# T2 — Subagent runtime: spawn tool, attribution, cascade stop

**Depends on:** [T1](01-contracts-and-activity-ids.md). **Pairs with:** [T3](03-agents-panel-and-quiet-timeline.md), [T4](04-background-liveness.md).
**Surface:** `src/main/ai/`, `src/main/ipc/chat.ts`, `tests/`.

## Why

Atlas has one agent per conversation. t3code's whole PR exists because subagents let a
thread fan out — parallel exploration, delegation to a cheaper model, isolated
long-running work — and the hard part is not spawning them, it is **attribution**:
knowing which tool call belonged to which agent, keeping child narration out of the
parent transcript, and stopping the whole fleet when the user hits Stop.

Build the runtime so attribution is structural, not best-effort.

## Deliverables

### 1. `src/main/ai/agents/SubagentRuntime.ts` (new)

A registry + spawner owning child sessions, one instance per `ChatEngine`.

```ts
export type SubagentSpawnRequest = {
  conversationId: string;
  parentTurnId: string;
  parentToolCallId: string;   // the tool call that spawned it — the linkage anchor
  agentId: string;            // `${parentToolCallId}:${index}` — deterministic
  title: string;
  prompt: string;
  model?: string;             // defaults to the parent's model
  role?: string;
  tools?: string[];           // allowlist; defaults to read-only tools
  maxSteps?: number;
};
```

Responsibilities:

- Run the child through the **existing** `ChatSessionRuntime` — do not fork the streaming
  loop. Pass a child `AbortSignal` derived from the parent's.
- Emit `task.started` / `task.progress` / `task.updated` / `task.completed` through the
  same `runtimeStateRepo.recordEvent` path, with full `TaskAgentLinkage` on **every**
  payload (T1 rule: repeat linkage, don't assume the start row survives).
- Stamp every tool event the child produces with `agentId` and
  `parentToolCallId` so T3 can re-home them.
- **Child narration never reaches the parent transcript.** Child assistant text is
  captured into the task's `summary`/result, not appended to parent message parts. In
  t3code this leak also reset the parent's Working timer — check Atlas's equivalent
  elapsed-time source for the same failure.
- Bounded concurrency (default 4, configurable) with a queue; `pending` status while queued.
  One extra rule keeps spawns deadlock-free: a single conversation can never have more
  in-flight subagents (running + waiting) than the total slot count. A subagent keeps its
  slot while it awaits its own nested spawns, so a conversation that could occupy every
  slot and still queue one more would let the last waiter block on a slot held by the
  ancestor it waits on — a circular wait only abort could break. The over-capacity spawn
  is rejected at `acquire` time with an actionable per-task error instead of queueing.
- `canSpawn` is depth-only (`depth < maxDepth`). Slot pressure is deliberately not a
  registration condition: the tool catalog must stay stable across turns so the
  provider's prompt cache prefix survives. An over-capacity spawn surfaces as a
  per-task `failed` result, never as `spawn_agent` vanishing from the catalog.
- Usage rollup per child via `mergeTaskUsage` from T1.

### 2. `src/main/ai/tools/agentTools.ts` (new), registered in `builtInTools.ts`

One tool, `spawn_agent`:

```
description: Run a focused sub-task in a separate agent with its own context window.
input: { tasks: Array<{ title, prompt, model?, role?, readOnly?: boolean }> }
```

An array input, not a single task — this is how you get one CTA row per *batch* in T3
instead of N interleaved rows, and it makes parallel fan-out the default shape.

The tool result returned to the parent model is a compact digest per child
(status, summary, token count) — **not** the child's full transcript. The full material
lives in the Agents panel and, optionally, an `outputFile`.

Approval: route through the existing `ToolApprovalController`. Child tool calls inherit
the parent's approval scope — a child must not be able to escalate past a denial the user
already gave. Verify this explicitly; it is the security-relevant part of this track.

### 3. `ChatEngine` — stop everything

Today `abort` (`ChatEngine.ts` ~line 806) completes the turn as `aborted`. Change to:

1. Interrupt **every live child task** for the conversation first, awaiting each with a
   short bounded timeout.
2. Then abort the parent turn.
3. Emit `task.updated { status: 'interrupted' }` per child so the fold and the sidebar
   settle correctly rather than showing a permanently-running ghost.

Order matters: parent-first leaves children orphaned and burning tokens, which is the
literal bug the PR fixed.

Also clear child state on session teardown — an exited session orphans all its background
work, and orphaned work is not live.

### 4. Context isolation

Children get a fresh context window seeded with: system prompt, workspace context, and
their own `prompt`. They do **not** inherit the parent's message history. This is the
point of the feature — if children inherit everything, fan-out costs more than doing it
inline.

## Tests — `tests/subagentRuntime.test.ts`

1. Spawning 3 children emits 3 `task.started` rows, each with distinct deterministic `agentId`.
2. Child tool calls carry `agentId` + `parentToolCallId`.
3. Child assistant text does not appear in the parent conversation's message parts.
4. `abort` interrupts all live children **before** the parent turn resolves, and each child
   ends with a terminal status (assert ordering, not just final state).
5. A denied approval in the parent scope is still denied for a child (no escalation).
6. Concurrency cap: 10 spawns with cap 4 ⇒ never more than 4 `running` at once.
7. A child that throws yields `task.completed { status: 'failed' }` with the error, and does
   not fail the parent turn.

## Definition of done

`pnpm test` and `pnpm build` green; spawning agents from a real conversation produces a
parent transcript with **no** child narration in it and a complete set of attributed
`task.*` rows in `runtimeStateRepo`.

## Explicitly out of scope

Workflows (phases, coordinators, phase rails). t3code has an orchestration engine behind
theirs. Atlas gets flat parallel spawns first; the contracts in T1 already carry
`agentIndex`/`parentAgentId` so a workflow layer is additive later.
