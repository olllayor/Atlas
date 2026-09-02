/**
 * Finds the biggest instances of a constructor in a snapshot and says who
 * holds them.
 *
 * `heapDiff.mjs` answers "what grew"; this answers "which object exactly, and
 * where does its retainer chain end up" — the step between a constructor name
 * and a line of source.
 *
 * Usage: node scripts/perf/heapQuery.mjs <snapshot> <type:namePattern> [topN]
 */

import { getFullHeapFromFile } from '@memlab/heap-analysis';

const [file, pattern, topRaw = '5'] = process.argv.slice(2);
const matcher = new RegExp(pattern, 'i');

const heap = await getFullHeapFromFile(file);

const hits = [];
heap.nodes.forEach((node) => {
  if (matcher.test(`${node.type}:${node.name}`)) {
    hits.push({ id: node.id, name: node.name, type: node.type, retained: node.retainedSize, self: node.self_size });
  }
  return true;
});
hits.sort((a, b) => b.retained - a.retained);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
console.log(`${file}\nmatches for /${pattern}/: ${hits.length}\n`);

for (const hit of hits.slice(0, Number(topRaw))) {
  console.log(`\n== ${hit.type}:${hit.name} id=${hit.id} retained=${mb(hit.retained)}MB self=${hit.self}B`);
  const node = heap.getNodeById(hit.id);
  let current = node;
  const seen = new Set();
  for (let depth = 0; depth < 14 && current; depth += 1) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const referrers = [];
    current.forEachReferrer((edge) => {
      referrers.push(edge);
      return true;
    });
    if (referrers.length === 0) break;
    const edge = referrers.find((candidate) => candidate.type === 'property') ?? referrers[0];
    const from = edge.fromNode;
    console.log(
      `   ${'  '.repeat(Math.min(depth, 7))}<- ${edge.name_or_index} in ${from.type}:${from.name || '(anon)'}`
    );
    if (from.type === 'synthetic') break;
    current = from;
  }
}
