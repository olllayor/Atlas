import { Profiler, useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatWindow } from './components/ChatWindow';
import { Composer } from './components/Composer';
import { TooltipProvider } from './components/ui/tooltip';
import { useAppStore } from './stores/useAppStore';
import type { ConversationPage, ChatMessage } from '../shared/contracts';
import './styles.css';

// Mock window.atlasChat for harness runs outside Electron
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).atlasChat) {
  (window as unknown as Record<string, unknown>).atlasChat = {
    chat: {
      start: async () => ({ requestId: 'mock-req' }),
      stop: async () => {},
    },
    plugins: {
      list: async () => ({ plugins: [] }),
      listMarketplacePlugins: async () => [],
      commands: async () => [],
      getEnabled: async () => [],
    },
    conversations: {
      setWorkspace: async () => {},
    },
  };
}

// 40 completed history messages with realistic markdown-ish bodies.
function makeHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const isUser = i % 2 === 0;
    const text = isUser
      ? `User question ${i}: how does the virtualizer handle a long thread?`
      : `# Answer ${i}\n\nHere is a summary with **bold** and \`inline code\`:\n\n- point one for ${i}\n- point two for ${i}\n\n\`\`\`ts\nfunction f${i}() { return ${i}; }\n\`\`\`\n\nFinal paragraph of answer ${i} with enough text to wrap a few lines. `;
    return {
      id: `m${i}`,
      conversationId: 'perf-conv',
      role: isUser ? ('user' as const) : ('assistant' as const),
      content: text,
      reasoning: null,
      parts: [{ id: `p${i}`, type: 'text' as const, text, state: 'done' as const }],
      status: 'complete' as const,
      providerId: 'test',
      modelId: 'test',
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: 1200,
      errorCode: null,
      createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
    };
  });
}

// ~2k tokens of markdown, split into 33ms flushes.
const STREAM_CHUNKS: string[] = (() => {
  const full = `# Streaming answer\n\nThis is a **live** response with \`code\`, a list, and a fenced block:\n\n- item alpha\n- item beta\n- item gamma\n\n\`\`\`ts\nfunction streamed(x: number) {\n  return x * 2;\n}\n\`\`\`\n\n${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(60)}\n\n## Second section\n\nMore prose with *emphasis* and a [link](https://example.com).\n\n${'The quick brown fox jumps over the lazy dog. '.repeat(40)}\n`;
  const size = 80;
  const out: string[] = [];
  for (let i = 0; i < full.length; i += size) out.push(full.slice(i, i + size));
  return out;
})();

type FlushSample = { flushMs: number; chatMs: number };

export type TypingLatencySample = {
  key: string;
  phase: 'idle' | 'streaming';
  /** Event loop delay before keydown was processed (ms) */
  eventQueueMs: number;
  /** Synchronous keydown handling cost (ms) */
  syncJsMs: number;
  /** React commit time of Composer (ms) */
  composerCommitMs: number;
  /** Full keyboard-to-paint latency until frame presentation (ms) */
  keyboardToPaintMs: number;
};

