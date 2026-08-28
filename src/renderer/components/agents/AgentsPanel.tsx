/**
 * T3 — Agents Panel (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * Dedicated right-hand panel displaying active & settled sub-agent task fleet.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Cpu, ExternalLink, FileText, Square, XCircle } from 'lucide-react';

import type { WorkLogEntry } from '../../../shared/contracts';
import { formatElapsed } from '../../../shared/toolCellGrammar';
import { foldAgents, isTerminalAgentStatus, type RuntimeAgent } from '../../lib/agentFold';
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

  // Elapsed is a live reading only while something is running; a settled
  // roster stops ticking entirely rather than repainting once a second.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLiveAgent) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasLiveAgent]);

  if (model.agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-text-muted">
        <Bot className="mb-3 h-8 w-8 stroke-[1.5] text-text-muted/60" />
        <h3 className="text-sm font-medium text-text-primary">No Sub-Agents Spawned</h3>
        <p className="mt-1 text-xs text-text-muted max-w-[220px]">
          Sub-agents spawned via the <code className="text-[11px] bg-bg-muted px-1 rounded">spawn_agent</code> tool will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 space-y-5 text-sm">
      {/* One quiet summary line, Tasks-tab header grammar: dim sentence-case,
          counts tabular, no box (spec §6). */}
      <div className="flex items-center gap-2 pb-1 text-sm font-normal text-text-tertiary">
        <Bot className="h-4 w-4 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
        <span>Sub-agents</span>
        <span className="tabular-nums text-text-faint">{model.agents.length}</span>
        <span className="ml-auto shrink-0 pl-3 tabular-nums text-sm text-text-faint">
          {model.totalTokens.toLocaleString()} tokens
        </span>
        {/* A fleet outlives its turn, and once the turn ends the composer's
            stop is gone — so the only fan-out control left has to be here,
            in the open, not behind a menu. */}
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
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
          >
            <Square className="h-3 w-3" />
            <span>{isStopping ? 'Stopping' : 'Stop'}</span>
          </button>
        )}
      </div>

      {/* Active Agents Section */}
      {model.activeAgents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-normal text-text-tertiary">
            Working now{' '}
            <span className="tabular-nums text-text-faint">{model.activeAgents.length}</span>
          </h3>
          <div className="space-y-2">
            {model.activeAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                nowMs={nowMs}
                isExpanded={expandedAgentId === agent.id}
                onToggle={() => setExpandedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                onOpenOutputFile={onOpenOutputFile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Settled Agents Section */}
      {model.settledAgents.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="text-sm font-normal text-text-tertiary">
            Earlier <span className="tabular-nums text-text-faint">{model.settledAgents.length}</span>
          </h3>
          <div className="space-y-2">
            {model.settledAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                nowMs={nowMs}
                isExpanded={expandedAgentId === agent.id}
                onToggle={() => setExpandedAgentId((prev) => (prev === agent.id ? null : agent.id))}
                onOpenOutputFile={onOpenOutputFile}
              />
            ))}
          </div>
        </div>
      )}
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
  /** Ticks once a second while the roster has live work, frozen otherwise. */
  nowMs: number;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenOutputFile?: (path: string) => void;
}) {
  const isTerminal = isTerminalAgentStatus(agent.status);
  const elapsedMs = agentElapsedMs(agent, nowMs);
  const tokens = agent.usage?.totalTokens ?? 0;

  return (
    <div
      className={cn(
        'rounded-lg border border-border-default bg-bg-surface/50 p-3 transition-colors hover:border-border-hover',
        isExpanded && 'bg-bg-surface border-border-hover'
      )}
    >
      <button
        onClick={onToggle}
        className="w-full text-left flex items-start justify-between gap-2 focus:outline-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={agent.status} />
          <span className="font-medium text-text-primary truncate">{agent.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-text-muted">
          {elapsedMs >= 1000 && <span className="tabular-nums">{formatElapsed(elapsedMs)}</span>}
          {tokens > 0 && <span className="tabular-nums">{tokens.toLocaleString()}</span>}
          {agent.model && (
            <span className="inline-flex items-center gap-1 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] font-mono text-text-muted">
              <Cpu className="h-3 w-3" />
              {agent.model}
            </span>
          )}
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}
        </div>
      </button>

      {/* Primary line: progress or result summary */}
      <div className="mt-2 text-xs text-text-secondary truncate">
        {agent.result ?? agent.error ?? agent.progress ?? (isTerminal ? 'Settled' : 'Running...')}
      </div>

      {/* Expanded Detail Body */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-border-subtle text-xs space-y-3">
          {agent.role && (
            <div>
              <span className="text-text-muted">Role: </span>
              <span className="text-text-primary font-medium">{agent.role}</span>
            </div>
          )}

          {agent.usage && (
            <div className="flex items-center gap-4 text-text-muted text-[11px]">
              <span>Tokens: {agent.usage.totalTokens.toLocaleString()}</span>
              {agent.usage.inputTokens !== undefined && (
                <span>In: {agent.usage.inputTokens.toLocaleString()}</span>
              )}
              {agent.usage.outputTokens !== undefined && (
                <span>Out: {agent.usage.outputTokens.toLocaleString()}</span>
              )}
            </div>
          )}

          {/* Activity Ring Buffer */}
          {agent.recentActivity.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-text-muted mb-1">Recent Activity</div>
              <ul className="space-y-1 text-text-secondary text-[11px]">
                {agent.recentActivity.map((act, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-text-muted/40 shrink-0" />
                    <span className="truncate">{act.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error display */}
          {agent.error && (
            <div className="rounded bg-destructive/10 border border-destructive/20 p-2 text-destructive flex items-start gap-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="break-all">{agent.error}</div>
            </div>
          )}

          {/* Output file link */}
          {agent.outputFile && (
            <button
              onClick={() => onOpenOutputFile?.(agent.outputFile!)}
              className="inline-flex items-center gap-1.5 text-accent hover:underline text-xs"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>{agent.outputFile}</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Wall time this run has been going, or took. */
function agentElapsedMs(agent: RuntimeAgent, nowMs: number): number {
  if (!agent.startedAt) return 0;
  const started = Date.parse(agent.startedAt);
  if (Number.isNaN(started)) return 0;
  const end = agent.completedAt ? Date.parse(agent.completedAt) : nowMs;
  return Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
}

function StatusDot({ status }: { status: string }) {
  if (status === 'completed') {
    return <span className="h-2 w-2 rounded-full bg-success shrink-0" />;
  }
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
    return <span className="h-2 w-2 rounded-full bg-error shrink-0" />;
  }
  if (status === 'running') {
    // `motion-glyph-pulse`, not `animate-pulse`: phase-locked with the rest
    // of the app's live marks and reduced-motion aware.
    return <span className="h-2 w-2 rounded-full bg-accent motion-glyph-pulse shrink-0" />;
  }
  return <span className="h-2 w-2 rounded-full bg-warning shrink-0" />;
}
