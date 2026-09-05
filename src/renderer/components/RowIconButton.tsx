import React from 'react';
import { cn } from '../lib/utils';

export function RowIconButton({
  icon,
  label,
  text,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  text?: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-bg-active hover:text-text-primary',
        text ? 'h-6 gap-1 px-1.5 text-3xs' : 'size-6',
        className
      )}
    >
      {icon}
      {text ? <span>{text}</span> : null}
    </button>
  );
}
