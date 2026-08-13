# Codex — design audit (distilled reference spec)

> **Superseded on structure (2026-07-29):** real product frames of the app were later
> captured into `shots/reference/` and distilled into **`reference-visual-spec.md`**.
> That spec corrects this document wherever they disagree — most importantly, the app
> does **not** use the TUI's `• verb` + `│` gutter cell grammar; tool activity renders
> as dim collapsed summary rows plus a "Changed N files" bar. Token-level facts here
> (colors, radii, weight 430, superellipse) remain valid.

This is the decision-ready distillation. Every claim here is backed by a cited,
confidence-marked entry in **`research-raw.md`** (1,648 lines, section numbers referenced
inline as §n). Where the raw doc says `[inferred]` or `[unknown]`, that is repeated here.

## What "the Codex app" is, and what we could actually verify

The Codex desktop app is a **native Electron app, macOS + Windows only** (§1.1). It cannot
be installed or inspected from this environment, so **pixel-level evidence for the app
chrome itself does not exist in this audit**.

What *does* exist, and is what this spec is built on:

1. **`openai/codex` — the open-source CLI.** Its Rust TUI encodes the exact rendering
   grammar for tool calls, diffs, approvals, and status, including committed snapshot
   tests that pin the literal output character-for-character. This is the strongest
   evidence available anywhere and it is authoritative for *behaviour and grammar*.
2. **`codex-rs/tui/src/inline_visualization/assets/visualize.css`** — OpenAI's actual
   CSS token contract for HTML rendered inside Codex surfaces, headed *"Agent-facing
   contract; keep in sync with SKILL.md."* This is the closest public artifact to the
   Codex/ChatGPT web design system and is the source of every hex value below.
3. **`git_action_directives.rs`** — exists *solely* to strip markers that "the Codex App"
   renders as rich UI. It is direct, if indirect, evidence of app-side rendering (§10.11).

**Confidence honestly stated:** the *interaction grammar* is verified. The *desktop app's
panel geometry* is not — see "Unverifiable without screenshots" at the end.

---

## 1. The single most important finding

> **Codex's transcript has no cards, no boxes, no borders, and no background fills on
> tool cells.** Only the session header uses a box. (§10.1)

Every agent action is an **inline block** in one column:

```
<glyph> <BOLD VERB> <subject>
  │ <command continuation, max 2 lines>
  └ <result / detail, max 5 lines>
    <more detail>
```

| Column | Content |
|---|---|
| 0 | status glyph — `•`, or `✔`/`✗`/`⚠`/`■`/`ⓘ` for non-tool cells |
| 1 | space |
| 2… | **bold verb** (`Ran`, `Explored`, `Called`, `Edited`, `Searched the web`) |
| then | space + subject (command, path, tool name, query) |

Gutter prefixes are fixed 4-column strings: `"  │ "` for command overflow, `"  └ "` for
the first detail line, `"    "` for subsequent detail lines (§4.2).

Atlas today renders the exact opposite: a bordered row with a rounded container, a colored
status pill, and nested bordered panels on expand. **This is the P0 decision of the whole
migration.**

## 2. Verb table — how a call announces itself (§10.2)

| Tool / action | Running | Finished |
|---|---|---|
| Shell command | `Running` | `Ran` |
| Shell command the *user* typed | — | `You ran` |
| Read/list/search cluster | `Exploring` | `Explored` |
| MCP tool | `Calling` | `Called` |
| Web search | `Searching the web` | `Searched the web for {query}` |
| File edit | — | `Edited` / `Added` / `Deleted` / `Edited {n} files` |
| Unapplied edit | — | `Proposed Change {path} (+a -b)` |
| Plan | — | `Proposed Plan` / `Updated Plan` |
| Image | — | `Generated Image:` / `Viewed Image` |
| Lifecycle hook | `Running {label} hook` | `{HookName} ({status})` |

Sub-verbs inside an `Explored` cell render **cyan**, one per line under `└`:
`Read` · `List` · `Search` · `Run`.

**The verb is bold; the subject is not.** No icons are used to identify tool type in the
CLI — the verb does that job. (The app's icon set is Lucide at `stroke-width: 1.6`, §5,
but per-tool glyph choices are `[unknown]`.)

## 3. Grouping — the rule that changes the most (§10.5)

Consecutive read-only calls **merge into one `Explored` cell**, and consecutive `Read`s
inside it merge onto **one line** with deduplicated names:

```
• Explored
  └ Search shimmer_spans
    Read shimmer.rs, status_indicator_widget.rs
```

> **N file reads = 1 line, not N cards.**

Algorithm: walk the call list; if a call's parsed commands are *all* `Read`, greedily
extend the group over following all-`Read` calls; emit one `Read` line with unique names
joined by **dim commas**. Any non-read call ends the group.

