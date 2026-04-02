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
      ? 'border-[#5d78d8]/18 bg-[#5d78d8]/10 text-[#dbe5ff] hover:border-[#6c87eb]/24 hover:bg-[#5d78d8]/14'
      : updateState.status === 'downloading'
        ? 'border-white/6 bg-white/[0.025] text-white/54'
        : 'border-white/6 bg-white/[0.025] text-white/68 hover:border-white/10 hover:bg-white/[0.045] hover:text-white/82';

  return (
    <div
      className="absolute inset-y-0 right-4 z-10 flex items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11.5px] font-medium tracking-[0.01em] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur-sm transition ${toneClass} ${
          disabled ? 'cursor-default' : 'active:scale-[0.985]'
        }`}
      >
        {icon}
        {label}
      </button>
    </div>
  );
}
