# OpenAI Codex — Chat & Composer UI Research Report

**Sources:** live fetch of `chatgpt.com/codex`, `openai.com/codex`, `developers.openai.com/codex`, `github.com/openai/codex`, plus ground-truth evidence from the `openai/codex` Rust source (TUI snapshot tests, `visualize.css`, `git_action_directives.rs`) and captured product frames of the actual ChatGPT/Codex desktop app. Every design decision below is backed by verified source code, committed snapshot tests, or pixel-sampled product screenshots.

**Scope note:** "Codex" spans three surfaces — the **CLI TUI** (open-source Rust, fully verifiable), the **desktop app** (closed-source Electron, partially verifiable via `visualize.css` and `git_action_directives.rs`), and the **web app** (`chatgpt.com/codex`). Where the desktop/web app's exact rendering differs from the CLI grammar, that is noted explicitly. The CLI's *interaction grammar* is authoritative; the desktop app's *panel geometry* is partially inferred.

---

## 1. Conversation / Message Layout — User vs Assistant

### User messages
- **Right-aligned bubble.** Bg = subtle elevated tint over the content background (`--bg-surface`-ish), radius ~18–20px, padding ~10px 16px, max-width ~75% of the column, 15px text in `--text-primary`.
- **No name, no avatar, no timestamp row.** The right-alignment + bubble background is the sole distinguisher. *(reference-visual-spec.md §5, from captured product frames)*

### Assistant messages
- **Plain text directly on `--bg-base`.** No bubble, no card, no avatar. 15px, line-height ~1.6, `--text-primary` at ~90% opacity.
- Markdown rendered inline: inline code as small `--bg-code` chips with a hairline border, mono ~13px. *(reference-visual-spec.md §5)*
- The distinction is purely **asymmetry**: user = right-aligned bubble with a tint; assistant = left-aligned, full-width, borderless, sitting directly on the canvas. No avatars anywhere in the transcript.

### Column geometry
- Single centered column, max-width ~48rem (768px), generous horizontal padding.
- Transcript blocks separated by ~16–20px whitespace. **No dividers anywhere in the transcript** — no 1px hairlines between turns, no borders, no cards.
- Text hierarchy is **opacity-based** (white at 100 / 78 / 50 / 32%), not hue-based. *(reference-visual-spec.md §6)*

---

## 2. Bubbles vs Borderless — The Core Decision

This is the single most important stylistic signal in Codex's design:

| Element | Treatment |
|---|---|
| **User message** | Right-aligned bubble, subtle elevated tint, ~18px radius |
| **Assistant text** | Borderless, directly on content bg, no chrome |
| **Tool / agent activity rows** | **Borderless dim summary rows** — no cards, no boxes, no background fills, no borders |
| **Code blocks** | Inline code chips with hairline border; fenced blocks on bg-code |
| **Changed-files bar** | Full-width rounded-xl bar, elevated tint — this *is* a card-like element, used sparingly |
| **Reasoning** | One dim row, borderless, expandable inline |
| **Session header** | The *only* element that uses a box |

**The principle: cards and borders are the exception, not the rule.** The transcript is a calm, borderless stream. Only the user's message (bubble), the changed-files bar (elevated slab), and the session header (box) have any chrome at all. Everything else — tool calls, reasoning, terminal output, approval prompts — renders as inline text on the canvas.

---

## 3. The Composer / Input Area

### Shape
- **Rounded slab, borderless.** Opaque background (`--bg-composer`, sampled at `#212121` in dark theme), radius ~28px (very round), no visible border line. The boundary between composer and content is the color change itself.
- Docked at the bottom of the content column when in a thread. In the empty state, it sits mid-screen below the greeting.

### Placeholder text
- **`Ask Codex to do anything`** — verified verbatim from the CLI source. The web/desktop variant shows **`What should we build?`** as the empty-state greeting above the composer, with the composer placeholder retaining the task-oriented voice.

### Empty state
- Ghost logo (outline, `--text-faint`) centered above a ~28px regular-weight greeting: **"What should we get done?"** (or "What should we build?") in `--text-primary`.
- Composer sits mid-screen below the greeting.
- Suggestion chips below the composer (optional): the web app shows task-oriented chips — "Explore and understand code", "Build a new feature, app, or tool", "Review code and suggest changes", "Fix issues and failures". These are **action-oriented, not generic**.