## 4. Command execution (§10.3)

```
• Ran set -o pipefail
  │ cargo test -p codex-tui
  │ --quiet
  └ (no output)
```

1. Command text is **bash-syntax-highlighted in the header**; `bash -lc` wrappers stripped.
2. First wrapped segment stays on the header line; overflow goes to `│` lines, capped at
   **2 lines** with `… +N lines`.
3. **stdout and stderr are interleaved in one stream** — no channel split, no color split.
4. **All output text is `DIM`** — output is recessive relative to the command.
5. **Head/tail truncation, not head-only**: N lines from the head, N from the tail, with
   `… +{omitted} lines (ctrl + t to view transcript)` between them.
6. Limits: **5 lines** for agent calls, **50 lines** for user-invoked shell.
7. Empty output → literal **`(no output)`**, dim.
8. **Exit code and duration are NOT in the collapsed view.** Success/failure is conveyed
   *only by the bullet color*. `✗ (1) • 0ms` appears only in the ctrl+t transcript.

## 5. Diffs (§10.6)

**Unified, never side-by-side.** Format: `{right-aligned line number}{space}{sign}{content}`.

```
• Edited example.txt (+1 -1)
    1  line one
    2 -line two
    2 +line two changed
    3  line three
```

- Header carries the summary `(+N -M)` with **`+N` green, `-M` red**, parens default color.
- **Single file** → verb + path + counts on the header, no per-file sub-header.
- **Multiple files** → `Edited {n} files (+total -total)`, then one `  └ {path} (+a -b)`
  per file, blank line between chunks, body indented 4 columns, **files sorted by path**.
- Renames render `old → new`; highlighting uses the **destination** extension.
- Non-adjacent hunks separated by a lone **`⋮`**.
- Line numbers: old number on delete, new number on insert, shared on context.
- Content is syntax-highlighted per language with add/del backgrounds composited under it;
  delete lines get a `DIM` overlay on the syntax colors.
- `[unknown]` — no per-file collapse exists in the CLI; large-diff caps not observed.

### Diff palette — exact hex (§3.3), GitHub's palette

| | Dark | Light |
|---|---|---|
| Add line bg | `#213A2B` | `#DAFBE1` |
| Del line bg | `#4A221D` | `#FFEBE9` |
| Add number bg | — (dim gutter) | `#ACEEBB` |
| Del number bg | — (dim gutter) | `#FFCECB` |
| Gutter fg (light) | — | `#1F2328` |
| Add fg | `Green` | default (pastel bg carries it) |
| Del fg | `Red` | default |

## 6. Reasoning vs. action (§10.8)

Reasoning and assistant text use the **same `• ` dim prefix** as tool cells but with
**no bold verb**. *The absence of a verb is the entire differentiator.* No card, no icon,
no title, no "Thought process" heading.

- Reasoning cells support a `transcript_only` flag: render **nothing** in the main view,
  visible only in the ctrl+t transcript. That is the CLI's collapse affordance.
- User messages use **`› `** (bold+dim) with a blank line above and below and a background
  tint (white @ α 0.12 on dark, black @ α 0.04 on light).
- Assistant messages get `• ` on the **first line only**; later lines indent 2 spaces.
- Empty reasoning summaries are suppressed entirely.

## 7. Turn boundaries & timing (§10.9)

- A turn that **did concrete work** ends with a full-width horizontal rule. Purely
  conversational turns get **no divider**.
- Turns over **60 s** get a labeled rule: `─ Worked for 2m 05s ────────…`
- Optional metrics join with ` • `: `Local tools: {n} call(s) ({duration})`,
  `Inference: {n} call(s) ({duration})`.
- **Per-call timing is not shown in the main view** — only aggregate, in the turn footer.

## 8. Status glyph + color vocabulary (§3.4)

| Meaning | Glyph | Color |
|---|---|---|
| Tool succeeded | `•` | green, **bold** |
| Tool failed | `•` | red, **bold** |
| Tool running | `•` | shimmering (§10 below) |
| Tool idle/neutral | `•` | dim |
| Approval granted | `✔ ` | green |
| Approval denied | `✗ ` | red |
| Warning | `⚠ ` | yellow (red bold when fatal) |
| Hard error | `■ ` | red |
| Info / policy block | `ⓘ ` | default |
| Plan step done | `✔ ` | crossed-out + dim |
| Plan step pending | `□ ` | default |
| User message prefix | `› ` | bold + dim |

There are **no status badges, no pills, no uppercase labels**. Status is glyph + color.

## 9. Approvals — verbatim copy (§9.3)

