import { AlertCircle, Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';

type DiagramNode = {
  id: string;
  label: string;
  type?: string;
  style?: Record<string, string>;
};

type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
};

type DiagramSpec = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Diagram colours, read from the live theme.
 *
 * Every colour in this file used to be a hardcoded Tailwind-slate hex
 * (`#0f172a`, `#1e293b`, `#334155`, …), which meant a diagram rendered as a
 * near-black slab on every light theme and ignored the accent of every dark
 * one. This mirrors `visual.tsx`'s `readThemeTokens()` — same custom
 * properties, same `MutationObserver` refresh.
 */
type DiagramTheme = {
  surface: string;
  nodeBg: string;
  nodeText: string;
  border: string;
  edge: string;
  edgeLabel: string;
  edgeLabelBg: string;
  dots: string;
  hover: string;
  /** Border colours cycled across untyped nodes to keep a graph legible. */
  accents: string[];
  /** Semantic slots every theme defines; see `--success` / `--warning` / `--error`. */
  success: string;
  warning: string;
  error: string;
};

const FALLBACK_THEME: DiagramTheme = {
  surface: '#101319',
  nodeBg: '#151922',
  nodeText: '#ffffff',
  border: 'rgba(255, 255, 255, 0.12)',
  edge: 'rgba(255, 255, 255, 0.28)',
  edgeLabel: '#94a3b8',
  edgeLabelBg: '#101319',
  dots: 'rgba(255, 255, 255, 0.12)',
  hover: 'rgba(255, 255, 255, 0.06)',
  accents: ['#3b82f6'],
  // Mirrors the `:root` contract in styles.css. These are only reachable
  // before there is a document to read tokens from.
  success: '#34d399',
  warning: '#fbbf24',
  error: '#fb7185',
};

function readDiagramTheme(): DiagramTheme {
  if (typeof window === 'undefined') return FALLBACK_THEME;

  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  const accent = read('--accent', FALLBACK_THEME.accents[0]);

  return {
    surface: read('--bg-surface', FALLBACK_THEME.surface),
    nodeBg: read('--bg-elevated', FALLBACK_THEME.nodeBg),
    nodeText: read('--text-primary', FALLBACK_THEME.nodeText),
    border: read('--border-default', FALLBACK_THEME.border),
    edge: read('--border-strong', FALLBACK_THEME.edge),
    edgeLabel: read('--text-tertiary', FALLBACK_THEME.edgeLabel),
    edgeLabelBg: read('--bg-surface', FALLBACK_THEME.edgeLabelBg),
    dots: read('--border-default', FALLBACK_THEME.dots),
    hover: read('--bg-hover', FALLBACK_THEME.hover),
    // Semantic tokens rather than a bespoke rainbow: a diagram should look
    // like the rest of the app, and these are the only "meaningful colour"
    // slots every theme is guaranteed to define.
    accents: [
      accent,
      read('--success', FALLBACK_THEME.success),
      read('--warning', FALLBACK_THEME.warning),
      read('--error', FALLBACK_THEME.error),
      read('--border-strong', FALLBACK_THEME.edge),
      read('--text-tertiary', FALLBACK_THEME.edgeLabel),
    ],
    success: read('--success', FALLBACK_THEME.success),
    warning: read('--warning', FALLBACK_THEME.warning),
    error: read('--error', FALLBACK_THEME.error),
  };
}

function useDiagramTheme(): DiagramTheme {
  const [theme, setTheme] = useState<DiagramTheme>(readDiagramTheme);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(readDiagramTheme()));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const NODE_WIDTH = 200;
const NODE_MIN_HEIGHT = 56;
const NODE_PADDING_Y = 12;
const NODE_LINE_HEIGHT = 18;
/** 200px wide minus 32px horizontal padding at 13px ≈ 22 characters. */
const NODE_CHARS_PER_LINE = 22;