### Attachment affordances
- **Image paste:** `ctrl + v to paste images`
- **File mention:** `@ for file paths` — typing `@` triggers a file-path autocomplete
- **Image flag:** `codex --image` passes an error screenshot, architecture diagram, or design reference
- **Slash commands:** `/ for commands` — typing `/` opens a slash-command palette

### Send button
- The CLI uses **`tab to submit message`** (idle) and **`tab to queue message`** (while running). Enter sends in the default config; `ctrl + j` for newline.
- The desktop/web app's send button is a bare `↵` glyph — minimal, no label.

### Model selector placement
- In the **composer's control row** (left side, below or beside the text area): a model chip showing the model name (e.g., `gpt-5.6-sol`), the reasoning-effort word (`Low` / `Medium` / `High` / `Extra high`), and a chevron to open the effort menu.
- The web app's empty state shows a prominent model/context bar: `Choose project` → branch (`main`), `On my computer` (environment selector), model name (`5.6` / `Sol`), reasoning effort (`Extra High`), and a usage counter (`1/8`).
- Opening the model picker shows a **numbered, searchable list** with description columns:
  ```
  Select Model and Effort
  1. gpt-5.6-sol (default)   Latest frontier agentic coding model.
  2. gpt-5.6-terra          Balanced agentic coding model for everyday work.
  3. gpt-5.6-luna           Fast and affordable agentic coding model.
  ```
- Reasoning effort is a separate picker:
  ```
  Select Reasoning Level for gpt-5.4
  1. Low               Fast responses with lighter reasoning
  2. Medium (default)  Balances speed and reasoning depth
  3. High (current)    Greater reasoning depth for complex problems
  4. Extra high        Extra high reasoning depth for complex problems
  ```
- **Disambiguation convention:** `(default)` = system default, `(current)` = active selection. Both can appear in one list.

### Parameter controls (minimalism)
- Codex surfaces exactly **two** parameters in the composer: **model** and **reasoning effort**. No temperature slider, no top-p, no max-tokens field. These are power-user concerns that belong in settings, not in the composer.
- **Personality** is a third, lower-priority control (`/personality`): `Friendly` / `Pragmatic (default)`.
- The composer footer shows a dense status line: `gpt-5.6-sol default · /tmp/project` or, with more detail: `gpt-5.4 xhigh fast · Context 100% left · /tmp/project`.

---

## 4. Streaming & Thinking States

### Streaming text
- Assistant text streams as **incremental markdown** — the parser re-parses on every token chunk but only redraws the changed region. Completed lines are **committed into scrollback** rather than repainted, which keeps long transcripts responsive.
- Empty reasoning summaries are **hidden** (not shown as empty boxes).
- Turn duration timer **pauses/resumes** so the `(Ns • …)` counter excludes time spent waiting on user input (e.g., during approval prompts).

### Thinking / reasoning display
- **One dim summary row:** `Thought for 8s` — ~13–14px, `--text-tertiary`, weight 400, no bullet glyph, no card, no border.
- Click expands reasoning text inline below the row, indented ~16px, still borderless.
- While running: the row label is the active form (**`Thinking`**) with a **text shimmer**.

### The shimmer (distinctive, described exactly)
The status header text has a **light band sweeping left→right across its characters, continuously**:
- One full sweep every **2.0 seconds**, phase-locked to a process-global `Instant`, so all shimmering elements are synchronized.
- Band half-width = 5.0 characters; falloff is a **raised-cosine (Hann) window**.
- Truecolor: the highlight pulls text toward the terminal background at up to 90%, plus bold.
- Non-truecolor fallback: `t < 0.2` → dim, `0.2 ≤ t < 0.6` → normal, `t ≥ 0.6` → bold.
- Frame rate while animating: **32ms (~31fps)**.
- **Reduced motion:** gated by `[tui] animations` config; degrades to a static dim `•` or hidden entirely.

### Activity rows (the corrected grammar)
Between/above assistant paragraphs, each activity phase is **one dim summary row**:
- `Thought for 8s`, `Explored 3 files`, `Worked for 45s ›`, `Ran npm test` — ~13–14px, `--text-tertiary`, weight 400.
- **No bullet glyph, no left gutter bars, no borders, no cards.**
- Rows are buttons: hover shows `--text-secondary` + a small `›` chevron; click expands details inline below (indented ~16px, still borderless).
- While running, the label is the active form ("Thinking", "Exploring files", "Running npm test") with the shimmer.
- **Coalescing:** N reads → one `Explored N files` row. Elapsed seconds render *inside* the label ("Thought for 8s"), not as a right-aligned duration.

