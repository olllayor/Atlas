import { EyeClosedIcon, EyeOpenIcon } from '@radix-ui/react-icons';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react';
import { useState } from 'react';

import { fieldInputClass } from './formPrimitives';

/**
 * The one API-key field, shared by the add form and the edit pane: masked by
 * default, whitespace stripped on every change and paste, and — when a save
 * affordance is wired up — a button that is always present and merely disabled
 * while the field is empty, so the control never jumps.
 */
export function ApiKeyInput({
  id,
  value,
  onChange,
  placeholder = 'Paste your API key',
  onSave,
  isSaving,
  saveLabel = 'Save key'
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSave?: () => void;
  isSaving?: boolean;
  saveLabel?: string;
}) {
  const [reveal, setReveal] = useState(false);

  // Keys never contain whitespace; pasting from a doc routinely adds some.
  const normalize = (raw: string) => raw.replace(/\s+/g, '');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(normalize(event.target.value));
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!pasted) {
      return;
    }

    event.preventDefault();
    onChange(normalize(pasted));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onSave && value) {
      event.preventDefault();
      onSave();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={`${fieldInputClass} pr-10 font-mono`}
        />
        <button
          type="button"
          onClick={() => setReveal((current) => !current)}
          aria-label={reveal ? 'Hide API key' : 'Show API key'}
          className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-tertiary transition hover:bg-bg-hover hover:text-text-primary"
        >
          {reveal ? <EyeClosedIcon className="h-4 w-4" /> : <EyeOpenIcon className="h-4 w-4" />}
        </button>
      </div>

      {onSave ? (
        <button
          type="button"
          onClick={onSave}
          disabled={!value || isSaving}
          className="inline-flex h-9 shrink-0 items-center rounded-md border border-border-default bg-bg-subtle px-3 text-xs text-text-primary transition hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : saveLabel}
        </button>
      ) : null}
    </div>
  );
}
