import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export type DeleteThreadDialogProps = {
  open: boolean;
  threadTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation dialog for permanently deleting a thread.
 * Matches the native macOS dark card modal design with clear distinction
 * between cancel and destructive confirm actions.
 */
export function DeleteThreadDialog({
  open,
  threadTitle,
  onConfirm,
  onCancel,
}: DeleteThreadDialogProps) {
  const trimmed = threadTitle.trim();
  const displayTitle = trimmed.length > 100 ? `${trimmed.slice(0, 100).trim()}...` : trimmed;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      {/* design-tokens-allow: dedicated dark modal card and scrim matching native desktop alert specification */}
      <DialogContent
        className="sm:max-w-[480px] rounded-2xl border border-white/10 bg-[#161619] p-6 shadow-2xl duration-150 outline-none"
        overlayClassName="bg-black/60"
        showCloseButton={false}
      >
        <DialogHeader className="gap-2 text-left">
          {/* design-tokens-allow: high contrast white title for modal card */}
          <DialogTitle className="text-[17px] font-semibold tracking-tight text-white leading-snug break-words whitespace-pre-line">
            Delete thread &quot;{displayTitle}&quot;?
          </DialogTitle>
          {/* design-tokens-allow: secondary gray text for modal description */}
          <DialogDescription className="text-sm text-zinc-400">
            This permanently clears conversation history for this thread.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 flex items-center justify-end gap-3">
          {/* design-tokens-allow: dark cancel button matching macOS alert design */}
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-[#222226] px-4 text-sm font-medium text-white transition-colors hover:bg-[#2c2c32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            Cancel
          </button>
          {/* design-tokens-allow: prominent red destructive confirm button */}
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-[#ef4444] px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#dc2626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Confirm
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