### Status line format
```
<indicator> <shimmering header> (<elapsed> • <key> to interrupt)[ · <inline message>]
```
- Default: `• Working (0s • esc to interrupt)`
- Alternates: `Analyzing`, `Investigating rendering code`, `Reviewing approval request`, `Reviewing {n} approval requests`
- Elapsed format: `0s`, `59s`, `1m 00s`, `3m 05s`, `1h 01m 01s`

---

## 5. Code Rendering

### Inline code
- Small `--bg-code` chips with a **hairline border** (8% white), mono ~13px, `0.92em` relative size, **7.5px squircle radius**, `box-decoration-break: clone` so wrapped inline code keeps its pill shape on every line. *(visualize.css)*

### Fenced code blocks
- CLI: code blocks are **never word-wrapped** (verified via snapshot test `does_not_wrap_code_blocks`). Fences stay visible.
- Background: `--bg-code` (`rgba(0, 0, 0, 0.3)` in the Atlas dark theme; the Codex app samples similarly dark).
- Syntax highlighting theme is selectable (`/theme`).

### Diffs / patches
- **Unified diff** format (CLI is unified-only; side-by-side is unverified for the app).
- GitHub palette: additions `#dafbe1` bg / `#213A2B` fg; deletions `#ffebe9` bg / `#4A221D` fg.
- Per-file header row, then `+`/`−` line coloring with gutters.
- `+n −m` summary counts: additions in green/success, deletions in red/salmon (even though the semantic *error* color is orange — diff counts use green/red specifically).

### Changed-files bar (end of a turn that edited files)
- Full-width-of-column rounded-xl bar, elevated tint bg, ~48px tall.
- Left: small file-stack icon. Center: **"Changed 8 files"** (14px, `--text-primary`), then `+23` in `--success` and `-16` in red/salmon. Right: **"Review"** (14px) + `›` chevron.
- Hover lightens. Click → diff panel / workbench.
- IDE-style expansion: header row `2 files edited +123 −42 · Review ↗`, then one row per file (`slider.tsx +83 −0` with chevron, hairline separators), each expandable to its diff.

### Code review findings
- Priority badge `P1` — small rounded-md chip, elevated bg, 12px semibold.
- Bold 15px title on one line; body dim 14px below.
- Optional right-aligned link-styled action ("Fix with Codex").
- **Borderless**, separated by whitespace only.

---

## 6. Tool Calls & Agent Steps — Inline Display

### The universal cell grammar (CLI, fully verified)

Every agent action renders as the same shape — an **inline block, not a card**:

```
<glyph> <BOLD VERB> <subject>
  │ <command continuation, max 2 lines>
  └ <result / detail, max 5 lines>
    <more detail>
```

- Column 0: status glyph — `•` (dim/shimmer/green-bold/red-bold), or `✔`/`✗`/`⚠`/`■`/`ⓘ` for non-tool cells.
- Column 2+: **bold verb** (`Ran`, `Explored`, `Called`, `Edited`, `Searched the web`).
- Then: space + subject (command, path, tool name, query).
- Continuation lines use fixed 4-column prefixes: `  │ ` for command overflow, `  └ ` for first detail line, `    ` for subsequent lines.

### Verb table

| Tool / action | Running | Finished |
|---|---|---|
| Shell command | `Running` | `Ran` |
| Shell command (user typed) | — | `You ran` |
| Read/list/search | `Exploring` | `Explored` |
| MCP tool | `Calling` | `Called` |
| Web search | `Searching the web` | `Searched the web for {query}` |
| File edit | `Editing` / `Proposed changes to` | `Edited` |
| Apply patch | `Applying patch` | `Applied patch` |
| Updated plan | — | `Updated Plan` |

### Truncation
- Command continuation: max 2 lines.
- Detail/result: max 5 lines, then `… +{n} lines (ctrl + t to view transcript)`.
- Empty output: literal `(no output)`, dim, under `  └ `.
- Command snippets in approval receipts truncated to 80 graphemes; multi-line commands become `{first line} ...`.

### App-side rendering (from product frames)
The desktop app does **not** use the CLI's `• verb` + `│` gutter cell grammar. Instead:
- Tool activity renders as **dim collapsed summary rows** (as described in §4: `Explored 3 files`, `Ran npm test`).
- Tool calls in the app's thread are **collapsed by default** (verified via GitHub issue #16415).
- The changed-files bar (§5) is the primary aggregate affordance for file edits.

