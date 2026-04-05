import type { AppUpdateSnapshot } from '../../shared/contracts';
import { DownloadIcon, LoaderCircleIcon, RotateCcwIcon } from 'lucide-react';

type AppUpdateButtonProps = {
  updateState: AppUpdateSnapshot;
  onClick: () => void;
};

function getButtonLabel(updateState: AppUpdateSnapshot) {
  switch (updateState.status) {
    case 'available':
      return 'Update';
    case 'downloading':
      return 'Downloading...';
    case 'downloaded':
      return 'Restart';
    default:
      return null;
  }
}

export function AppUpdateButton({ updateState, onClick }: AppUpdateButtonProps) {
  const label = getButtonLabel(updateState);

  if (!label) {
    return null;
  }

  const disabled = updateState.status === 'downloading';
  const icon =
    updateState.status === 'downloading' ? (
      <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
    ) : updateState.status === 'downloaded' ? (
      <RotateCcwIcon className="h-3.5 w-3.5" />
    ) : (
      <DownloadIcon className="h-3.5 w-3.5" />
    );
  const toneClass =
    updateState.status === 'downloaded'
      ? 'border-white/20 bg-white/[0.05] text-white/70 hover:border-white/30 hover:bg-white/[0.08] hover:text-white'
      : updateState.status === 'downloading'
        ? 'border-white/10 bg-transparent text-white/30'
        : 'border-white/10 bg-transparent text-white/50 hover:border-white/20 hover:bg-white/[0.05] hover:text-white/70';

  return (
    <div
      className="absolute inset-y-0 right-4 z-10 flex items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex h-8 items-center gap-1.5 border px-2.5 text-[11.5px] font-medium tracking-[0.01em] transition ${toneClass} ${
          disabled ? 'cursor-default' : ''
        }`}
      >
        {icon}
        {label}
      </button>
    </div>
  );
}
