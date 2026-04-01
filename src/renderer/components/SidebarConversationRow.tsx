type SidebarConversationRowProps = {
  isActive: boolean;
  isCollapsed: boolean;
  isRunning: boolean;
  primaryLabel: string;
  secondaryLabel: string | null;
  timestampLabel: string | null;
  status: 'idle' | 'streaming' | 'error' | 'aborted';
};

export function SidebarConversationRow({
  isCollapsed,
  isRunning,
  primaryLabel,
  secondaryLabel,
  timestampLabel,
  status,
}: SidebarConversationRowProps) {
  const collapsedSpacer = isCollapsed && !isRunning;

  return (
    <>
      {isRunning ? (
        <span
          aria-hidden="true"
          className={`relative shrink-0 rounded-full border border-cyan-300/45 bg-cyan-300/28 shadow-[0_0_0_4px_rgba(34,211,238,0.10)] ${isCollapsed ? 'h-2.5 w-2.5' : 'mt-0.5 h-2 w-2'}`}
        >
          <span className="absolute inset-[-4px] rounded-full bg-cyan-300/16 animate-ping" />
        </span>
      ) : collapsedSpacer ? (
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 opacity-0" />
      ) : null}

      {!isCollapsed ? (
        <>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-[18px] text-white/92" title={primaryLabel}>
              {primaryLabel}
            </div>
            {secondaryLabel ? (
              <div
                className={`truncate pt-0.5 text-[11px] leading-4 ${
                  status === 'streaming'
                    ? 'animate-pulse text-white/48'
                    : status === 'error'
                      ? 'text-error-text/80'
                      : status === 'aborted'
                        ? 'text-text-muted'
                        : 'text-text-muted'
                }`}
                title={secondaryLabel}
              >
                {secondaryLabel}
              </div>
            ) : null}
          </div>

          {timestampLabel ? (
            <span className="shrink-0 self-start pl-2 text-[10px] font-medium leading-4 tabular-nums text-white/34">
              {timestampLabel}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );
}
