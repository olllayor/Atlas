# Firsthand visual findings — Atlas, current build

Captured from the standalone renderer preview (`scripts/uiPreview/`), 1512×945 @2x,
theme `xai` / dark. Screenshots in `docs/codex-parity/shots/current/`.

These are observations made directly from rendered pixels, not from reading source.
They complement `current-state.md` (source audit) and feed `gap-analysis.md`.

## How to reproduce

```bash
node_modules/.bin/vite --config scripts/uiPreview/vite.preview.config.ts   # terminal 1
node scripts/uiPreview/snapshot.mjs                                        # terminal 2
```

Scenes: `chat`, `chat-empty`, `tool-timeline`, `tool-timeline-mid`, `tool-expanded`,
`composer`, `model-selector`, `command-palette`, `settings`.
Override output dir with `OUT=docs/codex-parity/shots/after`.

## Shell

- Two-column shell: fixed sidebar (~372px @2x ⇒ 186 CSS px) + main column. **Sidebar is
  not resizable and the drag handle has no hit target.**
- Top bar is a single line: conversation title · model display name. No breadcrumb, no
  per-session status, no actions.
- No right-hand panel of any kind (no diff pane, no terminal pane, no preview pane).
- Sidebar sections: New chat, Sites, CONVERSATIONS list, Settings pinned bottom-left.

## Tool timeline (`tool-timeline.png`) — the weakest surface

Each tool call is a **single-line row**: `● <title> <inline raw output preview> [BADGE] ›`

1. **Title truncation is broken.** Rows render as `E…` and `R…` — the title collapses to
   one or two characters while the untruncated output preview consumes the row. The title
   is the single most important token in the row and it is the first thing dropped.
2. **No per-tool iconography.** Every call gets the same coloured dot. A bash run, a file
   edit, a grep and a web search are visually identical.
3. **Command output is not terminal-styled.** Expanding a `bash` call shows an `INPUT`
   panel wrapping a `JSON` panel containing `{"command": "pnpm typecheck"}`, plus
   Copy/Download buttons — three nested bordered boxes to convey one command string.
   There is no `$ pnpm typecheck` line and no stdout/stderr distinction.
4. **Diffs are not diffs.** The `apply_patch` call renders its unified-diff output as
   undifferentiated inline body text — no `+`/`−` line colouring, no per-file header, no
   `+n −m` summary, no gutter.
5. **No per-call duration.** Nothing distinguishes a 40ms grep from a 40s test run, and a
   long-running call is indistinguishable from a stalled one.
6. **Status badges contradict the established theme.** Solid-fill colour-coded pills
   (`DONE` green, `ERROR` red, `RUNNING` blue, `NEEDS APPROVAL` amber) sit inside a design
   system that `MIGRATION.md` Phase 7 explicitly moved to monochrome. Two systems coexist.
7. **Approval is a passive badge, not a prompt.** The `NEEDS APPROVAL` row shows the risk
   reason as inline preview text but exposes no Allow/Deny affordance in the collapsed
   row — the decision is buried behind an expand.
8. **Nesting depth.** Expanded error state is: row → INPUT panel → JSON panel → code area,
   then a sibling ERROR panel. Four border levels for two pieces of information.
9. `Jump to latest` pill floats over transcript content rather than docking clear of it.

## Reasoning (`tool-timeline.png`)

- Rendered as a bordered card titled **"Thought process"** with subtitle "Reasoning notes"
  and a `42s` badge. That `42s` is the message `latencyMs` — total turn latency — displayed
  on the reasoning block as if it were reasoning duration. Misattributed.
- Visually heavier than the tool rows beneath it, inverting the intended hierarchy:
  thinking should recede, actions should lead.

## Composer (`composer.png`)

- **Double border when focused**: the composer container has a border and the inner
  textarea draws its own focus ring, producing two concentric rounded rectangles.
