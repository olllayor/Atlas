# 05 — Continuable subagent flow: durable conversations, follow-up, interrupt

**Status: implemented** · S1–S6 + composer takeover landed 2026-08-24 · **Depends on:** T1 (contracts) T2 (SubagentRuntime) T4 (liveness) · **Pairs with:** T3 (Agents panel)

Implements the gap between Atlas today and the two reference harnesses. Research distilled from `pingdotgg/t3code` and `deepseek-ai/deepseek-harness`. Sections 1–9 are the design record; §10 is what actually shipped and where it diverged.

## 1. Context

### Atlas today
* `src/main/ai/agents/SubagentRuntime.ts:124` owns Tasks, not Sessions. `spawn(req)` validates via `subagentCapabilities.ts:73` then `runTask():slotQueue.acquire() -> childExecutor()` threads `maxSteps` to `ChatSessionRuntime.ts:109`. Background tasks survive in `backgroundTasks: Map<agentId, BackgroundTask>` with `reported` flag for exactly-once drain (`drainBackgroundNotices()`).
* Child narration isolated: `ChildTurnExecutor` captures text into `task.result`, never appends to parent `parts`. Attribution stamped in `emitChildEvent()` with `agentId/parentToolCallId` on envelope + payload.
* Tool: single `spawn_agent` (`agentTools.ts:40`) — array of `{title,prompt}`. No `send_message`, no `interrupt_agent`, no `list_agents` for model, no durable child conversation the user can reopen.
* Storage: `RuntimeEventEnvelope` + `WorkLogEntry` upsert via `runtimeStateRepo.ts:mapEvent` derives `agentId` from `payload_json` (no columns). `WorkLogEntry` folded in `runtimeActivity.ts:mergeTaskUsage` + `agentFold.ts`.
* `ChatEngine.ts` cascade-stop already exists `interruptAll()` but only for active Tasks, not for Sessions with own message history.

### What research shows

**t3code** (`apps/server/src/orchestration`, `packages/contracts/src/orchestration.ts:299`):
* Event-sourced engine: `decider.ts:decideOrchestrationCommand` pure -> `projector.ts` in one SQL tx. `Thread` has single `OrchestrationSession` (`status: connecting|ready|running|error|closed`). Subagent = provider-internal tool call, not first-class. Frontend has no subagent catalog.
* Value to steal: typed Effect RPC WebSocket (`rpc.ts:WS_METHODS`), shared `packages/client-runtime` for web/desktop/mobile, `DrainableWorker` with `drain()` for tests. Do NOT steal provider-opaque subagent — hides lifecycle.

**deepseek-harness** (`packages/subagent/subagent/src/`):
* First-class seam `SubagentRuntime` (`index.ts`) with two modes: `one-shot` (`SubagentRun` + `settleRun`, background via Jobs) vs `continuable` (`continuation.ts:SubagentContinuationManager`). Single durable `Session` + at most one live `Activation` holding one `AgentHandle`; `Agent.inbox` is *only* FIFO. Child-first disposal, cold resume without provider, `ownedChildren: Set<SessionId>` blocks parent settlement.
* Durable identity `descriptor.ts:SUBAGENT_DESCRIPTOR_VERSION=2` persisted as `subagent/descriptor` event (mode/provider/label/agentProvider/toolFilter/persona). Projections `projection.ts:subagentIdentityProjectionDefinition` + `subagentTimingProjectionDefinition` give UI `hasChildren`, tokens, duration without log scan.
* Tools: `tool-subagent` delegates with capability gate (`SubagentCapabilities` fail-loud), `tool-subagent-control` exposes `send_message(childId, message)` -> `followup(parent, childId)` returning `MessageId` at inbox acceptance, `interrupt_agent(childId)` -> `interrupt()` parks pending work.
* Frontend `packages/client/ui-subagent`: header lineage breadcrumbs (`title >>` 12px), descendant-count dropdown with lazy direct-catalog fetch, `hasChildren` disclosure hint, token/duration columns from projections, composer takeover (one-shot always read-only, continuable offline+idle read-only else live).
* Value to steal: all of above except Cordis plugin-everything (too heavy) and the exact `ctx.agents` ownership graph — Atlas can simplify.

