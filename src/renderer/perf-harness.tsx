import { Profiler, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatWindow } from './components/ChatWindow';
import { TooltipProvider } from './components/ui/tooltip';
import { useAppStore } from './stores/useAppStore';
import type { ConversationPage, ChatMessage } from '../shared/contracts';
import './styles.css';

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

type Sample = { flushMs: number; chatMs: number };

function Harness() {
  const [done, setDone] = useState(false);
  const samplesRef = useRef<Sample[]>([]);
  const longTasksRef = useRef<number[]>([]);
  const startedRef = useRef(false);

  const detail = useAppStore((s) =>
    s.selectedConversationId ? (s.conversationDetails[s.selectedConversationId] ?? null) : null,
  );
  const draft = useAppStore((s) =>
    s.selectedConversationId ? (s.draftsByConversation[s.selectedConversationId] ?? null) : null,
  );

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
          status: 'streaming',
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

    let flushIdx = 0;
    const total = STREAM_CHUNKS.length;
    const timer = setInterval(() => {
      if (flushIdx >= total) {
        clearInterval(timer);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const samples = samplesRef.current;
            const chat = samples.map((s) => s.chatMs).filter((v) => Number.isFinite(v));
            const flush = samples.map((s) => s.flushMs);
            const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
            const sorted = [...chat].sort((a, b) => a - b);
            const p = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0 : 0);
            const st = useAppStore.getState();
            const det = st.conversationDetails['perf-conv'];
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
            observer?.disconnect();
          });
        });
        return;
      }
      const t0 = performance.now();
      const chunk = STREAM_CHUNKS[flushIdx] ?? '';
      void useAppStore.getState().handleStreamEvent({
        type: 'chunk',
        requestId: 'req-perf',
        id: 'text-1',
        delta: chunk,
      } as never);
      const t1 = performance.now();
      // flushMs records the synchronous store-update cost; the React commit
      // cost lands via the Profiler callback below, keyed by this flush.
      samplesRef.current.push({ flushMs: t1 - t0, chatMs: Number.NaN });
      flushIdx += 1;
      const counter = document.getElementById('perf-flush-count');
      if (counter) counter.textContent = `Flushes: ${flushIdx} / ${total} STREAMING`;
    }, 33);

    return () => {
      clearInterval(timer);
      observer?.disconnect();
    };
  }, []);

  const onRender = (_id: string, _phase: string, actualDuration: number) => {
    // Pair each ChatWindow commit with the most recent flush that has no
    // commit yet. Mount commits before the first flush find no sample and
    // are ignored.
    const pending = samplesRef.current[samplesRef.current.length - 1];
    if (pending && Number.isNaN(pending.chatMs)) {
      pending.chatMs = actualDuration;
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, background: '#f5f5f5', fontSize: 12, fontFamily: 'monospace' }}>
        <div id="perf-flush-count">Flushes: 0 / {STREAM_CHUNKS.length} STREAMING</div>
        <input
          id="perf-composer-input"
          placeholder="type during streaming to test INP"
          style={{ width: 320, marginTop: 4 }}
        />
      </div>
      <Profiler id="ChatWindow" onRender={onRender}>
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
      {done && <div style={{ padding: 4, fontSize: 11, fontFamily: 'monospace' }}>DONE</div>}
    </div>
  );
}

// Test hooks for the Playwright driver (not part of the app).
(window as unknown as Record<string, unknown>).harness = {
  store: useAppStore,
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
};

// No StrictMode: double-mount would run the 33ms stream twice.
ReactDOM.createRoot(document.getElementById('root')!).render(<Harness />);
