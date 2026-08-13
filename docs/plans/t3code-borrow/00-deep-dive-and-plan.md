# What Atlas takes from t3code — deep dive + implementation plan

> **Scope.** A deep dive into the borrowable-feature catalog that a prior agent
> produced from exploring the t3code app, and an implementation plan for it.
>
> **Headline finding (verified against `dev@4e2b169`).** Atlas *is* the
> t3code-derived app, and it has already carried over essentially the **entire**
> catalog — event-sourced activity logging, git checkpoints, byte-budget context
> compression, sandboxed bash, always-allow approvals, two-phase skills,
> rule-based keybindings with ⌘-hold jumps, autotitle, FTS5 palette search,
> virtualized transcript, themes, sites, MCP, terminal dock, visuals, and central
> toast rules. So this plan is not "go build these". It is a **borrow ledger**:
> it verifies what is already here (with exact file references and tests),
> surfaces the small set of genuine remaining gaps, and rolls the *differences*
> into shippable tracks.
>
> Follows the same shape as the existing [`docs/plans/agents/`](../agents/00-overview.md)
> series. Numbers like `ChatEngine.ts:85` are line anchors in `src/`, valid at the
> commit above; drift is expected as the code moves.

---

## How to read this document

- **Section 1** — deep dive per suggested borrow item, mapped to the shipping
  Atlas equivalent. Each row: what t3code does, where it lives in Atlas, the
  tests that pin it, and a status (**✅ shipped**, **🟡 partial**, **🔴 gap**).
- **Section 2** — the only genuine remaining gaps, with concrete file-level tasks.
- **Section 3** — prioritized tracks (ordered by dependency), each with scope,
  files, tests, and acceptance criteria.
- **Section 4** — how to validate (commands that must stay green).
- **Section 5** — principles worth copying frame-for-frame, carried over verbatim.

---

## 1. Deep dive per suggested item

### 1.1 Event-sourced streaming + runtime activity log (pick #1)

**t3code mechanic.** Every stream event (`chunk`, `reasoning`, `tool-input-start`,
`tool-approval-requested`, `visual-complete`, …) is appended to an append-only
`conversation_events` log with a monotonically increasing sequence per
conversation. The UI replays from the log after a reload, so it survives crashes
and enables fork/undo/checkpoint/resume to all "fall out" of one spine.

**In Atlas.**
- Envelope + persisted log: `RuntimeEventEnvelope` + `conversation_events`
  (`shared/contracts.ts`, `db/schema.ts`, `db/repositories/runtimeStateRepo.ts`),
  replay via `chat.recoverEvents` (`shared/ipc.ts`, `preload/index.ts`).
- Read-model derivation: `shared/runtimeActivity.ts` — `deriveWorkLogEntry`,
  `getWorkLogEntryId`, `WorkLogEntry` with `tone`/`status`/`isFinal`/`summary`;
  `ActivityType` covers `message.*`, `tool.*`, `approval.*`, `turn.*`.
- Fork/undo: `db/repositories/conversationFork.ts` (stable activity ids,
  event-log copy), `workspaceCheckpointsRepo.ts`.
- IPC reduction: **33 ms chunk coalescing** — `ChatEngine.ts:85`
  (`STREAM_BATCH_INTERVAL_MS = 33`) with `queueBufferedEvent` /
  `mergeBufferedEvents` / `flushBufferedEvents` (`ChatEngine.ts:1006–1090`).
- One projection of that log reaches the UI: `stores/streamEventReducers.ts`,
  `stores/conversationCache.ts`.

**Status: ✅ shipped.** Tests: `runtimeActivityTasks.test.ts`,
`runtimeStateRepo.test.ts`, `conversationFork.test.ts`,
`streamEventReducers.test.ts`.

**Why it matters / verdict.** This is the highest-leverage substrate and it is
already the load-bearing spine. Any *new* feature here (sub-agents, background
work, progress ticks) must ride this same path — see track **R3**.

---

### 1.2 Runtime-activity transcript rendering (pick #2)

**t3code mechanic.** A turn's tool calls + reasoning fold behind one dim summary
row ("Worked for 1m 47s ›"), tool calls group by type ("Explored N files"), diffs
use a GitHub palette with `⋮` hunk gaps and hover `+` line comments, terminal
output is never run through markdown, `<16` SGR colors map to theme tokens, and a
changed-files end card offers Undo/Review.