## 2. Goals / Non-goals

**Goals:** (a) durable continuable subagent conversations user can reopen, (b) parent -> child `send_message` as next FIFO turn while child running, (c) `interrupt_agent` cancels current turn without discarding queued follow-ups, (d) observable catalog (list, history, liveness) for both human UI and model tools, (e) backward compat with current Task runtime.

**Non-goals:** workflows/phases (T2 doc already excludes), cross-process lease, automatic replay of inbox-accepted-but-unlogged messages, Codis dynamic plugin registry, persisting background liveness across restart (T4 says in-memory only).

## 3. Architecture — what Atlas will look like

```
Conversation (parent)
  └─ SubagentSession (child conversation, side_of_conversation_id = parent.id, origin='subagent')
       ├─ durable: conversations row + messages + runtime_events (payload.subagentDescriptor)
       └─ ephemeral: Activation { handle: ChatSessionRuntime handle, ownedChildren, accepted:Set<msgId>, observer }
            └─ Agent.inbox = single FIFO (existing ChatEngine turn queue)
```

Reuse existing tables: add columns to `conversations` for origin/mode/label, reuse `messages` for child transcript, reuse `runtime_events` for `subagent/descriptor` + lifecycle edges. No new `subagent_sessions` table — a subagent IS a conversation with provenance.

### 3.1 Backend — durable session

**Descriptor** `src/main/ai/agents/subagentDescriptor.ts` (port of `harness/packages/subagent/subagent/src/descriptor.ts`):

```ts
export const SUBAGENT_DESCRIPTOR_VERSION = 1;
export type SubagentDescriptor = { version:1; mode:'one-shot'|'continuable'; provider:'atlas-turn-executor'; label:string; model?:string; toolFilter?:string[]; agentId:string; parentConversationId:string; delegationDepth:number };
export function snapshotDescriptor(input): SubagentDescriptor // JSON-detached via structuredClone
export function foldDescriptor(events: RuntimeEventEnvelope[]): SubagentDescriptor|undefined // validates version, known keys
```

Persist as `runtime_events` row with `activityType='task.started'` already carries linkage; add `payload.subagentDescriptor` there OR new `activityType='subagent.descriptor'` (prefer new type to avoid overloading task.started). Second option mirrors harness and keeps projections clean. Choose `subagent.descriptor` literal.

`conversations` columns (migration `ALTER TABLE` — see 6): `origin TEXT` (`null|'subagent'`), `subagent_mode TEXT` (`null|'one-shot'|'continuable'`), `subagent_label TEXT`, `parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE`, `delegation_depth INTEGER DEFAULT 0`. `parent_conversation_id` duplicates `side_of_conversation_id` semantics already present — reuse that column plus add `origin` flag instead of new FK.

**Session creation** in `SubagentRuntime.spawn()`:
* Validate via `subagentCapabilities` (already does depth/background/maxSteps). Add `persona/toolFilter` later.
* Allocate `agentId = agentIdFor(toolCallId, index)` deterministic, `conversationId = randomUUID()` for child.
* Insert `conversations` row with `origin='subagent'`, `side_of_conversation_id=parentId`, `delegation_depth=childDepth`.
* Record `subagent/descriptor` event before first turn — required for cold resume and `hasChildren` hint.
* Create `Activation` only after descriptor persisted. If descriptor write fails, rollback conversation row, return `failed` task — no ids leaked.

### 3.2 Backend — continuation manager

New `src/main/ai/agents/SubagentContinuationManager.ts` (adapted from `harness/packages/subagent/subagent/src/continuation.ts:150-600`, but without Cordis):