/**
 * Estimate a node's rendered height and *commit to it*.
 *
 * dagre was told every node is 200×56 while the DOM gave nodes an
 * unconstrained height, so any label that wrapped to two or three lines
 * overflowed its lane and overlapped the rank below it. Deriving the height
 * from the label and then pinning it in the node's style keeps the layout
 * engine and the renderer describing the same box.
 */
function estimateNodeHeight(label: string): number {
  const lines = label
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / NODE_CHARS_PER_LINE)), 0);
  return Math.max(NODE_MIN_HEIGHT, lines * NODE_LINE_HEIGHT + NODE_PADDING_Y * 2);
}

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'TB' | 'LR' = 'TB'
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });

  const heights = new Map<string, number>();

  nodes.forEach((node) => {
    const height = Number(node.style?.height) || NODE_MIN_HEIGHT;
    heights.set(node.id, height);
    g.setNode(node.id, { width: NODE_WIDTH, height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const height = heights.get(node.id) ?? NODE_MIN_HEIGHT;
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function toReactFlowNodes(specNodes: DiagramNode[], theme: DiagramTheme): Node[] {
  return specNodes.map((node, index) => {
    // `input`/`output` keep dedicated slots; everything else cycles the
    // accent list so adjacent nodes stay distinguishable.
    const accent =
      node.type === 'input'
        ? theme.accents[0]
        : node.type === 'output'
          ? theme.accents[1]
          : theme.accents[index % theme.accents.length];

    return {
      id: node.id,
      type: 'default',
      data: { label: node.label },
      position: { x: 0, y: 0 },
      style: {
        background: node.style?.background || theme.nodeBg,
        border: `1.5px solid ${node.style?.border || accent}`,
        color: theme.nodeText,
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '500',
        padding: `${NODE_PADDING_Y}px 16px`,
        width: NODE_WIDTH,
        height: estimateNodeHeight(node.label ?? ''),
        lineHeight: `${NODE_LINE_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center' as const,
        ...node.style,
      },
    };
  });
}

function toReactFlowEdges(specEdges: DiagramEdge[], theme: DiagramTheme): Edge[] {
  return specEdges.map((edge) => ({
    id: edge.id || `${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    label: edge.label ? edge.label : undefined,
    animated: edge.animated || false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: theme.edge,
    },
    style: {
      stroke: theme.edge,
      strokeWidth: 1.5,
    },
    labelStyle: {
      fill: theme.edgeLabel,
      fontSize: '11px',
      fontWeight: '500',
    },
    labelBgStyle: {
      fill: theme.edgeLabelBg,
      fillOpacity: 0.85,
    },
  }));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseDiagramSpec(content: string): DiagramSpec | null {
  const trimmed = content.trim();

  const jsonMatch = trimmed.match(/^\s*\{\s*"nodes"\s*:/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        return {
          nodes: parsed.nodes,
          edges: parsed.edges || [],
        };
      }
    } catch {
      // not valid JSON
    }
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (parsed.nodes && Array.isArray(parsed.nodes)) {
        return {
          nodes: parsed.nodes,
          edges: parsed.edges || [],
        };
      }
    } catch {
      // not valid JSON
    }
  }

  return null;
}

export function detectDiagramSpec(content: string): boolean {
  return parseDiagramSpec(content) !== null;
}

type ParseOutcome = { spec: DiagramSpec; error: null } | { spec: null; error: string };

/**
 * Parse *and* validate in one pass, returning the error as a value.
 *
 * The previous version called `setParseError` from inside `useMemo`, i.e.
 * set state during render — React warns about it and, in a concurrent
 * re-render, the error could be committed for a spec that had already been
 * replaced. Derived state should be derived.
 */
function parseOutcome(content: string): ParseOutcome {
  const parsed = parseDiagramSpec(content);
  if (!parsed) return { spec: null, error: 'Could not parse diagram specification.' };
  if (parsed.nodes.length === 0) return { spec: null, error: 'Diagram has no nodes.' };
  return { spec: parsed, error: null };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type InteractiveDiagramProps = {
  content: string;
  title?: string;
  className?: string;
  /**
   * Suppress the header and copy button.
   *
   * `VisualBlock` floats its own toolbar (save / copy / expand) over the
   * diagram, so rendering the diagram's header too produced two stacked
   * bars and two copy buttons that copied the same thing.
   */
  hideChrome?: boolean;
};

export function InteractiveDiagram({
  content,
  title,
  className,
  hideChrome = false,
}: InteractiveDiagramProps) {
  const { copied, copy } = useClipboard();
  const theme = useDiagramTheme();

  const { spec, error: parseError } = useMemo(() => parseOutcome(content), [content]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (!spec) return { nodes: [], edges: [] };
    const rfNodes = toReactFlowNodes(spec.nodes, theme);
    const rfEdges = toReactFlowEdges(spec.edges, theme);
    return getLayoutedElements(rfNodes, rfEdges);
  }, [spec, theme]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const copySource = useCallback(async () => {
    await copy(content.trim());
  }, [copy, content]);

  // React Flow's chrome is styled through its own custom properties, which
  // is how the Controls panel gets themed without `!important` overrides.
  const flowStyle = useMemo(
    () =>
      ({
        '--xy-controls-button-background-color': theme.nodeBg,
        '--xy-controls-button-background-color-hover': theme.hover,
        '--xy-controls-button-color': theme.nodeText,
        '--xy-controls-button-color-hover': theme.nodeText,
        '--xy-controls-button-border-color': theme.border,
        '--xy-edge-stroke': theme.edge,
        '--xy-edge-label-color': theme.edgeLabel,
        '--xy-edge-label-background-color': theme.edgeLabelBg,
        '--xy-background-color': 'transparent',
      }) as CSSProperties,
    [theme]
  );

  if (parseError || !spec) {
    return (
      <div className={cn('my-3 rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
        <div className="flex min-h-44 items-center justify-center px-5 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-error-border/20 bg-error-bg/10 px-4 py-4 text-error-text">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-sm font-semibold">Diagram could not be rendered</div>
                <div className="mt-1 text-sm leading-6">
                  {parseError || 'Invalid diagram specification.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Viewport height scales with the graph instead of one `h-80` for
  // everything, clamped so a 60-node graph cannot eat the whole transcript.
  const viewportHeight = Math.min(560, Math.max(240, 120 + spec.nodes.length * 44));

  return (
    <div
      className={cn('group my-3 overflow-hidden rounded-xl border border-border/50', className)}
      style={{ background: theme.surface }}
    >
      {!hideChrome && (
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-bg-subtle/60 px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-[0.02em] text-text-secondary">
              {title?.trim() || 'Interactive diagram'}
            </div>
            <div className="text-2xs text-text-muted">Drag nodes · ⌘ + scroll to zoom</div>
          </div>
          <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
            <button
              type="button"
              onClick={() => void copySource()}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-2xs font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
              title="Copy diagram source"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy source'}</span>
            </button>
          </div>
        </div>
      )}

      <div className="w-full" style={{ height: viewportHeight, ...flowStyle }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          /*
            The wheel belongs to the transcript. Hovering a diagram used to
            zoom it instead of scrolling the conversation, and `panOnScroll`
            would have stolen the wheel just as badly. `preventScrolling`
            is what actually lets the event reach the chat scroller; ⌘ is
            the opt-in for zooming.
          */
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomActivationKeyCode="Meta"
          zoomOnPinch
          defaultEdgeOptions={{ style: { stroke: theme.edge, strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color={theme.dots} />
          <Controls showInteractive={false} showFitView showZoom />
          <Panel position="bottom-right" className="!text-3xs !text-text-muted">
            {spec.nodes.length} nodes · {spec.edges.length} edges
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