**In Atlas.**
- Activity folding: `transcript/assistantSegments.ts` (`AssistantSegment[]`),
  `transcript/ActivityBlock.tsx` (labelled rule + elapsed), `ToolCell.tsx`
  (grouped cells, default-open on fail/awaiting-approval), `ReasoningCell.tsx`
  (shimmer "Thinking", timing via `useTranscriptUiStore` working window),
  `ChangedFilesBar.tsx` (Undo/Review), `TerminalBlock.tsx` (raw output, xterm
  theme mapping in `workbench/TerminalPanel.tsx`), `DiffBlock.tsx`
  (`+++/---` counts), `PlanCell.tsx` (anchored checklist), `McpUiFrame.tsx`.
- Raw mode: `git apply`-able copy (`shared/contracts.ts:790` region + transcript
  raw mode, CHANGELOG `87d93c6`).

**Status: ✅ shipped.** The Codex-parity sweep (`docs/codex-parity/`) re-skinned
exactly this grammar (one dim row per phase, status colour not label, turn rule
for turns that did work). Known UX regressions are logged in `docs/ux-audit.md`
(e.g. no expand/collapse animation, `TerminalBlock.tsx:52` h-scroll) and belong
to the hardening tracks, not a rewrite.

---

### 1.3 Context compression + accurate usage meter (pick #3)

**t3code mechanic.** Context is compacted by **byte budget**
(`contextWindow − reserved output`), not turn count; a rolling summary of
Goals/Decisions/Constraints/Open-loops plus tool-outcome summaries, sha256 –
fingerprint cached, never drops the newest turn, tool summaries deduped.

**In Atlas.**
- `main/ai/core/ContextManager.ts` — byte-budget compaction (file header
  comment, ~900 LOC), tool-summary dedup, rolling summary.
- Budget resolution: `ChatSessionRuntime.resolveContextBudget`
  (`ChatSessionRuntime.ts:909`).
- Meter surfaced as *remaining headroom*, not consumed: `hooks/useContextUsage.ts`,
  `components/ai-elements/context.tsx` (breakdown card with Source rows),
  context-ring in the composer (`Composer.tsx`); CHANGELOG `fd3031c`
  ("frame the context window as remaining, not consumed").
- Tests: `contextManager.test.ts`, `contextUsageDisplay.test.ts`,
  `chatSessionRuntime.test.ts`.

**Status: ✅ shipped.**

---

### 1.4 Tool sandboxing + approval controller / "always allow" (pick #4)

**t3code mechanic.** Seatbelt SBPL via `-D` params + additive network allow; a
session-scoped "always allow" persisted against the conversation.

**In Atlas.**
- Sandbox: `ai/tools/sandbox/` — `seatbelt.ts` (SBPL, additive network),
  `bubblewrap.ts` (ro-bind `/` + writable roots), `policy.ts` (writable roots,
  no aliased-volume splice), `denial.ts`, `index.ts`, `types.ts`.
- Approval: `ai/core/ToolApprovalController.ts` — `accept_for_session` decision +
  `sessionScopeKey` + `grantedScopesByConversation` (per runtime session,
  in-memory); `shared/contracts.ts:1593` (`ApprovalDecision` includes
  `accept_for_session`); scope-key builder `shared/runtimeActivity.ts:61`
  (`getApprovalScopeKey`).
- Tests: `bashSandboxWiring.test.ts`, the `toolRuntime` denial suite,
  `mcpNaming.test.ts`.

**Status: ✅ shipped** (session scope is per-runtime-session by design — see
**gap G2** for the deliberate decision about persistence).


---

### 1.5 Two-phase skills + dependency-gated plugin activation (pick #5)

**t3code mechanic.** Skills listed one line in the prompt, body loaded on demand
(two-phase); plugin/tool activation gated on declared dependencies.

**In Atlas.**
- `main/plugins/SkillsService.ts` and `main/plugins/skillTools.ts`
  (`createSkillTools`) — index-only standing cost vs on-demand body; wired into
  the turn runtime at `ChatSessionRuntime.ts:44`.
- `shared/plugins.ts:969–973` — honours `disable-model-invocation` /
  `policy.allow_implicit_invocation: false` (excludes those skills from the
  model-reachable index).
- Activation + dependency gating: `main/plugins/*` (17 files), `PluginActivation`,
  plugin docs (`docs/plugin-system.md`, `docs/plugin-distribution-research.md`).
- Tests: `skillsService.test.ts`, `agentPlugins.test.ts`, `pluginActivation.test.ts`.

