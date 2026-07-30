# Gap analysis — Atlas → Codex

Sources: `design-audit.md` (Codex spec) · `research-raw.md` (cited evidence) ·
`current-state.md` (Atlas source audit) · `visual-findings.md` (rendered-pixel audit).

---

## 0. The framing problem, stated first

**Atlas and Codex are not the same kind of application.**

Codex is a coding agent workbench: projects, threads, a workspace on disk, git, diffs, a
terminal, code review. Atlas is a **BYOK multi-provider chat client** with a local tool
runtime (`read_file`, `grep_search`, `glob_search`, `web_search`, `web_fetch`, `bash`,
`get_current_time`, `search_model_catalog`) plus a Sites workspace and a visuals gallery.

So "visual and interaction parity with Codex" splits cleanly into two very different asks:

| | What it means | Recommendation |
|---|---|---|
| **A. Presentation parity** | Adopt Codex's design language and — critically — its **transcript grammar** for the agent actions Atlas already performs. | **Do this. It is the whole win.** Zero new features; every element maps onto data Atlas already has. |
| **B. Structural parity** | Build Codex's *shells*: multi-agent/parallel task list, right-hand diff panel, integrated terminal, git/PR flow, environment/devbox controls, in-app browser. | **Do not do this as part of a UI migration.** Atlas has no agent fleet, no git integration, no devbox, and no workspace-on-disk to diff. These are product features wearing a UI costume. |

The original brief lists B's elements as "known structural elements to expect". They are
real Codex features — but in Atlas they would be **empty chrome**. A diff panel with no
repository, a parallel-task list with one task, a terminal panel with no PTY.

**I am proceeding with A in full, and flagging each B item below rather than building it.**
If you want any B item for real, it is a feature project and should be scoped as one.

One caveat worth stating plainly: the Codex desktop app's own panel geometry is
**unverified** (`design-audit.md` §"Unverifiable"). Its *transcript grammar* is verified
down to snapshot tests. That is a second, independent reason to weight A over B — we know
what A looks like and we are guessing at B.

---

## 1. Screen mapping

| Atlas screen | Closest Codex equivalent | Verdict |
|---|---|---|
| Chat transcript (`ChatWindow`) | Codex transcript / thread view | **Direct map.** The core of the work. |
| Tool rows in transcript | Exec / Explored / Edited / MCP cells | **Direct map, total rewrite of presentation.** |
| Reasoning block | Reasoning summary cell | **Direct map, drastic simplification.** |
| Composer | CLI composer + footer | **Direct map.** |
| Sidebar conversation list | Threads list | **Direct map.** |
| Settings workspace | Codex settings | **Already closest to parity.** Keep, retint. |
| Model selector dialog | `/model` picker popup | Direct map, minor. |
| Command palette | App command palette | Direct map; Codex's is `[unknown]`, keep ours. |
| Sites workspace | *(no equivalent)* | Atlas-only. Retint with tokens, no restructure. |
| Visual gallery | Artifacts viewer (loosely) | Atlas-only in practice. Retint only. |
| Landing page (`XAILandingPage`) | *(no equivalent)* | Atlas-only. Out of scope. |
| Onboarding | Codex welcome/onboarding | Retint only. |
| — | **Parallel/multi-agent task list** | **No Atlas equivalent.** Not building. |
| — | **Right-hand diff panel** | **No repo to diff.** Not building. |
| — | **Integrated terminal panel** | **No PTY.** Not building. |
| — | **Git / PR review flow** | **No git integration.** Not building. |
| — | **Environment / devbox controls** | **No devbox.** Not building. |
| — | **In-app browser preview** | Sites preview exists and is closer to this than a Codex clone would be. Not building. |

---

## P0 — Structural / layout

Things where the *arrangement of information* is wrong, not its styling.

### P0-1 · Replace the tool-call card with the Codex cell grammar
**The single highest-value change in this document.**

Codex: borderless inline block, `• ` + **bold verb** + subject, detail under a `└` gutter,
no card, no border, no badge (`design-audit.md` §1).
Atlas: `ToolRow` (`ChatWindow.tsx:175-368`) — rounded container, 1px rail, 7px dot,
uppercase colored status pill, nested bordered panels on expand.

Required:
- Drop the row container, the badge, and the nested `Input`/`Output` panel boxes.
- Adopt glyph + bold verb + subject. Verb from `CanonicalToolType`, not the raw tool name
  (today `read_file` renders as the literal string "read file").
