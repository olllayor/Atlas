import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron/main';

import { BUNDLED_MARKETPLACE_NAME } from '../../shared/marketplace';
import type { MarketplaceRecord } from './MarketplaceRegistry';

/**
 * The marketplace that ships with Atlas.
 *
 * Synthesised rather than stored: it is not a choice the user made, so it does
 * not live in settings and cannot drift out of sync with what the build
 * actually contains. It is always present, always first, and cannot be removed
 * — removing it would only mean the app disagreeing with its own contents until
 * the next release put it back.
 */
export { BUNDLED_MARKETPLACE_NAME } from '../../shared/marketplace';
/**
 * Where the bundle lives, packaged and in development.
 *
 * Same shape as `getIconCandidates`: `process.resourcesPath` once packaged, the
 * repository otherwise, with `process.cwd()` as the fallback for a dev run
 * launched from somewhere unexpected.
 */
// Re-exported so every existing caller keeps its import. The definitions moved
// to `atlasPaths.ts` because this module imports `electron/main`, and the
// plugin loader — which the tests load directly — needs the paths without it.
export { atlasHome, marketplaceCheckoutRoot, pluginDataDir } from './atlasPaths';

export function bundledMarketplacePath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'plugins')]
    : [join(app.getAppPath(), 'resources', 'plugins'), join(process.cwd(), 'resources', 'plugins')];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * The bundled record, or nothing when the build shipped without it.
 *
 * Returning `null` rather than a broken record matters: a marketplace that
 * cannot be read shows the user an error they can do nothing about, and a
 * missing bundle directory is a packaging mistake, not something to surface as
 * a failed catalogue.
 */
export function bundledMarketplaceRecord(): MarketplaceRecord | null {
  const path = bundledMarketplacePath();

  return path
    ? { name: BUNDLED_MARKETPLACE_NAME, source: { kind: 'path', path }, builtIn: true }
    : null;
}

/**
 * The official Codex catalogue, presented as a second built-in source.
 *
 * The same bundles the Plugins Directory in the ChatGPT desktop app browses —
 * 180 of them, most carrying skills Atlas reads directly. It ships as a record
 * rather than a checkout: the checkout is 77 MB of git history, so it is cloned
 * once, on the first time the directory is opened, and served from disk after
 * that (see `MarketplaceRegistry.checkout`). Freshness is the explicit check,
 * not every page open — the same model as the bundled path marketplace, whose
 * contents also change only when the app updates.
 *
 * The record name is the catalogue's own, so provenance reads
 * `<plugin>@openai-curated` and a revocation the catalogue publishes binds
 * exactly the installs it published.
 */
export const OFFICIAL_MARKETPLACE_NAME = 'openai-curated';
const OFFICIAL_MARKETPLACE_URL = 'https://github.com/openai/plugins';

export function officialMarketplaceRecord(): MarketplaceRecord {
  return {
    name: OFFICIAL_MARKETPLACE_NAME,
    source: { kind: 'git', url: OFFICIAL_MARKETPLACE_URL, ref: null },
    builtIn: true
  };
}

/**
 * The user's marketplaces with the built-ins in front.
 *
 * A stored record claiming a built-in name is dropped: the names are reserved,
 * and letting a user-added marketplace shadow one would mean the app's own
 * directory silently disappearing.
 */
export function withBundledMarketplace(stored: MarketplaceRecord[]): MarketplaceRecord[] {
  const builtIns = [bundledMarketplaceRecord(), officialMarketplaceRecord()].filter(
    (record) => record != null
  ) as MarketplaceRecord[];
  const reserved = new Set(builtIns.map((record) => record.name));
  const rest = stored.filter((record) => !reserved.has(record.name));

  return [...builtIns, ...rest];
}
