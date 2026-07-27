import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ParameterOption<T extends string> = {
  value: T;
  label: string;
  hint: string;
};

/**
 * Compact menu for the composer's parameter pills.
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
  disabled,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: T;
  options: ParameterOption<T>[];
  icon?: ReactNode;
  tone?: 'default' | 'warning';
  disabled?: boolean;
  ariaLabel: string;
  onChange: (value: T) => void;
}) {
  const toneClass =
    tone === 'warning'
      ? 'text-[var(--warning-text)] hover:bg-[var(--bg-ghost)]'
      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-ghost)] hover:text-[var(--text-primary)]';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-normal transition outline-none focus-visible:bg-[var(--bg-ghost)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-[var(--bg-ghost)] ${toneClass}`}
        >
          {icon}
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-60 transition-transform data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        aria-label={ariaLabel}
        className="w-[260px] rounded-xl border-border-medium bg-bg-overlay p-1 shadow-elevated"
      >
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <DropdownMenuItem
              key={option.value}
              onSelect={() => onChange(option.value)}
              className="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 focus:bg-[var(--bg-hover)]"
            >
              <span className="mt-0.5 w-3.5 shrink-0">
                {isActive ? <Check className="h-3.5 w-3.5 text-[var(--text-secondary)]" /> : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={`text-[12.5px] leading-4 ${
                    isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {option.label}
                </span>
                <span className="text-[11px] leading-4 text-[var(--text-faint)]">{option.hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
