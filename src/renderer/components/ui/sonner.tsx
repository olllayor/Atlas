import type { CSSProperties } from 'react';
import { Toaster } from 'sonner';

import { cn } from '@/lib/utils';

function ToneDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn('block size-2 rounded-full', className)} />;
}

export function AtlasToaster() {
  return (
    <Toaster
      theme="system"
      position="top-right"
      expand={false}
      visibleToasts={3}
      closeButton={false}
      richColors={false}
      gap={10}
      offset={{ top: 64, right: 16 }}
      mobileOffset={{ top: 64, left: 12, right: 12 }}
      containerAriaLabel="Atlas notifications"
      icons={{
        success: <ToneDot className="bg-success" />,
        error: <ToneDot className="bg-error" />,
        info: <ToneDot className="bg-text-tertiary" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'w-[min(300px,calc(100vw-2rem))] rounded-xl border border-border-default bg-bg-elevated/88 px-3.5 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-xl',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'truncate text-[13px] font-medium tracking-[-0.01em] text-text-primary',
          description: 'line-clamp-2 text-[12px] leading-[1.35] text-text-tertiary',
          icon: 'mt-[7px] mr-3 flex size-2 shrink-0 items-center justify-center',
          actionButton:
            'ml-3 inline-flex items-center rounded-md bg-bg-hover px-2.5 py-1 text-[12px] font-medium text-text-primary transition hover:bg-bg-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-strong',
        },
        style: { WebkitAppRegion: 'no-drag' } as CSSProperties,
      }}
    />
  );
}
