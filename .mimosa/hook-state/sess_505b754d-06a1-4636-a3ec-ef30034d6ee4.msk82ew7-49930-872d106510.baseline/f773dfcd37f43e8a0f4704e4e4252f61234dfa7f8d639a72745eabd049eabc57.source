/**
 * SpawnAgentCta card (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * Interactive summary row rendered in the timeline for a spawned subagent batch:
 * `▸ 4 agents · 2 running · 128k tokens` -> opens the Agents panel.
 */
import { Bot, ChevronRight } from 'lucide-react';
import type { RuntimeAgent } from '../../lib/agentFold';

export type SpawnAgentCtaProps = {
  agents: RuntimeAgent[];
  onOpenAgentsPanel: () => void;
};

export function SpawnAgentCta({ agents, onOpenAgentsPanel }: SpawnAgentCtaProps) {
  const activeCount = agents.filter((a) => a.status === 'running' || a.status === 'pending').length;
  const totalTokens = agents.reduce((acc, a) => acc + (a.usage?.totalTokens ?? 0), 0);
  const count = agents.length > 0 ? agents.length : 1;

  return (
    <button
      onClick={onOpenAgentsPanel}
      type="button"
      className="group my-2 flex w-full max-w-md items-center gap-2.5 rounded-lg border border-border-default bg-bg-surface/80 px-3 py-2 text-left text-xs transition-colors hover:border-border-hover hover:bg-bg-surface"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded bg-accent/10 text-accent group-hover:bg-accent/20">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-1 items-center gap-2 font-medium text-text-primary">
        <span>{count} agent{count > 1 ? 's' : ''}</span>
        <span className="text-text-muted">•</span>
        {activeCount > 0 || agents.length === 0 ? (
          <span className="text-accent">{activeCount || 1} running</span>
        ) : (
          <span className="text-success">settled</span>
        )}
        {totalTokens > 0 && (
          <>
            <span className="text-text-muted">•</span>
            <span className="text-text-muted">{totalTokens.toLocaleString()} tokens</span>
          </>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </button>
  );
}
