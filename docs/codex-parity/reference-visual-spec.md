# Codex app — reference visual spec (v2, from real product frames)

Source: official product frames captured 2026-07-29 from OpenAI's Codex landing page
(`docs/codex-parity/shots/reference/*.jpg|png`). These are renders of the actual
ChatGPT/Codex app, not the CLI TUI. **Where this spec conflicts with the earlier
TUI-derived `design-audit.md`, THIS spec wins.** The biggest correction: the app does
NOT use the TUI's `• verb` + `│` gutter cell grammar. Tool/agent activity renders as
dim collapsed summary rows and a "Changed N files" bar (see §5).

Key frames:
- `screenshot-1785267304270-0.jpg` — full shell: sidebar, header, empty state
- `screenshot-1785267354346-14.png` — sidebar zoom (2×)
- `screenshot-1785267361876-18.png` — composer zoom (2×)
- `screenshot-1785267374319-22.png` — transcript zoom: assistant turn, activity rows, changed-files bar
- `screenshot-1785267322915-8.jpg` — code-review turn: P1/P2 findings, "Fix with Codex"
- `screenshot-1785267322914-6.jpg` — scheduled-tasks list (Up next / Unread / Read)
- `screenshot-1785267361879-19.jpg` — sidebar variant with "ChatGPT Codex ▾" wordmark, Search, Sites
- `screenshot-1785267322916-12.jpg` — IDE extension card: per-file diff rows

Sampled colors (canvas pixel sampling, dark theme):
- Content background: `#181818` (confirms existing `--bg-base`)
- **Sidebar background: `#000000` — pure black, darker than content** (now `--bg-panel`)
- **Composer slab: `#212121` opaque, borderless** (now `--bg-composer`)
- Marketing transcript frames are glass-over-gradient — use them for STRUCTURE only, never sample their colors.

## 1. Shell layout