**Status: ✅ shipped.** Note: the CLI's user-invoked **commands** (`/`) are treated
in `docs/plugin-distribution-research.md` as a distinct, cheap, unimplemented
component — that is a forward item, not part of this pick.

---

### 1.6 Rule-based keybindings + ⌘-hold jump hints (pick #6)

**t3code mechanic.** Rule-based keybindings with `when` contexts; ⌘-hold reveals
jump labels `.1..9` over conversation rows with modifier-match hints and platform
display labels.

**In Atlas.**
- Rules: `shared/keybindings.ts` (rule form, `KEYBINDING_WHEN_IDENTIFIERS`),
  `renderer/lib/keybindings.ts` (`resolveKeybindingRules`, when-expression parser
  ~`shared/keybindings.ts:196`), command catalogue `renderer/lib/keybindingCommands.ts`.
- Context build: `renderer/App.tsx:306–315` (five context flags incl.
  `composer.focus`); ⌘-hold jump map for up to 9 sidebar items at `App.tsx:641–645`
  → `Sidebar.tsx` `showConversationJumpHints` → `SidebarConversationRow.tsx`
  `showJumpHint`.
- Tests: `keybindings.test.ts`.

**Status: ✅ shipped.**

---

### 1.7 Autotitle (local + LLM refine) (pick #7)

**t3code mechanic.** A local title from the first message immediately, an LLM
refinement after the turn, fire-and-forget so it never blocks, and a user rename
that wins.

**In Atlas.**
- `shared/sessionTitles.ts` — `deriveTitleFromUserMessage` (offline, deterministic)
  + `sanitizeGeneratedTitle` + `isPlaceholderSessionTitle` / placeholder pattern
  `^Session · `.
- `main/ai/core/ChatEngine.ts` imports `isPlaceholderSessionTitle`; emits
  `conversation-title` (`shared/contracts.ts:1538`, renderer patch at
  `useAppStore.ts:1788–1790`).
- `tests/chatEngineTitles.test.ts` pins every behaviour: local name lands before
  streaming starts, user rename never touched, auto names still open to
  refinement, unusable output / provider failure → local name stands, and the
  naming call carries model hints (`supportsTemperature:false`,
  `reasoningEffort:minimal`) so reasoning models don't 400.

**Status: ✅ shipped.**

---

### 1.8 FTS5 message search in the command palette (pick #8)

**t3code mechanic.** Full-text search over message bodies; the palette ranks
chats + commands + full-text hits (bodies ranked last); PUA-marker snippet
highlight (XSS-safe).

**In Atlas.**
- `db/repositories/messageSearchRepo.ts` — FTS5 virtual table with a LIKE
  fallback (`messageSearchRepo.ts:40`); `db/schema.ts:941` `messages_fts` +
  triggers.
- Palette: `renderer/hooks/useMessageSearch.ts`, `components/CommandPalette.tsx`.
- Tests: `messageSearch.test.ts`, `messageSearchPalette.test.ts`.

**Status: ✅ shipped.**


---

### 1.9 Category items — engineering / architecture

| t3code | Atlas equivalent | Status |
| --- | --- | --- |
| Git checkpointing (throwaway index, `write-tree`+`commit-tree` under `refs/atlas/checkpoints`, invisible to `git status`) | `workspace/WorkspaceCheckpointService.ts`, `workspace/CheckpointCoordinator.ts`, `db/repositories/workspaceCheckpointsRepo.ts` | ✅ `workspaceCheckpoint.test.ts`, `workspaceCheckpointsRepo.test.ts` |
| File-change tracking (LCS diff, `+++/---` computed once) | `workspace/FileChangeTracker.ts`, `db/repositories/fileChangesRepo.ts`, `ai/tools/codeTools.ts` (LCS + `resolveWritablePath` 3-tier) | ✅ `fileChangeTracker.test.ts`, `changeStats.test.ts` |
| Turn orchestration (retry on prompt-too-long w/ aggressive compaction, `stepScopedPartId`, 3-turn semaphore, FIFO queue + `queued`) | `ai/core/ChatSessionRuntime.ts`, `ai/core/ChatEngine.ts:188` | ✅ `chatSessionRuntime.test.ts`, `chatEngine.test.ts` |
| Error normalization (code bucket + retryable + Retry-After + full-jitter) | `ai/core/ErrorNormalizer.ts` | ✅ `errorNormalizer.test.ts` |
| Search highlighting (PUA-marker snippet) | `messageSearchRepo.ts` + `useMessageSearch.ts` | ✅ |

