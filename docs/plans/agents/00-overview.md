# Agent observability — what Atlas takes from t3code#5219

Source: [pingdotgg/t3code#5219 — "feat: native subagent & workflow observability"](https://github.com/pingdotgg/t3code/pull/5219)
(merged 2026-08-02, +6871/−71 across 46 files).

## What that PR actually did

t3code threads can spawn subagents, run multi-agent workflows, and drive Codex collab
fleets. Before the PR the UI showed none of it usefully: subagent tool calls and
narration interleaved anonymously into the parent chat, progress ticks flooded the work
log, background shells masqueraded as agents, the sidebar went blank once the turn
settled, and Stop killed only the parent turn while the fleet kept burning tokens.

The fix was deliberately conservative in shape and aggressive in behaviour:

- **Zero migrations, zero new tables.** All new information rides as *additive optional
  fields* on payloads that already flow through the event-sourced activity path.
- **Classify once, server-side.** Ingestion stamps `agentKind: "agent" | "background"`
  onto each persisted row. Clients trust the stamp; unstamped legacy rows fall back to
  "background", i.e. they render exactly as they did before the feature existed.
- **Stable, thread-scoped activity IDs** so progress ticks *upsert* instead of appending.
  Worst case per coordinator tick becomes proportional to *changed* members, not fleet size.
- **A pure client-side fold** (`subagentRuntime.ts`) turning the flat activity stream into
  a roster model, with ~30 unit tests pinning invariants that trace to previously shipped bugs.
- **Re-homing, not hiding.** Agent-attributed rows leave the main timeline and land in a
  dedicated Agents panel; a single always-visible spawn CTA row stays in the chat.
- **Liveness is in-memory and unpersisted.** After a restart the registry is empty — which
  matches reality, because orphaned background work is not live.
- **Stop means stop everything**, children first, then the parent turn.
- **A read-only file RPC written like a security boundary**: realpath re-containment,
  extension allowlist, TOCTOU-safe open-then-verify by inode, size cap with a truncation
  marker, and tagged failure reasons — with a symlink-escape test that asserts the
  *specific* reason so it can't pass vacuously on "not-found".

## Where Atlas stands today

Atlas is a local-first BYOK desktop chat client — different product, **same architecture
family**. It already has the substrate this PR builds on:

| t3code | Atlas equivalent |
| --- | --- |
| `ProviderRuntimeEventV2` | [`RuntimeEventEnvelope`](../../../src/shared/contracts.ts) |
| persisted thread activity | [`WorkLogEntry`](../../../src/shared/contracts.ts) + [`runtimeStateRepo`](../../../src/main/db/repositories/runtimeStateRepo.ts) |
| ingestion → activity projection | [`deriveWorkLogEntry` / `getWorkLogEntryId`](../../../src/shared/runtimeActivity.ts) |
| provider adapters | [`ProviderAdapter`](../../../src/main/ai/core/ProviderAdapter.ts), [`ChatSessionRuntime`](../../../src/main/ai/core/ChatSessionRuntime.ts) |
| turn fold / work-log group | [`ActivityBlock`](../../../src/renderer/components/transcript/ActivityBlock.tsx) |
| sidebar thread rows | [`SidebarConversationRow`](../../../src/renderer/components/SidebarConversationRow.tsx) |
| stop turn | `ChatEngine.abort` |

What Atlas **lacks**: any notion of a task/subagent, agent attribution on tool events,
background liveness, cascade-stop, and a contained-read security primitive.

`ActivityType` today is 12 literals and stops at `tool.*` / `approval.*` / `turn.*`.
`getWorkLogEntryId` falls back to `activity:${eventId}` for everything non-tool,
non-approval — so the moment Atlas emits any progress tick, it floods. That is the exact
bug t3code fixed with stable ids, and Atlas should fix it *before* it has the problem.

## Tracks

Ordered by dependency. T1 is the foundation; T2/T3/T4 build on it; T5 is independent and
shippable today.

| # | Track | Depends on | Scope |
| --- | --- | --- | --- |
| [T1](01-contracts-and-activity-ids.md) | Task/agent contracts + stable activity ids + `agentKind` stamp | — | shared + repo, ~400 LOC |
| [T2](02-subagent-runtime.md) | Subagent runtime in main: spawn tool, attribution, cascade stop | T1 | main, ~900 LOC |
| [T3](03-agents-panel-and-quiet-timeline.md) | Client fold + Agents panel + quiet timeline + spawn CTA | T1 (T2 to be useful) | renderer, ~1100 LOC |
| [T4](04-background-liveness.md) | In-memory liveness registry + sidebar Working/Monitoring pill | T1 | main + renderer, ~350 LOC |
| [T5](05-contained-file-read.md) | TOCTOU-safe contained file reader, applied to existing read paths | — | main, ~250 LOC |

## Principles carried over verbatim

These are the parts worth copying regardless of which tracks ship:

1. **Additive optional fields, never a migration.** Old rows decode unchanged; old
   emitters keep working. Payload is already JSON in `runtimeStateRepo` — use it.
2. **Classify once, at the boundary, and persist the classification.** Do not re-derive
   agent-vs-background in three places; they will drift.
3. **Denylist, not allowlist, for "is this an agent".** t3code shipped an allowlist and it
   silently dropped real subagents when a new type name appeared. Unknown type ⇒ agent.
4. **Stable ids ⇒ upsert.** Any recurring event needs an id derived from the *subject*,
   not the event.
5. **Folds must be order-robust.** A terminal event may arrive with no start row (it aged
   out of retention) — completion must be able to *create* the entity, and a late start
   may only fill metadata, never downgrade or reset it.
6. **Idle is a real non-terminal state**, and it must not pin a "working" indicator.
7. **Never let a live thing hide behind a disclosure.** Spawn rows are exempt from turn
   folds and from `+N more` overflow.
8. **Security tests must assert the specific reason.** A containment test that passes on
   `not-found` proves nothing.
