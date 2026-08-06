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
/**
 * Where Atlas keeps everything a user could reasonably want to look at.
 *
 * Installed bundles and marketplace checkouts live together under one visible
 * directory rather than split between here and Electron's `userData`. A plugin
 * is a folder someone may want to open, edit, or copy; burying half of that
 * under Application Support makes it findable only by someone who already knows
 * where to look.
 */
export function atlasHome(): string {
  return join(homedir(), '.atlas');
}

export function marketplaceCheckoutRoot(): string {
  return join(atlasHome(), 'marketplaces');
}

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
 * The user's marketplaces with the bundled one in front.
 *
 * A stored record claiming the bundled name is dropped: the name is reserved,
 * and letting a user-added marketplace shadow it would mean the app's own
 * plugins silently disappearing.
 */
export function withBundledMarketplace(stored: MarketplaceRecord[]): MarketplaceRecord[] {
  const bundled = bundledMarketplaceRecord();
  const rest = stored.filter((record) => record.name !== BUNDLED_MARKETPLACE_NAME);

  return bundled ? [bundled, ...rest] : rest;
}
