/**
 * The one row a spawn batch leaves in the transcript.
 *
 * `▸ 3 agents · 3 running · 42.1k tokens · 1m 04s ›` — the anchor back to the
 * fleet, rendered where the batch started and never folded away with the turn
 * (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`). The roster
 * itself lives in the Agents panel; this row is the link to it and the only
 * place in the transcript that names the fleet.
 */
import { useEffect, useState } from 'react';
import { Bot, ChevronRight } from 'lucide-react';

import { formatElapsed } from '../../../shared/toolCellGrammar';
import { isActiveAgentStatus, summarizeBatch, type RuntimeAgent } from '../../lib/agentFold';

export type SpawnAgentCtaProps = {
  /** The agents this batch owns, already selected by `selectBatchAgents`. */
  agents: RuntimeAgent[];
  /**
   * How many `spawn_agent` calls the batch made. Covers the window between the
   * tool call and the first `task.started` row reaching the renderer, when the
   * roster is still empty but the fleet is not.
   */
  spawnCallCount?: number;
  onOpenAgentsPanel: () => void;
};

function formatTokens(total: number): string {
  if (total >= 10_000) return `${(total / 1000).toFixed(1)}k`;
  return total.toLocaleString();
}

export function SpawnAgentCta({ agents, spawnCallCount = 1, onOpenAgentsPanel }: SpawnAgentCtaProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isLive = agents.some((agent) => isActiveAgentStatus(agent.status));

  // One second-hand tick per live batch, and none once the fleet settles: the
  // elapsed reading is text, so it costs a re-render, not a repaint loop.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const batch = summarizeBatch(agents, nowMs);
  const count = batch.total || spawnCallCount;
  const active = agents.length === 0 ? spawnCallCount : batch.active;
  const label = `${count} agent${count === 1 ? '' : 's'}`;
  const statusWord = active > 0 ? `${active} running` : 'settled';
  // The single-agent case reads better with its own name than with a count of
  // one — the same "readable title over identifier" rule the panel follows.
  const title = count === 1 ? (agents[0]?.title ?? null) : null;

  return (
    <button
      onClick={onOpenAgentsPanel}
      type="button"
      aria-label={`Open Agents panel — ${label}, ${statusWord}`}
      title={title ?? undefined}
      className="group my-2 flex w-full max-w-md items-center gap-2.5 rounded-lg border border-border-default bg-bg-surface/80 px-3 py-2 text-left text-xs transition-colors hover:border-border-hover hover:bg-bg-surface"
    >
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent/10 text-accent group-hover:bg-accent/20">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 font-medium text-text-primary">
        <span className="shrink-0">{title ?? label}</span>
        <span className="text-text-muted">•</span>
        {active > 0 ? (
          <span className="shrink-0 text-accent">{statusWord}</span>
        ) : (
          <span className="shrink-0 text-success">{statusWord}</span>
        )}
        {batch.totalTokens > 0 && (
          <>
            <span className="text-text-muted">•</span>
            <span className="shrink-0 tabular-nums text-text-muted">
              {formatTokens(batch.totalTokens)} tokens
            </span>
          </>
        )}
        {batch.elapsedMs >= 1000 && (
          <>
            <span className="text-text-muted">•</span>
            <span className="shrink-0 tabular-nums text-text-muted">{formatElapsed(batch.elapsedMs)}</span>
          </>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </button>
  );
}