- Detail lines under a real 4-column `└` / `│` gutter.
- Status becomes **glyph colour**, not a pill.

Blocked by P0-2.

### P0-2 · Thread `toolType` (and timing) through to the renderer
`CanonicalToolType` is computed in the main process (`runtimeActivity.ts:22-56`) and then
**thrown away**: `applyRuntimeEventToMessageParts` downgrades every envelope back into a
legacy `StreamEvent`, and `toolType`, `tone`, `sequence`, `createdAt`/`updatedAt`,
`isFinal` and `turnId` are all dropped at that boundary
(`current-state.md` §5.1). `grep toolType src/renderer` returns nothing.

Without this, per-verb rendering, per-tool grouping, and per-call timing are all
impossible. **This is a data-plumbing prerequisite, and it is the one place I will touch
non-presentational code.** It adds fields to an existing part type; it changes no IPC
channel, no business logic, and no persisted schema.

### P0-3 · Coalesce read-only calls into one `Explored` cell
Codex: N consecutive reads = **one line**, deduplicated, dim-comma joined
(`design-audit.md` §3). Atlas: N flat sibling rows.

On a turn that reads six files, Atlas currently renders six bordered cards where Codex
renders one line. This is the difference between a transcript that scans and one that
doesn't.

### P0-4 · Turn boundaries
Codex closes any turn that **did work** with a full-width rule, labeled
`─ Worked for 2m 05s ────…` when over 60 s (`design-audit.md` §7). Purely conversational
turns get none. Atlas has no turn concept in the UI at all — messages just stack.

### P0-5 · Reasoning must recede, not dominate
Codex: same `• ` prefix as everything else, **no verb, no card, no icon, no title** — the
absence of a verb *is* the differentiator (`design-audit.md` §6).
Atlas: a bordered card, a 36px icon box, a `BrushSpinner`, the title "Thought process",
the subtitle "Reasoning notes", and a duration chip — visually heavier than the actions
beneath it (`visual-findings.md`). Hierarchy is inverted.

Also: the duration chip is seeded from the message's `latencyMs` (`ChatWindow.tsx:166`),
i.e. **total turn latency mislabeled as reasoning time**.

### P0-6 · Sidebar defects
- Not resizable, no drag handle anywhere in the codebase (`current-state.md` §1.3).
- Collapsed rail **shows no conversations at all** — a dead 72px column with two buttons.
- Collapsed rail **overlaps the macOS traffic lights** (the `w-20` spacer exists only in
  the expanded branch, `Sidebar.tsx:99` vs `:95`).
- Collapse state is local React state (`App.tsx:123`), so it does not persist.

### P0-7 · Content width is three uncoordinated systems
`--content-max: clamp(680px, 102vw, 860px)`, assistant `min(100%, 76ch)`, user
`min(56%, 560px)` — in one column (`current-state.md` §1.5). Codex uses one measure.

### P0-8 · Titlebar border vanishes when the sidebar collapses
`App.tsx:756` gates the main-panel bottom border on sidebar expansion.

---

## P1 — Visual system (tokens)

The token layer exists and is **defined but not enforced**. This is the second-largest
cluster of work and it is almost entirely mechanical.

### P1-1 · Radius is completely inert
Six of seven `--radius-*` tokens have **zero component usage**. The user-facing radius
setting and every theme's radius values do nothing. Components hardcode `rounded-2xl`,
`rounded-lg`, `rounded-[10px]`, `rounded-[6px]`, `rounded-xl`, `rounded-full`
(`current-state.md` §8.2). Root cause is documented in `MIGRATION.md` Phases 7–11.

Codex target: `--radius: 12.5px` with sm `7.5` / md `10` / lg `12.5` / 2xl `20`, plus
**`corner-shape: superellipse(1.5)`** on every rounded surface — the squircle is Codex's
most distinctive purely-visual signature (`design-audit.md` §11).

### P1-2 · Typography has no scale
**231 arbitrary `text-[Npx]` declarations across 18 values**, 8 fractional. The six
`ui-text-size-*` utilities have 14 call sites total, so **the UI font-size setting is ~94%
inert in the chat surface** (`current-state.md` §8.3).

