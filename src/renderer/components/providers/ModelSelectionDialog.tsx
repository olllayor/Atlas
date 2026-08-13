import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DiscoveredModel } from '../../../shared/customProviders';
import { formatContextWindow } from '../../../shared/customProviders';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { fieldInputClass } from './formPrimitives';
import {
  filterModels,
  importSelectionCount,
  resolveImportSelection
} from './modelImportSelection';

/**
 * Discovery routinely returns hundreds of models. Importing all of them and
 * making the user delete one at a time is not a flow — pick first, import once.
 */
export function ModelSelectionDialog({
  open,
  models,
  alreadyAddedIds,
  isImporting,
  onCancel,
  onImport
}: {
  open: boolean;
  models: DiscoveredModel[];
  alreadyAddedIds: string[];
  isImporting?: boolean;
  onCancel: () => void;
  onImport: (selected: DiscoveredModel[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  // `alreadyAddedIds` is a fresh array on every parent render, so key the Set
  // off its contents rather than its identity.
  const knownKey = alreadyAddedIds.join('\u0000');
  const known = useMemo(() => new Set(knownKey ? knownKey.split('\u0000') : []), [knownKey]);

  // Preselect everything the provider does not already have — once per opening.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }

    if (seeded.current) {
      return;
    }

    seeded.current = true;
    setFilter('');
    setSelected(new Set(models.filter((model) => !known.has(model.id)).map((model) => model.id)));
  }, [known, models, open]);

  const visible = useMemo(() => filterModels(models, filter), [filter, models]);

  const selectableVisible = visible.filter((model) => !known.has(model.id));
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((model) => selected.has(model.id));

  // Badge + Import button follow the shown rows once a filter is active, so
  // the number the user sees matches what the click will actually import.
  const importCount = importSelectionCount({ filter, selected, models });

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const model of selectableVisible) {
        if (allVisibleSelected) {
          next.delete(model.id);
        } else {
          next.add(model.id);
        }
      }

      return next;
    });
  };

  const handleImport = () => {
    onImport(resolveImportSelection({ filter, selected, models }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import models</DialogTitle>
          <DialogDescription>
            {models.length} model{models.length === 1 ? '' : 's'} found at this endpoint. Pick the ones
            you want.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter models…"
            spellCheck={false}
            className={`${fieldInputClass} pl-9`}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={selectableVisible.length === 0}
              onChange={toggleAllVisible}
              className="h-3.5 w-3.5 rounded-sm accent-[var(--accent)]"
            />
            <span>Select all{filter.trim() ? ' shown' : ''}</span>
          </label>
          <span className="text-xs tabular-nums text-text-tertiary">{importCount} selected</span>
        </div>

        <ul className="max-h-[320px] divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-default scroll-container">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-text-muted">No models match that filter.</li>
          ) : (
            visible.map((model) => {
              const isKnown = known.has(model.id);
              const badge = formatContextWindow(model.contextWindow);

              return (
                <li key={model.id}>
                  <label
                    className={`flex items-center gap-2.5 px-3 py-2 text-xs transition ${
                      isKnown ? 'opacity-50' : 'cursor-pointer hover:bg-bg-hover'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(model.id)}
                      disabled={isKnown}
                      onChange={() => toggle(model.id)}
                      className="h-3.5 w-3.5 shrink-0 rounded-sm accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-text-primary" title={model.id}>
                      {model.id}
                    </span>
                    {isKnown ? (
                      <span className="shrink-0 text-2xs text-text-muted">Already added</span>
                    ) : badge ? (
                      <span className="shrink-0 rounded-sm border border-border-default px-1.5 py-0.5 text-2xs text-text-tertiary">
                        {badge}
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })
          )}
        </ul>

        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center justify-center rounded-md border border-border-default bg-bg-subtle px-4 text-xs text-text-primary transition hover:bg-bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importCount === 0 || isImporting}
            className="inline-flex h-9 items-center justify-center rounded-md bg-bg-button px-4 text-xs text-text-inverse transition hover:bg-bg-button-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImporting ? `Importing ${importCount} models…` : `Import ${importCount}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
