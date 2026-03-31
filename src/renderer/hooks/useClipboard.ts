import { useCallback, useState } from 'react';

export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);

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
            document.execCommand('copy');
          } finally {
            textArea.remove();
          }
        }
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        // Silently fail
      }
    },
    [timeout]
  );

  return { copied, copy };
}