Codex target: 12 / 13 / 14 / 18 / 20 / 24 px, body weight **430**, medium 500, line-height
1.5, **no letter-spacing token at all**. Atlas currently has four uncoordinated uppercase
tracking values (`0.12em`, `0.14em`, `0.16em`, `0.18em`) and Codex has none.

### P1-3 · Live typography regressions
- **`--font-ui-system` is referenced but never defined** (`App.tsx:112-118`) — when the
  user's font override is empty, `--font-ui-family` resolves to nothing and the app falls
  back to the browser default. This is a shipping bug, not a style preference.
- **GeistMono is referenced by the xAI theme (`xai.css:73`) but never loaded** — no
  `@font-face`, no font package.

### P1-4 · Colour escapes the token system
- 18 raw-palette Tailwind classes in `ChatWindow.tsx:87-121, 281-320` make the tool
  timeline unreadable on the light `cursor` theme.
- ~24 `text-white` / `bg-white` / `bg-black` sites break every light theme.
- Dialog/overlay backgrounds hardcode black while a theme-aware `--overlay` exists.
- `--accent` / `--accent-hover` / `--accent-text` are defined in **every** theme but are
  missing from the contract and from `@theme`, so the brand accent is **unreachable from
  any component**.
- `--accent-primary` is referenced and never defined (`context.tsx:143`).
- Cursor dark mode never overrides `--bg-overlay` → **cream popovers with cream text**.
- `default` and `xai` have **no light variant** — picking "Light" changes only
  `color-scheme`.

### P1-5 · Elevation model is wrong
Codex expresses depth as **surface tint (5% foreground over background) + 8% hairline
borders**, with essentially no shadows (tooltips explicitly `box-shadow: none`)
(`design-audit.md` §11). Atlas should adopt the tint formula rather than its current mix.

### P1-6 · Motion tokens are inert
`--duration-*` and `--easing-default` never leave `styles.css`. Codex's entire motion
language is **150ms** for colour/border/shadow, **200ms** for positional, easing
`cubic-bezier(0, 0, 0.2, 1)` — which is *already* what `xai.css` defines. It just needs to
be applied.

### P1-7 · Two competing button systems
`styles.css` defines `.btn-primary` / `.btn-secondary` / `.card` / `.input` (uppercase
mono, 1.4px tracking) that duplicate and conflict with `ui/button.tsx` and `ui/input.tsx`.
Both are used, sometimes in the same view.

---

## P2 — Components

### P2-1 · Command output is not terminal-styled
Expanding a `bash` call shows `INPUT` → `JSON` → `{"command": "pnpm typecheck"}` across
three nested bordered boxes (`visual-findings.md`). Codex shows the highlighted command in
the header and dim, interleaved stdout/stderr under `└`, capped at 5 lines with
head/tail truncation and `(no output)` when empty (`design-audit.md` §4).

Also: **`ansi-to-react` is a dependency and is imported nowhere** — ANSI escapes from
`bash` render as literal garbage. And stdout currently goes through the *markdown*
pipeline, so backticks and asterisks in program output get formatted as markup.

### P2-2 · No diff renderer exists anywhere in the repo
File-change tools dump full file contents as JSON. Codex renders a unified diff with
`(+N -M)` in the header (green/red), per-line signs, adaptive line-number gutter, `⋮` hunk
gaps, per-language syntax highlighting, and the exact GitHub palette
(`#213A2B`/`#4A221D` dark, `#DAFBE1`/`#FFEBE9` light) (`design-audit.md` §5).

This is the largest single net-new component in the migration.

### P2-3 · The header summary shows raw JSON
`headerSummary` (`ChatWindow.tsx:204-227`) falls through to `String(rawInput)`, so a bash
call's headline literally reads `{"command":"npm test"}`. Codex shows
`Ran pnpm test`.

### P2-4 · Titles truncate to nothing
Rendered rows show `E…` and `R…` — the title collapses to one character while the
untruncated output preview consumes the row (`visual-findings.md`). The most important
token in the row is the first thing dropped.

### P2-5 · Approvals
Atlas: four 24px-tall buttons at 10.5px text inside a hover-highlighted div; no keyboard
affordance, no focus management, no autofocus, no preview of *what* is being approved
beyond a generic summary line, and "Session" never says what scope it grants
(`current-state.md` §5.5).

