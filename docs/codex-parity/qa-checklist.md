# Phase 5 — QA

> **v2 rebuild (2026-07-29).** After real product frames were captured
> (`shots/reference/`, distilled in `reference-visual-spec.md`), the transcript,
> sidebar, composer, workbench, settings and command palette were rebuilt to match the
> actual app rather than the CLI TUI. Four parallel agents implemented it; verified by
> `tsc` clean, **246/246 tests**, production build, and re-rendered scenes in
> `shots/after-v2/` (before: `shots/before-v2/`). Highlights: TUI `•`/gutter cell
> grammar replaced by dim activity rows + "Changed N files +A −D | Review ›" bar;
> vendored `ai-elements/prompt-input.tsx` (1,477 lines) deleted and the composer
> rebuilt bespoke (opaque `#212121` slab, circular near-white send); sidebar is pure
> black `#000000` with flat nav and title+time rows; header gained the centered
> "Chat | Work" segmented control which now drives the workbench; settings/palette
> de-carded. Net for the v2 pass: 42 files, +1,629 / −3,088. The checklist below
> documents the v1 pass and remains accurate where not superseded above.

Verified against `docs/codex-parity/design-audit.md`, with screenshots in
`docs/codex-parity/shots/current/`.

**Gates:** `npx tsc --noEmit` clean · `node --import tsx --test tests/*.test.ts`
**240 passing, 0 failing** (23 of them new, covering the cell grammar) ·
`pnpm build` succeeds · all 12 preview scenes render with no console errors.

## Checklist

| Item | Status | Notes |
|---|---|---|
| Every screen from the Phase 1 audit has a matching screen | **Partial** | Every screen that maps to an Atlas feature is done. Codex screens with no Atlas backing (parallel-agent list, git/PR flow, devbox) are **not** built — see "Deliberately not built". |
| Design tokens centralised, not hardcoded | **Yes** | **Zero** `text-[Npx]` remain in `src/renderer` (191 → 0) and zero raw palette classes. `themes/codex.css` carries the full contract; accent, ring, diff and per-tool tokens are reachable from components for the first time. Verified by rendering at `uiFontSize` 13 and 18 — see `shots/font-13/` and `shots/font-18/`. |
| All interactive states implemented | **Yes** | Tool cells: queued / running / success / failed / awaiting-approval. Hover, focus-visible, disabled, empty, error on new components. |
| Tool calls render as their own visual units with clear status | **Yes** | Borderless cells, bold verb + subject, glyph-coloured status, `│`/`└` gutters. |
| Approval prompts match the reference pattern | **Yes** | Title, italic `Reason:`, the actual `$ command` shown highlighted, numbered options with single-key accelerators, autofocus on the safe default, Esc to decline. |
| Responsive / resize behaviour | **Yes** | Sidebar and workbench both drag-resizable with persisted width; keyboard-resizable via arrows; min/max clamped. |
| Keyboard shortcuts and accessibility | **Improved** | Focus ring now uses a real `--ring` token instead of a low-contrast border token. Tool region has `aria-live`. Approvals are keyboard-operable and autofocused. Resize handles are `role="separator"` with `aria-valuenow`. |
| No functional regressions | **Yes** | Typecheck, 240 tests, and production build all pass. No IPC channel, store action, or persisted schema was changed. |

## What was built

**Tokens** — `src/renderer/themes/codex.css` (light + dark) ported from OpenAI's own
`visualize.css` contract: `#181818`/`#FFFFFF` bases, `#83C3FF`/`#339CFF` accent, orange
`--destructive`, 12.5px radius with `corner-shape: superellipse(1.5)`, body weight 430,
tint-based elevation (5% fg) with 8% hairlines, 150ms/200ms motion on
`cubic-bezier(0,0,0.2,1)`. Registered as a fourth design theme and made the default;
`xai`, `default` and `cursor` are untouched and still switchable.

**Data plumbing** — `toolType`, `startedAt` and `completedAt` now survive the
envelope→`StreamEvent` downgrade that previously discarded them. Additive only.

**Transcript grammar** — `src/shared/toolCellGrammar.ts` (pure, unit-tested) plus
`components/transcript/`. Verbs (`Ran`/`Running`, `Explored`/`Exploring`, `Edited`,
`Called`, `Searched the web for`), read-coalescing, head/tail output truncation,
per-call duration, unified diffs, terminal blocks, inline approvals.

