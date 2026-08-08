import { useCallback, useEffect, useRef, useState } from 'react';

import { notify } from '../lib/notify';

/**
 * Clipboard writes with a visible outcome.
 *
 * Copy is one of the app's most-used affordances and it used to fail
 * silently — the `catch` block swallowed the error, so a denied clipboard
 * permission or a non-secure context looked identical to a successful copy
 * that just did not show a checkmark. Every async action owes the user its
 * three states; this hook now surfaces the third one as a toast and as a
 * `failed` flag callers can render inline.
 */
export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    []
  );

  const resetAfterTimeout = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
      setFailed(false);
    }, timeout);
  }, [timeout]);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.append(textArea);
          textArea.focus();
          textArea.select();
          try {
            const ok = document.execCommand('copy');
            if (!ok) {
              throw new Error('execCommand("copy") returned false');
            }
          } finally {
            textArea.remove();
          }
        }

        setFailed(false);
        setCopied(true);
        resetAfterTimeout();
        return true;
      } catch (error) {
        setCopied(false);
        setFailed(true);
        resetAfterTimeout();
        notify({
          tone: 'error',
          title: 'Could not copy to clipboard',
          description: error instanceof Error ? error.message : undefined,
        });
        return false;
      }
    },
    [resetAfterTimeout]
  );

  return { copied, failed, copy };
}