- Context meter renders as a bare **`9.8`** chip with no unit, no label, no tooltip.
- Model control shows the **raw model id** (`anthropic/claude-sonnet-4.5`) while the top
  bar shows the **display label** (`Claude Sonnet 4.5`) for the same model.
- Approval-mode control ("Ask first") is a quiet text dropdown with no visual weight,
  despite being the highest-consequence control in the composer.
- Submit button is a bare `↵` glyph with no accessible label visible.

## Model selector (`model-selector.png`)

- Opens as a centred dialog with a search field, a `FREE ONLY | ALL` segmented control, a
  provider-grouped list, and a `Manage providers` footer action. Structurally sound.
- **Double border again**: the dialog draws a border and the search input draws its own
  inset ring, so the top of the dialog reads as two stacked rectangles.
- Dialog has **no heading** — nothing names the surface for a screen reader or for a user
  who opened it by accident.
- Capability badges (`TOOLS`, `VISION`, `FREE`) are outlined boxes of differing widths that
  wrap onto a second line, so `FREE` sits below and right of `TOOLS` rather than aligning.
- Selected row is indicated by a check glyph plus a faint fill; the fill is close enough to
  the hover fill that selection and hover are hard to tell apart.
- The scrim is very light, so the dialog does not detach from the transcript behind it.

## Empty state (`chat-empty.png`)

- Centred "What can I help with?" + six generic suggestion cards (Explain a concept,
  Write code, Debug an error, Summarize text, Help me write, Research something).
- Generic assistant copy — none of it is task/agent oriented, and the cards do not reflect
  anything Atlas can actually do better than a plain chat box.
- Three capability chips (Drop files / Paste images / Tools enabled) read as static labels,
  not controls.

## Settings (`settings.png`)

- Already the most Codex-shaped surface: left rail (General, Model settings, Appearance,
  Keyboard, Privacy, Usage) + a `SOON` group (Configuration, Personalization, MCP servers,
  Git, Environments, Worktrees, Archived threads).
- Row pattern (title + description + right-aligned control) is consistent and reusable —
  this is the pattern worth propagating to the rest of the app.
- The `Free models by default` switch renders as a plain white square with no track,
  reading as a checkbox rather than a switch.

## Cross-cutting

- Border radius is effectively 0 everywhere (xAI theme) except the status badges and the
  `Jump to latest` pill, which are rounded — inconsistent.
- Colour usage splits into two vocabularies: monochrome chrome vs. saturated semantic
  badges, with no shared scale between them.
- No focus-visible ring observed on the sidebar conversation rows.

## Non-visual bug found while building the harness

History pagination is dropped on the click-to-open path, but not at boot.

- Boot path: `buildBootstrapConversationDetails` (`useAppStore.ts:1110-1132`) explicitly
  carries `detail.hasOlder` / `detail.nextCursor` through. Correct.
- Click path: `loadConversation` (`useAppStore.ts:439-459`) awaits both
  `conversations.getPage` and `chat.getRuntimeState`, then passes **only** the runtime
  snapshot to `applyRuntimeSnapshotToStore`. That reducer
  (`streamEventReducers.ts:73-86`) sets `hasOlder: existingDetail?.hasOlder ?? false` and
  `nextCursor: existingDetail?.nextCursor ?? null`. For a conversation not already in
  cache `existingDetail` is `undefined`, so both fall back to `false`/`null` and the
  fetched `detail.hasOlder` / `detail.nextCursor` are discarded. `loadOlderMessages`
  (`useAppStore.ts:469-475`) early-returns on `!detail?.hasOlder`.

Net: **"load older messages" can never fire for any conversation opened by clicking it** —
only for the one auto-selected at startup, and only until cache reconciliation evicts it.
The `detail` value is fetched and paid for on every open, then thrown away.

This is data-flow, not presentation. Flagged rather than fixed — it is outside the
UI/UX parity scope and should be a separate change.
