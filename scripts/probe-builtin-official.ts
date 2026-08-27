/**
 * One-off: proves the built-in official catalogue resolves against the real
 * remote, and that the second resolve is served from disk. Not in the suite.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { MarketplaceRegistry } from '../src/main/plugins/MarketplaceRegistry';

const checkoutRoot = join(homedir(), '.atlas-probe-checkouts');
const record = {
  name: 'openai-curated',
  source: { kind: 'git' as const, url: 'https://github.com/openai/plugins', ref: null },
  builtIn: true
};
const registry = new MarketplaceRegistry(() => [record], checkoutRoot);

const hadCheckout = existsSync(join(checkoutRoot, record.name, '.git'));
let start = performance.now();
const first = registry.resolve(record);
const firstMs = Math.round(performance.now() - start);
console.log(`resolve #1 (${hadCheckout ? 'cached' : 'cloned'}): ${firstMs}ms, error: ${first.error}, entries: ${first.catalog?.entries.length}`);
console.log(`  displayName: ${first.catalog?.displayName}, categories: ${[...new Set(first.catalog?.entries.map((e) => e.category))].join(', ')}`);

start = performance.now();
const second = registry.resolve(record);
const secondMs = Math.round(performance.now() - start);
console.log(`resolve #2 (must be cached): ${secondMs}ms, entries: ${second.catalog?.entries.length}`);
console.log(secondMs < firstMs / 2 ? 'CACHE OK' : 'CACHE SUSPECT');

const expired = registry.expireBuiltInCheckouts();
console.log(`expired: ${expired}, checkout gone: ${!existsSync(join(checkoutRoot, record.name))}`);