function Harness() {
  const [done, setDone] = useState(false);
  const [composerValue, setComposerValue] = useState('');
  const samplesRef = useRef<FlushSample[]>([]);
  const longTasksRef = useRef<number[]>([]);
  const startedRef = useRef(false);
  const isStreamingRef = useRef(false);
  const flushIdxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const typingSamplesRef = useRef<{
    idle: TypingLatencySample[];
    streaming: TypingLatencySample[];
  }>({ idle: [], streaming: [] });

  const activeKeySampleRef = useRef<{
    key: string;
    eventTime: number;
    startTs: number;
    syncJsMs: number;
    composerCommitMs: number;
  } | null>(null);

  const detail = useAppStore((s) =>
    s.selectedConversationId ? (s.conversationDetails[s.selectedConversationId] ?? null) : null,
  );
  const draft = useAppStore((s) =>
    s.selectedConversationId ? (s.draftsByConversation[s.selectedConversationId] ?? null) : null,
  );

  const startStreaming = useCallback(() => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;
    flushIdxRef.current = 0;
    samplesRef.current = [];

    // Ensure draft is set to streaming
    const st = useAppStore.getState();
    useAppStore.setState({
      draftsByConversation: {
        ...st.draftsByConversation,
        'perf-conv': {
          requestId: 'req-perf',
          providerId: 'test',
          modelId: 'test',
          parts: [],
          status: 'streaming',
          startedAt: new Date().toISOString(),
        },
      },
    });

    const total = STREAM_CHUNKS.length;
    timerRef.current = setInterval(() => {
      const idx = flushIdxRef.current;
      if (idx >= total) {
        if (timerRef.current) clearInterval(timerRef.current);
        isStreamingRef.current = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const samples = samplesRef.current;
            const chat = samples.map((s) => s.chatMs).filter((v) => Number.isFinite(v));
            const flush = samples.map((s) => s.flushMs);
            const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
            const sorted = [...chat].sort((a, b) => a - b);
            const p = (q: number) =>
              sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0 : 0;
            const storeState = useAppStore.getState();
            const det = storeState.conversationDetails['perf-conv'];
            const orderOk =
              det != null &&
              det.messages.length === 41 &&
              det.messages[40]?.id === 'm-stream' &&
              det.messages[39]?.id === 'm39';
            (window as unknown as Record<string, unknown>).perfResults = {
              totalFlushes: total,
              samples: samples.length,
              avgChatMs: avg(chat),
              p50ChatMs: p(0.5),
              p95ChatMs: p(0.95),
              maxChatMs: sorted[sorted.length - 1] ?? 0,
              avgFlushMs: avg(flush),
              maxFlushMs: flush.length ? Math.max(...flush) : 0,
              longTasks: [...longTasksRef.current],
              longTaskCount: longTasksRef.current.length,
              messageCount: det?.messages.length ?? -1,
              orderOk,
              streamingTextLen: JSON.stringify(det?.messages[40]?.parts ?? []).length,
            };
            (window as unknown as Record<string, unknown>).perfDone = true;
            setDone(true);
          });
        });
        return;
      }

      const t0 = performance.now();
      const chunk = STREAM_CHUNKS[idx] ?? '';
      void useAppStore.getState().handleStreamEvent({
        type: 'chunk',
        requestId: 'req-perf',
        id: 'text-1',
        delta: chunk,
      } as never);
      const t1 = performance.now();
      samplesRef.current.push({ flushMs: t1 - t0, chatMs: Number.NaN });
      flushIdxRef.current += 1;
      const counter = document.getElementById('perf-flush-count');
      if (counter) counter.textContent = `Flushes: ${flushIdxRef.current} / ${total} STREAMING`;
    }, 33);
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const history = makeHistory(40);
    const placeholder: ChatMessage = {
      id: 'm-stream',
      conversationId: 'perf-conv',
      role: 'assistant',
      content: '',
      reasoning: null,
      parts: [],
      status: 'streaming',
      providerId: 'test',
      modelId: 'test',
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: new Date().toISOString(),
    };
    const page: ConversationPage = {
      conversation: {
        id: 'perf-conv',
        title: 'Perf Harness',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        defaultProviderId: 'test',
        defaultModelId: 'test',
      } as ConversationPage['conversation'],
      messages: [...history, placeholder],
      hasOlder: false,
      nextCursor: null,
      limit: 100,
    };

    useAppStore.setState({
      conversationDetails: { 'perf-conv': page },
      selectedConversationId: 'perf-conv',
      draftsByConversation: {
        'perf-conv': {
          requestId: 'req-perf',
          providerId: 'test',
          modelId: 'test',
          parts: [],
          status: 'idle',
          startedAt: new Date().toISOString(),
        },
      },
      requestToConversation: { 'req-perf': 'perf-conv' },
    } as never);

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const d = (entry as PerformanceEntry & { duration: number }).duration;
          if (d > 50) longTasksRef.current.push(d);
        }
      });
      observer.observe({ entryTypes: ['longtask'] } as PerformanceObserverInit);
    } catch {
      observer = null;
    }

    (window as unknown as Record<string, unknown>).__startStreaming = startStreaming;
    (window as unknown as Record<string, unknown>).__getTypingMetrics = () => typingSamplesRef.current;
    (window as unknown as Record<string, unknown>).__clearTypingMetrics = () => {
      typingSamplesRef.current = { idle: [], streaming: [] };
    };
    (window as unknown as Record<string, unknown>).__isStreaming = () => isStreamingRef.current;
    (window as unknown as Record<string, unknown>).__flushCount = () => flushIdxRef.current;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') !== 'false';
    if (autostart) {
      startStreaming();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      observer?.disconnect();
    };
  }, [startStreaming]);

  const onChatWindowRender = (_id: string, _phase: string, actualDuration: number) => {
    const pending = samplesRef.current[samplesRef.current.length - 1];
    if (pending && Number.isNaN(pending.chatMs)) {
      pending.chatMs = actualDuration;
    }
  };

  const onComposerRender = (_id: string, _phase: string, actualDuration: number) => {
    if (activeKeySampleRef.current) {
      activeKeySampleRef.current.composerCommitMs = actualDuration;
    }
  };

  // Set up high-resolution keyboard-to-paint measurement on the composer textarea
  useEffect(() => {
    const textarea = document.querySelector('textarea[aria-label="Message"]') as HTMLTextAreaElement | null;
    if (!textarea) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      const startTs = performance.now();
      const eventTime = e.timeStamp;
      const sample = {
        key: e.key,
        eventTime,
        startTs,
        syncJsMs: 0,
        composerCommitMs: 0,
      };
      activeKeySampleRef.current = sample;

      // Real keyboard-to-paint measurement: double rAF ensures paint has happened
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const paintDone = performance.now();
          const phase = isStreamingRef.current ? 'streaming' : 'idle';
          const completedSample: TypingLatencySample = {
            key: sample.key,
            phase,
            eventQueueMs: Math.max(0, sample.startTs - sample.eventTime),
            syncJsMs: sample.syncJsMs,
            composerCommitMs: sample.composerCommitMs,
            keyboardToPaintMs: Math.max(0, paintDone - sample.eventTime),
          };
          typingSamplesRef.current[phase].push(completedSample);
          if (activeKeySampleRef.current === sample) {
            activeKeySampleRef.current = null;
          }
        });
      });
    };

    const onInput = () => {
      if (activeKeySampleRef.current) {
        activeKeySampleRef.current.syncJsMs = performance.now() - activeKeySampleRef.current.startTs;
      }
    };

    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('input', onInput);
    return () => {
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('input', onInput);
    };
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, background: '#f5f5f5', fontSize: 12, fontFamily: 'monospace' }}>
        <div id="perf-flush-count">
          Flushes: {flushIdxRef.current} / {STREAM_CHUNKS.length} {isStreamingRef.current ? 'STREAMING' : 'IDLE'}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Profiler id="ChatWindow" onRender={onChatWindowRender}>
          <TooltipProvider>
            <ChatWindow
              detail={detail}
              draft={draft as never}
              hasCredential
              isLoadingConversation={false}
              isLoadingOlder={false}
              onOpenSettings={() => {}}
              onSuggestionClick={() => {}}
              onLoadOlderMessages={async () => {}}
              onRespondToolApproval={async () => {}}
            />
          </TooltipProvider>
        </Profiler>
      </div>
      <Profiler id="Composer" onRender={onComposerRender}>
        <div style={{ borderTop: '1px solid #e5e5e5', padding: '8px 16px', background: '#fff' }}>
          <TooltipProvider>
            <Composer
              conversationId="perf-conv"
              draftRequestId="req-perf"
              draftStatus={draft?.status === 'streaming' ? 'streaming' : null}
              isStreaming={isStreamingRef.current}
              queuedCount={0}
              attachments={[]}
              onAttachmentsChange={() => {}}
              citations={[]}
              onCitationsChange={() => {}}
              onChange={(text) => {
                setComposerValue(text);
                useAppStore.getState().setComposerDraft('perf-conv', text);
              }}
              value={composerValue}
              disabled={false}
              models={[]}
              selectedModelId="test"
              selectedProviderId="test"
              onSend={() => {}}
              onAbort={() => {}}
              onOpenGallery={() => {}}
              modelPickerOpen={false}
              onModelPickerOpenChange={() => {}}
              composerFocusNonce={0}
              onComposerFocusChange={() => {}}
              workspaceMode="work"
              workspaceReady={true}
              onWorkspaceModeChange={() => {}}
              toolPermissionMode="ask"
              onToolPermissionModeChange={() => {}}
              credentials={[]}
                            onSelectModel={() => {}}
              reasoningEffort="off"
              onReasoningEffortChange={() => {}}
              customProviders={[]}
            />
          </TooltipProvider>
        </div>
      </Profiler>
      {done && <div style={{ padding: 4, fontSize: 11, fontFamily: 'monospace' }}>DONE</div>}
    </div>
  );
}

