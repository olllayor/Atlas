# Steal Plan: t3code + DeepSeek Harness → Atlas

Research artifacts: full clones at `/var/folders/by/b_9h7vl11nl_kt50dqj679880000gn/T/opencode/steal/{t3code,dsh}`.
Both MIT. Verdicts:

- **t3code** (`pingdotgg/t3code`, 20k★): React 19 + Tailwind v4 + shadcn-style on Base UI — near-identical stack to Atlas renderer. Most UI code lifts directly. Server-owns-everything architecture; Effect-TS (skip the framework, keep the patterns).
- **dsh** (`deepseek-ai/deepseek-harness`, 190k★): hand-rolled CSS Modules design system — steal *patterns*, not code. Best-in-class session event log, agent loop, KV-cache discipline.

Shorthands: `$T3` = `.../steal/t3code/apps/web/src`, `$DSH` = `.../steal/dsh/packages/client`.

---

## Tier 0 — Architecture steals (do first, everything else sits on these)

### 0.1 Append-only session log + surface projection (dsh)
- Problem: resume/fork/search/UI-replay correctness; model history diverging from stored state.
- Their solution: every turn is frozen events `{type, seq, time, data}`; model context derived from a cached **surface** projection; compaction = `surfaceOp: {op:'replace', start, end}` shadowing a range without deleting history; `request/header` events snapshot full request envelope so any request is reproducible; raw assistant chunks kept for UI replay but excluded from derivation.
- Files: `$T3→dsh/packages/core/session/src/{types.ts,index.ts,surface.ts,request-header.ts}`, crash marker `session/end-seed`.
- Atlas mapping: replace/augment `src/main/db/schema.ts` conversation storage + `src/renderer/stores/streamEventReducers.ts`. SQLite JSON rows fine (they ship a zstd JSONL backend — skip). Invariants to copy: seq contiguity, deep-freeze on append, unknown-event-without-`ignorable` ⇒ refuse log.
- Effort: ~1 week. Highest leverage item in this document.

