import { AlertCircle, Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;

const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  input: { bg: '#1e3a5f', border: '#3b82f6' },
  output: { bg: '#1a4731', border: '#22c55e' },
  default: { bg: '#1e293b', border: '#334155' },
};

const SEMANTIC_COLORS = [
  { bg: '#1e3a5f', border: '#3b82f6' },
  { bg: '#1a4731', border: '#22c55e' },
  { bg: '#1e293b', border: '#334155' },
  { bg: '#3b1f5e', border: '#8b5cf6' },
  { bg: '#422006', border: '#f59e0b' },
  { bg: '#4a1c1c', border: '#ef4444' },
];

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

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function toReactFlowNodes(specNodes: DiagramNode[]): Node[] {
  return specNodes.map((node, i) => {
    const typeColors = NODE_COLORS[node.type || 'default'];
    const semanticColors = SEMANTIC_COLORS[i % SEMANTIC_COLORS.length];
    const colors = node.type && NODE_COLORS[node.type] ? typeColors : semanticColors;

    return {
      id: node.id,
      type: 'default',
      data: { label: node.label },
      position: { x: 0, y: 0 },
      style: {
        background: node.style?.background || colors.bg,
        border: `1.5px solid ${node.style?.border || colors.border}`,
        color: '#f1f5f9',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '500',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '12px 16px',
        width: NODE_WIDTH,
        lineHeight: '1.4',
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3)',
        ...node.style,
      },
    };
  });
}

function toReactFlowEdges(specEdges: DiagramEdge[]): Edge[] {
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
      color: '#475569',
    },
    style: {
      stroke: '#475569',
      strokeWidth: 1.5,
    },
    labelStyle: {
      fill: '#94a3b8',
      fontSize: '11px',
      fontWeight: '500',
    },
    labelBgStyle: {
      fill: '#0f172a',
      fillOpacity: 0.85,
    },
  }));
}

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

type InteractiveDiagramProps = {
  content: string;
  title?: string;
  className?: string;
};

export function InteractiveDiagram({
  content,
  title,
  className,
}: InteractiveDiagramProps) {
  const { copied, copy } = useClipboard();
  const [parseError, setParseError] = useState<string | null>(null);

  const spec = useMemo(() => {
    setParseError(null);
    const parsed = parseDiagramSpec(content);
    if (!parsed) {
      setParseError('Could not parse diagram specification.');
      return null;
    }
    if (parsed.nodes.length === 0) {
      setParseError('Diagram has no nodes.');
      return null;
    }
    return parsed;
  }, [content]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    if (!spec) return { nodes: [], edges: [] };
    const rfNodes = toReactFlowNodes(spec.nodes);
    const rfEdges = toReactFlowEdges(spec.edges);
    return getLayoutedElements(rfNodes, rfEdges);
  }, [spec]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const copySource = useCallback(async () => {
    await copy(content.trim());
  }, [copy, content]);

  if (parseError || !spec) {
    return (
      <div className={cn('my-3 rounded-xl border border-border/50 bg-bg-subtle/35', className)}>
        <div className="flex min-h-44 items-center justify-center px-5 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-error-border/20 bg-error-bg/10 px-4 py-4 text-error-text">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="text-sm font-semibold">Diagram could not be rendered</div>
                <div className="mt-1 text-sm leading-6">{parseError || 'Invalid diagram specification.'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('group my-3 overflow-hidden rounded-xl border border-border/50 bg-[#0f172a]', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-bg-subtle/60 px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold tracking-[0.02em] text-text-secondary">
            {title?.trim() || 'Interactive diagram'}
          </div>
          <div className="text-[11px] text-text-muted">
            Drag nodes · Scroll to zoom · Pan to explore
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void copySource()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-bg-elevated px-3 text-[11px] font-medium text-text-secondary transition hover:bg-bg-hover hover:text-text-primary"
            title="Copy diagram source"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy source'}</span>
          </button>
        </div>
      </div>

      <div className="h-80 w-full" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
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
          zoomOnScroll
          zoomOnPinch
          defaultEdgeOptions={{
            style: { stroke: '#475569', strokeWidth: 1.5 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1e293b"
          />
          <Controls
            showInteractive={false}
            showFitView
            showZoom
            className="!bg-[#1e293b] !border-[#334155] !shadow-lg !rounded-lg"
          />
          <Panel position="bottom-right" className="!text-[10px] !text-slate-500">
            {spec.nodes.length} nodes · {spec.edges.length} edges
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
}
