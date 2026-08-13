# T4 — Background liveness registry + sidebar Working/Monitoring pill

**Depends on:** [T1](01-contracts-and-activity-ids.md). Useful with [T2](02-subagent-runtime.md) but also pays for itself alone.
**Surface:** `src/main/ai/core/`, `src/main/ipc/conversations.ts`, `src/preload/`, `src/renderer/components/Sidebar*`, `tests/`.

## Why

A turn can settle while work keeps running: an agent fleet, a long bash command, a
terminal session, a site dev server. Atlas's sidebar shows nothing once the turn ends, so
a conversation that is still burning tokens looks idle. t3code's answer is a tiny
in-memory registry with a deliberately two-word vocabulary.

**This is worth doing even without subagents** — Atlas already has background-capable work
(terminal sessions, sites, MCP servers) that the sidebar is blind to.

## Design decisions to copy verbatim

- **In-memory, never persisted, no migration.** After a restart the registry is empty,
  which is correct: orphaned background work is not live. Do not be tempted to persist it.
- **Two states only.** `working | monitoring | null`. Any live *agent* work ⇒ `working`.
  `monitoring` is reserved for watch loops (monitors, background shells, dev servers) when
  they are the **only** live work.
- **Classification is per-transition, not sticky.** A task first seen without a type may
  later reveal itself as a shell, become inert, or turn out to be agent-owned. Every path
  drops any prior entry for the `taskId` before re-bucketing, so a stale bucket assignment
  can never pin a conversation's status. (This was a review finding in the PR.)
- **Idle counts as not-live.** A resting resumable agent is doing nothing; an all-idle
  fleet must not pin `working`.
- **A nested agent still counts.** An agent-owned *shell* is covered by its owning agent's
  liveness and is dropped, but an agent-owned *agent* can outlive its parent and stays.

## Deliverables

### 1. `src/main/ai/core/BackgroundLivenessService.ts` (new)

```ts
export type BackgroundLiveness = 'working' | 'monitoring' | null;

export class BackgroundLivenessService {
  recordTaskLiveness(input: {
    conversationId: string;
    taskId: string;
    taskType: string | undefined;
    status: string | undefined;
    kind: 'started' | 'progress' | 'updated' | 'completed';
    agentId?: string;
  }): void;

  clearConversationLiveness(conversationId: string): void;
  getBackgroundLiveness(conversationId: string): BackgroundLiveness;
}
```

Internal state: `Map<conversationId, { agents: Set<taskId>; monitors: Set<taskId> }>`.
Delete the conversation entry when both sets empty, so the map doesn't grow without bound.

Transition logic, in order:
1. `INERT_TASK_TYPES` (from T1) ⇒ drop, return.
2. `agentId` set **and** (`taskType` undefined or in `MONITOR_TASK_TYPES`) ⇒ drop, return.
3. Terminal (`kind === 'completed'`, or status `idle`, or status in
   `{completed, failed, stopped, cancelled, interrupted}`) ⇒ drop, return.
4. Otherwise: drop, then add to `monitors` if `taskType ∈ MONITOR_TASK_TYPES`, else `agents`.

### 2. Wiring

- `runtimeStateRepo.recordEvent` (or `ChatEngine`, wherever T1 stamps `agentKind`) feeds
  every `task.*` event into `recordTaskLiveness`.
- Also feed non-task background work Atlas already has: terminal sessions
  (`src/main/terminal/`) and site dev servers (`src/main/sites/`) register as
  `taskType: 'terminal'` / `'site_dev_server'` on start and drop on exit. This is where
  the track pays for itself pre-T2.
- Session teardown / app quit ⇒ `clearConversationLiveness`.

### 3. Surface it

- Add `backgroundLiveness: BackgroundLiveness` to the conversation summary shape returned
  by `src/main/ipc/conversations.ts`, computed **at mapping time** (read-through, not a
  stored field).
- Preload passthrough in `src/preload/index.ts`; type it in `src/shared/ipc.ts`.
- `SidebarConversationRow` renders a pill: pulsing dot + `Working` or `Monitoring`.
  Reuse existing status styling; do not introduce a new colour vocabulary.
- Conversations that are `running` (an active turn) keep their existing indicator —
  liveness is the *post-turn* signal.

### 4. Stop affordance

When a settled conversation has `backgroundLiveness !== null`, show a Stop control in the
chat header. It calls the same cascade-stop path as T2 (children first, then anything
else live). If T2 has not landed, it stops terminals/dev servers registered for that
conversation.

## Tests — `tests/backgroundLiveness.test.ts`

1. Agent task started ⇒ `working`; completed ⇒ `null`.
2. Shell only ⇒ `monitoring`; shell + agent ⇒ `working`.
3. `status: 'idle'` ⇒ not live (the all-idle-fleet case).
4. Agent-owned shell (`agentId` + `shell`) ⇒ does not register.
5. Nested agent (`agentId` + agent-flavoured type) ⇒ registers as agent.
6. Re-bucketing: a task seen first with no type, then as `shell`, ends in `monitors` only
   — assert it is not in both sets.
7. `clearConversationLiveness` empties everything; map has no residual key.
8. Terminal start/exit drives `monitoring` without any `task.*` event.

## Definition of done

`pnpm test` / `pnpm build` green; killing the app mid-fleet and reopening shows no phantom
`Working` pill.