```
  Would you like to run the following command?

  Reason: this is a test reason such as one that would be produced by the model

  $ echo hello world

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `echo hello world` (p)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
```

- Patch variant: title `Would you like to make the following edits?`, option 2 becomes
  `Yes, and don't ask again for these files (a)`.
- Network variant: `Do you want to approve network access to "example.com"?` with a
  four-option list including `Yes, and allow this host for this conversation (a)` and
  `Yes, and allow this host in the future (p)`.
- Style: title **bold**, `Reason:` value *italic*, selected row `› 1.` **cyan + bold**,
  `(y)`/`(a)`/`(p)` hints **dim**, footer **dim**.
- Header rows may precede the question, in order: `Thread:`, `Environment:`, `Reason:`,
  `Permission rule:` (cyan), then `$ {highlighted command}`.
- **The command being approved is always shown, syntax-highlighted, above the options.**

**Decision receipts** are written back into the transcript afterwards (§9.4):
`✔ You approved codex to run <cmd> this time` ·
`✗ You did not approve codex to run <cmd>` ·
`` ✔ You approved codex to always run commands that start with `<prefix>` ``

## 10. Motion (§8)

**Web/app** — deliberately minimal, only three transitions exist:
- `150ms` for color / border / box-shadow state changes
- `200ms` for positional (thumb travel) changes
- Easing is **`cubic-bezier(0, 0, 0.2, 1)`** (Material decelerate) everywhere

**CLI shimmer** — the distinctive running indicator. A light band sweeps left→right across
the status text continuously:
- `padding = 10` chars each side; `period = len + 2*padding`
- **`sweep_seconds = 2.0`**, phase-locked to a process-global clock so *all* shimmering
  elements are synchronized
- `band_half_width = 5.0` chars; falloff is a **raised cosine (Hann)**:
  `t = 0.5 * (1 + cos(π·d/5))` for `d ≤ 5`, else `0`
- Highlight pulls text **toward the background** at up to 90%, plus BOLD on every char
- Frame budget **32 ms (~31 fps)** while animating
- Reduced motion: indicator becomes hidden or a **static dim `•`**; shimmer degrades to
  plain text. Gated by `[tui] animations`.

**Worth copying wholesale:** there is a **compile-time lint test** that fails the build if
any file outside `motion.rs`/`shimmer.rs` calls `spinner()` or `shimmer_spans()` directly,
so the reduced-motion fallback can never be bypassed.

## 11. Design tokens — exact values (§3.1, §4.1, §2.1)

From `visualize.css`, using CSS `light-dark()`. **The app stamps `data-theme` on `:root`.**

| Token | Light | Dark |
|---|---|---|
| `--background` | `#FFFFFF` | `#181818` |
| `--foreground` | `#1A1C1F` | `#FFFFFF` |
| `--card` | `color-mix(in oklab, fg 5%, transparent)` | same formula |
| `--popover` | `#FFFFFF` | `#2D2D2D` |
| `--primary` | `#339CFF` | `#83C3FF` |
| `--primary-foreground` | `#FFFFFF` | `#0D0D0D` |
| `--secondary` | `#FFFFFF` @ 96% | `#363636` @ 96% |
| `--muted` | `color-mix(in srgb, fg 10%, transparent)` | same |
| `--muted-foreground` | fg @ 49.4% | fg @ 49.8% |
| `--accent` | `#E5F2FF` | `#0D273F` |
| `--destructive` | `#E25507` | `#FF8549` |
| `--border` | fg @ 8% | fg @ 8.2% |
| `--ring` | `#339CFF` | `#83C3FF` @ 76% |

Three structural facts that matter more than the hexes:

1. **Elevation is tint, not shadow.** `--card` is *5% foreground over background*.
   The only shadow token is `--shadow-sm: 0 1px 2px -1px rgb(0 0 0 / 8%)`; tooltips
   explicitly set `box-shadow: none`. Depth = surface tint + 8% hairline borders.
2. **Text secondary is ~50% opacity foreground**, not a separate hue.
3. **`--destructive` is orange (`#E25507` / `#FF8549`), not red.**

### Type scale

```css
--font-sans: -apple-system, system-ui, "Segoe UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
--font-size-base: 14px;
```

| Token | Value @ base 14 |
|---|---|
| `--font-size-small` | 12px |
| `--font-size-tooltip` | 13px |
| `--font-size-normal` | 14px |
| `--font-size-h3` | 18px |
| `--font-size-h2` | 20px |
| `--font-size-h1` | 24px |

- **Body weight is `430`**, not 400 — a variable-font optical tweak. Medium is `500`.
  `b`/`strong`/`th`/`h1–h6` → `500`. Only `caption`/`thead th` reach `600`.
