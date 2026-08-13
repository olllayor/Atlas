import { useEffect, useState, type CSSProperties } from 'react';
import {
  CheckCircledIcon,
  Cross2Icon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon
} from '@radix-ui/react-icons';
import { Toaster } from 'sonner';

type ResolvedTheme = 'light' | 'dark';

function readDocumentTheme(): ResolvedTheme {
  if (typeof document === 'undefined') {
    return 'dark';
  }

  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Mirrors the theme App.tsx stamps onto `<html data-theme>` so the toaster never
 * disagrees with the app's resolved mode (the old `theme="system"` did).
 */
function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(readDocumentTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readDocumentTheme());

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  return theme;
}

export function AtlasToaster() {
  const theme = useResolvedTheme();

  return (
    <Toaster
      theme={theme}
      position="top-right"
      expand={false}
      visibleToasts={3}
      closeButton
      richColors={false}
      gap={8}
      offset={{ top: 64, right: 16 }}
      mobileOffset={{ top: 64, left: 12, right: 12 }}
      containerAriaLabel="Atlas notifications"
      icons={{
        success: <CheckCircledIcon className="size-4" />,
        error: <CrossCircledIcon className="size-4" />,
        warning: <ExclamationTriangleIcon className="size-4" />,
        info: <InfoCircledIcon className="size-4" />,
        close: <Cross2Icon className="size-4" />
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          // `items-start`, not `items-center`: a two-line body would push the
          // icon and the close button to the vertical middle of the block,
          // away from the title they belong to.
          toast:
            'group/toast flex w-fit max-w-[340px] min-w-0 items-start rounded-xl border border-toast-border bg-toast-bg px-3.5 py-2.5 text-toast-text shadow-elevated backdrop-blur-sm',
          content: 'flex min-w-0 flex-1 flex-col justify-center',
          // Two lines, not one. `truncate` here was silently eating the back
          // half of every error message the app raised.
          title: 'line-clamp-2 pr-1 text-sm leading-snug tracking-[-0.02em] text-text-primary',
          description: 'mt-1 line-clamp-3 pr-1 text-2xs leading-[1.35] text-toast-text',
          icon: [
            // `mt-px` aligns the glyph to the first line's cap height now that
            // the row is top-aligned.
            'mr-2.5 mt-px flex size-4 shrink-0 items-center justify-center text-toast-icon',
            'group-data-[type=success]/toast:text-success',
            'group-data-[type=error]/toast:text-error',
            'group-data-[type=warning]/toast:text-warning',
            '[&_svg]:size-4'
          ].join(' '),
          // `order-last`: sonner emits the close button before the icon, which
          // put a ✕ and a ⊗ side by side at the head of the row and read as
          // two competing status glyphs. It belongs at the trailing edge.
          closeButton:
            'order-last ml-2 mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-md !border-0 !bg-transparent text-toast-close opacity-60 transition hover:bg-bg-hover hover:text-toast-close-hover hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong [&>svg]:size-3',
          actionButton:
            'ml-2 inline-flex h-6 items-center rounded-md border border-border-subtle bg-bg-subtle px-2.5 text-2xs text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong'
        },
        style: { WebkitAppRegion: 'no-drag' } as CSSProperties
      }}
    />
  );
}
