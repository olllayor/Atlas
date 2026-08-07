# R3 — Activity feed read-model off the runtime log (quiet timeline)

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → track R3.

## Why

The borrow catalog's "runtime activity model" (§1.1) is the skeleton for *any*
activity-feed UI: a sidebar that shows what a conversation has been doing even
after the turn settles, distinct from the raw message transcript. The reuse
target is the existing `conversation_events` → `deriveWorkLogEntry` projection —
**no second transcript source** (principle #2).

## Note on overlap

`docs/plans/agents/03-agents-panel-and-quiet-timeline.md` already plans a
"quiet timeline" that hides agent-attributed rows from the main thread. R3 is the
general case (all activity, not just agent rows) and should share its fold +
render machinery. Coordinate so the two don't build parallel folds.

## Scope

- A shared read-model over `WorkLogEntry[]` that groups by turn and phase with a
  stable `getWorkLogEntryId`-derived key (reuse existing ids; upsert, don't
  append — principle #3).
- A sidebar/panel view fed by that model: dim summary rows per phase + elapsed,
  status colour not label, turn rule for turns that did work (reuse the Codex-
  parity `ActivityBlock` grammar).
- Pure fold with invariant tests (order-robust: a terminal event with no start
  row creates the entity; a late start only fills metadata).

## Acceptance

- The feed renders from the persisted log after a reload (no live-only data).
- Invariant tests green under `pnpm test`; `pnpm build` passes.
- No new tables; purely additive payload fields if needed (principle #1).
