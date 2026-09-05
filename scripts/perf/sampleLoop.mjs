/**
 * Appends one CSV row per interval for an Electron tree's per-role memory.
 *
 * Standalone so it can watch a process this script did not launch (an app the
 * user already has open) as well as one the probe launched itself.
 *
 * Usage: node scripts/perf/sampleLoop.mjs <rootPid> <outCsv> [intervalMs]
 */

import { appendFileSync, writeFileSync } from 'node:fs';

import { sampleTree } from './procSampler.mjs';

const [rootPid, outPath, intervalMs = '10000'] = process.argv.slice(2);
if (!rootPid || !outPath) {
  console.error('usage: sampleLoop.mjs <rootPid> <outCsv> [intervalMs]');
  process.exit(1);
}

const ROLES = ['main', 'renderer', 'gpu-process', 'utility'];
writeFileSync(
  outPath,
  `at,elapsedS,${ROLES.flatMap((role) => [`${role}RssKb`, `${role}FootprintKb`]).join(',')},totalRssKb,totalFootprintKb,rendererPids\n`
);

const startedAt = Date.now();

async function tick() {
  const sample = await sampleTree(Number(rootPid));
  if (sample.processes.length === 0) {
    console.log('[sampler] root process gone, stopping');
    process.exit(0);
  }
  const cells = ROLES.flatMap((role) => {
    const bucket = sample.byRole[role];
    return [bucket?.rssKb ?? 0, bucket?.footprintKb ?? 0];
  });
  appendFileSync(
    outPath,
    [
      sample.at,
      ((Date.now() - startedAt) / 1000).toFixed(0),
      ...cells,
      sample.totalRssKb,
      sample.totalFootprintKb,
      `"${(sample.byRole.renderer?.pids ?? []).join(' ')}"`,
    ].join(',') + '\n'
  );
}

await tick();
setInterval(() => void tick().catch((error) => console.error('[sampler]', error)), Number(intervalMs));
