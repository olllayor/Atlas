/**
 * One gate for cold start. The renderer awaits `ready` before any real IPC;
 * main resolves it only after those handlers exist. Resolve is idempotent so a
 * second settle cannot throw or leave a dangling pending promise.
 */
export type BootReadyGate = {
  ready: Promise<void>;
  resolve: () => void;
};

export function createBootReadyGate(): BootReadyGate {
  let settle: (() => void) | null = null;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return {
    ready,
    resolve() {
      settle?.();
      settle = null;
    },
  };
}