Codex: the command is **always shown, syntax-highlighted, above the options**; options are
an explicit numbered list with single-key accelerators and verbatim copy including
`` Yes, and don't ask again for commands that start with `echo hello world` (p) ``; and a
decision receipt is written back into the transcript afterwards
(`✔ You approved codex to run <cmd> this time`) (`design-audit.md` §9).

Note: **`ai-elements/confirmation.tsx` is a complete, purpose-built, token-correct approval
component — 173 lines, `ChatToolApproval`-aware — with zero importers.**

### P2-6 · Expand state is destroyed on every status change
`ChatWindow.tsx:229-233` re-runs on every `part.state` change and calls `setIsOpen`
unconditionally, so any manual expand is **silently reverted** the moment the tool
transitions (`input-available` → `output-available` snaps it shut). Same bug in the
reasoning component.

### P2-7 · 900-char truncation with no escape hatch
`ToolResultNormalizer.ts:1` truncates every input and output in the main process before it
reaches the renderer, and there is no "show full output" affordance. Codex truncates
head/tail in the *view* and always offers `ctrl + t to view transcript`.

### P2-8 · Composer
- **Double border when focused** — container border + inner textarea ring.
- Context meter is a bare **`9.8`** chip: no unit, no label, no tooltip.
- Model control shows the **raw id** (`anthropic/claude-sonnet-4.5`) while the titlebar
  shows the **display label** for the same model.
- Approval-mode control ("Ask first") is the highest-consequence control in the composer
  and has the least visual weight.
- Codex reference: placeholder `Ask Codex to do anything`, status line
  `gpt-5.6-sol default · /tmp/project`, footer `? for shortcuts … 100% context left`.

### P2-9 · Model selector
Double border, **no dialog heading**, capability badges of differing widths that wrap so
`FREE` misaligns, selection fill nearly identical to hover fill, near-invisible scrim
(`visual-findings.md`).

### P2-10 · ~1,300 lines of dead, purpose-built UI
`ai-elements/tool.tsx` (382, `Tool`/`ToolHeader`/`ToolContent`/`getStatusBadge` all dead) ·
`confirmation.tsx` (173, entirely dead) · `interactive-diagram.tsx` (324, 0 importers) ·
`rive-visual.tsx` (186, 0 importers) · `message.tsx` `MessageBranch*` (~180, dead) ·
`conversation.tsx` (only `ConversationEmptyState` used; ChatWindow re-implements
sticky-scroll and the jump button itself).

The repo carries **three parallel tool-status vocabularies**, one dead, one bypassing all
tokens, one never reaching the UI.

---

## P3 — Micro-interactions & polish

- **P3-1 · Running indicator.** Codex's shimmer is a 2 s sweep, Hann falloff, band half-width
  5 chars, phase-locked globally, 32 ms frames, degrading to a static dim `•` under reduced
  motion (`design-audit.md` §10). Atlas has three copy-pasted ping-dot indicators
  (`App.tsx:797-800`, `ChatWindow.tsx:453-456`, sidebar variant).
  Worth copying: Codex's **compile-time lint** that fails the build if motion is invoked
  outside the motion module, so the reduced-motion path can't be bypassed.
- **P3-2 · Microcopy.** Adopt Codex's tense discipline: present participle in flight
  (`Running`), past tense when done (`Ran`), second person for user actions
  (`You approved…`). Key hints with **spaces around `+`**.
- **P3-3 · Empty states.** Atlas's six generic cards ("Explain a concept", "Summarize
  text") describe a generic chatbot, not an agent with a tool runtime.
- **P3-4 · Focus rings.** Only 12 files use `focus-visible`, all but two of them `ui/*`
  primitives. The global fallback uses a **border** token as the ring
  (`rgba(255,255,255,0.28)` on `default`) — barely visible. `.input:focus` uses
  `box-shadow: 0 0 0 3px var(--border-strong)`, a thick grey halo.
  Codex has a real `--ring` token (`#339CFF` / `#83C3FF` @ 76%) and `2px` outline offset.
- **P3-5 · ARIA.** No `aria-live` on the tool region, so tool state changes are never
  announced. `ToolRow` is a bare `div` with no accessible name or state. The tool
  disclosure button is labeled **`"Show/Hide reasoning details"`** — copy-pasted from the
  reasoning component. Chevron is the only expand affordance, so the hit target is 20×20px.
