/**
 * A three-state capability switch: Auto / Yes / No.
 *
 * Capabilities are three-valued everywhere else in the app — `null` means no
 * source has described the model — and the editor has to be able to express
 * that third state, otherwise opening a dialog to change one field silently
 * converts every unknown into a claim.
 *
 * "Auto" is first and is the resting state: the catalog fills it in when it
 * knows the model, and a provider refusal writes the answer down when it does
 * not. The other two are overrides for the case where both of those are wrong.
 */

import { fieldLabelClass } from './formPrimitives';

export type CapabilityValue = boolean | null;

const OPTIONS: Array<{ value: CapabilityValue; label: string; hint: string }> = [
  { value: null, label: 'Auto', hint: 'Let the catalog and the provider decide' },
  { value: true, label: 'Yes', hint: 'Always offer this' },
  { value: false, label: 'No', hint: 'Never offer this' },
];

export function CapabilityControl({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: CapabilityValue;
  onChange: (value: CapabilityValue) => void;
}) {
  return (
    <div>
      <span className={fieldLabelClass} id={`${id}-label`}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        // One control, three segments — a row of buttons rather than a select,
        // because all three states are worth reading at a glance when scanning
        // a model that is behaving oddly.
        className="mt-2 inline-flex rounded-md border border-border-default bg-bg-subtle p-0.5"
      >
        {OPTIONS.map((option) => {
          const isSelected = option.value === value;

          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={option.hint}
              onClick={() => onChange(option.value)}
              className={`h-7 min-w-[52px] rounded-[5px] px-2.5 text-xs transition ${
                isSelected
                  ? 'bg-bg-button text-text-inverse'
                  : 'text-text-tertiary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-text-muted">{hint}</p>
    </div>
  );
}
