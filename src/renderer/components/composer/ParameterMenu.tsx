import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ParameterOption<T extends string> = {
  value: T;
  label: string;
  hint: string;
};

/**
 * Compact menu for the composer's parameter controls.
 *
 * Radix portals the content to the body, which matters here: the composer shell
 * is `overflow-hidden`, so a plain absolutely-positioned panel gets clipped by
 * its own container. Radix also handles flipping when there is no room above.
 */
export function ParameterMenu<T extends string>({
  label,
  value,
  options,
  icon,
  tone = 'default',
  variant = 'pill',
  disabled,
  ariaLabel,
  labelClassName,
  tooltip,
  onChange,
}: {
  label: string;
  value: T;
  options: ParameterOption<T>[];
  icon?: ReactNode;
  tone?: 'default' | 'warning';
  /**
   * `pill`: icon + label dim button (left cluster of the control row).
   * `word`: bare dim word + chevron, meant to dock against the model chip.
   */
  variant?: 'pill' | 'word';
  disabled?: boolean;
  ariaLabel: string;
  /** Hidden below this container width so the row never overflows. */
  labelClassName?: string;
  /** Hover/focus explanation; the label alone is not self-describing. */
  tooltip?: ReactNode;
  onChange: (value: T) => void;
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-warning-text hover:bg-bg-hover'
      : variant === 'word'
        ? 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary';
  const layoutClass = variant === 'word' ? 'h-9 gap-1 px-1.5' : 'h-9 gap-1.5 px-2.5';

  const trigger = (
    <DropdownMenuTrigger asChild disabled={disabled}>
      <button
        type="button"
        aria-label={ariaLabel}
        // `group` so the chevron can react to the open state Radix stamps on
        // the button (the SVG itself never gets `data-state`).
        className={`group flex min-w-0 items-center rounded-full text-sm font-normal transition outline-none focus-visible:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-bg-hover ${layoutClass} ${toneClass}`}
      >
        {icon}
        <span className={`min-w-0 truncate ${labelClassName ?? ''}`}>{label}</span>
        <ChevronDown
          className={`size-4 shrink-0 opacity-70 transition-transform group-data-[state=open]:rotate-180 ${labelClassName ?? ''}`}
          strokeWidth={1.75}
        />
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {tooltip ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        aria-label={ariaLabel}
        className="w-[260px] rounded-lg border border-border-default bg-bg-overlay p-1 shadow-none"
      >
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 focus:bg-bg-hover"
            >
              <span className="mt-0.5 w-3.5 shrink-0">
                {isActive ? <Check className="size-3.5 text-text-secondary" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={`text-sm leading-5 ${isActive ? 'text-text-primary' : 'text-text-secondary'}`}
                >
                  {option.label}
                </span>
                <span className="text-2xs leading-4 text-text-tertiary">{option.hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