// Test hooks for the benchmark runner
(window as unknown as Record<string, unknown>).harness = {
  store: useAppStore,
  startStreaming: () => {
    const fn = (window as unknown as Record<string, unknown>).__startStreaming as (() => void) | undefined;
    fn?.();
  },
  settleTurn: () => {
    const st = useAppStore.getState();
    const det = st.conversationDetails['perf-conv'];
    if (!det) return { ok: false };
    const beforeTop = document.querySelector('[role="region"]')?.scrollTop ?? -1;
    const beforeHeight = document.querySelector('[role="region"]')?.scrollHeight ?? -1;
    const messages = det.messages.map((m) =>
      m.id === 'm-stream' ? { ...m, status: 'complete' as const } : m,
    );
    const { ['perf-conv']: _dropped, ...restDrafts } = st.draftsByConversation;
    useAppStore.setState({
      conversationDetails: { ...st.conversationDetails, 'perf-conv': { ...det, messages } },
      draftsByConversation: restDrafts,
    });
    return { ok: true, beforeTop, beforeHeight };
  },
  getTypingMetrics: () => {
    const fn = (window as unknown as Record<string, unknown>).__getTypingMetrics as
      | (() => { idle: TypingLatencySample[]; streaming: TypingLatencySample[] })
      | undefined;
    return fn ? fn() : { idle: [], streaming: [] };
  },
  clearTypingMetrics: () => {
    const fn = (window as unknown as Record<string, unknown>).__clearTypingMetrics as (() => void) | undefined;
    fn?.();
  },
  isStreaming: () => {
    const fn = (window as unknown as Record<string, unknown>).__isStreaming as (() => boolean) | undefined;
    return fn ? fn() : false;
  },
  flushCount: () => {
    const fn = (window as unknown as Record<string, unknown>).__flushCount as (() => number) | undefined;
    return fn ? fn() : 0;
  },
};

function HarnessWrapper() {
  const harnessRef = useRef<ReturnType<typeof Harness> | null>(null);
  return <Harness />;
}

// Attach callbacks into window.__startStreaming and window.__getTypingMetrics inside Harness
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
