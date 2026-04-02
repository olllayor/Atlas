let messageRenderingModulePromise: Promise<typeof import('../components/ai-elements/MessageResponseContent')> | null = null;

export function loadMessageRenderingModule() {
  if (!messageRenderingModulePromise) {
    messageRenderingModulePromise = import('../components/ai-elements/MessageResponseContent');
  }

  return messageRenderingModulePromise;
}

export function prewarmMessageRendering() {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const browserWindow = window as Window & typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  const run = () => {
    void loadMessageRenderingModule();
  };

  if (typeof browserWindow.requestIdleCallback === 'function' && typeof browserWindow.cancelIdleCallback === 'function') {
    const idleId = browserWindow.requestIdleCallback(run, { timeout: 1200 });
    return () => browserWindow.cancelIdleCallback?.(idleId);
  }

  const timeoutId = globalThis.setTimeout(run, 64);
  return () => globalThis.clearTimeout(timeoutId);
}
