import React, { Profiler, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChatWindow } from './components/ChatWindow';
import { useAppStore } from './stores/useAppStore';
import type { ConversationPage, ChatMessage } from '../shared/contracts';
import './styles.css';

// Synthetic history: 40 completed messages + streaming placeholder
function makeHistory(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    conversationId: 'perf-conv',
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `User question ${i}` : `Assistant answer ${i} `.repeat(20),
    reasoning: null,
    parts: i % 2 === 0
      ? [{ id: `p${i}`, type: 'text' as const, text: `User question ${i}`, state: 'done' as const }]
      : [{ id: `p${i}`, type: 'text' as const, text: `Assistant answer ${i} `.repeat(20), state: 'done' as const }],
    status: 'complete' as const,
    providerId: 'test',
    modelId: 'test',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    errorCode: null,
    createdAt: new Date(Date.now() - (count - i) * 60000).toISOString(),
    latencyMs: 1200,
  }));
}

const streamingPlaceholder: ChatMessage = {
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

function Harness() {
  const [renderDurations, setRenderDurations] = useState<number[]>([]);
  const [flushTimes, setFlushTimes] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const flushCountRef = useRef(0);
  const chatWindowDurationsRef = useRef<number[]>([]);
  const streamingRowDurationsRef = useRef<number[]>([]);
  const longTasksRef = useRef<number[]>([]);
  const inputLatencyRef = useRef<number[]>([]);

  // Setup store with history + placeholder
  useEffect(() => {
    const history = makeHistory(40);
    const detail: ConversationPage = {
      conversation: {
        id: 'perf-conv',
        title: 'Perf Harness',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        defaultProviderId: 'test',
        defaultModelId: 'test',
      } as any,
      messages: [...history, streamingPlaceholder],
      hasOlder: false,
      nextCursor: null,
      limit: 100,
    };
    // Seed Zustand directly
    useAppStore.setState({
      conversationDetails: { 'perf-conv': detail },
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
    } as any);

    // Long task observer
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // @ts-ignore
          if (entry.duration > 50) longTasksRef.current.push(entry.duration);
        }
      });
      // @ts-ignore
      observer.observe({ entryTypes: ['longtask'] });
    } catch {}

    // Input latency test: simulate typing in composer during streaming
    let inputHandler: any = null;
    const composerInput = document.getElementById('perf-composer-input') as HTMLInputElement | null;
    if (composerInput) {
      inputHandler = (e: Event) => {
        const start = performance.now();
        // Simulate Zustand composer draft update (isolated)
        useAppStore.getState().setComposerDraft('perf-conv', (e.target as HTMLInputElement).value);
        const end = performance.now();
        inputLatencyRef.current.push(end - start);
      };
      composerInput.addEventListener('input', inputHandler);
    }

    // Start synthetic streaming: 2k tokens ~ 100 flushes * 20 tokens * 4 chars = 8000 chars
    const totalFlushes = 100;
    const tokensPerFlush = 20;
    const charsPerToken = 4;
    const deltaPerFlush = 'x'.repeat(tokensPerFlush * charsPerToken); // 80 chars
    // Use actual store's handleStreamEvent path to be realistic
    const store = useAppStore.getState();
    let flushIdx = 0;
    const interval = setInterval(() => {
      if (flushIdx >= totalFlushes) {
        clearInterval(interval);
        // Mark done after one more frame to let final render settle
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setDone(true);
            // Expose results
            (window as any).perfResults = {
              flushTimes: flushTimesRef.current,
              chatWindowDurations: chatWindowDurationsRef.current,
              streamingRowDurations: streamingRowDurationsRef.current,
              longTasks: longTasksRef.current,
              inputLatencies: inputLatencyRef.current,
              scrollTop: document.querySelector('[role="region"]')?.scrollTop,
              totalFlushes,
            };
            (window as any).perfDone = true;
            console.info('[perf-harness] done', (window as any).perfResults);
            observer?.disconnect();
          });
        });
        return;
      }
      const t0 = performance.now();
      performance.mark(`flush-${flushIdx}-start`);
      // Use the real reducer path: handleStreamEvent with chunk
      const event: any = {
        type: 'chunk',
        requestId: 'req-perf',
        id: 'text-1',
        delta: deltaPerFlush,
      };
      // Directly use store's internal logic to avoid async IPC
      // Apply via handleStreamEvent (will go through applyStreamingEvent)
      void store.handleStreamEvent(event);
      performance.mark(`flush-${flushIdx}-end`);
      try {
        performance.measure(`flush-${flushIdx}`, `flush-${flushIdx}-start`, `flush-${flushIdx}-end`);
      } catch {}
      const t1 = performance.now();
      flushTimesRef.current.push(t1 - t0);
      flushIdx += 1;
      flushCountRef.current = flushIdx;
    }, 33);

    return () => {
      clearInterval(interval);
      observer?.disconnect();
      if (composerInput && inputHandler) composerInput.removeEventListener('input', inputHandler);
    };
  }, []);

  const flushTimesRef = useRef<number[]>([]);
  // Keep refs in sync for profiler
  useEffect(() => {
    flushTimesRef.current = flushTimes;
  }, [flushTimes]);

  const onChatWindowRender = (
    id: string,
    phase: string,
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    if (id === 'ChatWindow') {
      chatWindowDurationsRef.current.push(actualDuration);
    } else if (id === 'StreamingRow') {
      streamingRowDurationsRef.current.push(actualDuration);
    }
    // Also collect for display
    if (actualDuration > 0) {
      setRenderDurations((prev) => [...prev.slice(-99), actualDuration]);
    }
  };

  const detail = useAppStore((s) => (s.selectedConversationId ? s.conversationDetails[s.selectedConversationId] ?? null : null));
  const draft = useAppStore((s) => (s.selectedConversationId ? s.draftsByConversation[s.selectedConversationId] ?? null : null));

  // Scroll verification
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollInfo, setScrollInfo] = useState({ top: 0, height: 0, stable: true });
  useEffect(() => {
    const el = document.querySelector('[role="region"]') as HTMLDivElement | null;
    if (!el) return;
    let lastTop = el.scrollTop;
    let jumps = 0;
    const onScroll = () => {
      const top = el.scrollTop;
      if (Math.abs(top - lastTop) > 200 && !done) {
        // Potential jump not caused by user
        jumps += 1;
      }
      lastTop = top;
      setScrollInfo({ top, height: el.scrollHeight, stable: jumps === 0 });
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [done]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, background: '#f5f5f5', fontSize: 12, fontFamily: 'monospace' }}>
        <div>Flushes: {flushCountRef.current} / 100 {done ? 'DONE' : 'STREAMING'}</div>
        <div>ChatWindow avg: {(chatWindowDurationsRef.current.reduce((a,b)=>a+b,0)/Math.max(1,chatWindowDurationsRef.current.length)).toFixed(2)}ms ({chatWindowDurationsRef.current.length} samples)</div>
        <div>Flush avg: {(flushTimesRef.current.reduce((a,b)=>a+b,0)/Math.max(1,flushTimesRef.current.length)).toFixed(2)}ms</div>
        <div>Long tasks: {longTasksRef.current.length}</div>
        <div>Scroll stable: {String(scrollInfo.stable)} top={scrollInfo.top.toFixed(0)} height={scrollInfo.height.toFixed(0)}</div>
        <input id="perf-composer-input" placeholder="type during streaming to test INP" style={{ width: 300, marginTop: 4 }} />
      </div>
      <Profiler id="ChatWindow" onRender={onChatWindowRender}>
        <ChatWindow
          detail={detail}
          draft={draft as any}
          hasCredential={true}
          isLoadingConversation={false}
          isLoadingOlder={false}
          onOpenSettings={() => {}}
          onSuggestionClick={() => {}}
          onLoadOlderMessages={async () => {}}
          onRespondToolApproval={async () => {}}
        />
      </Profiler>
      {done && (
        <div style={{ padding: 8, fontSize: 12, fontFamily: 'monospace', background: '#e8f5e9' }}>
          <pre>{JSON.stringify({ flushCount: flushCountRef.current, lastFlush: flushTimesRef.current[flushTimesRef.current.length-1]?.toFixed(2), avgChatWindow: (chatWindowDurationsRef.current.reduce((a,b)=>a+b,0)/chatWindowDurationsRef.current.length).toFixed(2), longTasks: longTasksRef.current.length, done }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>
);
