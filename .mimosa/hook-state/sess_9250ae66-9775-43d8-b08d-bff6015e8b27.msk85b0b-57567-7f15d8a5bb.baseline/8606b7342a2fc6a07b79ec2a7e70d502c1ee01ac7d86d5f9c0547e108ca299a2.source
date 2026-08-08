import { flushSync } from 'react-dom';

import { isReducedMotion } from './reducedMotion';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

export function runViewTransition(update: () => void) {
  // Read per call rather than caching: this is the only motion decision in the
  // module, and toggling Reduce motion has to take effect on the next
  // transition, not the next reload.
  if (typeof document === 'undefined' || isReducedMotion()) {
    update();
    return;
  }

  const viewTransitionDocument = document as ViewTransitionDocument;
  if (typeof viewTransitionDocument.startViewTransition !== 'function') {
    update();
    return;
  }

  const transition = viewTransitionDocument.startViewTransition(() => {
    flushSync(update);
  });

  void transition.finished.catch(() => {
    // Ignore transition failures and preserve the state update.
  });
}
