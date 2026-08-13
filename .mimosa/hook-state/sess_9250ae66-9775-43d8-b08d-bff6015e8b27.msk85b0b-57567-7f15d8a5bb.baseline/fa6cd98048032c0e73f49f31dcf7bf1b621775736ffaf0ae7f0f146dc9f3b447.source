/**
 * T3 — Agents Panel (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * Dedicated right-hand panel displaying active & settled sub-agent task fleet.
 */
import { useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Cpu, ExternalLink, FileText, XCircle } from 'lucide-react';

import type { WorkLogEntry } from '../../../shared/contracts';
import { foldAgents, isTerminalAgentStatus, type RuntimeAgent } from '../../lib/agentFold';
import { cn } from '../../lib/utils';

export type AgentsPanelProps = {
  conversationId?: string;
  activities?: WorkLogEntry[];
  onOpenOutputFile?: (filePath: string) => void;
};

export function AgentsPanel({
  activities = [],
  onOpenOutputFile,
}: AgentsPanelProps) {
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  const model = useMemo(() => foldAgents(activities), [activities]);

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
      {/* Summary Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <span className="font-semibold text-text-primary">Sub-Agents Roster</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>{model.agents.length} total</span>
          <span>•</span>
          <span>{model.totalTokens.toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Active Agents Section */}
      {model.activeAgents.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Live Agents ({model.activeAgents.length})
          </div>
          <div className="space-y-2">
            {model.activeAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
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
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Earlier ({model.settledAgents.length})
          </div>
          <div className="space-y-2">
            {model.settledAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
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
  isExpanded,
  onToggle,
  onOpenOutputFile,
}: {
  agent: RuntimeAgent;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenOutputFile?: (path: string) => void;
}) {
  const isTerminal = isTerminalAgentStatus(agent.status);

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
        <div className="flex items-center gap-2 shrink-0">
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

function StatusDot({ status }: { status: string }) {
  if (status === 'completed') {
    return <span className="h-2 w-2 rounded-full bg-success shrink-0" />;
  }
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') {
    return <span className="h-2 w-2 rounded-full bg-error shrink-0" />;
  }
  if (status === 'running') {
    return <span className="h-2 w-2 rounded-full bg-accent animate-pulse shrink-0" />;
  }
  return <span className="h-2 w-2 rounded-full bg-warning shrink-0" />;
}
