/**
 * T3 — Agents Panel (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * The only roster surface. Live workflows render as bordered sections with a
 * phase rail and collapsible phase groups; direct agents render as flat rows;
 * settled runs collapse to one line under "Earlier".
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Square,
} from 'lucide-react';

import type { WorkLogEntry } from '../../../shared/contracts';
import { formatElapsed } from '../../../shared/toolCellGrammar';
import {
  foldAgents,
  formatTokens,
  groupMembersByPhase,
  isActiveAgentStatus,
  isTerminalAgentStatus,
  phaseMemberStatus,
  type RuntimeAgent,
  type RuntimeWorkflow,
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
  // Phase collapse: `${workflowId}:${phaseIndex}` -> collapsed. Absent means
  // default (live open, done collapsed).
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});

  const model = useMemo(() => foldAgents(activities), [activities]);
  const hasLiveAgent = model.activeAgents.length > 0;

  const liveWorkflows = useMemo(
    () => model.workflows.filter((workflow) => isActiveAgentStatus(workflow.status)),
    [model.workflows]
  );
  const settledWorkflows = useMemo(
    () => model.workflows.filter((workflow) => !isActiveAgentStatus(workflow.status)),
    [model.workflows]
  );
  const liveDirect = useMemo(
    () => model.directAgents.filter((agent) => isActiveAgentStatus(agent.status)),
    [model.directAgents]
  );
  const settledDirect = useMemo(
    () => model.directAgents.filter((agent) => !isActiveAgentStatus(agent.status)),
    [model.directAgents]
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

  const togglePhase = (workflowId: string, phaseIndex: number) => {
    const key = `${workflowId}:${phaseIndex}`;
    setCollapsedPhases((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };

  const isPhaseCollapsed = (workflowId: string, phaseIndex: number, live: boolean) => {
    const key = `${workflowId}:${phaseIndex}`;
    // Default: live open, done collapsed.
    if (!(key in collapsedPhases)) return !live;
    return collapsedPhases[key] ?? false;
  };

  return (
    <div className="flex h-full flex-col bg-bg-base font-sans select-text">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-wider text-text-muted uppercase select-none">
        <span>AGENTS</span>
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

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4 scrollbar-auto-hide">
        {/* Live workflows as bordered sections */}
        {liveWorkflows.map((workflow) => (
          <WorkflowSection
            key={workflow.id}
            workflow={workflow}
            nowMs={nowMs}
            isPhaseCollapsed={(phaseIndex, live) => isPhaseCollapsed(workflow.id, phaseIndex, live)}
            onTogglePhase={(phaseIndex) => togglePhase(workflow.id, phaseIndex)}
            onOpenOutputFile={onOpenOutputFile}
          />
        ))}

        {/* Live direct spawns: flat rows, no unfold */}
        {liveDirect.length > 0 && (
          <section aria-label="Direct spawns">
            {liveWorkflows.length > 0 && (
              <div className="pb-1.5 text-[11px] font-semibold tracking-wider text-text-muted uppercase select-none">
                Direct spawns
              </div>
            )}
            <div className="space-y-3">
              {liveDirect.map((agent) => (
                <AgentRow key={agent.id} agent={agent} nowMs={nowMs} onOpenOutputFile={onOpenOutputFile} />
              ))}
            </div>
          </section>
        )}

        {/* Earlier: settled runs collapse to one line each */}
        {(settledWorkflows.length > 0 || settledDirect.length > 0) && (
          <section aria-label="Earlier">
            <div className="pt-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase select-none">
              Earlier
            </div>
            <div className="mt-1.5 space-y-1">
              {settledWorkflows.map((workflow) => (
                <SettledWorkflowLine key={workflow.id} workflow={workflow} nowMs={nowMs} />
              ))}
              {settledDirect.map((agent) => (
                <SettledAgentLine key={agent.id} agent={agent} nowMs={nowMs} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky Bottom Bar */}
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

function WorkflowSection({
  workflow,
  nowMs,
  isPhaseCollapsed,
  onTogglePhase,
  onOpenOutputFile,
}: {
  workflow: RuntimeWorkflow;
  nowMs: number;
  isPhaseCollapsed: (phaseIndex: number, live: boolean) => boolean;
  onTogglePhase: (phaseIndex: number) => void;
  onOpenOutputFile?: (path: string) => void;
}) {
  const scriptPath = workflow.runHandles?.scriptPath ?? null;
  const sessionUrl = workflow.runHandles?.sessionUrl ?? null;
  const groups = useMemo(() => groupMembersByPhase(workflow.members), [workflow.members]);
  const elapsedMs = workflowElapsedMs(workflow, nowMs);

  return (
    <section
      aria-label={`Workflow ${workflow.name}`}
      className="rounded-lg border border-border-default bg-bg-surface/40 p-3"
    >
      {/* Header: name + {} script + status */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={workflow.status} />
        <span className="truncate text-xs font-semibold text-text-primary">
          <span className="mr-1.5 font-normal text-text-muted">Workflow ·</span>
          {workflow.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {scriptPath && (
            <button
              type="button"
              onClick={() => onOpenOutputFile?.(scriptPath)}
              aria-label={`Open run script for ${workflow.name}`}
              title={scriptPath}
              className="inline-flex h-5 items-center rounded border border-border-subtle bg-bg-muted/60 px-1.5 font-mono text-[11px] text-text-muted transition-colors hover:text-text-primary hover:border-border-hover cursor-pointer"
            >
              {'{}'}
              <span className="ml-1 hidden sm:inline">script</span>
            </button>
          )}
          {sessionUrl && (
            <a
              href={sessionUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open external session for ${workflow.name}`}
              className="inline-flex h-5 items-center gap-0.5 rounded px-1 text-[11px] text-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className="font-mono text-[11px] tabular-nums text-text-muted">{formatElapsed(elapsedMs)}</span>
        </span>
      </div>

      {/* Phase rail: per-phase segments with member status dots */}
      {workflow.phases.length > 0 && (
        <div className="mt-2 flex gap-1" role="img" aria-label={`${workflow.phases.length} phases`}>
          {workflow.phases.map((phase) => {
            const info = phaseMemberStatus(workflow.members, phase.index);
            return (
              <div
                key={phase.index}
                title={`${phase.title} · ${info.count} agent${info.count === 1 ? '' : 's'}`}
                className={cn(
                  'flex h-5 min-w-0 flex-1 items-center justify-center gap-1 rounded border px-1',
                  info.live
                    ? 'border-accent/30 bg-accent/10'
                    : info.failed
                      ? 'border-destructive/30 bg-destructive/10'
                      : info.done
                        ? 'border-border-subtle bg-bg-muted/60'
                        : 'border-border-subtle/60 bg-transparent'
                )}
              >
                {workflow.members
                  .filter((member) => (member.phaseIndex ?? -2) === phase.index)
                  .slice(0, 8)
                  .map((member) => (
                    <MemberDot key={member.id} status={member.status} />
                  ))}
                {info.count === 0 && <span className="h-1 w-1 rounded-full bg-text-faint/40" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Phase sections: live open, done collapsed */}
      <div className="mt-2 space-y-1.5">
        {groups.map((group) => {
          const phaseIndex = group.phase?.index ?? -1;
          const info = group.phase ? phaseMemberStatus(workflow.members, group.phase.index) : { live: group.members.some((m) => isActiveAgentStatus(m.status)), done: false, failed: false, count: group.members.length };
          const collapsed = group.phase ? isPhaseCollapsed(group.phase.index, info.live) : false;
          if (!group.phase) {
            return (
              <div key="unphased" className="space-y-2 pt-1">
                {group.members.map((member) => (
                  <AgentRow key={member.id} agent={member} nowMs={nowMs} onOpenOutputFile={onOpenOutputFile} />
                ))}
              </div>
            );
          }
          return (
            <div key={phaseIndex} className="rounded border border-border-subtle/60">
              <button
                type="button"
                onClick={() => onTogglePhase(group.phase!.index)}
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left cursor-pointer"
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                )}
                <span className="truncate text-[11px] font-medium text-text-secondary">{group.phase.title}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-text-faint">
                  {group.members.filter((m) => isActiveAgentStatus(m.status)).length > 0
                    ? `${group.members.filter((m) => isActiveAgentStatus(m.status)).length} active`
                    : info.failed
                      ? 'failed'
                      : 'done'}
                  {' · '}
                  {group.members.length}
                </span>
              </button>
              {!collapsed && (
                <div className="space-y-2 border-t border-border-subtle/60 px-2 py-2">
                  {group.members.map((member) => (
                    <AgentRow key={member.id} agent={member} nowMs={nowMs} onOpenOutputFile={onOpenOutputFile} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Coordinator progress line */}
      {workflow.coordinator?.progress && (
        <p className="mt-2 truncate text-[11px] text-text-secondary">{workflow.coordinator.progress}</p>
      )}
      <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-text-faint">
        <span className="tabular-nums">{formatTokens(workflow.totalTokens)} tok</span>
        <span>·</span>
        <span className="tabular-nums">{workflow.members.length} agents</span>
      </div>
    </section>
  );
}

/** Flat agent row: no unfold, no expand. Errors are the only inline preview. */
function AgentRow({
  agent,
  nowMs,
  onOpenOutputFile,
}: {
  agent: RuntimeAgent;
  nowMs: number;
  onOpenOutputFile?: (path: string) => void;
}) {
  const elapsedMs = agentElapsedMs(agent, nowMs);
  const tokens = agent.usage?.totalTokens ?? 0;
  const hasError = Boolean(agent.error || agent.status === 'failed');
  const scriptPath = agent.runHandles?.scriptPath ?? null;

  return (
    <div className="group relative rounded p-1 -mx-1">
      <div className="flex items-center gap-2">
        <StatusDot status={agent.status} />
        <span className="truncate font-semibold text-text-primary text-xs">{agent.title}</span>
        <span className="shrink-0 rounded bg-bg-muted/80 border border-border-subtle/80 px-1.5 py-0.5 text-[10px] font-mono text-text-muted leading-none">
          {agent.role || 'general-purpose'}
        </span>
        {scriptPath && (
          <button
            type="button"
            onClick={() => onOpenOutputFile?.(scriptPath)}
            aria-label={`Open run script for ${agent.title}`}
            title={scriptPath}
            className="inline-flex h-5 shrink-0 items-center rounded border border-border-subtle bg-bg-muted/60 px-1.5 font-mono text-[10px] text-text-muted transition-colors hover:text-text-primary cursor-pointer"
          >
            {'{}'}
          </button>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-text-muted">
          {formatElapsed(elapsedMs)}
        </span>
      </div>

      {hasError ? (
        <p className="mt-1 text-xs font-normal leading-relaxed text-destructive/95 break-words">
          {agent.error || 'Agent terminated early due to an error'}
        </p>
      ) : agent.status === 'idle' ? (
        <p className="mt-1 truncate text-xs font-normal leading-relaxed text-text-secondary">
          Idle · resumable{agent.progress ? ` · ${agent.progress}` : agent.result ? ` · ${agent.result}` : ''}
        </p>
      ) : isActiveAgentStatus(agent.status) ? (
        <p className="mt-1 truncate text-xs font-normal leading-relaxed text-text-secondary">
          {agent.progress || (agent.lastToolName ? `Running ${agent.lastToolName}` : 'Working…')}
        </p>
      ) : (
        <p className="mt-1 truncate text-xs font-normal leading-relaxed text-text-secondary">
          {agent.error || agent.result || agent.progress || 'Settled'}
        </p>
      )}

      <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-text-faint">
        {agent.model && <span>&lt;{agent.model}&gt;</span>}
        {agent.model && <span>·</span>}
        {agent.reasoningEffort && <span>{agent.reasoningEffort}</span>}
        {agent.reasoningEffort && <span>·</span>}
        <span className="tabular-nums">{formatTokens(tokens)} tok</span>
        <span>·</span>
        <span className="tabular-nums">{agent.toolCount ?? 0} tools</span>
        {agent.activationCount > 1 && (
          <>
            <span>·</span>
            <span className="tabular-nums">run {agent.activationCount}</span>
          </>
        )}
        {agent.outputFile && (
          <>
            <span>·</span>
            <button
              type="button"
              onClick={() => onOpenOutputFile?.(agent.outputFile!)}
              className="inline-flex items-center gap-1 text-accent hover:underline cursor-pointer"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[120px] truncate">{agent.outputFile}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SettledWorkflowLine({ workflow, nowMs }: { workflow: RuntimeWorkflow; nowMs: number }) {
  const elapsedMs = workflowElapsedMs(workflow, nowMs);
  const failed = workflow.status === 'failed';
  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs">
      <StatusDot status={workflow.status} />
      <span className="truncate text-text-secondary">
        <span className="font-medium text-text-primary">{workflow.name}</span>
        <span className="ml-1.5 font-mono text-[11px] text-text-faint">
          {workflow.members.length} agents · {formatTokens(workflow.totalTokens)} tok · {formatElapsed(elapsedMs)}
        </span>
      </span>
      <span className={cn('ml-auto shrink-0 font-mono text-[11px]', failed ? 'text-destructive' : 'text-text-faint')}>
        {failed ? 'Failed' : workflow.status === 'idle' ? 'Idle' : 'Settled'}
      </span>
    </div>
  );
}

function SettledAgentLine({ agent, nowMs }: { agent: RuntimeAgent; nowMs: number }) {
  const elapsedMs = agentElapsedMs(agent, nowMs);
  const failed = agent.status === 'failed' || agent.status === 'cancelled' || agent.status === 'interrupted';
  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-xs">
      <StatusDot status={agent.status} />
      <span className="truncate text-text-secondary">
        <span className="font-medium text-text-primary">{agent.title}</span>
        <span className="ml-1.5 truncate font-normal">
          {agent.error || agent.result || agent.progress || (agent.status === 'idle' ? 'Idle · resumable' : 'Settled')}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] tabular-nums text-text-faint">
        <span>{formatTokens(agent.usage?.totalTokens ?? 0)}</span>
        <span>{formatElapsed(elapsedMs)}</span>
      </span>
      <span className={cn('shrink-0 font-mono text-[11px]', failed ? 'text-destructive' : 'text-text-faint')}>
        {failed ? 'Failed' : agent.status === 'idle' ? 'Idle' : 'Settled'}
      </span>
    </div>
  );
}

/**
 * Bottom-bar counts. Idle presents as settled: it keeps its roster row and
 * resumable label, but never pins a live count.
 */
function joinAgentCounts(model: { activeAgents: readonly unknown[]; settledAgents: readonly unknown[] }) {
  const parts: string[] = [];
  if (model.activeAgents.length > 0) parts.push(`${model.activeAgents.length} running`);
  if (model.settledAgents.length > 0 || parts.length === 0)
    parts.push(`${model.settledAgents.length} settled`);
  return parts.join(' · ');
}

function agentElapsedMs(agent: RuntimeAgent, nowMs: number): number {
  if (!agent.startedAt) return 0;
  const started = Date.parse(agent.startedAt);
  if (Number.isNaN(started)) return 0;
  const end = agent.completedAt ? Date.parse(agent.completedAt) : nowMs;
  return Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
}

function workflowElapsedMs(workflow: RuntimeWorkflow, nowMs: number): number {
  if (!workflow.startedAt) return 0;
  const started = Date.parse(workflow.startedAt);
  if (Number.isNaN(started)) return 0;
  const end = workflow.completedAt ? Date.parse(workflow.completedAt) : nowMs;
  return Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
}

/** Static dots: no pulse, shimmer, or spinner loops. Idle reads as settled. */
function StatusDot({ status }: { status: string }) {
  if (status === 'failed') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />;
  }
  if (status === 'cancelled' || status === 'interrupted') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-text-faint/60" />;
  }
  if (status === 'completed') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-success" />;
  }
  if (status === 'waiting') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />;
  }
  if (status === 'pending') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-text-faint/40" />;
  }
  if (status === 'idle') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-text-faint/60" />;
  }
  // running and unknown in-flight: static sky, never pulsing.
  return <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />;
}

function MemberDot({ status }: { status: string }) {
  if (status === 'failed') return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />;
  if (status === 'completed') return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />;
  if (status === 'waiting') return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />;
  if (status === 'cancelled' || status === 'interrupted' || status === 'idle')
    return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint/60" />;
  if (status === 'pending') return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-faint/40" />;
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />;
}

export { isTerminalAgentStatus };