### 0.2 Canonical runtime-event vocabulary + provider adapter SPI (t3code)
- Problem: N providers (OpenAI/Anthropic/Google/OpenRouter/MCP) each with own stream shapes behind one transcript.
- Their solution: one shared `ProviderRuntimeEvent` union (`content.delta`, `item.started/completed`, `request.opened/resolved`, `turn.*`, `session.exited`) + per-driver mappers; adapter = plain object `{configSchema, create}` returning scoped closures; capabilities field declares e.g. `sessionModelSwitch: 'in-session'|'unsupported'`; opaque **resume cursor** blob per session with graceful fallback to fresh session on recoverable errors; multi-account = instance-per-config-closure (two Codex accounts can't collide).
- Files: t3code `apps/server/src/provider/ProviderDriver.ts:119`, `Services/ProviderAdapter.ts:47`, `Layers/CodexAdapter.ts:764-1628` (the translation table), `CodexSessionRuntime.ts:664-722` (resume fallback).
- Atlas mapping: `src/main/ai/*`. Atlas uses AI SDK which normalizes streams already — adopt the *event vocabulary + capability flags + resume cursor*, not a new adapter layer wholesale.

### 0.3 Sequence-cursor subscriptions (t3code)
- Problem: WS/reconnect duplicate-or-lost streaming events; pagination racing live deltas.
- Their solution: subscribe takes `afterSequence` + `requestCompletionMarker`; server replays missed then streams live; client dedupes by seq; per-thread watermarks stop old pages merging past live deltas. Reconnect policy isolated in one supervisor state machine: offline waits free, exp backoff cap 16s, 30s-stable resets ladder.
- Files: t3code `packages/contracts/src/orchestration.ts:556-646`, `packages/client-runtime/src/connection/supervisor.ts`, docs `docs/internals/connection-runtime.md`.
- Atlas mapping: Electron IPC today; matters when Atlas gets remote/mobile surface. Port the supervisor semantics into `useAppStore` connection logic when needed. Low urgency, cheap to remember.

### 0.4 Agent-loop hardening (dsh)
- Two-target inbox: `followup(msg)` wakes next turn, `steer(msg)` consumed at next step boundary mid-turn, `inject()` adds context without waking — all durable log events. Copy verbatim.
- Interrupted mid-stream: delivered text finalized as `assistant/message {interrupted:true}`; unstarted tool calls get synthetic ordered error results — replay never has dangling calls.
- Tool scheduler: `isConcurrencySafe(args)` groups parallel-safe calls into bounded pool; exclusive calls are barriers; results commit in model order.
- Failures normalize to serializable `LlmFailure`; retry policy attached at registration (`agent/request-error` waterfall); canonical `CONTEXT_WINDOW_EXCEEDED` routes to compaction.
- Files: dsh `packages/core/agent-loop/src/{agent.ts,tool-calls.ts}`, `packages/llm/llm-retry`.
- Atlas mapping: `src/main/ai/core/*`, `SubagentContinuationManager.ts`.

### 0.5 KV-cache discipline (dsh) — real money saver for BYOK users
- Dynamic runtime context NEVER rewritten into system prompt; appended as full-snapshot user messages only when changed; prefix stays append-only.
- Request header logged only when actually changed (`headerEquals`) — stable envelope keeps provider prefix cache alive.
- Adopt as review checklist + implement snapshot-append in prompt assembly (`src/main/ai`).

### 0.6 Permissions done right (both)
- Vocabulary: decisions `accept|acceptForSession|acceptAlways|decline|cancel` (t3code) folded into dsh's fail-closed outcome union; missing answerer ⇒ deny, headless ⇒ deterministic reject.
- Every ask appends audit pair `approval/asked`+`approval/decided` to the log; policy state folded from last log event (survives restart).
- Permission presets = named bundle of two independent knobs: sandbox mode × approval policy; switching writes intent event; effective preset derived, unmatched ⇒ "custom".
- Sandbox honesty flag: `enforcement:'full'|'partial'` + denial-dialect classification distinguishes "sandbox denied command" from "sandbox broken". macOS Seatbelt backend exists in dsh `packages/sandbox/sandbox-local/native`.
- Atlas mapping: extend `src/main/security/` + approval flow in transcript.

---

## Tier 1 — UI/UX steals (go hard here)

Stack note: t3code is Tailwind v4 + shadcn-style on Base UI ≈ Atlas. Lift code nearly as-is.

### 1.1 Design-system upgrades (from t3code `apps/web/src/index.css`, 2,523 lines)
- Semantic roles beyond shadcn defaults: `--message-surface`, `--sidebar-row-hover/active/selected`, `--code-background`, `--terminal-cursor`, each with a `--contrast-*` twin computed via `color-mix(in oklab …)` — gives users a contrast slider for free.
- Glass utilities `surface-glass/dialog-glass/dropdown-glass`: blur 12px light /16px dark, saturation 1.14/1.08, opacity 80%, `@supports not (backdrop-filter)` solid fallback. Copy verbatim.
- Film grain: inline SVG feTurbulence data-URL tile, opacity 0.035, via `@utility surface-grain`.
- Scroll-edge fades as mask-image gradient utilities (topbar/virtualized/sidebar).
- Duty-cycled pulse animations: `status-pulse/ghost-pulse/status-ping` use `steps(4..8)` — "~14 vs ~288 updates at 120Hz". Copy for every always-on spinner/pulse.
- Radius scale derived from single `--radius: 0.625rem` via calc; extra shade `--color-zinc-25`.
- Theme engine: `html[data-theme-id]` palettes remapping roles; `.no-transitions` kill-switch during theme swap.

### 1.2 Transcript rendering kit
- Virtualization: t3code `MessagesTimeline.tsx` — LegendList, `maintainScrollAtEnd`, custom `shouldRestorePosition` that suspends 2 rAF around disclosure toggles (kills expand-near-bottom jump), per-role `getItemType`, row-stable references across streaming updates (`MessagesTimeline.logic.ts:1084`), Context-not-props for shared row state.
- Per-node subscriptions instead of giant store re-render (dsh `ChatNodeSeat`): each row subscribes to its own node key; delta replaces only its row.
- Streaming markdown: no fake typewriter; timers update single text node via ref (never re-render rows). dsh `ui-primitives/src/markdown/incremental.ts` (~130 lines): append-only parse freezing all blocks except trailing 2 using micromark position offsets — O(1) per chunk, stable keys. Near drop-in; kills quadratic re-parse.
- Shiki with LRU cache (500 entries) + streaming bypass; failure falls back to `text` (t3code `ChatMarkdown.tsx`).
- Code block UX: filename header + real file icon, wrap toggle `aria-pressed`, copy icon swaps to Check for 1200ms.
- Craft details from `index.css` chat-markdown block: list-gutter widening for 3-digit markers (inherited custom property reset on nested lists), dotted link underline via radial-gradient background-image, collapsed-cell ellipsis tables with footer expand.

### 1.3 Tool-call rows (best pattern in either repo)
- dsh `ToolRow.tsx/.module.css` documented geometry: 24px row `[16 icon][gap6][title][2px dot sep][summary fills, truncates]`; icon swaps to chevron on hover; error row's collapsed summary IS the failure first-line in error color; expanded IN/OUT card with sticky gutter labels, sections scroll independently max-h 150px, hover "Inspect" pill that reserves layout space (no shift).
- Fuse with t3code work-group folding: collapsed groups render `+N previous tool calls` toggle; overflow modeled as list data not nested DOM.
- Running state: glare sweep band (300px, 2.6s ease-out, bg-mix 60%) + `StateDot` halo/chase matrix with `-125ms × index` delays + screen-reader run-state label.

### 1.4 Composer (t3code `ChatComposer.tsx` 3,519 lines + index.css `.chat-composer-*`)
- Glass shell: translucent color-mix surface, 1px outline, top inner highlight, drop shadow; attachment drawer joins composer with continuous silhouette via `clip-path: shape(...)` Bézier handles (with @supports fallback).
- Footer zones: left = model picker + mode toggles; right = **ContextWindowMeter** SVG donut (r=9.75, >90% flips error color, hover popover delay 150/0) + send/stop.
- Send button physics: 36px round, `hover:scale-105 active:inset-shadow` pressed-sink; stop = destructive rounded-square glyph; aria-label walks every disabled reason ("Preparing worktree"…).
- Placeholder-as-feature-matrix per state (ask/approval/plan/disconnected).
- Queued messages while running: dsh `QueueDock.tsx` — collapsible strip above composer, per-row inline edit (isComposing guard), delete, **steer-now** action enabled only while running. Pairs with 0.4 inbox.
- Trigger grammar: dsh `ui-input-trigger/src/core/detect.ts` — pure function, word-boundary rule with URL carve-outs, quoted `@"path with spaces"` tokens. Cleanest @-mention parser found; port it.

### 1.5 Approval UI (inline, not modal)
- t3code `ComposerPendingApprovalPanel.tsx`: approval detail as scrollable mono block (`max-h-20 text-[11px]`), kind-specific labels, `1/{pendingCount}` counter; editor disabled while pending; actions array Cancel/Decline/**"Always allow this session"**/Approve — safest-last ordering, decline destructive-tinted, approve emphasized.
- dsh `PermissionSelect.tsx`: shield glyphs check/pencil/exclamation for read-only/workspace-write/full-access; Full access opens `RiskConfirmation` modal with acknowledge checkbox before applying.
- Multi-question input wizard: `ComposerPendingUserInputPanel.tsx` (Next/Previous/own-answer mode).

### 1.6 Diff + changed files
- Inline diff card starter: dsh `DiffBlock.tsx` (head/tail split at 16 lines, center expander, footer stats, copy emits exactly what's rendered). Atlas has `transcript/DiffBlock.tsx` — upgrade path.
- Full panel: t3code `DiffPanel.tsx` on `@pierre/diffs` (npm-installable): unified/split toggle, wrap toggle, ignore-whitespace, sticky headers, per-file collapse via `composedPath()` hit-test disambiguating filename-click vs header-click, worker pool sized `clamp(cores/2, 2..6)` with LRU cache, patch cache keyed by double-FNV hash for cheap streaming invalidation.
- Changed-files card: t3code `ChangedFilesTree.tsx` — container queries (compact chips <24rem, tree ≥24rem), indent `8+depth*14px`, diffstat labels, expansion persisted per thread+turn, auto-expand rule in `changedFilesPresentation.ts`. Upgrade Atlas `ChangedFilesBar.tsx`.
- Checkpoint-backed exact diffs: hidden git ref per turn means turn/thread diffs are exact git diffs and revert pairs workspace+conversation rollback (t3code `CheckpointReactor.ts`). Atlas has `workspace/CheckpointCoordinator.ts` — wire it to produce per-turn refs + `rollbackThread`.

### 1.7 Layout engine
- dsh `ui-layout/src/client/columns.ts` — pure concession-chain solver: CENTER_MIN 640, SIDEBAR 264–420 (collapsed rail 56), DETAILS 300–520; auto-collapse <1024; closing under pressure derives width 0 but preference preserved; drag handles freeze dx at gesture start; grid transition paused during drag; details column stays mounted at width 0. Drop-in for Atlas three-pane + `PanelResizeHandle.tsx`.

### 1.8 Navigation & palette
- One reducer owns ⌘K commands / ⌘P files / ⇧⌘F content-search — modes root/browse/submenu; same shortcut closes; thread-jump numbered hints appear on modifier-hold; non-Latin layouts matched via `event.code` aliases (t3code `CommandPalette.logic.ts`, `keybindings.ts`).
- Timeline minimap scrubber (t3code line 723): left rail jump list, tick widths shrink by distance from hovered item, keyboard nav, glass preview card.
- Empty states: t3code `NoActiveThreadState`, dsh `EmptyHero` fish-swim gated `@(hover:hover) and (prefers-reduced-motion:no-preference)`.

### 1.9 Settings polish
- Secret masking: `RedactedSensitiveText.tsx` — FNV hash generates same-length gibberish preserving `@.-_` shapes, `blur-[2px] select-none`, click-to-reveal. Better than password inputs for BYOK keys.
- `DraftInput.tsx`: buffers keystrokes, commits on blur/Enter.
- Settings search jump pulse: target card rings 650ms ×2, exactly-one-indicator rule.
- Theme import from VSCode themes (`vscodeThemeImport.ts`).

### 1.10 Accessibility/polish checklist
- Reduced motion per-file but keep opacity fades, kill movement.
- Color-only state always paired with text/aria (`role="img" aria-label="Tool call failed"`).
- Focus-visible ring inset on full-row disclosures; popups get ring-reset.
- Touch hit-target expander `pointer-coarse:after min-h/w-11` in button base.
- IME-safe submits (`isComposing` guard); tabular-nums everywhere numeric.
- Electron: WCO titlebar vars (`env(titlebar-area-height)`), drag/no-drag region utilities, safe-area padding, `scrollbar-gutter` reservation.

---

## Tier 2 — Worth queueing

- Worktree lifecycle (t3code `GitVcsDriverCore.ts:2780`): submodule fixup after `worktree add`, idempotent removal + prune, stale detection via porcelain parsing, branch-name sanitizer from commit subject, stacked actions commit→push→PR with result-toast CTA chaining, PR-status sticky lookup surviving deleted branches. Direct fit if Atlas grows repo-agent features.
- Terminal replay protocol: history ring 5000 lines + sequence numbers, attach RPC replays history then live frames; coalescing worker for output backpressure (t3code `terminal/Manager.ts`). Atlas `main/terminal` + xterm.js pragmatic path.
- Spill: oversized tool outputs persisted to files, inline replaced by bounded preview + retrieval locator (dsh `packages/spill`).
- Token meter: usage-anchor baseline + signed heuristic delta per node — cheap pressure signal without per-request tokenization (dsh `token-meter`).
- Keyless snapshot replay testing: record transcripts, replay deterministically offline vs expected output — regression harness for agent behavior (dsh test pyramid).
- Settings YAML leaf-diff comment preservation (dsh settings-file) if Atlas moves config to files.
- Version-skew detection semver-core ignoring nightly suffixes (t3code `versionSkew.ts`) for future server/client split.

## Skip (not portable / overkill)

Effect-TS framework, Cordis kernel itself (reimplement 3 ideas: registrations-unwind-as-effects, waterfall-events-as-interception, inject-declared-deps gating startup — ~500 LOC), Cloudflare relay/APNs, Typert codegen gateway, vector indexing (neither repo uses embeddings for grounding — AGENTS.md-style instruction files + skills only), ghostty-wasm terminal renderer, zstd log framing.

---

## Implementation order (proposed)

| Phase | Items | Outcome | Status |
|---|---|---|---|
| 1 | Session-log hardening: followup/steer inbox, interrupted-finalize + synthetic tool results + context-visible partials, request-header envelope snapshots | Correct-by-construction core | **Done** (`tests/interruptedTurns.test.ts`) |
| 2 | Transcript kit | See phase notes below — most of the planned steals already existed; shipped the gaps: draft request-scoping fix, queue store + **QueueDock** (dsh), scroll-edge fades | **Done** (`tests/streamEventReducers.test.ts`) |
| 3 | Composer overhaul (send-button physics, ContextWindowMeter donut, placeholder matrix) + trigger grammar (@/$// `detect.ts` port), 1.5 approval polish, 0.6 permission presets | Agent-control UX complete | **Done** — presets chip, Context donut, mention grammar and approval prompt (y/a/esc + focus discipline) already existed; added send-button press physics and the queue-aware placeholder matrix |
| 4 | 1.6 diffs + changed-files + checkpoint wiring | Code-change story end-to-end | **Already present** — `ChangedFilesBar` card with undo/review wired through tool-call ids; `CheckpointCoordinator` brackets turns. No gap worth a rewrite; @pierre/diffs migration left as optional future work |
| 5 | 1.7 layout solver, 1.8 palette/minimap, 1.9 settings polish (`RedactedSensitiveText`, `DraftInput`), 1.10 a11y pass | Polish sweep | Small items audited: key masking + blur-commit already exist in provider forms; nothing to add. Remaining candidates are builds, not steals: timeline minimap, dsh `columns.ts` layout solver |
| Later | Tier 2 as features demand; resume cursor; ~~prefix-stable dynamic context~~ **done** (see below); ~~subagent suite failures~~ **fixed** | — | — |

## Completed follow-ups (post-phase)

0. **Context-manager rework, slice 1 (dsh compaction semantics).** Three changes to `ContextManager` + the runtime: (1) **pressure-threshold trigger** — the sticky boundary now moves at 85% of the available window (`PRESSURE_RATIO`, dsh's `thresholdRatio` idea, tuned up because Atlas's budget already reserves the completion), not at 100% overflow, so the turn that crosses the line no longer pays for emergency compression and the next message starts with headroom; (2) **shrink guard** — a summary that would cost as much as the turns it replaces is not built; the raw turns go out instead (dsh's "strictly smaller" rule; the heuristic summarizer duplicates turn text nearly verbatim, so short spans honestly lose to it); (3) **live compaction notice** — the first send after the boundary deepens emits the existing `compacting` notice ("Compressed N older turns…"), previously only the overflow-retry path announced anything. Renderer: the context hover card gained a segmented composition bar (system/tools/summary/recent/pending, dsh's `ContextMeter` panel strip). Tests: pressure line, shrink guard, guard-aware fixtures in runtime suites. **Deferred:** durable transcript marker row (dsh `CompactionItem` — needs a persisted part/activity and transcript placement, own session), manual `/compact` (needs slash-command + forced-walk IPC).

1. **Subagent S1–S4 "breakage" fixed** — all 31 failures were one root cause: those suites imported `better-sqlite3` directly, which is compiled against Electron's Node ABI and cannot load under plain Node (`ERR_DLOPEN_FAILED`). Zero product bugs. Fix: shared `tests/helpers/sqliteTestDb.ts` (`node:sqlite` behind the three-method repo surface), four suites converted. Full suite green: **1433 pass / 0 fail / 2 intentional skips**.
2. **KV-cache prefix-stable dynamic context shipped.** The compaction handoff moved out of the system prompt into a positioned history message (after preface, before kept turns) via `ContextManager`. The system prompt is now byte-stable for the life of a conversation; when the compaction boundary shifts, only the request tail re-pays instead of re-keying the cache at position 0. Handoff bytes are deterministic given (fingerprint, mode) — regression-tested. `measureContextUsage` accounting unchanged (addendum still its own bucket).
3. **Issue sweep against dsh/t3code patterns (all shipped, all tested):**
   - *Queue dies on restart* → durable followup queue (`turn.followup_queued/started/cancelled` events; `resumePersistedFollowups()` folds at boot and auto-drains — dsh's durable-inbox shape). Snapshot exposes `pendingFollowups`; renderer dock rebuilds after its own restart.
   - *Cancel-queued refetch storm* → queued draft + `aborted` ⇒ drop draft and return; no page/list/stats/diagnostics roundtrips for a row that never existed.
   - *"Streaming" lie while queued* → `DraftState.status: 'queued'`; first event for its requestId promotes to streaming; `StreamingRow` renders nothing for queued drafts (the QueueDock owns the waiting state); Esc/stop don't hijack.
   - *KV tail churn* → sticky per-(conversation, mode) compaction boundary: frozen across turns, moves only under budget pressure or fork-shrink; mode escalation can't clobber another mode's warm boundary.
   - *Header growth* → `pruneRequestHeaders(keep=100)` window-function delete, run every 25th envelope write.
   - Followup lifecycle events hidden from the work log (`deriveWorkLogEntry` returns null) — the dock renders that state, not the transcript.

## Remaining known issues (not fixed here)

- Scroll-edge fade + QueueDock pixels unverified in the running app (no Electron preview in this environment).
- Resume cursor N/A for now: Atlas's provider calls are stateless BYOK requests; there is nothing server-side to resume into. Restart mid-turn stays "interrupted", user resends.
- Hygiene: ~45 files uncommitted across sessions (commit in logical chunks next); root junk (`Atlas_codebase.txt` 5.5 MB, `.snap-tmp.mjs`, empty `mesh-bundle/`); no lint script; zero React-tree tests (store reducers well covered).

## Item-3 candidates, scoped for next session

Both are builds needing visual verification in the running app — do not land blind:

- **Timeline minimap** (t3code): left-rail jump scrubber beside the transcript virtualizer. Needs: row-position source from `useVirtualizer` (virtual items already measured), tick widths shrinking by distance from hovered item, `data-in-view` sync on scroll, keyboard nav (arrows/Home/End/Enter), glass preview card. Est. ~250 LOC + integration into `ChatWindow`'s scroll container.
- **Concession-chain layout solver** (dsh `columns.ts` port): pure function over min/max/default widths with auto-collapse under pressure and preference preservation. Atlas's panes differ from dsh's AppFrame — map onto sidebar + workbench panel first, transcript stays center-fixed. Drag-handle CSS rules carry over verbatim: pause grid transitions during drag, keep collapsed pane mounted at width 0.

Phase notes:
- Atlas was already further along than the research assumed: `conversation_events` is a seq-contiguous append-only log, compaction is request-copy-only (never mutates the transcript), checkpoints per turn exist, and the summary cache has a fingerprint crash lock. The dsh surface-projection design is therefore *not* needed as-is — the remaining value was in loop semantics, not storage.
- Phase 2 findings: the renderer had already absorbed most planned steals independently — Streamdown covers incremental markdown, `@tanstack/react-virtual` powers the transcript, ToolCell is Codex-parity (group folding + hover-chevron + disclosure), and styles.css already has duty-cycled `steps()` motion. Glass utilities were **rejected**: they fight the flat Codex-parity direction in `docs/codex-parity/`. Shipped instead: draft/event requestId-scoping (queued followups no longer swallow the running turn's tokens or get killed by its terminal events), `queuedByConversation` store slice with central event-driven pruning, QueueDock above the composer, and a bottom scroll-edge fade tied to the jump-button's hysteresis.
- Known pre-existing breakage: subagent suites S1–S4 fail on clean HEAD (31 tests). Unrelated to this work; fix separately.
- Deferred by design: KV-cache prefix stability needs the addendum moved out of the system prompt into appended snapshot messages — behavioral change, own PR.