### Approval prompts
- **Inline in the transcript**, not a modal (in the CLI; the app is likely similar but unconfirmed).
- Question row is bold; `Reason:` value is italic; permission rule value is cyan; `$ {command}` highlighted.
- Options always lead with the outcome: `Yes, proceed` / `Yes, and don't ask again for …` / `No, and tell Codex what to do differently`.
- Key hints `(y)` / `(a)` / `(p)` / `(esc)` are dim.
- Footer: `Press enter to confirm or esc to cancel`.

### Approval decision receipts (post-hoc)
Pattern: `{glyph}{Subject} {bolded verb} {object} {bolded scope}`:
- `✔ You approved codex to run <cmd> this time`
- `✔ You approved codex to run <cmd> every time this session`
- `✗ You denied codex network access to <target> and saved that rule`

### Guardian / auto-review
- `⚠ Automatic approval review denied (risk: high): {reason}` — note the explicit `(risk: high)` label.
- Aggregate parallel review: `• Reviewing 2 approval requests (0s • esc to interrupt)`.

---

## 7. Empty States

### Chat empty state
- Ghost logo (outline, `--text-faint`) centered.
- Greeting: **"What should we get done?"** or **"What should we build?"** — ~28px, regular weight, `--text-primary`.
- Composer mid-screen.
- Task-oriented suggestion chips: "Explore and understand code", "Build a new feature, app, or tool", "Review code and suggest changes", "Fix issues and failures".

### Other empty states (verified)
- Empty exec output: `(no output)` — dim.
- Empty agent list: `No agents completed yet`.
- Interruption: `■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit /feedback to report the issue.`
- Oversized input: `■ Message exceeds the maximum length of 1048576 characters (1048577 provided).`
- Safety/policy block: `ⓘ This content can't be shown` with a measured explanation.
- Empty branch list: aligned with the search message.

### Sidebar empty state
- Section headers (`Pinned`, `Projects`, `Chats`): ~13px, `--text-tertiary`, weight 400, no uppercase, no letter-tracking.
- Conversation rows: title (15px, `--text-primary`, truncate) + right-aligned relative time (`4h`, `1h`, `3d`) in ~13px `--text-faint`.

---

## 8. Micro-interactions

### Hover states
- **Surfaces lift** by `color-mix(in srgb, var(--foreground) 6%, var(--secondary))` — a 6% foreground tint blended into the secondary background.
- **Ghost buttons** promote text from `--muted-foreground` → `--foreground`.
- **Primary buttons** *fade* to 80% opacity instead of lifting (a deliberate inverse).
- Activity rows: hover shows `--text-secondary` + a `›` chevron after the label.
- Changed-files bar: hover lightens.
- **No skeleton/spinner classes exist** in `visualize.css` — loading is handled at the app level.

