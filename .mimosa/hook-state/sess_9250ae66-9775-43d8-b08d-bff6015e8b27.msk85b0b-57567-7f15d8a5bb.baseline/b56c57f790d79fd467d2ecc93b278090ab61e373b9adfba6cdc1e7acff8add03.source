/**
 * The node-and-edge spec a model emits inside a `<visual>` block, and the
 * validation that turns it into something React Flow can render.
 *
 * Kept out of the component so it can be tested without a DOM, and so the
 * parsing rules live in one place for both the renderer and the detector.
 */

export type DiagramNode = {
  id: string;
  label: string;
  type?: string;
  style?: Record<string, string>;
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
};

export type DiagramSpec = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStyle(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const style: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') style[key] = entry;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * Take the spec apart field by field rather than trusting its shape.
 *
 * This JSON comes from a language model, so every guarantee has to be checked:
 * a node without an `id` renders as `[object Object]`, a duplicate `id` makes
 * React Flow drop nodes silently, and an edge pointing at a node that does not
 * exist makes dagre invent a zero-sized one and skew the whole layout.
 */
function normalizeSpec(value: unknown): DiagramSpec | null {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    return null;
  }

  const nodes: DiagramNode[] = [];
  const seenIds = new Set<string>();

  for (const raw of value.nodes) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seenIds.has(id)) continue;

    seenIds.add(id);
    nodes.push({
      id,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : id,
      type: typeof raw.type === 'string' ? raw.type : undefined,
      style: readStyle(raw.style),
    });
  }

  const edges: DiagramEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];

  for (const raw of rawEdges) {
    if (!isRecord(raw)) continue;
    const source = typeof raw.source === 'string' ? raw.source.trim() : '';
    const target = typeof raw.target === 'string' ? raw.target.trim() : '';
    if (!seenIds.has(source) || !seenIds.has(target)) continue;

    // Parallel edges between the same pair would share the generated id, and
    // React Flow renders a repeated id once; the suffix keeps them distinct.
    const proposed = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${source}-${target}`;
    let id = proposed;
    let suffix = 1;
    while (seenEdgeIds.has(id)) {
      id = `${proposed}-${suffix}`;
      suffix += 1;
    }
    seenEdgeIds.add(id);

    edges.push({
      id,
      source,
      target,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : undefined,
      animated: raw.animated === true,
    });
  }

  return nodes.length > 0 ? { nodes, edges } : null;
}

export function parseDiagramSpec(content: string): DiagramSpec | null {
  const trimmed = content.trim();

  // A bare object, or one the model fenced anyway. Both are tried because the
  // first is what the prompt asks for and the second is what models do.
  const candidates = [trimmed, trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/)?.[1]];

  for (const candidate of candidates) {
    if (!candidate || !candidate.trimStart().startsWith('{')) continue;
    try {
      const spec = normalizeSpec(JSON.parse(candidate));
      if (spec) return spec;
    } catch {
      // Not this candidate; try the next.
    }
  }

  return null;
}

export function detectDiagramSpec(content: string): boolean {
  return parseDiagramSpec(content) !== null;
}