- **P3-6 · Scroll behaviour.** `scrollToBottom({ ignoreEscapes: true })` fires on every new
  `requestId`, yanking the user down at the start of each turn even if they deliberately
  scrolled up. Virtualizer height estimates are hand-tuned magic numbers, so scroll
  position jumps when tool rows expand.
- **P3-7 · `deferRichContent`** renders unstyled plaintext for off-screen rows, so fast
  scrolling shows raw markdown that then reflows.
- **P3-8 · Three `setState` calls per keystroke** app-wide for shortcut hints, on both
  `keydown` and `keyup` (`App.tsx:551-568`).
- **P3-9 · `Jump to latest`** pill floats over transcript content instead of docking clear.
- **P3-10 · Switch renders as a plain white square** with no track — reads as a checkbox.

---

## Out of scope — flagged, not built

Per §0. Each is a product feature, not a restyle:

| Codex feature | Why not | What Atlas would need first |
|---|---|---|
| Parallel / multi-agent task list | Atlas runs one conversation at a time | An agent fleet + scheduler |
| Right-hand diff panel | No workspace-on-disk | Repo binding + file watcher |
| Integrated terminal panel | No PTY | A PTY host in main |
| Git / PR review flow | No git integration | git plumbing + a forge client |
| Environment / devbox controls | No devbox | Container/VM lifecycle |
| In-app browser for frontend iteration | Sites preview already covers the real need | — |
| `::code-comment` / `::git-*` directives | Nothing produces them | The above |

---

## Non-parity bug found during this audit

Reported because it was found, not because it is in scope — **I am not fixing it as part
of a UI migration**:

History pagination is dropped on the click-to-open path. `loadConversation`
(`useAppStore.ts:439-459`) fetches `conversations.getPage` *and*
`chat.getRuntimeState`, then passes only the runtime snapshot to
`applyRuntimeSnapshotToStore`, which sets `hasOlder: existingDetail?.hasOlder ?? false`
(`streamEventReducers.ts:73-86`). For a conversation not already cached that is always
`false`, so `loadOlderMessages` can never fire. The bootstrap path
(`buildBootstrapConversationDetails`, `useAppStore.ts:1110-1132`) does it correctly.

Net: **"load older messages" works only for the conversation auto-selected at startup.**
The `getPage` result is fetched and paid for on every open, then discarded.

---

## Proposed implementation order

Each step ends with a screenshot pass through `scripts/uiPreview/snapshot.mjs`.

1. **Token layer** — radius (+ squircle), type scale, colour contract, motion, elevation
   tint. Fix `--font-ui-system` and the GeistMono reference. *(P1)*
2. **Data plumbing** — thread `toolType` + timing into `ChatToolPart`. *(P0-2)*
3. **Transcript grammar** — cell grammar, verbs, gutters, coalescing, turn rules,
   reasoning demotion. *(P0-1, P0-3, P0-4, P0-5)*
4. **Tool renderers** — terminal block, unified diff, search/read/web result shapes.
   *(P2-1, P2-2, P2-3, P2-4)*
5. **Approvals** — adopt the dead `confirmation.tsx`, Codex copy, keyboard + focus.
   *(P2-5)*
6. **Shell** — sidebar resize/persist/collapsed-rail/traffic-lights, single content
   measure, titlebar border. *(P0-6, P0-7, P0-8)*
7. **Composer, model selector, settings retint.** *(P2-8, P2-9)*
8. **Polish** — shimmer + motion module, focus rings, ARIA, scroll, empty states. *(P3)*
9. **Delete dead code.** *(P2-10)*

---

## Decisions I need from you

1. **Scope A vs B** — confirm presentation parity only, or name which structural feature
   you actually want built as a feature.
2. **Theme strategy** — Codex's palette (`#181818` bg, `#83C3FF` accent, orange
   destructive, 12.5px squircle radius) conflicts head-on with the current `xai` theme
   (`#1f2228`, monochrome, 0px radius) that `MIGRATION.md` was built to deliver.
   Options: **(a)** add `codex` as a fourth design theme and make it the default,
   **(b)** replace `xai` outright, **(c)** keep xAI's palette and adopt only Codex's
   *structure*. I recommend **(a)** — it is reversible and it does not throw away the
   completed xAI work.
3. **Screenshots** — if you can send the Codex app's main thread view, a turn with an
   expanded tool call, and the diff panel, items 1/2/4 in the "Unverifiable" list become
   implementable at pixel level rather than grammar level.