* Internals: `Map<childConversationId, Activation>` where `Activation = { childId, parentConversationId, handle: { controller, donePromise }, ownedChildren:Set<string>, accepted:Set<string>, observer, poke:PromiseWithResolvers, disposal?:Promise<void> }`.
* Operations:
  * `startContinuable(spec: ContinuableStartSpec): Promise<{childId, messageId}>` — reserves id, writes descriptor, creates child `ChatSessionRuntime` handle via private owner scope, `agent.followup(initialPrompt)` and returns at inbox acceptance (do NOT await turn completion or log write). Failure before acceptance rolls back handle + ownedChildren edge.
  * `followup(parentConversationId, childId, content, {source, signal}): Promise<messageId>` — exact live parent check (`parentConversationId` must match descriptor's parent and parent must be not-archived). If Activation running/waiting -> enqueue to same inbox. If no Activation -> cold resume: read descriptor + history from DB, recreate handle, then enqueue. Re-check authority at final synchronous admission span. Return `MessageId`. **Per-child mutex** (`Map<childId, Promise>` or async-mutex) serializes concurrent cold resumes / followups so two rapid calls cannot both create an Activation — second awaits first's creation.
  * `interrupt(childId, authority): Promise<{accepted:true}>` — fire-and-return, idempotent `controller.abort()` (no throw on second abort). Calls `controller.abort()` on current turn with `keepInbox=true`. Pending inbox stays. No `session.cancel` fallthrough.
  * `listChildren(parentId): SubagentListEntry[]` — scan `conversations WHERE side_of_conversation_id=parentId AND origin='subagent'` + join latest `runtime_events` for descriptor + `foldSubagentTiming` for activity. Compute `hasChildren` via batched `SELECT side_of_conversation_id, COUNT(*) FROM conversations WHERE origin='subagent' AND side_of_conversation_id IN (?,...) GROUP BY side_of_conversation_id` (avoids N+1 `EXISTS` per row). Joining descriptor/timing denormalized later if slow: add `last_token_usage_json`/`last_timing_json` columns updated on write instead of per-list log scan. Overlay live `running` from `activeTasks` / `continuations` map.
  * `readHistory(childId, mode, pagination)` — verify catalog entry + mode, read `messages` + `runtime_events` without publishing Agent.
  * `onConversationDeleted(parentId)` — when `conversations` row deleted via `ON DELETE CASCADE`, evict any in-memory `Activation` for `childId` and clear `parent.ownedChildren`. Subscribe to `runtimeStateRepo` delete hook or poll on next access — avoids zombie Activations.
* Lifecycle edges: `subagent/start` + `subagent/end` emitted via simple EventEmitter scoped by `parentConversationId` (port of `lifecycle.ts:createLifecycleEmitter` but without Cordis). Listener containment: each callback try/catch, async rejection logged.
* Ownership graph: when parent is itself a continuable Activation, adding child does `parentActivation.ownedChildren.add(childId)` before inbox acceptance. Parent `settled` waits for ownedChildren empty -> `handle.dispose()` -> remove Activation. Top-level conversations not in map need not join graph. **Disposal failure handling:** `try { await handle.dispose() } catch(e){ logger.error(e); } finally { parent.ownedChildren.delete(childId) }` so one child's throw cannot pin parent in `waiting` forever. Also clear on `ON DELETE`.
* **Inbox bound:** cap FIFO depth (e.g. 10 pending followups per child). `followup()` rejects with `queue-full` instead of unbounded memory growth.
* **Child error propagation:** child turn `failed`/`error` writes `task.completed {status:'failed'}` + emits `subagent/end {stopReason:'error', diagnostic}`; parent `listChildren` shows `status:'error'` row. Completion notice queued to parent via `drainChildCompletionNotices()` (like harness `report` next-step) so parent not blocked forever.
* **Depth validation inside `spawn()`:** keep registration unconditional (`spawn_agent` always present), do `validateSpawnRequest` inside `spawn()` fail-loud. Avoids TOCTOU where registration check passes but depth changed by time of call.
* No Task wrapper for continuable children — `SubagentRun` remains only for current one-shot Tasks. Continuable directly owns `ChatSessionRuntime`.

### 3.3 Backend — provider / tool layer

Keep `agentTools.ts:spawn_agent` but extend: add `backgroundMode?:'one-shot'|'continuable'` per harness `tool-subagent` Config. When `backgroundMode==='continuable'`, `spawn_agent` calls `continuationManager.startContinuable` instead of `runtime.spawn`. Return `{kind:'continuable', subagentId:childId}` not foreground result.

Add `src/main/ai/tools/subagentControlTools.ts` (port of `tool-subagent-control/src/index.ts`):

```ts
export function createSubagentControlTools(ctx:{ continuationManager, conversationId }) {
  return {
    send_message: tool({ name:'send_message', input:{ subagent_id:string, message:string }, execute: followup }),
    interrupt_agent: tool({ name:'interrupt_agent', input:{ agent_id:string }, execute: interrupt }),
    list_agents: tool({ name:'list_agents', ... }) // optional convenience for model
  }
}
```

Register alongside `spawn_agent` only when `depth < maxDepth` still allows. These tools share one model-facing control API across all `spawn_agent` instances.

### 3.4 Projections

New `src/main/ai/agents/subagentProjections.ts` (port `projection.ts`):

* `subagentIdentity` folds `subagent/descriptor` last-wins -> `{mode,label,seq}`.
* `subagentTiming` folds `turn/start|end` around descriptor -> `{settledMs, active:{since,through}}`. Resets on each descriptor so fork seed cannot pollute child.
* Store in memory cache keyed by `conversationId` with **LRU + TTL** (cap 200 entries, evict idle >5min) — unbounded map grows with every `listChildren`. Populate from `runtime_events` on demand, invalidate on new event. No extra table; reuse `work_log` payload scan. For `hasChildren`, use batched `GROUP BY` above, not per-row `EXISTS`.

Wire via `runtimeStateRepo.recordEvent` callback — same path that feeds `agentFold`.

* **Descriptor versioning:** `foldDescriptor` validates `version===SUBAGENT_DESCRIPTOR_VERSION`; if `version > current`, return `undefined` -> row becomes diagnostic `unsupported` disabled row in UI. Future bump provides explicit migrator `migrateDescriptorV1ToV2()` rather than silent reinterpretation. Documented upgrade path.
* **Ordering:** `followup` IPC calls for same `childId` are serialized by the per-child mutex above, preserving FIFO even when first call blocks on cold resume. Cross-child ordering irrelevant.

### 3.5 Frontend — catalog & lineage

**IPC** `src/shared/contracts.ts` add:

```ts
export type SubagentListEntry = { childConversationId:string; mode:'one-shot'|'continuable'; label:string; hasChildren:boolean; status:'running'|'inactive'; tokenUsage:RuntimeTaskUsage|null; timing:TimingProjection; parentAvailable:boolean };
export type SubagentHistoryRequest = { parentConversationId:string; childConversationId:string; mode:string; cursor?:string; limit?:number };
```

**Main IPC** `src/main/ipc/conversations.ts`: handlers `subagent:list`, `subagent:history`, `subagent:prompt` (followup), `subagent:interrupt`. Each validates catalog + mode, exact parent availability, conversation-fenced access. Map errors to typed RPC errors (missing parent, diagnostic row, not-continuable, unauthorized).

**Preload** `src/preload/index.ts` passthrough.

**Renderer** new `src/renderer/components/subagents/SubagentCatalog.tsx` + `SubagentComposer.tsx` (port `packages/client/ui-subagent`):

* Header lineage: in `ChatWindow` header, when `hasSubagentDescendants`, render `title / 2 subagents` trigger. Breadcrumbs: `parent >> child >> ...` with `>>` fixed chevron, current primary 500 else tertiary 400, 12px, truncation before chevron. Hover 150ms opens direct-parent catalog (sibling switcher, bold selected, label overrides title). Only current subagent appends descendant count.
* Tree dropdown: ARIA tree, lazy `hasChildren` disclosure, loading placeholder `1 disabled row per known direct descendant`, direct-catalog authoritative after fetch. Rows: `label|id fallback, mode badge, running/inactive dot, token total, duration` (exact seconds <1d else 2 adjacent units, hover shows exact). Disabled diagnostic rows for corrupt/unsupported.
* Mix into existing `AgentFold`? Keep separate: `foldAgents` stays Task-based for Agents panel; catalog reads from IPC directly. Sidebar filters `origin='subagent'` rows from ordinary `listConversations` (already `side_of_conversation_id` hides them).
* Composer takeover: new hook `useSubagentComposerState(conversationId)` returns `{ mode:'readOnly', reason } | { mode:'live', canSend, canInterrupt }`. Rules: one-shot => always readOnly (`"This execution record is read-only"`). Continuable + parentAvailable false + inactive => readOnly with recovery hint. Continuable running offline => input disabled, Send disabled, Stop -> `subagent:interrupt` enabled. Continuable parentAvailable true => normal input, Send -> `subagent:prompt`, Stop -> `subagent:interrupt` even while running (followups queue as next turn).
* `@` mentions stay inert literal text as today (`shared/mentions`) — do NOT acquire continuation semantics.

**Agents panel** `AgentsPanel.tsx:19` stays for Tasks; add sibling `SubagentPanel` or extend AgentsPanel to show continuable sessions when expanded. Recommendation: reuse AgentsPanel flat rows but source from catalog when in subagent conversation.

### 3.6 Liveness

Extend `BackgroundLivenessService` (T4) to watch continuable Activations: `recordTaskLiveness` already handles `task.*`; add `recordSubagentLiveness(childId, status)` feeding same `agents` Set. `SidebarConversationRow` pill already renders `working|monitoring`; wire child runner status via `subagent:list` overlay so parent shows `working` even after turn settled while child still running — parity with harness `owner-running.expected.md`.

## 4. Phased rollout (vertical slices, each shippable)

**S1 — Descriptor + durable child conversations (2-3 days)**
* Add `subagentDescriptor.ts` + `subagent/descriptor` event + `conversations` columns migration.
* Change `SubagentRuntime.spawn` to write descriptor + child conversation row (still Tasks, no Activation yet). UI still Task-based. Test: spawn creates child conversation row readable via `subagent:list`, survives restart, no `hasChildren` regression.

**S2 — Continuation manager + followup (3-4 days)**
* Implement `SubagentContinuationManager` with `startContinuable`, `followup`, `listChildren`, cold resume via `ChatSessionRuntime`.
* Switch `spawn_agent` to call it when `background:true` (map Atlas `background` to `continuable`). Keep one-shot Tasks for `background:false`.
* Add `subagent:prompt` IPC + `send_message` tool. No interrupt yet. Test: parent can `send_message` while child running, queued as next FIFO turn, child sees two user messages in order.

**S3 — Interrupt + ownership graph + child-first disposal (2 days)**
* Implement `interrupt()` with `keepInbox`, `ownedChildren`, waiting->running wakeup, child-first `dispose` ordering, manager `drain()` for `ChatEngine.interruptAll`.
* Add `interrupt_agent` tool + `subagent:interrupt` IPC. Test: interrupt parks followups, later `send_message` resumes FIFO; interrupting `waiting` parent leaves owned child live; app quit drains child-first.

**S4 — Projections + list enrichment (1-2 days)**
* Add `subagentProjections.ts` identity/timing, enrich `listChildren` with tokens/duration/active bounds, compute `hasChildren` header-only.
* Cover with `subagentProjections.test.ts` porting `harness/packages/subagent/subagent/tests/timing-projection.spec.ts`.

**S5 — Frontend catalog + lineage + composer takeover (3-4 days)**
* IPC `subagent:list/history`, preload, `SubagentCatalog.tsx`, header breadcrumbs, tree with keyboard (ArrowRight/Left, Up/Down, Home/End, Escape), token/duration columns, `hasChildren` lazy loading.
* Composer takeover hook + `ChatWindow` integration. `@` stays literal.
* Visual tests port harness snapshots `subagent-conversation/*.expected.md` as fixtures.

**S6 — Polish, control tools, liveness (1-2 days)**
* `list_agents` for model, `BackgroundLivenessService` wiring for continuable, sidebar `working` pill for settled-but-child-running parent, `AgentsPanel` subagent rows.
* Compatibility: existing `task.*` rows remain, older Atlas `background` Tasks still read. Feature-flagged behind `maxDepth` + `supportsBackground`.

Total ~12-16 days for one engineer, each slice green on `pnpm test` + `pnpm build`.

## 5. IPC & contract changes

* `src/shared/contracts.ts`: add `SubagentDescriptor`, `SubagentListEntry`, `TimingProjection`, `SubagentHistoryRequest`, `SubagentInterruptResult`, `SubagentFollowupError {code:'queue-full'|'not-found'|'not-continuable'|'parent-unavailable'}`.
* `src/shared/ipc.ts`: add channels `subagent:list|history|prompt|interrupt`.
* `src/main/db/schema.ts`: migration `addColumns` for `origin, subagent_mode, subagent_label, delegation_depth`. **Reuse `side_of_conversation_id` as parent FK** (no new `parent_conversation_id`) + add index `idx_conversations_subagent_parent ON conversations(side_of_conversation_id) WHERE origin='subagent'`. One FK, explicit in migration comment.
* `src/main/db/repositories/runtimeStateRepo.ts`: handle `activityType='subagent.descriptor'`, `deriveWorkLogEntry` for it, `listSubagentConversations(parentId)` using batched `GROUP BY`, `delete` hook to notify `SubagentContinuationManager.evict(childId)`.
* `src/preload/index.ts` / `src/renderer/lib/ipc.ts` passthrough.
* **Backoff:** child that crashes 3× quickly gets exponential backoff before next cold resume (circuit breaker), prevents hot loop.

## 6. Open decisions (input needed before S1)

* **Conversation vs Task for continuable:** reuse `conversations` (proposed) vs new `subagent_sessions` table. Reuse avoids duplication but pollutes conversation listing — needs `origin` filter everywhere `listConversations` runs. Alternative isolates but duplicates message storage. Decision: reuse, add `WHERE origin IS NULL` default.
* **One-shot lifetime:** keep current Task `result` snapshot vs adopt harness `SubagentResult {output, structured, diagnostic, stopReason}` with `finalAssistantOutput` selection. Recommendation: keep simpler `result:string` for now.
* **Model for child:** default to parent model vs allow `model` override. Atlas `agentTools` already exposes `model?`; keep but gate via `SubagentCapabilities` later.
* **Tool filter / persona:** defer to post-S6; descriptor reserves fields now so version bump not needed later.
* **Depth source:** `depth` passed in `SubagentContext` as today vs derive from `delegation_depth` column. Keep explicit param, assert equals column.

## 7. What to steal vs skip — checklist

Steal from **deepseek-harness**: descriptor versioning, single-inbox FIFO, Activation + cold resume without provider, `hasChildren` header-only hint, token/timing projections, scoped `subagent/start|end`, exact-parent authority re-check, parked-queue interrupt, lineage breadcrumbs + lazy catalog, composer takeover matrix.

Steal from **t3code**: Effect RPC group shape if Atlas ever splits server, `DrainableWorker.drain()` idiom for tests, shared `client-runtime` factoring.

Skip: t3code provider-opaque subagent (no catalog), harness Cordis dynamic registry (Atlas has static providers), harness `Jobs` Task wrapper for continuable (Atlas `Activation` direct), harness ACP/Claude-Code specific providers (keep `atlas-turn-executor` only).

## 8. Verification

* Port harness e2e `subagent-conversation.e2e.ts` scenario: parent spawns continuable child, child runs, parent `send_message` while child running -> FIFO, `interrupt` parks, later `send_message` resumes, `listChildren` shows `hasChildren` after grandchild spawn. Add race: two concurrent `send_message` for same child -> serializes via per-child mutex, no double Activation.
* Port `sidebar-subagent-activity.e2e.ts`: settled parent with running child shows `working` pill via `getBackgroundLiveness`.
* Unit: descriptor round-trip + version bump -> diagnostic row, validation `validateSpawnRequest` inside `spawn()` not at registration, slot queue deadlock (T2 `99993`), timing projection with fork seed reset, continuation `startContinuable` inbox-acceptance boundary + rollback on pre-accept failure, cold resume without provider, exact-parent reauth after resume materialization, interrupt idempotency (double abort = accepted no-op), bounded inbox rejects 11th followup, `ON DELETE CASCADE` evicts Activation, batched `hasChildren` query returns correct counts for N children.
* Manual: spawn 4 agents, expand tree, sibling switch via catalog, offline child read-only, running offline Stop still works, fork parent purge after `clearConversationBackground`, child error row shows `error` diagnostic and parent receives completion notice.

## 9. Second-opinion notes incorporated (2026-08-21, mimo-v2.5-free)

* Per-child mutex for concurrent `followup`/cold resume -> no double Activation.
* Interrupt idempotent, no double-abort throw.
* `ON DELETE CASCADE` -> manager eviction hook.
* Cold-resume authority window closed by synchronous final admission re-check.
* Descriptor version `> current` -> unsupported diagnostic row + explicit migrator path.
* Bounded inbox depth (cap 10) -> `queue-full` error.
* IPC ordering preserved by same mutex.
* `side_of_conversation_id` reuse clarified — one FK, not two.
* LRU+TTL for projection cache.
* Batched `hasChildren` `GROUP BY` avoids N+1.
* Registration unconditional, validation inside `spawn()`.
* Child error propagates to parent via `subagent/end` + notice.
* `ownedChildren` force-clears on `dispose()` throw.
* Denormalize tokens/timing to `conversations` columns if `listChildren` join becomes slow.
* Backoff/circuit breaker on repeated crash.

## 10 — Implementation record (2026-08-24)

All six slices landed in one pass, each with review fixes applied. Verification at close: `tsc --noEmit` clean; `pnpm test` 1423 tests, 1421 pass, 2 skipped (0 fail).

### Shipped

* **S1** — `subagentDescriptor.ts` + `subagent.descriptor` events + `conversations` columns (`origin`, `subagent_mode`, `subagent_label`, `delegation_depth`, partial index on `side_of_conversation_id`). Both one-shot and continuable spawns write durable child rows.
* **S2** — `SubagentContinuationManager.ts` (`startContinuable`, `followup`, cold resume via `ensureActivation`, per-child mutex, bounded inbox of 10). `subagents:followup` IPC + `send_message` tool.
* **S3** — `interrupt()` parks the FIFO (waking send resumes), `interruptForParent` exact-parent authority, `ownedChildren` graph, child-first `evict`/`evictForConversation`, `interrupt_agent` tool + `subagents:interrupt` IPC.
* **S4** — `subagentProjections.ts`: batched `hasChildren` GROUP BY, live activation timing, enriched catalog entries. Identity comes from `conversations` columns rather than folding descriptor events (see deviations).
* **S5** — `SubagentCatalog.tsx` (lazy disclosure tree, status dots, mode badges, duration column) + `SubagentBreadcrumbs.tsx`; runtime-sync–driven refresh including the unknown-child race.
* **S6** — liveness wiring: `BackgroundLivenessService.recordSubagentLiveness`, `subagents:liveness` IPC for sidebar pills; failure completion notices drain into parent turns.
* **Composer takeover (§3.5)** — landed after S6 as the last actively-wrong gap. `subagents:composerState` IPC (`ChatEngine.getSubagentComposerState`) reports `{mode, parentAvailable, running}`; renderer `useSubagentComposerState` polls it (2s) and renders one of: one-shot → read-only execution record; continuable+parent → live slab sending `subagents:followup` with Stop→`subagents:interrupt`; continuable orphaned+running → input disabled, Stop enabled; orphaned+idle → read-only with recovery hint. Child transcripts sync by polling `getPage` while a turn runs (no push channel exists for continuable turns); store gained `reloadConversationDetail`.

### Deviations from §3

* Channel namespace is `subagents:*` (not `subagent:*`), and history is served from `conversations.get` after meta validation rather than a separate reader.
* Projections are simpler than §3.4 planned: no descriptor fold, no LRU cache — identity lives in columns and every input is already O(1)/indexed.
* Catalog is a flat bordered panel with inline expansion, not the harness's ARIA tree dropdown with breadcrumb hover-switcher. Breadcrumbs exist separately.
* Continuable turns emit no per-token events to the renderer (`emitEvent` is a no-op in the manager's executor) — the transcript updates on poll, not stream.

### Open items — closed 2026-08-24

* `settledMs` now sums persisted assistant-turn latencies (`sumAssistantLatencyByConversation`, one batched query per listing); live open-turn interval overlays the sum. Duration column shows real values.
* `SubagentContinuationManager.isWaiting()` deleted — zero consumers; `whenIdle` already encodes waiting inline.
* Success settlements stay silent **by decision**: one-shot output reaches the parent through the spawn tool result, and per-turn continuable notices would spam the parent transcript. Failures keep the drain-based notice path. Rationale recorded at `SubagentContinuationManager.completionNotices`.