### 1.10 Category items — tooling / integrations

| t3code | Atlas equivalent | Status |
| --- | --- | --- |
| Tools (read/grep/glob/web/bash/git/plan/site/GitHub `gh`) | `ai/tools/builtInTools.ts`, `codeTools.ts`, `gitTools.ts`, `githubTools.ts` + `workspace/GitHubCli.ts`, `planTools.ts`, `siteTools.ts`, `ToolExecutionTracker.ts`, `ToolStateStore.ts` | ✅ |
| MCP (lazy connect, one-in-flight dedupe, env allowlist, FNV-1a namespacing, `readOnlyHint`) | `ai/mcp/McpClientManager.ts`, `mcpToolsProvider.ts`, `mcpTools.ts`, `mcpAuditLog.ts` (+ `mcpNaming.test.ts`) | ✅ |
| Terminal dock (node-pty, agent never writes stdin, display-only echo, scrollback replay) | `terminal/PtyService.ts`, `workbench/TerminalPanel.tsx`, `workbench/TerminalDock.tsx` | ✅ `terminalHistory.test.ts` |
| Sites (build/preview/publish, `atlas-site://` origin, CSP, draft→published, export) | `sites/SitePreviewHost.ts`, `SiteService.ts`, `SiteExporter.ts`, `shared/sites.ts`, `components/sites/SitesWorkspace.tsx` | ✅ |
| Plugins (6-vendor manifests, atomic staged install, symlink-escape detection, two-phase skills, dependency gating, marketplace SHA-pinned) | `main/plugins/*`, `shared/plugins.ts`, `shared/marketplace.ts`, `components/plugins/*` | ✅ |
| Attachments (text inlined, binary capability-gated, `attachment://` protocol) | `shared/attachments.ts`, `components/ai-elements/attachments.tsx` | ✅ `attachmentCapabilities.test.ts` |
| Visuals (HTML spec → gate → iframe, gallery, standalone window, d3/chart.js) | `shared/visualParser.ts`, `visualIntent.ts`, `visualDocument.ts`, `renderer/visual/*`, `ai-elements/visual.tsx` + gallery | ✅ |
| Autotitle | §1.7 | ✅ |

### 1.11 Category items — UI/UX

| t3code | Atlas equivalent | Status |
| --- | --- | --- |
| Transcript fold / grouped tool cells / diff / terminal / changed-files Undo-Review | §1.2 | ✅ |
| Raw mode `git apply` copy | `shared/contracts.ts:790` + transcript raw mode | ✅ |
| Composer (two-step Backspace delete, IME-aware Enter, Esc hint while streaming, mention autocomplete in a plain textarea, drag-drop attachments, context ring) | `components/Composer.tsx`, `MentionAutocomplete.tsx`, `CommandAutocomplete.tsx`, `PluginMentionAutocomplete.tsx` | ✅ |
| Context ring (drains as window fills, 2% floor, `<1%`/`>99%`, breakdown card, main-process-measured, 250 ms debounced) | `ai-elements/context.tsx`, `hooks/useContextUsage.ts` | ✅ |
| Command palette (chats + commands + FTS bodies ranked last, stale-response guard) | `CommandPalette.tsx`, `useMessageSearch.ts` | ✅ |
| Virtualized transcript (stubs off-screen, measured/estimated calibration, reserved thinking min-height, load-older slot) | `ChatWindow.tsx` (@tanstack/react-virtual), `useMeasuredHeight.ts`, `useTranscriptScroll.ts`, `jumpToLatest.ts` | ✅ |
| Rule-based keybindings + ⌘-hold hints | §1.6 | ✅ |
| Resizable panels (pointer-capture + rAF, persist on pointer-up, keyboard 16/48 px, invisible 12 px hit area) | `PanelResizeHandle.tsx`, `hooks/useResizablePanel.ts` | ✅ |
| Themes (token contract, `data-design-theme`/`data-theme`, colour-mix contrast slider, JSON export/import, reduced-motion single source) | `renderer/themes/*.css`, `lib/themeOverrides.ts`, `styles.css` token contract | ✅ |
| Sticky-to-bottom hysteresis jump pill | `jumpToLatest.ts`, `useTranscriptScroll.ts` | ✅ |
| Onboarding (provider-first, no key form, obvious skip) | `components/OnboardingFlow.tsx` | ✅ |
| Toasts (title = label, description = why, none for visible state, one owner per event) | `renderer/lib/notify.ts`, `ui/sonner.tsx` | ✅ |


