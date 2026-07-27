import { Brain, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';

import type { ReasoningEffort, ToolPermissionMode } from '../../../shared/chatParameters';
import {
  REASONING_EFFORTS,
  TOOL_PERMISSION_MODES,
  describeReasoningEffort,
  describeToolPermissionMode
} from '../../../shared/chatParameters';
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
      icon={<Icon className="h-3.5 w-3.5 shrink-0" />}
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

export function ReasoningEffortControl({
  value,
  disabled,
  supported,
  onChange
}: {
  value: ReasoningEffort;
  disabled?: boolean;
  /** False when the selected model has no thinking mode to spend budget on. */
  supported: boolean;
  onChange: (value: ReasoningEffort) => void;
}) {
  if (!supported) {
    return null;
  }

  return (
    <ParameterMenu
      ariaLabel="Reasoning effort"
      label={describeReasoningEffort(value).label}
      value={value}
      icon={<Brain className="h-3.5 w-3.5 shrink-0" />}
      options={REASONING_EFFORTS.map((entry) => ({
        value: entry.value,
        label: entry.label,
        hint: entry.hint
      }))}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
