import type { CSSProperties } from 'react';
import { CheckCircledIcon, Cross2Icon, CrossCircledIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Toaster } from 'sonner';

export function AtlasToaster() {
  return (
    <Toaster
      theme="system"
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
        success: <CheckCircledIcon className="size-[18px]" />,
        error: <CrossCircledIcon className="size-[18px]" />,
        info: <InfoCircledIcon className="size-[18px]" />,
        close: <Cross2Icon className="size-4" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-fit max-w-[320px] min-w-0 items-center border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3.5 py-2.5 text-[var(--text-primary)]',
          content: 'flex min-w-0 flex-1 flex-col justify-center',
          title: 'truncate pr-1 text-[13px] leading-none tracking-[-0.02em] text-[var(--text-primary)]',
          description: 'mt-1 line-clamp-1 pr-1 text-[11px] leading-[1.25] text-[var(--text-secondary)]',
          icon: 'mr-2.5 flex size-4 shrink-0 items-center justify-center text-[var(--text-secondary)]',
          closeButton:
            'ml-2 inline-flex size-5 shrink-0 items-center justify-center border border-transparent text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]',
          actionButton:
            'ml-2 inline-flex h-6 items-center border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2.5 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]',
        },
        style: { WebkitAppRegion: 'no-drag' } as CSSProperties,
      }}
    />
  );
}
