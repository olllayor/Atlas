# T1 — Task/agent contracts, stable activity ids, `agentKind` stamp

**Depends on:** nothing. **Blocks:** T2, T3, T4.
**Surface:** `src/shared/`, `src/main/db/repositories/runtimeStateRepo.ts`, `tests/`.
**No DB migration.** Everything rides in the existing JSON `payload` column.

## Why

`ActivityType` stops at `tool.*`/`approval.*`/`turn.*`, and
`getWorkLogEntryId` falls back to `activity:${eventId}` for anything else — so any
recurring progress event would append a new work-log row per tick. t3code hit exactly
this and fixed it with subject-derived ids that upsert. Fix it before Atlas emits its
first tick.

## Deliverables

### 1. `src/shared/contracts.ts`

Extend `ActivityType` with four literals:

```ts
| 'task.started'
| 'task.progress'
| 'task.updated'   // non-terminal status patch
| 'task.completed'
```

Add, near the other runtime types:

```ts
export type RuntimeTaskStatus =
  | 'pending' | 'running' | 'waiting' | 'idle'
  | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type RuntimeTaskUsage = {
  totalTokens: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  toolUses?: number;
  durationMs?: number;
};

/**
 * Optional agent-identity linkage carried on EVERY task payload — including
 * progress and terminal payloads, not just `task.started`. Repetition is the
 * point: a fold must be able to reconstruct an agent whose start row aged out
 * of retention. All fields optional so old rows decode unchanged.
 */
export type TaskAgentLinkage = {
  taskType?: string;
  agentKind?: 'agent' | 'background';   // server-stamped, clients trust it
  agentId?: string;                     // owning agent when nested
  parentAgentId?: string;
  toolCallId?: string;                  // the spawn tool call that created it
  title?: string;
  role?: string;
  model?: string;
  effort?: string;
  agentIndex?: number;
  attempt?: number;
  outputFile?: string;
  /** Provider-synthesized rows that belong only in the Agents surface. */
  timelineBypass?: boolean;
};
```

Add `agentId?: string | null` and `parentToolCallId?: string | null` to
**`RuntimeEventEnvelope`** and to **`WorkLogEntry`** (top-level, not just payload — the
renderer filters on them hot-path and should not have to reach into `payload`).

### 2. `src/shared/runtimeActivity.ts`

**`classifyTaskAgentKind`** — copy the denylist shape, do not invent an allowlist:

```ts
export const MONITOR_TASK_TYPES: ReadonlySet<string> = new Set([
  'monitor', 'shell', 'local_bash', 'terminal', 'site_dev_server',
]);
export const INERT_TASK_TYPES: ReadonlySet<string> = new Set(['plan']);

/**
 * Denylist by design. Agent-flavoured type names drift; an allowlist silently
 * drops real subagents the first time a new name appears. Unknown ⇒ agent.
 * A task launched from inside an agent (agentId set) is agent-internal
 * background work UNLESS it is itself agent-flavoured — a nested agent can
 * outlive its parent and must stay in the roster.
 */
export function classifyTaskAgentKind(input: {
  taskType?: string;
  agentId?: string;
}): 'agent' | 'background';
```

**`getWorkLogEntryId`** — add a task branch *before* the `activity:${eventId}` fallback:

```ts
if (event.activityType.startsWith('task.') && typeof event.payload.taskId === 'string') {
  return `task:${event.payload.taskId}`;
}
```

so all four task events for one task collapse onto one upserting row.

**`deriveWorkLogEntry`** — handle the task branch: title from
`payload.title ?? payload.description`, status mapped from `RuntimeTaskStatus`
(`completed`→`completed`, `failed`/`cancelled`/`interrupted`→`error`, everything else
→`running`), `isFinal` only on terminal statuses, and — critically — **merge, don't
replace**: a terminal payload carrying only `totalTokens` must not wipe a known usage
breakdown, and a late-arriving payload must never downgrade a known field to null.

Export a shared field-wise **`mergeTaskUsage(current, incoming)`** doing a max-merge
(`Math.max` per field, `undefined` yields to a known value). Max-merge is idempotent
under duplicate and out-of-order frames, which is what makes the fold order-robust.

### 3. `src/main/db/repositories/runtimeStateRepo.ts`

- Stamp `agentKind` at record time via `classifyTaskAgentKind` for every `task.*` event,
  and persist `agentId` / `parentToolCallId` onto the work-log row. This is the
  "classify once at the boundary" rule — nothing downstream re-derives it.
- Verify the existing upsert in `recordEvent` (around `runtimeStateRepo.ts:485`) merges
  payloads rather than overwriting, since task rows now accumulate across four event types.
- Confirm `listActivitiesByConversation` still returns rows in sequence order after the
  id change (a `task:` row's `sequence` should track its **latest** event so it sorts by
  recency, but its `createdAt` must stay first-write).

## Tests — `tests/runtimeActivityTasks.test.ts`

Pin the invariants, not the implementation:

1. Four `task.*` events for one `taskId` produce **one** work-log row.
2. 200 progress ticks produce one row (the flood test).
3. `task.completed` with no preceding `task.started` still yields a coherent row —
   completion can create the entity.
4. A late `task.started` after `task.completed` fills missing metadata but does **not**
   reset status or `createdAt`.
5. Terminal payload carrying only `totalTokens` preserves an earlier `inputTokens`.
6. `classifyTaskAgentKind`: unknown type ⇒ `agent`; `shell` ⇒ `background`;
   `{ agentId, taskType: 'shell' }` ⇒ `background`; `{ agentId, taskType: 'subagent' }`
   ⇒ `agent` (nested agent stays in the roster).
7. A row with no `agentKind` (legacy) is treated as `background` by consumers.

## Definition of done

`pnpm test` green, `pnpm build` green, no schema change in `db/migrations`, and every
existing work-log test still passes untouched.
