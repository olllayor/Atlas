/**
 * T3 — Agents Panel (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * Dedicated right-hand panel displaying active & settled sub-agent task fleet,
 * matching the T3 Code direct spawns UI/UX layout.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Square,
  XCircle,
} from 'lucide-react';

import type { WorkLogEntry } from '../../../shared/contracts';
import { formatElapsed } from '../../../shared/toolCellGrammar';
import {
  foldAgents,
  formatTokens,
  isTerminalAgentStatus,
  type RuntimeAgent,
} from '../../lib/agentFold';
import { cn } from '../../lib/utils';

export type AgentsPanelProps = {
  conversationId?: string;
  activities?: WorkLogEntry[];
  onOpenOutputFile?: (filePath: string) => void;
};

export function AgentsPanel({
  conversationId,
  activities = [],
  onOpenOutputFile,
}: AgentsPanelProps) {
  const [isStopping, setIsStopping] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const model = useMemo(() => foldAgents(activities), [activities]);
  const hasLiveAgent = model.activeAgents.length > 0;
  // The header promises direct spawns; nested grandchildren (spawned from
  // inside another agent) get their own shelf so the roster doesn't lie.
  const directAgents = useMemo(
    () => model.agents.filter((agent) => agent.kind !== 'nested'),
    [model.agents]
  );
  const nestedAgents = useMemo(
    () => model.agents.filter((agent) => agent.kind === 'nested'),
    [model.agents]
  );

  // Elapsed ticks live while work is active; freezes once settled
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLiveAgent) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasLiveAgent]);

  if (model.agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-text-muted font-sans">
        <Bot className="mb-3 h-8 w-8 stroke-[1.5] text-text-muted/60" />
        <h3 className="text-sm font-medium text-text-primary">No Sub-Agents Spawned</h3>
        <p className="mt-1 max-w-[220px] text-xs text-text-muted">
          Sub-agents spawned via the <code className="rounded bg-bg-muted px-1 text-[11px]">spawn_agent</code> tool will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-base font-sans select-text">
      {/* DIRECT SPAWNS Section Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-wider text-text-muted uppercase select-none">
        <span>DIRECT SPAWNS</span>
        {hasLiveAgent && conversationId && (
          <button
            type="button"
            disabled={isStopping}
            onClick={() => {
              setIsStopping(true);
              void window.atlasChat?.subagents
                ?.interruptAll(conversationId)
                .catch(() => {})
                .finally(() => setIsStopping(false));
            }}
            aria-label={`Stop ${model.activeAgents.length} running agent${model.activeAgents.length === 1 ? '' : 's'}`}
            className="inline-flex items-center gap-1 text-[11px] font-normal tracking-normal text-text-tertiary transition-colors hover:text-destructive disabled:opacity-50 cursor-pointer"
          >
            <Square className="h-3 w-3 fill-current" />
            <span>{isStopping ? 'Stopping' : 'Stop all'}</span>
          </button>
        )}
      </div>

      {/* Main Agent Card List */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 scrollbar-auto-hide">
        {directAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            nowMs={nowMs}
            isExpanded={expandedAgentId === agent.id}
            onToggle={() => setExpandedAgentId((prev) => (prev === agent.id ? null : agent.id))}
            onOpenOutputFile={onOpenOutputFile}
          />
        ))}
        {nestedAgents.length > 0 && (
          <>
            <div className="pt-2 text-[11px] font-semibold tracking-wider text-text-muted uppercase select-none">
              NESTED
            </div>
            {nestedAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                nowMs={nowMs}
                isExpanded={expandedAgentId === agent.id}
                onToggle={() => setExpandedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                onOpenOutputFile={onOpenOutputFile}
              />
            ))}
          </>
        )}
      </div>

      {/* Sticky Bottom Bar matching Image 2 */}
      <div className="shrink-0 border-t border-border-default/80 bg-bg-surface/70 backdrop-blur px-4 py-2.5 text-xs text-text-muted flex items-center justify-between font-mono select-none">
        <span>{joinAgentCounts(model)}</span>
        {model.totalTokens > 0 && (
          <span className="tabular-nums text-text-muted">
            Σ {formatTokens(model.totalTokens)} tok
          </span>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  nowMs,
  isExpanded,
  onToggle,
  onOpenOutputFile,
}: {
  agent: RuntimeAgent;
  nowMs: number;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenOutputFile?: (path: string) => void;
}) {
  const isTerminal = isTerminalAgentStatus(agent.status);
  const elapsedMs = agentElapsedMs(agent, nowMs);
  const tokens = agent.usage?.totalTokens ?? 0;
  const hasError = Boolean(agent.error || agent.status === 'failed');

  return (
    <div
      className={cn(
        'group relative rounded-lg border border-transparent p-1 -mx-1 transition-colors hover:bg-bg-surface/40',
        isExpanded && 'bg-bg-surface/60 border-border-subtle'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left focus:outline-none cursor-pointer"
      >
        {/* Line 1: Status Dot + Title + general-purpose badge + Duration */}
        <div className="flex items-center gap-2">
          <StatusDot status={agent.status} hasError={hasError} />
          <span className="truncate font-semibold text-text-primary text-xs">
            {agent.title}
          </span>
          <span className="shrink-0 rounded bg-bg-muted/80 border border-border-subtle/80 px-1.5 py-0.5 text-[10px] font-mono text-text-muted leading-none">
            {agent.role || 'general-purpose'}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
            {formatElapsed(elapsedMs)}
          </span>
        </div>

        {/* Line 2: Status / Error / Progress message */}
        {hasError ? (
          <p className="mt-1 text-xs font-normal leading-relaxed text-destructive/95 break-words">
            {agent.error || 'Agent terminated early due to an error'}
          </p>
        ) : agent.status === 'running' ? (
          <p className="mt-1 truncate text-xs font-normal leading-relaxed text-text-secondary">
            {agent.progress || (agent.lastToolName ? `Running ${agent.lastToolName}` : 'Working in background...')}
          </p>
        ) : (
          <p className="mt-1 truncate text-xs font-normal leading-relaxed text-text-secondary">
            {agent.result ||
              agent.progress ||
              (isTerminal ? 'Settled' : agent.status === 'idle' ? 'Idle' : 'Running...')}
          </p>
        )}

        {/* Line 3: Metadata footer (model · effort · tokens · tools). Unknown segments are omitted, never invented. */}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-text-faint">
          {agent.model && <span>&lt;{agent.model}&gt;</span>}
          {agent.model && <span>·</span>}
          {agent.reasoningEffort && <span>{agent.reasoningEffort}</span>}
          {agent.reasoningEffort && <span>·</span>}
          <span className="tabular-nums">{formatTokens(tokens)} tok</span>
          <span>·</span>
          <span className="tabular-nums">{agent.toolCount ?? 0} tools</span>
          <span className="ml-auto transition-transform group-hover:text-text-secondary">
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
            )}
          </span>
        </div>
      </button>

      {/* Expanded Detailed View (progressive disclosure) */}
      {isExpanded && (
        <div className="mt-2.5 border-t border-border-subtle pt-2.5 text-xs space-y-2.5 font-sans">
          {agent.usage && (
            <div className="flex items-center gap-4 text-[11px] font-mono text-text-muted">
              <span>Tokens: {agent.usage.totalTokens.toLocaleString()}</span>
              {agent.usage.inputTokens !== undefined && (
                <span>In: {agent.usage.inputTokens.toLocaleString()}</span>
              )}
              {agent.usage.outputTokens !== undefined && (
                <span>Out: {agent.usage.outputTokens.toLocaleString()}</span>
              )}
            </div>
          )}

          {agent.recentActivity.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-text-muted">Recent Activity</div>
              <ul className="space-y-1 text-[11px] text-text-secondary">
                {agent.recentActivity.map((act, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-text-muted/40" />
                    <span className="truncate">{act.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {agent.error && (
            <div className="flex items-start gap-1.5 rounded border border-destructive/20 bg-destructive/10 p-2 text-destructive">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="break-all font-mono text-[11px]">{agent.error}</div>
            </div>
          )}

          {agent.outputFile && (
            <button
              type="button"
              onClick={() => onOpenOutputFile?.(agent.outputFile!)}
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate">{agent.outputFile}</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bottom-bar counts. Idle agents are parked, not done: naming them keeps the
 * bar from claiming completion the roster never reported (t3code #9616).
 */
function joinAgentCounts(model: { activeAgents: readonly unknown[]; settledAgents: RuntimeAgent[] }) {
  const idle = model.settledAgents.filter((agent) => agent.status === 'idle').length;
  const settled = model.settledAgents.length - idle;
  const parts: string[] = [];
  if (model.activeAgents.length > 0) parts.push(`${model.activeAgents.length} running`);
  if (idle > 0) parts.push(`${idle} idle`);
  if (settled > 0 || parts.length === 0) parts.push(`${settled} settled`);
  return parts.join(' · ');
}

function agentElapsedMs(agent: RuntimeAgent, nowMs: number): number {  if (!agent.startedAt) return 0;
  const started = Date.parse(agent.startedAt);
  if (Number.isNaN(started)) return 0;
  const end = agent.completedAt ? Date.parse(agent.completedAt) : nowMs;
  return Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
}

function StatusDot({ status, hasError }: { status: string; hasError?: boolean }) {
  if (hasError || status === 'failed' || status === 'cancelled' || status === 'interrupted') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />;
  }
  if (status === 'completed' || status === 'resolved') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-success" />;
  }
  if (status === 'running') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-accent motion-glyph-pulse" />;
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />;
}