**Workbench** — `components/workbench/WorkbenchPanel.tsx`. Changes / Terminal / Tasks
tabs in a resizable right panel.

## Deviations from the brief, and why

**The structural panels are backed by real data, not left empty.** You asked for
presentation parity *plus* empty structural shells. Building them literally empty would
have shipped three dead panels. Instead each is wired to data Atlas already has:

- **Changes** — aggregates every `file_change` diff in the thread, deduplicated by path
- **Terminal** — every `command_execution` call as a session command log
- **Tasks** — every tool call with status and duration

Each panel's empty state says plainly what it is showing *and what it is not* (no
repository binding, no PTY, single conversation rather than an agent fleet), so the UI
never implies a capability that isn't there.

## Deliberately not built

Per the Phase 3 scope decision — each is a product feature, not a restyle:
parallel/multi-agent task list, git/PR review flow, environment/devbox controls,
in-app browser preview, `::code-comment` / `::git-*` directive rendering.

## Follow-up pass — all four "known remaining" items closed

1. **Token sweep — done.** 191 hardcoded `text-[Npx]` across 26 files replaced with scale
   tokens; the scale gained `--text-3xs` and `--text-3xl` to absorb the 8–10px and 28px
   outliers. 20 `text-white`/`bg-white`/`bg-black` sites and one `text-slate-500` moved to
   tokens. `src/renderer` now has **zero** hardcoded font sizes and **zero** raw palette
   classes outside the xAI landing page.
   Two deliberate exceptions, both annotated in-place:
   - `SitesWorkspace` preview iframe keeps `bg-white` — it renders the user's own site and
     must not inherit app chrome colours.
   - `components/xai/*` is a fixed-brand marketing surface, not themed chrome.
2. **Dead code — partly deleted, and the audit was wrong.** `tool.tsx` (382),
   `reasoning.tsx` (206) and `confirmation.tsx` (173) are gone; `message.tsx` shrank from
   ~370 lines to 47 and `conversation.tsx` from 145 to 45.
   **Correction:** `current-state.md` §8.6 listed `interactive-diagram.tsx` and
   `rive-visual.tsx` as having "0 importers". That is false — both are imported by
   `visual.tsx` and `visual-gallery.tsx`. They were kept.
   `prompt-input.tsx` (1,477 lines, 82 exports, ~11 used) is still untrimmed: it is a
   vendored kit and picking it apart is high-risk relative to the benefit.
3. **Virtualizer estimates — retuned.** Constants are now named and derived from the cell
   grammar: `estimateHistoryRowHeight` calls `buildToolCells` so it counts *rendered
   cells*, not raw tool parts. That matters because coalescing means six file reads
   produce one cell, and the old code assumed six 52px cards.
4. **Fonts — fixed.** `--font-ui-system` is defined. The unloaded `GeistMono` reference is
   removed from `xai.css` rather than the font added, since nothing depends on Geist.

Also in this pass: empty-state suggestions are now tool-aware — a model that supports tool
calling gets agent-shaped prompts ("Search a codebase", "Run a command", "Track down a
bug"); a model without tool support still gets the generic set, so the UI never suggests
work the selected model cannot do.

## Known remaining

- **`prompt-input.tsx`** — ~70 unused exports in a vendored 1,477-line file (see above).
- **xAI landing page** (`components/xai/*`) — intentionally unthemed brand surface.
- **`--sidebar-expanded` / `--sidebar-collapsed`** — still exported to `@theme` while
  marked deprecated in `styles.css`. Harmless, but dead.

## Non-parity bug found, reported — FIXED

History pagination was dropped on the click-to-open path: `loadConversation`
(`useAppStore.ts:582-650`) fetched `conversations.getPage` and then passed only
the runtime snapshot to `applyRuntimeSnapshotToStore`, which reset `hasOlder` to
`false` (`streamEventReducers.ts:87-91`). Result: **"load older messages" only
ever worked for the conversation auto-selected at startup.** The bootstrap path
handled it correctly.

**Fixed (2026-08-01):** `applyRuntimeSnapshotToStore` gained an optional
`page?: Pick<ConversationPage, 'hasOlder' | 'nextCursor' | 'limit'>` parameter,
and `loadConversation` now passes its `getPage` result through, so pagination
state survives the click-to-open snapshot application. Covered by two new tests
in `tests/streamEventReducers.test.ts` ("keeps page pagination..." and "without a
page keeps the false/null defaults").
