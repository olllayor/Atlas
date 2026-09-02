/**
 * Ranks what grew between two `.heapsnapshot` files and traces who holds it.
 *
 * The DevTools "Comparison" view by hand does not survive being run twice, so
 * this does the same job from memlab's parsed heap: group every node by
 * (type, constructor), diff retained-ish shallow size and count, then walk
 * retainer edges up from the biggest survivors until the chain names a file,
 * a store, or a module scope.
 *
 * Usage: node scripts/perf/heapDiff.mjs <before.heapsnapshot> <after.heapsnapshot> [topN]
 */

import { getFullHeapFromFile } from '@memlab/heap-analysis';

const [beforePath, afterPath, topRaw = '12'] = process.argv.slice(2);
const topN = Number(topRaw);

/** Shallow size and count per `type:name`, plus the biggest node id per group. */
function summarize(heap) {
  const groups = new Map();
  heap.nodes.forEach((node) => {
    const key = `${node.type}:${node.name}`;
    const group = groups.get(key) ?? { key, count: 0, size: 0, biggest: 0, biggestId: 0 };
    group.count += 1;
    group.size += node.self_size;
    if (node.self_size > group.biggest) {
      group.biggest = node.self_size;
      group.biggestId = node.id;
    }
    groups.set(key, group);
    return true;
  });
  return groups;
}

/**
 * The retainer chain above one node.
 *
 * Stops at the first GC root or at `maxDepth`, and prefers a named edge over
 * an array index so the chain reads as a path through the program rather than
 * a list of anonymous slots.
 */
function retainerChain(node, maxDepth = 18) {
  const chain = [];
  const seen = new Set();
  let current = node;
  for (let depth = 0; depth < maxDepth && current; depth += 1) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const edges = [];
    current.forEachReferrer((edge) => {
      edges.push(edge);
      return true;
    });
    if (edges.length === 0) break;
    const named = edges.find((edge) => edge.type === 'property' || edge.type === 'internal') ?? edges[0];
    const from = named.fromNode;
    chain.push(
      `${named.type === 'element' ? `[${named.name_or_index}]` : named.name_or_index} in ${from.type}:${from.name || '(anon)'} (self ${from.self_size}B)`
    );
    if (from.name === '(GC roots)' || from.type === 'synthetic') break;
    current = from;
  }
  return chain;
}

const before = await getFullHeapFromFile(beforePath);
const beforeGroups = summarize(before);
const after = await getFullHeapFromFile(afterPath);
const afterGroups = summarize(after);

const rows = [];
for (const [key, group] of afterGroups) {
  const prior = beforeGroups.get(key);
  rows.push({
    key,
    deltaSize: group.size - (prior?.size ?? 0),
    deltaCount: group.count - (prior?.count ?? 0),
    afterSize: group.size,
    afterCount: group.count,
    biggestId: group.biggestId,
    biggest: group.biggest,
  });
}
rows.sort((a, b) => b.deltaSize - a.deltaSize);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
console.log(`before ${beforePath}\nafter  ${afterPath}\n`);
console.log('rank  ΔsizeMB  Δcount  afterMB  afterCount  type:constructor');
rows.slice(0, topN).forEach((row, index) => {
  console.log(
    `${String(index + 1).padStart(4)}  ${mb(row.deltaSize).padStart(7)}  ${String(row.deltaCount).padStart(6)}  ${mb(row.afterSize).padStart(7)}  ${String(row.afterCount).padStart(10)}  ${row.key}`
  );
});

console.log('\n--- retainer chains for the top 4 rows (largest node in each) ---');
for (const row of rows.slice(0, 4)) {
  const node = after.getNodeById(row.biggestId);
  console.log(`\n# ${row.key}  (largest single node ${mb(row.biggest)} MB, id ${row.biggestId})`);
  if (!node) {
    console.log('  node not resolvable');
    continue;
  }
  if (node.type === 'string') console.log(`  string starts: ${JSON.stringify(String(node.name).slice(0, 160))}`);
  for (const [depth, step] of retainerChain(node).entries()) {
    console.log(`  ${'  '.repeat(Math.min(depth, 8))}<- ${step}`);
  }
}
