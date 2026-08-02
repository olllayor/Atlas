# Codex — interaction-pattern spec (component & micro-interaction level)

**Compiled:** 2026-08-02 · **Scope:** how the OpenAI Codex app *presents agent actions* and why it
feels clean/modern/minimalist, distilled into implementable micro-interaction patterns for Atlas.

**Evidence:** `design-audit.md`, `reference-visual-spec.md`, `research-raw.md` (all in this
folder), the current Atlas implementation under `src/renderer`, plus live web fetch of
`github.com/openai/codex` and `developers.openai.com/codex`.

**Confidence convention (from research-raw):**
- **[verified]** — read directly from source (openai/codex Rust TUI, snapshot tests, `visualize.css`, official docs).
- **[inferred]** — a reasonable deduction not stated outright.
- **[unknown]** — could not confirm.
- **Atlas:** `src/renderer/...` references mark *current* implementation state and where a pattern applies.

> **Posture.** Codex's clean/minimal look is not an absence of interaction design — it is a
> *borderless grammar*: hierarchy is carried by **typography (weight 400 + opacity tiers) and
> whitespace, not by cards/borders/fills**. Motion is there but heavily restricted: three CSS
> transitions (150/200 ms, Material ease-out) in the whole design token set, one 2 s shimmer.
> The hardest thing to replicate is restraint. (`reference-visual-spec.md §5–6`, `research-raw §8.1`)

---

## 1. Tool-call cells

### Codex behavior (verified + inferred)
- **Borderless inline grammar, one column, no cards/borders/background fills** on tool cells —
  only the session header uses a box. `design-audit.md §1`, `reference-visual-spec.md §5`.
- **CLI grammar:** `• <BOLD VERB> <subject>` + `│`/`└` dim gutter overflow lines. The **verb is
  bold, the subject is not**; no tool-type icons — the verb does that job. `design-audit.md §1–2`.
- **App grammar (supersedes CLI):** each activity phase is **ONE dim summary row** —
  `Thought for 8s`, `Explored 3 files`, `Ran npm test`, `Worked for 45s ›` — ~13–14 px,
  `--text-tertiary`, **weight 400**, no bullet, no gutter bars, no border. `reference-visual-spec.md §5`.
- **Status colour, not status labels:** the CLI conveys success/failure *only* by the glyph/bullet
  colour (green/red bold). No status pills, no uppercase labels, no badges. `design-audit.md §8`.
- **Collapsed by default.** Tools collapse into their summary row; details are revealed on
  click/Enter. Confirmed for the app by GitHub issue `openai/codex#16415` (`design-audit.md §13`).
- **Timing is not per-row in the main view** — elapsed renders inline in the label ("Thought for 8s")
  and only *aggregate* timing appears in the turn footer. `design-audit.md §7`, `reference-visual-spec.md §5`.
- **Running state:** active-form label ("Thinking", "Running npm test") with a text shimmer.
- **Coalescing:** N consecutive reads → one `Explored N files` row (reads merge onto one line, dedup).

### Atlas current state
`ToolCell.tsx` already implements the app grammar correctly: borderless weight-400 tertiary rows,
`motion-shimmer` while running, inline `· {elapsed}`, status conveyed via a **tint on the label text**
(`failed → text-error`, `awaiting-approval → text-warning`) rather than a pill, hover→secondary +
chevron, disclosure animation. Row height seeded in `ChatWindow.tsx:668-682` (`toolCell: 24`).

**Whitespace check to keep Codex-clean:** transcript blocks stay separated by ~16–20 px whitespace
with *no dividers anywhere* (`reference-visual-spec.md §6`). Verify Atlas isn't drifting toward
hairline separators between cells as it grows.

---

## 2. Reasoning / thinking blocks

### Codex behavior
- **Reasoning is just another dim activity row** — no card, no icon, no "Thought process" heading.
  `design-audit.md §6`.
- **The differentiator is the absence of a verb**: reasoning uses the same dim prefix as tool
  cells but no bold verb. `research-raw §10.8`.
- **Collapsed by default**, even while streaming — the resting state is the shimmering `Thinking`
  label. Click expands the reasoning text inline, indented, dim. `reference-visual-spec.md §5`.
- **Collapse affordance = hiding, not truncation:** the CLI's `transcript_only` flag renders
  reasoning *nothing* in the main view, visible only in the full transcript. `research-raw §10.8`.