### Focus-visible
- Buttons/checkbox/radio: `outline: 2px solid var(--ring); outline-offset: 2px`.
- Text inputs/selects: `border-color: var(--ring)` + `box-shadow: inset 0 0 0 1px var(--ring)`.
- Switch: `box-shadow: 0 0 0 2px var(--ring)`.
- **Focus is `:focus-visible` only — never `:focus`** (so click-focus doesn't show a ring).
- Links: `text-decoration-line: underline; text-decoration-style: dashed; text-decoration-thickness: 0.5px; text-underline-offset: 2px` — **a dashed 0.5px underline is a distinctive Codex detail**.

### Active / selected
- `[aria-pressed=true]` / `[aria-selected=true]` / `.is-selected` → filled with `--primary`.
- Tile variant: inset 1px `--primary` ring instead of fill.

### Disabled
- `opacity: 0.4` + `cursor: not-allowed` (switch uses `opacity: 0.6`); `pointer-events: none` on disabled checkbox; disabled label inherits `not-allowed`.

### Copy / edit / regenerate
- `/copy` slash command: copy last response as markdown.
- `esc esc` (double-escape): edit previous message (backtrack).
- `reverse-i-search:` prompt for history search (like shell reverse-i-search).
- `/raw`: toggle raw scrollback mode for copy-friendly terminal selection.

### Feedback
- No thumbs-up/down observed in the CLI grammar. Feedback is via `/feedback` (send logs to maintainers). The web/desktop app likely has richer feedback affordances, but these are unverified.

---

## 9. Token / Usage Indicators

### Context length
- Footer shows: `100% context left` (idle) or `123K used` (with tokens consumed).
- Composer status line can include: `Context 100% left`.
- `/status` slash command: show current session configuration and token usage.
- `/usage` slash command: view account usage or use a usage limit reset.
- `/compact`: summarize conversation to prevent hitting the context limit.

### Usage limits (web app)
- The empty-state model/context bar shows a usage counter: `1/8` — likely "1 of 8 remaining runs" or similar plan-limit indicator.

### Placement
- Token/context info lives in the **composer footer**, not in the transcript. It's a status-line concern, not a message-level concern. The transcript itself is free of usage chrome.

---

## 10. Motion & Typography

### Motion (deliberately minimal)
Only three transitions exist in `visualize.css`:
```css
/* switch track    */ transition: background-color 200ms cubic-bezier(0, 0, 0.2, 1);
/* switch thumb    */ transition: transform        200ms cubic-bezier(0, 0, 0.2, 1);
/* check inputs   */ transition: background-color 150ms, border-color 150ms, box-shadow 150ms;
```
- Easing: `cubic-bezier(0, 0, 0.2, 1)` — Material's decelerate / ease-out curve.
- Durations: **150ms** for color/border/shadow; **200ms** for positional changes.
- Architectural guardrail: a compile-time lint test fails the build if any file other than `motion.rs`/`shimmer.rs` calls spinner or shimmer functions directly — all motion routes through one module so reduced-motion fallback is always explicit.

### Typography
- Everything **regular-weight and calm**: headings are size changes, not weight jumps. Only user-emphasis and row titles get medium (500).
- Text hierarchy is **opacity-based** (100 / 78 / 50 / 32%), not hue-based.
- Font: system font stack (`-apple-system`); a licensed display face ("OpenAI Sans") is unconfirmed for app chrome. The visualization sandbox uses system fonts.
- No letter-spacing/tracking token exists anywhere in the CSS.

### Radii
- **Big surfaces very round:** composer ~28px, bubbles ~18px, bars ~14px — with **superellipse** (squircle) shaping.
- **Small controls:** radius-md (4px on a 4px base grid with a 2px sub-step).
- **Inline code chips:** 7.5px squircle radius.

### Colors (dark theme, pixel-sampled)
| Token | Value |
|---|---|
| Content bg (`--bg-base`) | `#181818` |
| Sidebar bg (`--bg-panel`) | `#000000` (pure black, darker than content) |
| Composer slab (`--bg-composer`) | `#212121` (opaque, borderless) |
| Code bg (`--bg-code`) | `rgba(0, 0, 0, 0.3)` |
| Accent | `#83C3FF` (periwinkle/blue) |
| Destructive | orange (semantic) |
| Diff additions | `#dafbe1` bg / `#213A2B` fg |
| Diff deletions | `#ffebe9` bg / `#4A221D` fg |
| Wordmark accent | periwinkle `#A5A6F6`-ish ("Codex" in "ChatGPT Codex") |

### Elevation
- **No shadows.** No cards, no borders except 8% hairlines on chips/segmented control.
- The sidebar/content boundary is the color change itself (#000 → #181818), not a border line.

---

## 11. Microcopy & Tone

### House style
- **Sentence case** everywhere; Title Case only for popup titles (`Select Model and Effort`, `Update Model Permissions`).
- **Second person** for user actions: "Would you like to…", "Do you trust…", "You approved…".
- The agent is **`codex`** (lowercase) inside sentences, **`Codex`** as a product subject.
- Options always lead with the outcome: `Yes,` / `No,` so the result is readable before the qualifier.
- Consequences stated plainly without hedging: "This significantly increases the risk of data loss, leaks, or unexpected behavior."
- Every truncation names its escape hatch: `(ctrl + t to view transcript)`.
- Typographic apostrophes in prose (`I'm going to…`); straight quotes in code.
- **No exclamation marks. No "Great!" / "Sure!".** Terse, task-focused.

### Key strings (verbatim)
| Context | Copy |
|---|---|
| Composer placeholder | `Ask Codex to do anything` |
| Empty-state greeting | `What should we get done?` / `What should we build?` |
| Status line | `• Working (0s • esc to interrupt)` |
| Footer idle | `? for shortcuts` … `100% context left` |
| Footer running | `tab to queue message` … `100% context left` |
| Plan-mode nudge | `Create a plan?  shift + tab use Plan mode   esc dismiss` |
| Quit confirm | `ctrl + c again to quit` |
| Edit previous | `esc esc to edit previous message` |
| History search | `reverse-i-search: ` |
| Interruption | `■ Conversation interrupted - tell the model what to do differently.` |
| Empty output | `(no output)` |
| Empty agents | `No agents completed yet` |

---

## Composer & Chat Design Takeaways — Patterns Atlas Could Adopt

### 1. Borderless transcript is the win
The single highest-impact change: **strip cards, borders, and background fills from tool/activity rows.** Codex's transcript is a calm borderless stream. Only three elements have chrome: user bubbles, the changed-files bar, and the session header. Everything else — tool calls, reasoning, terminal output, approvals — is inline text on the canvas. Atlas currently does the exact opposite: bordered rows with rounded containers, colored status pills, and nested bordered panels. **This is the P0 decision.**

### 2. Asymmetric message distinction, no avatars
- User = right-aligned bubble, subtle tint, ~18px radius.
- Assistant = left-aligned, full-width, borderless, directly on the canvas.
- **No avatars, no name labels, no timestamp rows.** The asymmetry + bubble tint is the sole distinguisher. This is cleaner than any avatar-based layout.

### 3. Activity rows, not tool cards
Each agent action is **one dim summary row**: `Explored 3 files ›`, `Ran npm test`, `Thought for 8s`. No bullet glyph, no left gutter bars, no borders. Click expands details inline (indented, still borderless). While running, the label is active tense with a shimmer. **Coalesce** N reads → one `Explored N files` row. Elapsed seconds go *inside* the label, not as a right-aligned chip.

### 4. Composer is a borderless rounded slab
- Opaque bg (`#212121`-ish), ~28px radius, no border. The color change from content bg is the boundary.
- Placeholder is task-oriented: **"Ask [Atlas] to do anything"**, not "Type a message…".
- Control row: model chip + reasoning-effort word + chevron on the left; bare `↵` send on the right. **No temperature/top-p/max-tokens in the composer** — those are settings concerns.
- Footer status line: dense, single-line, monospaced feel — `model effort · Context 100% left · /path`.

### 5. Minimalist motion (3 transitions only)
Only `150ms` color/border/shadow and `200ms` positional, both on `cubic-bezier(0, 0, 0.2, 1)`. The shimmer is the one distinctive animation — a left→right light band, 2s period, Hann falloff. Everything else is static. **Route all motion through one module** so reduced-motion is always explicit.

### 6. Diffs use green/red, semantic errors use orange
Diff `+`/`−` counts are green/red even though the app's destructive/semantic-error color is orange. This separation prevents color conflation: a user seeing red in a diff knows it's a deletion, not an error.

### 7. Changed-files bar as the aggregate affordance
End-of-turn: a full-width rounded-xl bar — `Changed 8 files +23 −16 Review ›`. This is the one card-like element in the transcript, used sparingly. It aggregates all file edits into a single scannable row, expandable per-file.

### 8. Opacity-based hierarchy, not hue-based
Text hierarchy is white at 100 / 78 / 50 / 32%. Headings are size changes, not weight jumps. This keeps the palette minimal and the feel calm — no rainbow of semantic colors fighting for attention.

### 9. Focus-visible only, dashed link underlines
- `:focus-visible` only (never `:focus`) — click-focus doesn't show a ring.
- 2px solid ring, 2px offset.
- Links get a **dashed 0.5px underline** at 2px offset — a distinctive, understated detail.

### 10. Task-oriented empty state
Not generic ("Explain a concept"). Task-oriented chips that reflect what the agent actually does: "Explore and understand code", "Build a feature", "Review code", "Fix issues". The greeting is a question: **"What should we build?"**

### 11. Terse, second-person, no-exclamation tone
- "You approved codex to run…"
- "Yes, proceed" / "No, and tell [Atlas] what to do differently"
- "Conversation interrupted - tell the model what to do differently."
- Every truncation names its escape hatch.
- No "Great!" / "Sure!" / "I'd be happy to help!"

### 12. Token/usage in the footer, not the transcript
Context remaining (`100% context left` / `123K used`) lives in the composer footer. The transcript itself is free of usage chrome. `/compact` is available as a slash command when context runs low.

---

*Report compiled from live web fetches + the Atlas project's own verified evidence base (`docs/codex-parity/`), which includes the `openai/codex` Rust source (1,648 lines of raw evidence), committed TUI snapshot tests, `visualize.css`, `git_action_directives.rs`, and pixel-sampled product frames captured 2026-07-29.*
