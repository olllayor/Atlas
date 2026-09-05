/**
 * One-off compatibility probe: Atlas's own parsers against the real
 * openai/plugins checkout. Not part of the suite — network-dependent.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseMarketplaceCatalog } from '../src/shared/marketplace';
import { loadPlugin } from '../src/main/plugins/PluginLoader';

const root = process.argv[2];
if (!root) {
  console.error('usage: tsx scripts/probe-openai-plugins.ts <checkout>');
  process.exit(1);
}

const catalogueText = await import('node:fs').then((fs) =>
  fs.readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')
);
const catalogue = parseMarketplaceCatalog(catalogueText);
if (!catalogue.ok) {
  console.error('CATALOGUE REFUSED:', catalogue.error);
  process.exit(1);
}

console.log(`catalogue "${catalogue.catalog.name}" — ${catalogue.catalog.entries.length} entries`);

const dirs = new Set(readdirSync(join(root, 'plugins')));
const missing = catalogue.catalog.entries.filter((entry) => !dirs.has(entry.name));
console.log(`entries whose folder is missing from plugins/: ${missing.length}`, missing.map((m) => m.name));

let ok = 0;
const failures: Array<{ name: string; error: string }> = [];
const capabilities: Record<string, number> = {};
for (const entry of catalogue.catalog.entries) {
  const result = loadPlugin(join(root, 'plugins', entry.name));
  if (result.ok) {
    ok += 1;
    const key = [
      result.plugin.skills.length ? `${result.plugin.skills.length}skills` : null,
      result.plugin.mcpServers.length ? `${result.plugin.mcpServers.length}mcp` : null,
      result.plugin.connectors.length ? `${result.plugin.connectors.length}conn` : null,
      result.plugin.commands.length ? `${result.plugin.commands.length}cmd` : null
    ]
      .filter(Boolean)
      .join('+');
    capabilities[key] = (capabilities[key] ?? 0) + 1;
    if (result.plugin.warnings.length > 0) {
      console.log(`  warnings ${entry.name}:`, result.plugin.warnings.join(' | '));
    }
  } else {
    failures.push({ name: entry.name, error: result.error });
  }
}

console.log(`\nloaded ok: ${ok}/${catalogue.catalog.entries.length}`);
for (const [key, count] of Object.entries(capabilities).sort()) {
  console.log(`  ${count.toString().padStart(3)}  ${key}`);
}
if (failures.length > 0) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const failure of failures) {
    console.log(`  ${failure.name}: ${failure.error}`);
  }
}