- **Empty reasoning summaries are suppressed entirely** (`rust-v0.145.0`, #31652). `research-raw §8.3/10.8`.

### Atlas current state
`ReasoningCell.tsx` matches well: collapsed default, shimmer "Thinking", `Thought for {elapsed}`,
expand via `Disclosure`. Timing is measured into the transcript store so it survives virtualizer
unmount; historical rows fall back to bare `Thought`. Empty-suppression exists (line 80).

---

## 3. Streaming (text / tokens)

### Codex behavior (verified)
- **Incremental markdown rendering** — render as tokens arrive, keep completed content stable.
  `rust-v0.145.0`: "incremental Markdown rendering, fewer redraws, caching, and bounded command
  output." `research-raw §8.3`.
- **No fidget / stable layout:** streaming rows are pre-sized so the scrollbar thumb doesn't lie;
  the CLI commits completed lines to scrollback rather than repainting. `research-raw §8.3`.
- **The shimmer is the only "live" affordance** on in-flight text — a light band sweeping left→right
  once every **2 s**, Hann falloff over a ~5-char band, pulling text toward bg up to 90%; phase-locked
  globally so all shimmering elements move together. `research-raw §8.2`, `design-audit.md §10`.
- **Stick-to-bottom** must not steal the wheel: the CLI pauses/resumes its timer and the user's
  scroll position is respected.

### Atlas current state
- Unread/completed-content stability is handled by the virtualizer (`ChatWindow.tsx`) — measurement
  calibration, `shouldAdjustScrollPositionOnItemSizeChange`, no upper clamps on estimates
  (`ChatWindow.tsx:650-716`), instant scroll on send gated on `isAtBottom` (`:1023-1042`).
- `useStickToBottom` configured `initial: 'instant', resize: 'instant'` (`:800-808`) **so expanding
  a cell never animates the transcript away from the clicked row** — this correctly mirrors Codex's
  "no fidget" rule.
- Shimmer is a faithful CSS gradient sweep (@`styles.css:514-545`): 2 s, 200% background travel,
  `-webkit-text-fill-color` trick. Reduced-motion collapses to a static dim mark (`styles.css:567`, `:908-915`).
- **Watch:** the 0→6px scrollbar width animation that caused reflow was removed (`styles.css:588-591`)
  in favor of constant width + thumb-only fade (`:637-656`) — this is exactly the Codex stable-layout rule.

---

## 4. Approvals & confirmations

### Codex behavior (verified)
- **Inline in the transcript, not a hard modal** (in the CLI at least; app treatment is [unknown],
  see GAP below). Header rows before the question, in order: `Thread:`, `Environment:`, `Reason:`,
  `Permission rule:` (cyan), then `$ {highlighted command}`. `research-raw §9.3`.
- **Copy — exec:** *"Would you like to run the following command?"* · **patch:** *"Would you like to
  make the following edits?"*. `research-raw §9.3`.
- **Options (verbatim):** `1. Yes, proceed (y)` · `2. Yes, and don't ask again for … (p)` ·
  `3. No, and tell Codex what to do differently (esc)`. Footer: **`Press enter to confirm or esc to cancel`**.
- **Keyboard:** `y`/`enter` approve-scope, `p` approve-session, **`esc` denies** ("No, and tell the
  model what to do differently"). Auto-focus the safe default (`y`/enter — least-risk path that keeps
  work moving) so the decision is reachable without a mouse.
- **Scope disclosure is explicit in the option copy** ("don't ask again for commands that start
  with…" / "for this tool this session").
- **Decision receipts** render as transcript lines: `✔ You approved codex to run <cmd> this time` /
  `✗ You did not approve codex to run <cmd>`. `research-raw §9.4`.
- Destructive intent gets a **second confirmation gate** with explicit risk ("Enable full access? …
  This significantly increases the risk of data loss…"). `research-raw §6.6`.

### Atlas current state
`ApprovalPrompt` in `ToolCell.tsx:460-578` already implements: autofocus safe default once-per-prompt
only (`focusedApprovals` Set + `isTypingElsewhere` guard, `:447-484`), `y`/`a`/`esc` keys match the
advertised hints, exact approval command shown as a `$`-prefixed dim mono line (no slab), borderless
row options. Good parity.

**Tighten to match Codex copy/grammar:**
- Consider adding scope header rows (`Reason:` already there, `:534`; add `Environment:`/`Thread:` if
  those exist in Atlas's context) before the command line.
- Add **decision receipts** after resolution (a `✔`/`✗` trace line in the cell when it closes) —
  currently the prompt just disappears on approve.
- Verify the composer gets focus back after a decision so typing isn't interrupted.

---

## 5. Diff rendering

### Codex behavior (verified)
- **Unified, never side-by-side.** `{right-aligned line number}{space}{sign}{content}`.
  `design-audit.md §5`.
- **+/- gutters and colours use GitHub's palette:** dark `#213A2B` add bg / `#4A221D` del bg
  (`research-raw §3.3`), with the semantic *error* orange reserved for errors — diff counts are
  green/red even though fail is orange. `reference-visual-spec.md §5`, `design-audit.md §5`.
- **Collapsed long output:** CLI uses head/tail truncation with `… +N lines (ctrl + t to view
  transcript)`. `design-audit.md §4`. The app's "Changed N files" bar is a separate collapsed summary.
- **Copy affordance:** Codex diff surfaces provide copy on hover/focus. (Atlas has this.)
- **Non-adjacent hunks** separated by a lone `⋮`. Line numbers: old on delete, new on insert,
  shared on context. `research-raw §10.6`.

### Atlas current state
`DiffBlock.tsx` already does all of this correctly: `whitespace-pre` + real horizontal scroller,
gutter width adapts to largest number, `⋮` gaps with sr-only label, `bg-diff-*` tokens carrying
GitHub palette, 400-row cap with a `Show {n} more diff lines` button (button, not dead text — fixed
vs. the audit's finding), copy button hover/focus revealed, `sr-only` "Added:/Removed:" for screen
readers, MINUS is U+2212 for column alignment. `ChangedFilesBar.tsx` gives the end-of-turn bar with
`+N`/`−M` counts and `Review` → per-file rows.

**Gap:** the terminal/diff `… +N lines` affordance was static text (audit finding #10); `TerminalBlock`
and `DiffBlock` now make them real expand buttons — verify both are reachable by keyboard (they are
`<button>`) and by focus-reveal (they are).

---

## 6. Hover / focus / active states

### Codex behavior (verified / inferred)
- **Focus ring:** `outline: 2px solid var(--ring)` (#339CFF dark) with `outline-offset: 2px`
  (`research-raw §3.1`, `.focus-visible` at `visualize.css`). **Ring must not change the element's
  border-radius** (that's what caused circular buttons to snap square in Atlas).
- **Hover-revealed controls:** the app's transcript rows dim at rest and **promote to secondary text
  + a trailing `›` chevron on hover**; artwork/code chrome (copy buttons) is opacity-0 until
  hover *or* focus-within. `reference-visual-spec.md §5`.
- **Hit targets:** web controls min-height 28px (`design-audit.md §11`); checkbox 14×14, switch
  32×20/16 thumb — 4px base grid with 2px sub-step.
- **Hover vs. theme tint are distinct:** hover reveals *secondary text* + chevron on transcript rows;
  selection uses `--bg-active`; hover uses `--bg-hover`. These are separate vocabularies
  (`design-audit.md`, `reference-visual-spec.md §3`).

### Atlas current state
- Global focus-visible ring correction is already in (`styles.css:462-465` — no border-radius,
  outline follows element radius). 
- Row hover/active: `ToolCell.tsx:240-254` (secondary + chevron on hover) and `hover:bg-bg-hover` /
  `bg-bg-active` across the app. CodeBlock/Terminal/Diff copy buttons are `opacity-0`
  `group-hover:*:opacity-100 group-focus-within:*:opacity-100` — matches the hover-or-focus rule.
- **Audit rule #2** ("hover-revealed must also reveal on focus") is the contract to keep — verify any
  new `opacity-0 group-hover:` element also gets `group-focus-within:`.

---

## 7. Motion

### Codex behavior (verified / inferred)
- **Deliberately minimal.** The entire token set has three transitions: switch track
  `background-color 200ms`, switch thumb `transform 200ms`, check inputs `150ms` for
  color/border/shadow — all **`cubic-bezier(0,0,0.2,1)`** (Material decelerate/ease-out).
  `research-raw §8.1`.
- **What animates:** state changes (color/border/box-shadow) at 150 ms, positional (thumb) at 200 ms,
  the running shimmer at 2 s. **What does not:** scrollbar width (never — jank), transcript layout on
  streaming, toasts' underlying content.
- **Reduced motion is app-level, not per-stylesheet** (no `prefers-reduced-motion` block in
  `visualize.css`; gated by `[tui] animations`, default on). The CLI degrades shimmer→static dim and
  hides/staticizes the activity bullet. `research-raw §8.1–8.2`.
- **Reveal/expand** in the app is an inline unfold (indent + disclose), not a modal pop.

### Atlas current state
- `Disclosure` (`ToolCell.tsx:67-104`): 160 ms `grid-template-rows 0fr→1fr` ease-out,
  `motion-reduce:transition-none`, children stay mounted during collapse then unmount. Consistent
  across tool cells / reasoning / changed-files bar.
- Motion tokens: `:where(button,…)` house default `transition-property` (color/bg/border/opacity/
  transform) + `--duration-fast` @ `styles.css:491-495`; reduced-motion resolved attribute kills all
  animation/transition at `styles.css:908-915`.
- Codex directionally uses ~150–200 ms; Atlas uses `--duration-fast` (likely ~150 ms) and 160 ms
  disclosure — **already on-curve**. Keep chevron rotations <= 160–200 ms.

---

## 8. Empty, loading, error states

### Codex behavior (verified)
- **Empty state:** ghost logo (`--text-faint` outline) above a ~28 px regular-weight greeting
  ("What should we get done?" / "What should we build?" — the live docs page shows the latter);
  composer sits mid-screen below; suggestion chips optional. `reference-visual-spec.md §4`.
- **Empty exec output:** literal dim `(no output)`. `research-raw §9.6`.
- **Empty agent list:** `No agents completed yet`. `research-raw §9.6`.
- **Error / interruption:** `■` prefix + a single plain line ("Conversation interrupted — tell the
  model what to do differently…"), or the policy block `ⓘ This content can't be shown…`.
  `research-raw §9.6`.
- **Status header while working:** `• Working (0s • esc to interrupt)`, alternate headers
  `Analyzing`, `Reviewing {n} approval requests`. `research-raw §9.1`.
- **Loading:** welcome ASCII animation when `animations_enabled`; graceful text fallback otherwise.
  `research-raw §8.4`.

### Atlas current state
- `ConversationEmptyState` (`conversation.tsx`) — but the *Codex* shape (ghost logo + centered
  greeting + mid-screen composer) is the one to chase per `reference-visual-spec.md §4`; confirm
  Atlas's current empty state matches. Composer placeholder is already "Do anything" (`Composer.tsx:1025`).
- `(no output)` explicit marker: `ToolCell.tsx:355`. Status region for screen readers:
  `ToolCell.tsx:144-146` (aria-live, success/failure only — mirrors "announce terminal transitions").
- **Error render:** tool `error` detail is a dim red mono `pre` (`ToolCell.tsx:337-344`).
- Gate any loading shimmer/welcome behind `data-reduce-motion` (already the `[data-reduce-motion]`
  attribute does this globally).

---

# Prioritized INTERACTION PATTERN SPEC (by impact)

Ordered by expected impact on the clean/modern/minimal feel, with **concrete behavior** and the
**Atlas file** each applies to. Items marked ✅ are already implemented to spec — keep an eye that
they stay that way.

## P0 — the grammar (biggest perceived lift)

**P0-1 · Borderless activity rows with weight-400 opacity hierarchy** ✅
Behavior: every agent action is one dim (`--text-tertiary`) weight-400 summary row; no card, no
border, no bullet, no gutter bars, no fill; hover promotes to `--text-secondary` + trailing `›`;
running rows get the shimmer; failed/awaiting rows tint the *label text* (error/warning), never a pill.
Atlas: `ToolCell.tsx`, `ReasoningCell.tsx`. **Now:** do not reintroduce cards/borders as new cells
are added (e.g. artifacts, MCP tools).

**P0-2 · Coalescing read-only calls** ✅
Behavior: N consecutive reads → one `Explored {n} files` row; reads dedup onto single lines.
Atlas: `buildToolCells` (shared grammar) + `ChatWindow.tsx:702`. **Now:** keep the virtualizer's
row-height estimate using actual cell counts, not parts counts.

## P1 — interaction feel

**P1-1 · No-fidget streaming + honest stick-to-bottom** ✅
Behavior: instant scroll, gated on `isAtBottom`; expanding a cell never animates the transcript
away from the clicked row; completed content never repaints/shuffles; constant-width scrollbar
(thumb-only fade). Atlas: `ChatWindow.tsx:793-808, 1023-1042`; `styles.css:637-656`; `code block
overflow` handling. **Now:** guard any future `<pre>` that adds `overflow-x-auto` — it may compute
`overflow-y:auto` and steal wheel-escape (audit finding; re-check `CodeBlock.tsx:399`,
`ToolCell.tsx:396`, `TerminalBlock.tsx:225`).

**P1-2 · Shimmer = the *only* "working" affordance** ✅
Behavior: 2 s left→right sweep, Hann falloff, phase-locked across all shimmering text; reduced-motion
→ static dim, not removed. Atlas: `styles.css:514-567`. **Now:** keep the 2 s period and direction;
do not add spinners/rotating glyphs beside shimmer rows (spinner ring is reserved for Workbench task
"running", `reference-visual-spec.md §5-task-lists`).

**P1-3 · Disclosure expands at 160 ms, ease-out, reduced-motion-aware** ✅
Behavior: `grid-template-rows 0fr→1fr`; children mount for the closing animation then unmount so
long diffs don't stay mounted. Atlas: `Disclosure` in `ToolCell.tsx:67-104`. **Now:** apply the same
disclosure to any new inline detail (already shared by reasoning + changed-files bar).

**P1-4 · Focus ring never changes radius** ✅
Behavior: 2 px `--ring` outline, `outline-offset: 2px`, follows the element's own radius; composer
field exempt (slab is the affordance). Atlas: `styles.css:462-473`.

## P2 — safety & fidelity

**P2-5 · Approval: explicit scope + decision receipts** ⚠️ (partially done)
Behavior: show `Reason`/`Environment` header rows above the `$`-command; options are `Yes, proceed
(y)` / `Yes, and don't ask again… (session)` / `No, and tell the model… (esc)`; autofocus the safe
default ONCE per prompt (never from under the composer caret); on resolution append a `✔`/`✗` trace
line ("You approved codex to run <cmd> this time") instead of just vanishing; return focus to the
composer afterward.
Atlas: `ApprovalPrompt` in `ToolCell.tsx:460-578`. **Do:** add the decision-receipt trace line and
composer refocus; keep the once-only autofocus.

**P2-6 · Long output is collapsible, not dead text** ✅
Behavior: `… +N lines` is a real button that expands in place (terminal scrolls within the block,
diff caps at 400 then shows "Show N more diff lines"); copy is hover/focus-revealed and produces a
`git apply`-ready patch. Atlas: `TerminalBlock.tsx:236-259`, `DiffBlock.tsx:61-127`. **Now:** verify
copy-composed patches use ASCII signs (DiffBlock already maps U+2212 display → ASCII in `patchText`).

**P2-7 · Status is colour+glyph, never a badge** ✅
Behavior: success/failure is conveyed by tint/colour, not a status pill or uppercase label; empty
output is explicit `(no output)`; per-row timing only inline when >1 s elapsed.
Atlas: `ToolCell.tsx:46-49, 204-235`.

## P3 — polish (low effort, high perceived quality)

**P3-8 · Turn-boundary rule for turns that did concrete work**
Behavior: a turn that ran commands/edited files ends with a thin dim rule (`─`); purely conversational
turns get none; turns > 60 s get a labeled rule `─ Worked for 2m 05s ─`. `research-raw §10.9`.
Atlas: add to the turn-separator logic in `ChatWindow.tsx` (currently none). Cheap and reads very
"Codex".

**P3-9 · Empty state = ghost logo + centered greeting + mid-screen composer**
Behavior: replicate `reference-visual-spec.md §4` — outline logo (`--text-faint`), ~28 px
regular-weight greeting, composer floating mid-screen, suggestion chips optional.
Atlas: replace/align `ConversationEmptyState` (`ai-elements/conversation.tsx`).

**P3-10 · Hover-reveal controls must also reveal on focus** ⚠️ (audit rule #2)
Behavior: every `opacity-0 group-hover:opacity-100` needs `group-focus-within:opacity-100` +
`:focus-visible:opacity-100` so keyboard users can reach copy/chevrons.
Atlas: `CodeBlock.tsx:364`, `TerminalBlock.tsx:215`, `DiffBlock.tsx:81`, `ToolCell.tsx:230`,
`ReasoningCell.tsx:112`. **Do:** audit the four `group-*` containers above — they already do this;
verify new ones do too.

---

## Gaps still open ([unknown]) — don't invent these
1. Whether the *app's* approval prompt is inline-or-modal, and the verbatim app option list.
2. Desktop-app transcript vs. card re-skin — `#16415` is consistent with the borderless view Atlas uses.
3. Whether the app uses a licensed display face (e.g. "OpenAI Sans") vs. system stack.
4. Per-tool glyph choices (only Lucide `stroke-width:1.6` is confirmed).
5. Completion notification (badge / toast / sound) in-app.

**Sources (primary):** `openai/codex` Rust TUI + 613 snapshot tests (verified values),
`visualize.css` token contract, `git_action_directives.rs` (app-rendering evidence), official docs at
`learn.chatgpt.com/docs/app` / `developers.openai.com/codex`, and the captured app frames in
`docs/codex-parity/shots/reference/`.
