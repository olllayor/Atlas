type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => { finished: Promise<void> };
};

export function runViewTransition(callback: () => void) {
  const documentWithViewTransition = document as DocumentWithViewTransition;

  if (typeof documentWithViewTransition.startViewTransition !== 'function') {
    callback();
    return;
  }

  void documentWithViewTransition.startViewTransition(() => {
    callback();
  }).finished.catch(() => {
    // Ignore transition failures and preserve the state update.
  });
}
