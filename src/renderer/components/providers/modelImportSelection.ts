import type { DiscoveredModel } from '../../../shared/customProviders';

/**
 * Import-dialog selection semantics.
 *
 * The dialog seeds `selected` with every not-yet-added model so a fresh open
 * can import the whole endpoint in one click. But once the user types a
 * filter, the counter and the Import button must follow what is *shown*,
 * not the hidden seeded set — otherwise "nemo" + "Import 60" burns the user.
 *
 * Rule: with a non-empty filter, the effective selection is
 * `selected ∩ visible models`. With an empty filter, the whole `selected`
 * set is in play, exactly as before.
 */

export function filterModels(models: DiscoveredModel[], filter: string): DiscoveredModel[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) {
    return models;
  }

  return models.filter(
    (entry) =>
      entry.id.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle)
  );
}

/**
 * Intersect the user's selection with the models currently shown for the
 * filter. With an empty filter this is the whole selection. This is the list
 * `onImport` should receive.
 */
export function resolveImportSelection({
  filter,
  selected,
  models,
}: {
  filter: string;
  selected: ReadonlySet<string>;
  models: DiscoveredModel[];
}): DiscoveredModel[] {
  return filterModels(models, filter).filter((entry) => selected.has(entry.id));
}

/**
 * Number the badge and Import button should display for the current state.
 * Equals `resolveImportSelection(...).length`; kept as a separate helper so
 * the component can read the count without allocating the array.
 */
export function importSelectionCount({
  filter,
  selected,
  models,
}: {
  filter: string;
  selected: ReadonlySet<string>;
  models: DiscoveredModel[];
}): number {
  const visible = filterModels(models, filter);
  let count = 0;
  for (const entry of visible) {
    if (selected.has(entry.id)) {
      count += 1;
    }
  }
  return count;
}
