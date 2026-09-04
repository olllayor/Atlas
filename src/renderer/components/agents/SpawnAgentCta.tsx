/**
 * The spawn batch row in the transcript matching T3 Code subagent UI/UX.
 *
 * Top card:
 * `[• Ran 4 subagents       4 failed  Σ 636k  View ▸]`
 *
 * Below:
 * `4 subagents running in background:`
 * Table with `agent` | `scope`
 */
import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';

import type { ChatToolPart } from '../../../shared/contracts';
import {
  formatTokens,
  isActiveAgentStatus,
  summarizeBatch,
  type RuntimeAgent,
} from '../../lib/agentFold';
import { cn } from '../../lib/utils';

export type SpawnAgentCtaProps = {
  /** The agents this batch owns, already selected by `selectBatchAgents`. */
  agents: RuntimeAgent[];
  /**
   * How many `spawn_agent` calls the batch made. Covers the window between the
   * tool call and the first `task.started` row reaching the renderer, when the
   * roster is still empty but the fleet is not.
   */
  spawnCallCount?: number;
  /** The tool parts that initiated this batch, used to extract task scope details. */
  parts?: ChatToolPart[];
  onOpenAgentsPanel: () => void;
};

type SpawnTaskRow = {
  index: number;
  title: string;
  scope: string;
  status?: string;
  error?: string | null;
};

/** How many subagent tasks the spawn parts declare, before any roster row arrives. */
function countDeclaredTasks(parts: ChatToolPart[] | undefined): number {
  if (!parts || parts.length === 0) return 0;
  let total = 0;
  for (const part of parts) {
    let inputObj: any = part.input;
    if (!inputObj && part.rawInput) {
      try {
        inputObj = JSON.parse(part.rawInput);
      } catch {
        // ignore malformed rawInput (e.g. still streaming)
      }
    }
    if (inputObj && Array.isArray(inputObj.tasks)) {
      total += inputObj.tasks.length;
    }
  }
  return total;
}

function extractTaskRows(
  parts: ChatToolPart[] | undefined,
  agents: RuntimeAgent[],
  defaultCount: number
): SpawnTaskRow[] {
  const rows: SpawnTaskRow[] = [];

  if (parts && parts.length > 0) {
    for (const part of parts) {
      let inputObj: any = part.input;
      if (!inputObj && part.rawInput) {
        try {
          inputObj = JSON.parse(part.rawInput);
        } catch {
          // ignore malformed rawInput
        }
      }
      if (inputObj && Array.isArray(inputObj.tasks)) {
        for (const task of inputObj.tasks) {
          rows.push({
            index: rows.length + 1,
            title: task.title || `Agent ${rows.length + 1}`,
            scope: task.prompt || task.scope || task.title || '',
          });
        }
      }
    }
  }

  // Fallback to runtime agent roster if input schema didn't produce tasks
  if (rows.length === 0) {
    if (agents.length > 0) {
      agents.forEach((agent, i) => {
        rows.push({
          index: i + 1,
          title: agent.title,
          scope: agent.progress || agent.result || agent.role || agent.title,
          status: agent.status,
          error: agent.error,
        });
      });
    } else {
      const fallbackCount = Math.max(1, defaultCount);
      for (let i = 0; i < fallbackCount; i++) {
        rows.push({
          index: i + 1,
          title: `Agent ${i + 1}`,
          scope: 'Subagent task execution',
        });
      }
    }
  }

  // Correlate with live agent items if available
  return rows.map((row, idx) => {
    const matchedAgent = agents[idx] || agents.find((a) => a.title === row.title);
    return {
      ...row,
      status: matchedAgent?.status ?? row.status,
      error: matchedAgent?.error ?? row.error,
    };
  });
}

export function SpawnAgentCta({
  agents,
  spawnCallCount = 1,
  parts,
  onOpenAgentsPanel,
}: SpawnAgentCtaProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isLive = agents.some((agent) => isActiveAgentStatus(agent.status));

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const batch = summarizeBatch(agents, nowMs);
  const declaredTasks = useMemo(() => countDeclaredTasks(parts), [parts]);

  const taskRows = useMemo(
    () => extractTaskRows(parts, agents, Math.max(declaredTasks, spawnCallCount)),
    [parts, agents, declaredTasks, spawnCallCount]
  );

  // `spawnCallCount` counts spawn_agent *calls*; one call can fan out to many
  // tasks. Prefer the declared task count and the live roster over it so the
  // pill doesn't flash "Ran 1 subagent" for a 4-task fan-out while the first
  // `task.started` rows are still in flight.
  const count = Math.max(batch.total, taskRows.length, spawnCallCount);
  // Rows not yet in the roster haven't started reporting — treat them as
  // pending rather than dropping them from the running count.
  const active = batch.active + Math.max(0, count - batch.total);

  const failedCount = agents.filter(
    (a) => a.status === 'failed' || a.status === 'cancelled' || a.status === 'interrupted'
  ).length;

  return (
    <div className="my-3 w-full max-w-2xl font-sans">
      {/* Top Header Pill Banner */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-surface/80 px-3.5 py-2 text-xs transition-colors hover:border-border-hover">
        <div className="flex min-w-0 items-center gap-2">
          {failedCount > 0 ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
          ) : active > 0 ? (
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent motion-glyph-pulse" />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
          )}
          <Bot className="h-4 w-4 shrink-0 text-text-primary" strokeWidth={1.75} />
          <span className="truncate font-medium text-text-primary">
            {`Ran ${count} subagent${count === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs">
          {failedCount > 0 ? (
            <span className="font-mono text-destructive font-medium">{failedCount} failed</span>
          ) : active > 0 ? (
            <span className="font-mono text-accent">{active} running</span>
          ) : (
            <span className="font-mono text-text-muted">{count} settled</span>
          )}

          {batch.totalTokens > 0 && (
            <span className="font-mono tabular-nums text-text-muted">
              Σ {formatTokens(batch.totalTokens)}
            </span>
          )}

          <button
            type="button"
            onClick={onOpenAgentsPanel}
            aria-label="Open subagents in right panel"
            className="inline-flex items-center gap-1 font-medium text-accent transition-colors hover:underline hover:text-accent-hover focus:outline-none cursor-pointer"
          >
            <span>View</span>
            <span className="text-[10px] leading-none select-none">▸</span>
          </button>
        </div>
      </div>

      {/* Task Scope Table */}
      {taskRows.length > 0 && (
        <div className="mt-3.5 pl-1">
          <div className="mb-2 text-xs text-text-muted font-normal">
            {active > 0
              ? `${count} subagent${count === 1 ? '' : 's'} running in background:`
              : `${count} subagent${count === 1 ? '' : 's'} settled:`}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border-default/80 text-text-muted">
                  <th className="w-16 py-2 pr-4 font-normal">agent</th>
                  <th className="py-2 font-normal">scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/40">
                {taskRows.map((task) => (
                  <tr key={task.index} className="transition-colors hover:bg-bg-surface/40">
                    <td className="w-16 py-2.5 pr-4 align-top font-mono tabular-nums text-text-muted">
                      {task.index}
                    </td>
                    <td className="py-2.5 align-top leading-relaxed text-text-secondary break-words line-clamp-3">
                      {task.scope}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