---

## 2. Genuine remaining gaps

Everything above shipped. What remains is small, deliberate, and mostly about
*completing* or *forwarding* the borrowed ideas rather than importing new ones.

- **G1 — Stream chunk buffering is present but untested as a contract.** The 33 ms
  coalesce path (`ChatEngine.ts:85,1069–1090`) has no dedicated test pinning
  merge semantics (same part id, same part type; text vs tool-input, reasoning
  vs text must not cross-merge). Add invariant tests so the "massive IPC
  reduction" claim cannot silently regress.
- **G2 — `accept_for_session` is per-runtime-session only.** `ToolApprovalController`
  keeps grants in an in-memory `Map`; a restart forgets them. That matches
  t3code's "session" semantics and the privacy posture (pending approvals live in
  `approval_requests`), but the plan should *decide and document* it rather than
  leave it implicit. No code change unless we want grants to persist per
  conversation — see track **R4**.
- **G3 — No renderer-level "user rename wins" test.** `chatEngineTitles` pins the
  main-process side, but the sidebar patch at `useAppStore.ts:1788` and the
  `conversations:rename` IPC both exist yet have no store-level invariant test
  covering a late `conversation-title` arriving after a manual rename.
- **G4 — The raw-mode "git-apply-able" guarantee is not asserted.** Add a test
  that a synthetic turn's raw copy round-trips through `git apply --check` (or,
  if environment-gated, an offline parser check of the `+++/---` grammar).
- **G5 — Borrowed-in-concept, deliberately unbuilt.** Native sub-agents / background
  work and `/` user commands. These are product decisions, not gaps in the
  borrowed spine; sub-agents are already tracked in `docs/plans/agents/`.

---

## 3. Tracks (ordered by dependency)

> **Implementation status (2026-08-07): all four tracks below are built, tested,
> and committed on branch `feat/t3code-borrow-R1-R4/openrouter-deepseek-chat`:
> R1 (`b11b62d`), R2 (`5b3cb4e`), R4 (`b14d535`), R3 (`bc81359`).**

Small, focused, shippable. **R1** is pure hardening of already-shipped borrows;
**R2** closes the raw-mode guarantee; **R3–R4** are forward work rooted in the
event spine.

| # | Track | Depends on | Scope |
| --- | --- | --- | --- |
| [R1](01-stream-buffer-invariants.md) | Pin the 33 ms stream coalescer with merge-invariant tests | — | main + tests, ~120 LOC |
| [R2](02-raw-clone-roundtrip.md) | Assert raw mode round-trips through `git apply --check` | — | renderer/shared + tests, ~120 LOC |
| [R3](03-activity-feed-quiet-timeline.md) | Derive an "activity feed" read-model off the runtime log (already partially planned in `agents/03`) | — | shared + renderer, ~300 LOC |
| [R4](04-approval-grant-persistence.md) | Decide + (optionally) persist per-conversation `accept_for_session` grants | — | main + repo + tests, ~200 LOC |

**Rationale for stopping here.** Every one of the eight "highest-value picks" and
every category row is already shipped and tested. The highest-value *next* work in
this codebase is the sub-agent/observability series (`docs/plans/agents/`), which
this plan hands off to rather than duplicates.

---

## 4. Validation

After any track lands:

```bash
pnpm build          # tsc --noEmit + electron-vite build
pnpm test           # node --import tsx --test tests/*.test.ts
```

New tests follow the repo's invariant-test style (`node:test` +
`assert/strict`, no mocks where a seam exists; security/boundary tests must
assert the *specific* reason, per `agents/00-overview.md` principles).

---

## 5. Principles carried over verbatim

1. **Additive optional fields, never a migration.** The event/activity path is
   JSON in `runtimeStateRepo` — extend it, don't fork it.
2. **One spine.** New work rides the `conversation_events` → `deriveWorkLogEntry`
   → renderer projection path; never open a second transcript source.
3. **Stable ids ⇒ upsert.** Any recurring/frequent event gets an id derived from
   its *subject*, not the event (`getWorkLogEntryId` already does this).
4. **Classify once, at the boundary, and persist it.**
5. **Denylist, not allowlist, for capability** ("is the model vision-capable",
   "is this an agent"). Unknown ⇒ capable until proven blocked (Atlas writes
   `supportsVision:false` into the catalog on rejection).
6. **Never let a live thing hide behind a disclosure.**
7. **Security tests assert the specific reason.**

