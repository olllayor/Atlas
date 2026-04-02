import { flushSync } from 'react-dom';

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function runViewTransition(update: () => void) {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    update();
    return;
  }

  const viewTransitionDocument = document as ViewTransitionDocument;
  if (typeof viewTransitionDocument.startViewTransition !== 'function') {
    update();
    return;
  }

  viewTransitionDocument.startViewTransition(() => {
    flushSync(update);
  });
}
