import assert from 'node:assert/strict';
import test from 'node:test';

import { detectDiagramSpec, parseDiagramSpec } from '../src/shared/diagramSpec.js';

test('a well-formed spec keeps its nodes and edges', () => {
  const spec = parseDiagramSpec(
    JSON.stringify({
      nodes: [
        { id: 'client', label: 'Client', type: 'input' },
        { id: 'api', label: 'API', style: { background: '#1e3a5f', border: '#3b82f6' } },
      ],
      edges: [{ source: 'client', target: 'api', label: 'HTTPS', animated: true }],
    })
  );

  assert.deepEqual(spec, {
    nodes: [
      { id: 'client', label: 'Client', type: 'input', style: undefined },
      { id: 'api', label: 'API', type: undefined, style: { background: '#1e3a5f', border: '#3b82f6' } },
    ],
    edges: [{ id: 'client-api', source: 'client', target: 'api', label: 'HTTPS', animated: true }],
  });
});

test('a spec the model fenced is still read', () => {
  const spec = parseDiagramSpec('```json\n{"nodes":[{"id":"a","label":"A"}],"edges":[]}\n```');
  assert.equal(spec?.nodes.length, 1);
});

test('edges pointing at nodes that do not exist are dropped', () => {
  // dagre invents a zero-sized node for an unknown endpoint, which throws the
  // whole layout off; React Flow then logs an error for the orphan edge.
  const spec = parseDiagramSpec(
    JSON.stringify({
      nodes: [{ id: 'a', label: 'A' }],
      edges: [
        { source: 'a', target: 'ghost' },
        { source: 'nowhere', target: 'a' },
      ],
    })
  );

  assert.deepEqual(spec?.edges, []);
});

test('duplicate node ids and parallel edges are made unique', () => {
  const spec = parseDiagramSpec(
    JSON.stringify({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'A again' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'b', label: 'retry' },
      ],
    })
  );

  assert.deepEqual(
    spec?.nodes.map((node) => node.id),
    ['a', 'b']
  );
  assert.deepEqual(
    spec?.edges.map((edge) => edge.id),
    ['a-b', 'a-b-1']
  );
});

test('a node without an id is skipped and one without a label falls back to its id', () => {
  const spec = parseDiagramSpec(
    JSON.stringify({ nodes: [{ label: 'orphan' }, { id: 'kept' }], edges: [] })
  );

  assert.deepEqual(spec?.nodes, [{ id: 'kept', label: 'kept', type: undefined, style: undefined }]);
});

test('non-diagram payloads are not mistaken for one', () => {
  assert.equal(detectDiagramSpec('{"src":"loading"}'), false);
  assert.equal(detectDiagramSpec('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), false);
  assert.equal(detectDiagramSpec('{"nodes":[]}'), false);
  assert.equal(detectDiagramSpec('{"nodes": not json}'), false);
});
