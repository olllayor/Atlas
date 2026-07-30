import { ChevronDownIcon } from '@radix-ui/react-icons';

import type { CustomProviderApiFormat } from '../../../shared/customProviders';
import { CUSTOM_PROVIDER_API_FORMATS } from '../../../shared/customProviders';

/**
 * Native select on purpose: the option list is short, fixed, and benefits from
 * platform keyboard behaviour more than from custom styling.
 */
export function ApiFormatSelect({
  id,
  value,
  onChange
}: {
  id?: string;
  value: CustomProviderApiFormat;
  onChange: (value: CustomProviderApiFormat) => void;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CustomProviderApiFormat)}
        className="h-9 w-full appearance-none rounded-md border border-border-default bg-bg-subtle px-3 pr-9 text-sm text-text-primary outline-none transition focus:border-border-strong"
      >
        {CUSTOM_PROVIDER_API_FORMATS.map((format) => (
          <option key={format.value} value={format.value}>
            {format.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
    </div>
  );
}
