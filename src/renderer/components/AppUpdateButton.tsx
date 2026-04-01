import type { AppUpdateSnapshot } from '../../shared/contracts';

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

  return (
    <div className="absolute inset-y-0 left-4 z-10 flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex h-8 items-center rounded-full px-4 text-[13px] font-semibold tracking-[0.01em] text-white shadow-[0_6px_18px_rgba(10,132,255,0.24),inset_0_1px_0_rgba(255,255,255,0.16)] transition ${
          disabled
            ? 'cursor-default bg-[#2b5f99] opacity-75'
            : 'bg-[#0a84ff] hover:bg-[#2994ff] active:scale-[0.98]'
        }`}
      >
        {label}
      </button>
    </div>
  );
}
