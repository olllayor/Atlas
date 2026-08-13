import type { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';

/**
 * One confirm surface for every destructive or lossy action in the providers
 * subtree. Radix gives us focus trap, Escape and scroll lock for free.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[440px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className={tone === 'danger' ? 'text-error' : undefined}>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm leading-5 text-text-tertiary">{description}</div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-default bg-bg-subtle px-4 text-xs text-text-primary transition hover:bg-bg-hover"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-xs transition ${
              tone === 'danger'
                ? 'border border-error-border bg-error-bg text-error-text hover:bg-error-bg hover:brightness-125'
                : 'bg-bg-button text-text-inverse hover:bg-bg-button-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
