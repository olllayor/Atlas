import { Cross2Icon, ExclamationTriangleIcon, TrashIcon } from '@radix-ui/react-icons';
import { useState } from 'react';

import type { MarketplaceInput, MarketplacesView } from '../../../shared/contracts';
import { cn } from '../../lib/utils';

/**
 * Adding and removing the catalogues plugins are listed from.
 *
 * Kept out of the browsing surface: choosing where plugins come from is a
 * configuration decision made once, not part of looking through them. A
 * marketplace that failed to load says so here rather than silently listing
 * nothing.
 */
export function MarketplaceManager({
  markets,
  busy,
  onClose,
  onAdd,
  onRemove
}: {
  markets: MarketplacesView;
  busy: boolean;
  onClose: () => void;
  onAdd: (input: MarketplaceInput) => void;
  onRemove: (name: string) => void;
}) {
  const [kind, setKind] = useState<'git' | 'path'>('git');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [ref, setRef] = useState('');

  const submit = () => {
    const trimmed = location.trim();

    onAdd(
      kind === 'git'
        ? { kind: 'git', name: name.trim(), url: trimmed, ref: ref.trim() || null }
        : { kind: 'path', name: name.trim(), path: trimmed }
    );

    setName('');
    setLocation('');
    setRef('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]" onClick={onClose}>
      <div
        className="scroll-container max-h-[80vh] w-[520px] max-w-full overflow-y-auto rounded-xl bg-bg-base p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base text-text-primary">Marketplaces</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-text-faint hover:bg-bg-hover"
          >
            <Cross2Icon className="size-4" aria-hidden />
          </button>
        </div>

        <p className="mt-1 text-xs text-text-tertiary">
          Adding one only reads its catalogue. Nothing runs until you install a plugin.
        </p>

        <ul className="mt-4 space-y-1.5">
          {markets.marketplaces.map((marketplace) => (
            <li key={marketplace.name} className="rounded-lg border border-border-default p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary">
                    {marketplace.displayName ?? marketplace.name}
                    <span className="ml-1.5 text-2xs text-text-faint">
                      {marketplace.error ? 'unavailable' : `${marketplace.entries.length} plugins`}
                    </span>
                  </p>
                  <p className="mt-0.5 break-all font-mono text-2xs text-text-faint">
                    {marketplace.sourceLabel}
                  </p>
                </div>
                {/* No remove control for what ships with the app: the next
                    launch would put it back, so offering the button would only
                    promise something Atlas cannot keep. */}
                {marketplace.builtIn ? (
                  <span className="shrink-0 text-2xs text-text-faint">built in</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRemove(marketplace.name)}
                    disabled={busy}
                    aria-label={`Remove ${marketplace.name}`}
                    className="shrink-0 rounded-md p-1 text-text-faint hover:bg-bg-hover hover:text-error-text"
                  >
                    <TrashIcon className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              {marketplace.error ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-2xs text-error-text">
                  <ExclamationTriangleIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {marketplace.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-2 border-t border-border-default pt-4">
          <div className="flex gap-1.5">
            {(['git', 'path'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={cn(
                  'rounded-md px-2 py-1 text-2xs',
                  kind === option
                    ? 'bg-bg-active text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover'
                )}
              >
                {option === 'git' ? 'Git repository' : 'Local folder'}
              </button>
            ))}
          </div>

          <Field label="Name" value={name} onChange={setName} placeholder="openai-curated" />
          <Field
            label={kind === 'git' ? 'URL' : 'Folder'}
            value={location}
            onChange={setLocation}
            placeholder={
              kind === 'git' ? 'https://github.com/owner/repo.git' : '/path/to/marketplace'
            }
          />
          {kind === 'git' ? (
            <Field label="Branch or tag" value={ref} onChange={setRef} placeholder="optional" />
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim() || !location.trim()}
            className="w-full rounded-lg bg-bg-active px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover disabled:opacity-50"
          >
            Add marketplace
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-2xs text-text-faint">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-md border border-border-default bg-transparent px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-faint"
      />
    </label>
  );
}