- Two columns only: sidebar (~230–256px) + content. No 72px icon rail. No third column by default.
- Sidebar is `--bg-panel` (#000), content `--bg-base` (#181818). Boundary is the color change itself — no visible border line.
- macOS traffic lights top-left inside sidebar; a sidebar-collapse icon button (panel outline icon) sits top-RIGHT of the sidebar, same row.
- Content header: thread title (~15px, medium, `--text-primary`) top-left of the content column, vertically centered with a **centered segmented control** (see §2). Header has no border-bottom; it floats over content bg. Height ~52px.
- Content column: single centered column, max-width ~48rem (768px), generous horizontal padding.

## 2. Header segmented control ("Chat | Work")

- Pill container: `--radius-full`, 1px hairline border (8% white), bg transparent-to-subtle, height ~30px.
- Two segments ~60px each. Active segment: near-white pill (own rounded-full bg, subtle lighter fill) with `--text-primary`; inactive: transparent, `--text-tertiary`.
- Map in Atlas: "Chat" = plain thread view, "Work" = thread + workbench context (this replaces the old workbench toggle button placement).

## 3. Sidebar content

Order, from top (see shots 14 + 19):
1. Traffic lights row (drag region) + collapse button right.
2. Wordmark row: app name bold ~17px. Codex variant renders "ChatGPT **Codex**" with "Codex" in periwinkle (#A5A6F6-ish) + tiny chevron. Atlas: "Atlas" wordmark, accent-colored second word optional.
3. Primary nav (icon + label rows, ~34px tall, 15px text, `--text-primary`, thin outline icons, transparent until hover `--bg-hover`, radius-md):
   - New chat (pencil-square icon)
   - Search (magnifier) — opens command palette
   - Sites (grid icon) — Atlas has this
   - Settings can live in footer as today.
4. Section header `Pinned` / `Projects` / `Chats`: ~13px, `--text-tertiary`, weight 400, margin-top ~20px, margin-bottom ~6px, NO uppercase, no tracking.
5. Rows: title (15px, `--text-primary`, truncate) + right-aligned relative time (`4h`, `1h`, `3d`) in ~13px `--text-faint`. Row height ~32px. Project rows get a folder outline icon; chats under a project indent to the text column with no icon.
6. Hover: `--bg-hover` rounded-md; active/selected: `--bg-active`.

No search input box inside the sidebar body, no pill-shaped "New chat" button, no avatars, no unread badges.

## 4. Composer (shot 18 — the highest-value fix)

Structure: an opaque rounded slab, **two stacked rows**, floating over page bg, centered, max-width ~48rem, NO border, NO shadow ring.

- Slab: bg `--bg-composer` (#212121), radius ~28px (superellipse corner-shape), padding ~14px 18px.
- Row 1: bare textarea, no inner border/bg. Placeholder `--text-tertiary` ~15px. ("Work with ChatGPT" in reference; keep Atlas copy.)
- Row 2 (controls, ~40px, space-between):
  - Left: `+` plain icon button (20px glyph, `--text-secondary`, no circle/border) → attachments. Then optional mode control with icon + 14px label (`--text-secondary`) — reference shows "✋ Ask for approval".
  - Right: model chip: bolt icon + model name (14px, `--text-primary`, medium) + variant/effort word (`--text-tertiary`) + small chevron; the whole chip is a borderless hover-bg button. Then the send button: **circular, filled near-white (#e8e8e8), dark up-arrow glyph, ~36px**; disabled state dims to ~35% opacity slab-colored.
- Above the slab, left-aligned: optional context chip ("Choose project": folder icon + 14px `--text-tertiary` label, transparent bg, hover subtle) — Atlas maps this to model/workspace context if desired.
- Empty state: ghost logo (outline, `--text-faint`) centered above ~28px regular-weight greeting "What should we get done?" (`--text-primary`); composer sits mid-screen below it; suggestion chips optional below composer.
- In-thread: composer docks at bottom, same slab.

## 5. Transcript (shots 22, 8, 6 — structure only, colors from tokens)

**User message**: right-aligned bubble. Bg = subtle elevated tint over content (`--bg-surface`-ish), radius ~18–20px, padding ~10px 16px, max-width ~75%, 15px text `--text-primary`. No name, no avatar, no timestamp row.

**Assistant message**: plain text directly on `--bg-base`. No bubble, no card, no avatar. 15px, line-height ~1.6, `--text-primary` at ~90% intensity. Markdown: inline code in small `--bg-code` chips with hairline border, mono ~13px (see the `imagegen` chip, shot 4/5).

**Activity rows** (replaces the TUI `•` cell grammar — this is the correction):
- Between/above assistant paragraphs, each activity phase is ONE dim summary row: `Thought for 8s`, `Explored 3 files`, `Worked for 45s ›`, `Ran npm test`, ~13–14px, `--text-tertiary`, weight 400, NO bullet glyph, NO left gutter bars, NO borders/cards.
- Rows are buttons: hover shows `--text-secondary` + a small chevron (`›`) after the label; click expands details inline below the row (indented ~16px, still borderless: dim mono lines for commands/output, file list for Explored, reasoning text for Thought).
- While running, the row label is the active form ("Thinking", "Exploring files", "Running npm test") with a text shimmer — keep the existing shimmer.
- Coalescing stays: N reads → one `Explored N files` row. Elapsed seconds render inside the label ("Thought for 8s"), not as a right-aligned duration.

**Changed-files bar** (end of a turn that edited files):
- Full-width-of-column rounded-xl bar, elevated tint bg, ~48px: left small file-stack icon or thumbnail, "Changed 8 files" 14px `--text-primary`, then `+23` in `--success` and `-16` in a RED/salmon (diff counts use green/red even though semantic error is orange), right-aligned "Review" 14px + `›` chevron. Hover lightens. Click → workbench/diff panel.
- IDE-style expansion (shot 12): header row "2 files edited +123 −42 · Review ↗" then one row per file: `slider.tsx` `+83 −0` with chevron, hairline separators, each expandable to its diff.

**Approval prompt**: keep existing inline copy/options, but restyle: borderless, question 14px `--text-primary`, command as dim mono line, options as simple rows (no card chrome).

**Code-review findings** (shot 8): priority badge `P1` — small rounded-md chip, elevated bg, 12px semibold — + bold 15px title on one line; body dim 14px below; optional right-aligned link-styled action ("Fix with Codex"). Borderless, separated by whitespace only.

**Task/status lists** (shot 6, workbench Tasks tab): section headers dim 13px (`Up next`, `Unread`, `Read`); rows = status glyph (spinner ring = running, hollow circle = queued, blue dot = unread/new, dim check = done) + 15px name + dim source label + right-aligned dim status text ("In progress", "Starts in 13min", "5m", "1d"). Row ~40px, borderless, hover bg.

## 6. Typography & feel

- Everything regular-weight and calm: headings are size changes, not weight jumps. Only user-emphasis and row titles get medium (500).
- Text hierarchy is opacity-based (white at 100/78/50/32%), not hue-based.
- Density: transcript blocks separated by ~16–20px whitespace; no dividers anywhere in the transcript.
- Radii: big surfaces very round (composer ~28px, bubbles ~18px, bars ~14px) + superellipse. Small controls radius-md.
- No cards, no borders except 8% hairlines on chips/segmented control, no shadows.
