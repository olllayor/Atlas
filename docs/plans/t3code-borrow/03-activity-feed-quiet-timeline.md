# R3 — Activity feed read-model off the runtime log (quiet timeline)

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → track R3.

## Status: ✅ built (`src/shared/activityFeed.ts` + `tests/activityFeed.test.ts`)

## Why

The borrow catalog's "runtime activity model" (§1.1) is the skeleton for *any*
activity-feed UI: a sidebar that shows what a conversation has been doing even
after the turn settles, distinct from the raw message transcript. The reuse
target is the existing `conversation_events` → `deriveWorkLogEntry` projection —
**no second transcript source** (principle #2).

## What shipped (the read-model)

`buildActivityFeed(entries: WorkLogEntry[])` folds a flat, persisted list into
turn-grouped rows keyed by the entry's **stable subject id** (`tool:<callId>` /
`task:<taskId>` / `approval:<id>`), so:

- a `tool.started` + `tool.completed` for one call fold onto one row;
- recurring `task.progress` ticks fold onto the task's row (upsert, not append);
- `approval.requested` + `approval.resolved` fold onto one approval row;
- **order-robust**: a terminal event with no start row still creates the row, and
  a late start row only fills metadata and never regresses a final status
  (sticky terminal);
- `message.*` / `reasoning.*` deltas are excluded — that is the transcript
  answer, not the feed of what the conversation did.

Deliberately **UI-free**: the fold is the shared, testable source. The Agents
panel / quiet-timeline render layer it feeds is tracked in
`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`, which should reuse
this read-model rather than build a parallel fold.

## Invariants pinned (9 tests)

Stable-key folding; first-seen row order; per-turn grouping; sticky terminal on
late start; terminal-creates-row; message/reasoning exclusion; title→summary→type
headline fallback; task-progress folding; approval folding.

## Acceptance

- `pnpm test` green; `pnpm build` passes. (Verified: 9/9 tests pass.)