- Line heights: normal `1.5` (21px), small `size + 4px`, h1/h2 `1.25`, h3–h6 `1.3`.
- Inline code: `0.92em`, mono, `padding: 1px 6px`.
- Right-aligned numerics use `font-variant-numeric: tabular-nums`.
- **No letter-spacing token exists anywhere** — tracking is browser default everywhere.

### Radii — and the signature detail

```css
--radius: 12.5px;
--radius-sm:  7.5px;   /* inline code, checkbox */
--radius-md:  10px;
--radius-lg:  12.5px;  /* button, input, select, tooltip */
--radius-2xl: 20px;    /* card, panel */
--radius-full: 9999px; /* badge, radio, switch */
```

Every rounded surface also declares **`corner-shape: superellipse(1.5)`** — squircle
corners, not circular arcs. This is the most distinctive purely-visual detail in the
system.

### Spacing & control sizing

Card padding `12px` · tooltip `4px 8px` · button/input padding-inline `8px` · textarea
`8px 10px` · grid gap `10px` · badge `3px 8px` · focus outline offset `2px`.
**Control min-height `28px`**; checkbox/radio `14×14`; switch `32×20` with a `16×16` thumb.
Net: a **4px base grid with a 2px sub-step**.

## 12. Microcopy (§9)

- Composer placeholder: **`Ask Codex to do anything`**
- Status line: **`• Working (0s • esc to interrupt)`**; alternates observed: `Analyzing`,
  `Investigating rendering code`, `Reviewing approval request`,
  `Reviewing {n} approval requests`
- Elapsed format: `0s` · `59s` · `1m 00s` · `3m 05s` · `1h 01m 01s`
- Footer: `? for shortcuts` … `100% context left` / `123K used`
- While running: `tab to queue message`
- `ctrl + c again to quit` · `esc esc to edit previous message` · `reverse-i-search: `
- Key hints use **spaces around `+`**: `ctrl + t`, `⌥ + ,` (`⌥` on macOS *and* Windows,
  `alt` on Linux)
- Truncation hint appended everywhere: **`ctrl + t to view transcript`**
- Agent status vocabulary: `Pending init` (cyan) · `Running` (cyan bold) · `Interrupted`
  (yellow) · `Completed` (green) · `Error` (red) · `Shutdown` · `Not found` (red)
- Agent list empty state: **`No agents completed yet`**

Tone: terse, second-person for user actions ("You approved…"), present participle for
in-flight work, past tense for completed work. No exclamation marks. No "Great!"/"Sure!".

## 13. Desktop-app-specific evidence (§10.11)

`git_action_directives.rs` exists to strip markers the app renders as rich UI:

- **`::code-comment{title= body= file= start= end= priority=}`** — an anchored inline
  code-review comment with a **P0–P3 priority badge** and a file:line-range link.
  `[verified]` that priority is 0–3; `[inferred]` that the app renders it as a badge.
- **`::git-stage` / `::git-commit` / `::git-create-branch` / `::git-push` /
  `::git-create-pr{branch= url= isDraft=}`** — `[inferred]` inline action buttons
  **inside the assistant message**, confirming git integration lives in the transcript,
  not only in a side panel.

Also `[verified]`: GitHub issue `openai/codex#16415` confirms **tool calls in the app's
thread are collapsed by default**, and that the diff sidebar is *"not the same as a fully
expanded working transcript."*

---

## Unverifiable without screenshots

These are `[unknown]` and any implementation of them would be invention, not parity.
Listed in priority order — the first four block real pixel parity.

1. **Pane geometry** — default split ratios, min/max widths, whether the right panel is a
   tab stack (Diff / Terminal / Browser) or independent toggles.
2. **Tab model** — are threads tabs or list rows? Is there a tab bar at all?
3. **Whether the app uses a licensed display face** (e.g. "OpenAI Sans") rather than
   `-apple-system`. The visualization sandbox uses system fonts; the chrome may not.
4. **Whether the app's transcript keeps the CLI's borderless grammar** or re-skins it as
   cards. `#16415` implies collapsed rows, which is compatible with either.
5. Git action button styling and placement.
6. Command palette invocation key, row layout, grouping.
7. Terminal panel styling; whether it is a real PTY.
8. Browser preview panel — whether it exists in the app at all.
9. Loading/skeleton treatment; first-run and empty states.
10. Completion-notification behaviour in-app (badge / toast / sound).
11. Icon sizes and per-tool glyph choices (only `stroke-width: 1.6` Lucide is confirmed).

**If you can send screenshots of items 1, 2, and 4, the rest of the spec becomes
implementable at pixel level.** Without them, everything above is still implementable at
*grammar* level, which is where the perceived difference actually lives.
