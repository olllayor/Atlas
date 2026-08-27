/**
 * One-off end-to-end probe: the full marketplace install path against the real
 * openai/plugins checkout. Not part of the suite — needs a local clone.
 */
import { rmSync } from 'node:fs';
import { mkdtempSync, rmSync as rm } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MarketplaceRegistry } from '../src/main/plugins/MarketplaceRegistry';
import { PluginInstaller } from '../src/main/plugins/PluginInstaller';
import { PluginMarketplaceService } from '../src/main/plugins/PluginMarketplaceService';
import { PluginRegistry } from '../src/main/plugins/PluginRegistry';
import { loadPlugin } from '../src/main/plugins/PluginLoader';

const checkout = process.argv[2];
if (!checkout) {
  console.error('usage: tsx scripts/probe-install-openai.ts <checkout>');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'atlas-openai-e2e-'));
const pluginsRoot = join(dir, 'plugins');

let records: Parameters<PluginMarketplaceService['add']>[0][] = [];
const marketplaces = new MarketplaceRegistry(() => records as never, join(dir, 'checkouts'));
const plugins = new PluginRegistry({ root: pluginsRoot });
const installer = new PluginInstaller(plugins);
const service = new PluginMarketplaceService(
  marketplaces,
  plugins,
  installer,
  () => records as never,
  (next) => {
    records = next as never;
  }
);

service.add({ name: 'openai-curated', source: { kind: 'path', path: checkout } });

const view = service.view().marketplaces[0];
if (!view || view.error) {
  console.error('view failed:', view?.error);
  process.exit(1);
}
console.log(`marketplace "${view.name}" — ${view.entries.length} entries, error: ${view.error}`);

// Classify entries by what a full load says they carry, then pick install
// candidates: one skills-only (must succeed), one connector-only (must refuse).
const skillsOnly: string[] = [];
const connectorOnly: string[] = [];
const mcpCarrying: string[] = [];

for (const entry of view.entries) {
  const probe = loadPlugin(join(checkout, 'plugins', entry.name));
  if (!probe.ok) continue;
  const has = {
    skills: probe.plugin.skills.length > 0,
    mcp: probe.plugin.mcpServers.length > 0,
    conn: probe.plugin.connectors.length > 0
  };
  if (has.mcp) mcpCarrying.push(entry.name);
  else if (has.skills && !has.conn) skillsOnly.push(entry.name);
  else if (has.conn && !has.skills && !has.mcp) connectorOnly.push(entry.name);
}

console.log(`skills-only: ${skillsOnly.length}, mcp-carrying: ${mcpCarrying.length}, connector-only: ${connectorOnly.length}`);

// 1. Install a skills-only bundle end to end.
const pick = skillsOnly[0];
console.log(`\n[install] "${pick}" (skills-only)`);
try {
  service.install('openai-curated', pick);
  const snapshot = plugins.snapshot();
  const installed = [...snapshot.plugins, ...snapshot.disabled].find((p) => p.manifest.name === pick);
  console.log(`  ok — installed to registry: ${Boolean(installed)}, skills: ${installed?.skills.length ?? 0}`);
} catch (error) {
  console.log(`  FAILED: ${error instanceof Error ? error.message : error}`);
}

// 2. Connector-only must refuse with the capability message.
const connPick = connectorOnly[0];
console.log(`\n[install] "${connPick}" (connector-only — expect refusal)`);
try {
  service.install('openai-curated', connPick);
  console.log('  UNEXPECTED: install succeeded');
} catch (error) {
  console.log(`  refused as designed: ${error instanceof Error ? error.message : error}`);
}

// 3. An mcp-carrying bundle if one exists.
const mcpPick = mcpCarrying[0];
if (mcpPick) {
  console.log(`\n[install] "${mcpPick}" (mcp-carrying)`);
  try {
    service.install('openai-curated', mcpPick);
    const snapshot = plugins.snapshot();
    const installed = [...snapshot.plugins, ...snapshot.disabled].find((p) => p.manifest.name === mcpPick);
    console.log(`  ok — servers: ${installed?.mcpServers.map((s) => `${s.key}(${s.transport})`).join(', ')}`);
  } catch (error) {
    console.log(`  FAILED: ${error instanceof Error ? error.message : error}`);
  }
}

// 4. What the directory card shows for a connector-only entry.
const connEntry = view.entries.find((entry) => entry.name === connPick);
console.log(`\n[card] connector-only entry view:`, JSON.stringify(connEntry, null, 2));

rmSync(dir, { recursive: true, force: true });
void rm;
