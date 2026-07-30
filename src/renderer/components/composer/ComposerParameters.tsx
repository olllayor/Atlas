import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import { TOOL_PERMISSION_MODES, describeToolPermissionMode } from '../../../shared/chatParameters';
import { ParameterMenu } from './ParameterMenu';

const MODE_ICONS: Record<ToolPermissionMode, typeof ShieldCheck> = {
  'read-only': ShieldCheck,
  ask: ShieldQuestion,
  'full-access': ShieldAlert
};

export function ToolPermissionModeControl({
  value,
  disabled,
  onChange
}: {
  value: ToolPermissionMode;
  disabled?: boolean;
  onChange: (value: ToolPermissionMode) => void;
}) {
  const mode = describeToolPermissionMode(value);
  const Icon = MODE_ICONS[value] ?? ShieldQuestion;

  return (
    <ParameterMenu
      ariaLabel="Tool permission mode"
      label={mode.label}
      value={value}
      // Full access is the only setting that runs shell commands unprompted, so
      // it is the only one that gets the warning accent.
      tone={mode.risk === 'high' ? 'warning' : 'default'}
      icon={<Icon className="size-4 shrink-0" strokeWidth={1.75} />}
      // Below ~26rem of composer width the pill drops to its shield glyph so the
      // model chip and send button keep their room.
      labelClassName="hidden @min-[26rem]:inline"
      tooltip={
        <span>
          Tool permissions — <span className="text-text-secondary">{mode.label}</span>
        </span>
      }
      options={TOOL_PERMISSION_MODES.map((entry) => ({
        value: entry.value,
        label: entry.label,
        hint: entry.hint
      }))}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
