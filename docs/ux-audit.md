# Atlas UI/UX Audit

Full-surface audit of the renderer, 2026-07-29. Goal: an easy, clean, minimalist UX.
Every finding carries `file:line` (renderer paths relative to `src/renderer/`) and a suggested fix.
Severity: **H** = user-visible breakage or fights the user · **M** = friction/inconsistency · **L** = polish.

---

## 0. Top 10 — fix these first

| # | Sev | What | Where |
|---|-----|------|-------|
| 1 | H | Post-send scroll animation reverts the user's own scrolling for ~1s (`ignoreEscapes`) | `ChatWindow.tsx:700-710` |
| 2 | H | Scrollbar toggles 0→6px layout width on hover — the whole pane reflows (this is the "scrollbar flow" jank) | `styles.css:568-586` |
| 3 | H | Virtualizer measures deferred (plain-text) rows, then re-measures rich rows — transcript shuffles on every scroll | `ChatWindow.tsx:796,803` |
| 4 | H | Syntax highlighting is completely inert — dual-theme shiki tokens never expose `.color` | `CodeBlock.tsx:169-189,248` |
| 5 | H | Toasts are undismissable AND 3%-opaque (`--bg-subtle` instead of `--toast-bg`) | `lib/notify.ts:21-22`, `ui/sonner.tsx:28` |
| 6 | H | Main titlebar is almost entirely non-draggable (no-drag applied to whole grid cells) | `App.tsx:801,829,864` |
| 7 | H | Composer draft + attachments leak between conversations | `App.tsx:126`, `Composer.tsx:317` |
| 8 | H | `*:focus-visible` sets `border-radius` on the element — circles snap to 4px boxes on keyboard focus | `styles.css:391-395` |
| 9 | H | Windows/Linux builds have no minimize/maximize/close (frameless, no `titleBarOverlay`) | `src/main/.../createWindow.ts:17` |
| 10 | H | Truncated tool/diff output ("… +N lines") is static text — content permanently unreachable, no copy button | `TerminalBlock.tsx:59-65`, `DiffBlock.tsx:68-72`, `ToolCell.tsx:264-268` |

---

## 1. Scrolling & scrollbars (the core complaint)

The "bad scrollbar flow" is not one bug — it is five stacked ones:

- **H — Layout-shifting scrollbar reveal.** `styles.css:568-586` — styling `::-webkit-scrollbar` opts out of macOS overlay scrollbars, so the bar consumes layout width. `.scrollbar-auto-hide` then animates `width: 0 → 6px` on `:hover`/`:focus-within`, shrinking the content box 6px: every line re-wraps, sidebar titles re-truncate, and Tab-focus jitters the list. Fix: keep width constant and animate only thumb color (`--scrollbar: transparent` → opaque), or add `scrollbar-gutter: stable`. Note `scrollbar-width` (`:569,579`) and `::-webkit-scrollbar` conflict in Chromium ≥121 — the standard property wins and yields a wide native default-colored bar on hover. Pick one system.
- **H — Stick-to-bottom fights the user.** `ChatWindow.tsx:700-710` calls `scrollToBottom({ animation: 'smooth', ignoreEscapes: true })` on every new request; while that spring animation runs (~1s from far up), the lib reverts `scrollTop` and swallows wheel input. Fix: drop `ignoreEscapes`, use `instant`, and gate on `isAtBottom`.
- **H — Wheel-escape broken over code blocks.** `useStickToBottom`'s `handleWheel` bails when the wheel target sits in any `overflow: auto` ancestor other than the scroller; `overflow-x-auto` on `<pre>` (`CodeBlock.tsx:322`, `ToolCell.tsx:236,389`) computes `overflow-y: auto` too, so scrolling up with the cursor over code never releases the streaming lock — you get yanked back down. Fix: own wheel listener on the scroll container, or restructure the `<pre>` overflow.
- **H — Virtualizer mis-measurement.** Overscan rows render as `AssistantTextFallback` (plain text, tools/markdown stripped) but still get `ref={rowVirtualizer.measureElement}` (`ChatWindow.tsx:796,803`); entering the visible range re-renders them hundreds of px taller → total-size changes → everything shifts. Also: no `shouldAdjustScrollPositionOnItemSizeChange` (`:608-635`), so above-viewport corrections move content under the reader; height estimates clamped at 560/320 (`:489-539`) make the thumb size a lie.
- **M — Missing scroll CSS.** No `overflow-anchor: none` and no `overscroll-behavior: contain` on the transcript scroller (`ChatWindow.tsx:749-755`) — browser scroll anchoring runs concurrently with the virtualizer + stick-to-bottom RAF, and overscroll rubber-bands the whole window.

Related scroll issues:

- **H** First paint of every conversation renders the *entire* history unvirtualized, then swaps to the virtual list (`ChatWindow.tsx:638,810-815`). Multi-second stall on long threads. Render a spacer until `virtualItems.length > 0`.
- **H** Stick-to-bottom state survives conversation switches — `ChatWindow` isn't keyed by conversation id; you land mid-scroll in the new thread. Fix: `key={selectedConversationId}` or instant scroll-to-bottom on id change.
- **H** "Load older" prepend compensation is computed against *estimated* heights, so restoring the reading position drifts (`ChatWindow.tsx:662-685`). Use `scrollToIndex` after prepend instead.
- **M** `resize: 'smooth'` while near bottom means expanding a reasoning/tool cell scrolls the view away from what you clicked (`ChatWindow.tsx:593`). Keep `resize: 'instant'`.
- **M** "Jump to latest" button pops in/out with no transition, flickers around the 70px threshold, shows no unread count (`ChatWindow.tsx:832-845`). Always mount + animate opacity, add hysteresis (show >120px, hide <40px).
- **M** Auto-load-older fires on first paint of any thread (`visibleRange.startIndex === 0` is true immediately) on top of a redundant manual button that shifts the transcript when it appears (`ChatWindow.tsx:687-698,763-775`).
- **M** Code block horizontal scrollbars are permanent 6px bars flush against the card border, and right padding is not honored at scroll-end (`CodeBlock.tsx:322` + `styles.css:550-553`).
- **M** Diagram traps the scroll wheel — hovering a diagram zooms it instead of scrolling chat (`interactive-diagram.tsx:299`). Set `zoomOnScroll={false}`, gate zoom on ⌘.
- **M** Sites workspace shows up to five independent scroll containers at once, none using `.scrollbar-auto-hide` (`sites/SitesWorkspace.tsx:124,182,247,335,589`).

**Recommended scrollbar system (one decision, applied everywhere):** constant-width 6px custom scrollbar, thumb `transparent` at rest → `var(--scrollbar)` while scrolling or hovering the container, `scrollbar-gutter: stable` on every vertical scroller, `overscroll-behavior: contain` on the transcript and sidebar. No width animation anywhere.

---

## 2. Chat transcript & layout

- **M — Composer wider than message column.** Transcript uses `px-6 lg:px-7 xl:px-8` *inside* `max-w-content-max`; composer uses `px-5 lg:px-6` *outside* it (`ChatWindow.tsx:759` vs `Composer.tsx:501-502`). Edges don't line up (~32px overhang/side). Use one shared wrapper.
- **M — Two width rails disagree.** Assistant text capped at `76ch` (~600px), user bubbles at 75% of the 796px column, right-flush (`ChatWindow.tsx:360` vs `:331`) — transcript reads lopsided. Pick one measure.
- **L — `--content-max: clamp(680px, 102vw, 860px)`** keys on viewport, not panel width — ignores sidebar/workbench (`styles.css:139`). Use `min(860px, 100%)` or a container query.
- **M — Two divergent empty states** for the same suggestions view with different padding/centering; visible jump when `detail` resolves (`ChatWindow.tsx:726` vs `:777-780`).
- **L** Loading state is a spinning `RefreshCw` (a *retry* glyph); switching between two loaded conversations shows stale messages with no loading affordance (`ChatWindow.tsx:718-724`).
- **H — Hover actions invisible to keyboard.** Copy/regenerate rows are `opacity-0 group-hover:opacity-100` with no `group-focus-within` (`ChatWindow.tsx:341,371`). Same defect: sidebar delete (`Sidebar.tsx:347`), tool-cell chevron (`ToolCell.tsx:132-140`), visual toolbar (`visual.tsx:229`).
- **M — Regenerate is dead.** `onRegenerate` is never passed, so the button can never render (`ChatWindow.tsx:801-805` vs `:381-391`).
- **M — Text selection broken by virtualization** (rows unmount, Cmd+A copies only mounted rows). Can't be fixed under virtualization — add an explicit "Copy conversation" action.
- **H — `role="log" aria-live="polite"` on the virtualized container** re-announces on every token *and* every scroll (`ChatWindow.tsx:753-754`). Move announcements to a dedicated off-screen region, turn-boundaries only. Same problem on every tool cell (`ToolCell.tsx:66-72`).
- **M** Scroll container isn't focusable (`tabIndex`), so PageUp/Down/Home/End are dead (`ChatWindow.tsx:750-755`).
- **L** Streaming placeholder "Thinking" has no reserved height — hard jump on first token (`ChatWindow.tsx:161-164`). Live row uses `mt-6` (24px) while history gap is 22px (`:818-828`).
- **L** No `::selection` style anywhere — OS default blue on all dark themes (`styles.css`).
- **L** `groupAssistantParts` not memoized — recomputed on every streamed token per visible row (`ChatWindow.tsx:172`). Dead props `latencyMs`, `hasVision` (`:145,547`).
- **L** Copy confirmation is a *dimmer* check icon plus a delayed native tooltip (`ChatWindow.tsx:343-350`). Clipboard failures are swallowed silently (`hooks/useClipboard.ts:28-30`).

---

## 3. Composer

State bugs:

- **H — Draft text is a single global string** — switching conversations carries your half-typed message into the other thread (`App.tsx:126`). Store per-conversation drafts like `selectedModelIdByConversation`.
- **H — Staged attachments also leak across conversations** (`Composer.tsx:317`; component never remounts).
- **H — Drag-and-drop: zero visual feedback** and the document-level drop handler bypasses `disabled`/`isStreaming` guards (`Composer.tsx:349-369`). Add a drop overlay + guards.
- **H — Double-send window** while blob→dataURL conversion runs before `onSend` — UI unchanged, Enter twice sends twice (`Composer.tsx:383-394`). Add `isSubmitting`.
- **H — Enter is silently swallowed while streaming** (`Composer.tsx:376-379,407`) — dead key with no feedback while the button says Stop. Map Esc → stop, hint it.
- **H — Mention autocomplete dies after one blur** — `dismissed` only re-arms on Backspace/Space, never on typing `@` again (`Composer.tsx:561-564`, `MentionAutocomplete.tsx:88,121`). Reset on focus and on trigger-index change.
- **M — Pasting mixed text+image discards the text** — `preventDefault()` fires if any clipboard item is a file (`Composer.tsx:424-442`).
- **M — Backspace silently deletes the last attachment** with no pending-delete step and no undo (`Composer.tsx:415-421`).
- **M — Suggestion clicks overwrite typed text wholesale** (`App.tsx:881,988`).
- **M — Auto-grow:** `useEffect` (flash on paste; should be `useLayoutEffect`), never recomputes on width change — needs a `ResizeObserver` (`Composer.tsx:324-329`). Max-height 180px hardcoded twice and doesn't scale with font size (`:328,572`).

Controls & layout:

- **M — Model picker is a centered modal dialog** while its two sibling controls are anchored dropdowns (`ai-elements/model-selector.tsx:19,36`). Convert to Popover+Command, `side="top" align="end"`. The dialog's default close X also overlaps the search input (`ui/dialog.tsx:51,68-76`).
- **M — Model chip + reasoning word read as one control** but the chevron opens the *effort* menu (`Composer.tsx:625-651`). Separate the affordances.
- **M — Control row shifts on model switch** (context ring / effort word / chevron each conditionally render) — send button moves horizontally (`Composer.tsx:607`, `ComposerParameters.tsx:62-64`).
- **M — Missing `min-w-0`** breaks truncation of model chip and lets the row overflow at narrow widths (`ModelSelector.tsx:124,137-143`, `Composer.tsx:578`).
- **H — Attachment remove button is a 16px hit target** ~2px from the chip edge (`Composer.tsx:265`). Expand hit area to ≥28px.
- **M — Attachment errors styled as passive tertiary hints**, never auto-clear, no `aria-live` (`Composer.tsx:535-537,336-340`). Use error tokens + `role="status"`.
- **M — Native `title` or nothing:** permission and effort menus have zero hover explanation; the `ui/tooltip.tsx` primitive is mounted but unused app-wide (`ParameterMenu.tsx:60-68`, `App.tsx:975`). Adopt the shared Tooltip everywhere.
- **M — Placeholder does all the work:** no disabled-state explanation, no Enter/Shift+Enter or `@` hints, no `aria-label` (`Composer.tsx:566-568`).
- **M — Mention popup anchored to container corner, not caret; not portaled; will clip** (`MentionAutocomplete.tsx:142`). No combobox ARIA wiring on the textarea (`Composer.tsx:548-574`).
- **M — Attachment chips:** 18px unidentifiable thumbnail, ~8-char filename, hover card repeats the name instead of showing the image (`Composer.tsx:243-274`); row grows unbounded past 8 files (`:521-533`); chips not keyboard-focusable but have `cursor-pointer` (false affordance).
- **M — ParameterMenu chevron never rotates** — `data-[state=open]` targets the SVG, Radix stamps the button (`composer/ParameterMenu.tsx:67`). Use `group-data-[state=open]:rotate-180`.
- **M — Model picker "Free only" filter on by default** with a 24px toggle; "N models" reflects the filtered count — catalog looks smaller than it is (`ModelSelector.tsx:83,166-192`). "No key" badge stamped on all 40 rows of a provider instead of once on the group header (`:255-262`).
- **L — Five icon sizes and two stroke weights in one 36px row** (`Composer.tsx:587,597,668,670`, `ComposerParameters.tsx:38`, `ParameterMenu.tsx:67`). Standardize 16px/1.75.
- **L — Context ring is the row's only bordered, square, press-animated, 32px control** among 36px round ghosts (`ai-elements/context.tsx:157`).
- **L — `rounded-[28px]` slab bypasses tokens** and ignores the user's border-radius=none setting (`Composer.tsx:520`). Add a `--radius-composer` token.
- **L — Disabled send at `opacity-35`** with a static "Send message" tooltip even when blocked for a stated reason (`Composer.tsx:657,665`).
- **L — Optical misalignment:** text starts at 18px inset, first icon at 14px (`Composer.tsx:520,539`).
- **L** Attach limits (8 files/15MB) never surfaced until violated (`shared/attachments.ts:46-47`). Gallery button never disabled, unlike every sibling (`Composer.tsx:590-598`).

---

## 4. Sidebar & navigation

Conversation list:

- **H — "Search" doesn't search conversations** — it opens a command palette containing 8 static commands, placeholder "Type a command…" (`App.tsx:763-768`, `CommandPalette.tsx:54`). Feed conversations into the palette or rename the row.
- **H — No rename anywhere.** No `conversations.rename` IPC exists (contracts expose list/create/get/delete only, while `sites.rename` exists). Auto-titles are permanent. Add the IPC + context menu (Rename/Delete) + double-click inline rename.
- **M — Delete confirm is sticky and un-escapable** — cleared only by clicking the row or the X; Esc/outside-click/scroll leave "Delete this chat?" armed forever (`Sidebar.tsx:115,345`). The confirm also *overlays* the still-clickable title with a gradient mask and collides at min width (`:304-338`). Replace row content when pending; handle Esc + outside click.
- **M — No date grouping** — one flat "Chats" header for a potentially 200-item list (`Sidebar.tsx:274-278`). Group Today/Yesterday/This week/older in `sidebarViewModel.ts`.
- **M — Relative timestamps degrade to "412d"** (`sidebarViewModel.ts:59-60`); the label overflows its fixed 24px box with no `overflow-hidden` (`SidebarConversationRow.tsx:75-78`); it flickers out when hovering *any* row.
- **M — ~72px of the row permanently reserved** for a hover-only trash button + timestamp — at min width the title gets ~112px (`Sidebar.tsx:291`). Cross-fade timestamp ↔ action in one 24px slot.
- **M — Tooltip shows the pre-clipped title** — `clipLabel(value, 90)` bakes `…` into the string used for `title=` (`sidebarViewModel.ts:23-31`, `SidebarConversationRow.tsx:71`). Keep the raw title for the tooltip.
- **M — Empty state is a blank void** — no "No chats yet", no ⌘N hint (`Sidebar.tsx:274-279`).
- **M — Active row ≈ hover row** (12% vs 6% white wash, nothing else) (`Sidebar.tsx:292`). Add text-color/weight delta or a 2px accent rail.
- **M — No arrow-key navigation**; expanded rows lack `aria-current` (collapsed rail has it) (`Sidebar.tsx:284-293` vs `:216`).
- **L** Delete icon at `text-text-faint` ≈ 2.4:1 contrast (`Sidebar.tsx:347`). "Chats" header not sticky. No scroll fade at list top. No virtualization at ~500 rows.

Collapse/expand & rail:

- **M — Collapse toggle teleports** ~200px between expanded (titlebar right) and collapsed (rail item) positions (`Sidebar.tsx:135-150` vs `:163-171`). Keep it in the titlebar row in both states.
- **M — Holding ⌘ replaces the toggle icon with a shortcut chip**, resizing the button (`Sidebar.tsx:143-149`). Make the hint additive like the New-chat row (`:253-259`).
- **M — View transition cross-fades two unrelated layouts** with horizontal squish (`Sidebar.tsx:121`, `styles.css:608-620`). Clip snapshots (`object-fit: none; object-position: left top`).
- **M — Icon-only rail relies on native OS tooltips** (~1s delay, never on keyboard focus); collapsed gear/… buttons have none at all (`Sidebar.tsx:167-217`, `SidebarSettingsMenu.tsx:99-126`).
- **L** Rail is 72px for 36px buttons — 56px suffices (`styles.css:141`). Every conversation renders as ambiguous 2-letter initials — cap at ~8 or drop. Dead code: `SidebarConversationRow`'s entire `isCollapsed` branch is unreachable (`Sidebar.tsx:296` hardcodes false) and the two glyph helpers disagree (2-letter vs 1-letter). Running indicator differs between modes (dot vs spinner).
- **L** Three row heights (`h-8.5`/`h-8`/`h-9`) and three left-edge alignments (wordmark `px-4`, nav `px-3`, rows `px-2`) in one panel. Sidebar titlebar is 52px holding one 20px button, wordmark gets a second row — ~80px of chrome before the first action (`Sidebar.tsx:130-152,242-244`).
- **M — Settings footer overflows the collapsed rail** — gear + `…` = 64px in 56px usable (`Sidebar.tsx:362`, `SidebarSettingsMenu.tsx:92`). Collapse to one trigger. Update-available state is only visible *inside* the closed menu — no badge on the trigger (`SidebarSettingsMenu.tsx:55-69`).

Resize handle (`PanelResizeHandle.tsx`, `hooks/useResizablePanel.ts`):

- **M** No double-click-to-reset (Home-key only, undiscoverable; hook doesn't even expose `defaultWidth`). No cursor/`user-select` lock during drag — I-beam flicker + accidental text selection. No `pointercancel` → stuck resize state + leaked listener. Focus ring explicitly suppressed on a tabbable control (`focus-visible:outline-none`).
- **M** `localStorage.setItem` every animation frame during drag (`useResizablePanel.ts:28-35,53-54`). Persist on pointer-up.
- **L** 8px hit area / 1px indicator that snaps to full `bg-brand` instantly — widen to 12px, `w-0.5 rounded-full`, 150ms fade.

Command palette:

- **M** Stray close X overlaps the search input (`showCloseButton` defaults true) (`CommandPalette.tsx:45-51`, `ui/command.tsx:36`). Disabled items give no reason (untooltippable, `pointer-events-none`). No `keywords` — "hide sidebar", "theme", "dark" match nothing (`CommandPalette.tsx:72`). Description competes with title on one line, both truncating.
- **L** 8 commands total, no recents, no theme/settings-section/workbench/sites commands; no `loop` on arrows; no footer key hints.

---

## 5. Titlebar & window

- **H — Titlebar is non-draggable** — `no-drag` is applied to the three whole grid cells, not the buttons inside them; only `px-5` edge slivers drag; double-click-to-zoom dead (`App.tsx:797-868`). Move `no-drag` onto the actual interactive elements.
- **H — Windows/Linux: frameless with no window controls** — `titleBarStyle: 'hiddenInset'` is macOS-only and no `titleBarOverlay` is configured (`createWindow.ts:17`).
- **M** Traffic lights nearly collide with the conversation title when sidebar is collapsed (~14px gap). Set `trafficLightPosition` explicitly and reserve inset when collapsed.
- **M — AppUpdateButton escapes its grid cell** with `absolute right-4` inside the `px-5` titlebar — 4px misalignment (`AppUpdateButton.tsx:48-51`). Also: square corners in a rounded system (`:57`), silent on `checking`/`error` (menu action gives zero feedback), no download progress (`:11-29`).
- **M** Sites drag strip hardcodes `h-[52px]` instead of `h-titlebar-height` — desyncs if font size changes (`sites/SitesWorkspace.tsx:462`; same in `SettingsWorkspace.tsx:203,207`).

---

## 6. Tool cells, code, diffs, terminal, visuals

Code blocks (`CodeBlock.tsx`):

- **H — Highlighting is dead.** Dual-theme shiki (`themes: highlighter.getThemes()`, `:248`) returns tokens with `htmlStyle`, never `.color` — every `<span style={{color: undefined}}>`. Consume `htmlStyle`/`--shiki-dark`, or use a single theme matched to the app theme.
- **H — `pre` bg/fg inline styles are invalid** — dual-theme `bg` is a semicolon-joined string, rejected by CSSOM; intended fallback skipped (`:321-327`). Style from `var(--bg-code)` instead.
- **H — Two different code blocks in one transcript.** Fences not in `codeLanguages.ts` (incl. `js`, `ts`, `py`, `yml`, untagged) fall to Streamdown's default `<pre>` — different chrome, **no copy button** (`ai-elements/codeLanguages.ts:11-46`, `MessageResponseContent.tsx:22`). The alias table at `CodeBlock.tsx:60-70` is unreachable. Route all fences through `CodeBlock`.
- **L** Permanent 33px header on every fence incl. one-liners; label falls back to the literal "code"; 10px + `tracking-[0.16em]` near-illegible (`:289-319`). No max-height/line numbers/wrap toggle; horizontal overflow undiscoverable (`:321-329`). `min-h-6` forces ~1.85 leading vs terminal 1.45 vs diff `leading-relaxed` — three code leadings (`:163,171`). Square corners while every sibling block is rounded (`:285`). Streaming blocks snap plain→highlighted at fence close (`:214-219`). `.markdown-body` CSS (`styles.css:500-543`) matches nothing — dead.

Tool cells (`transcript/ToolCell.tsx`):

- **H — Truncation is a dead end.** Head 5 + tail 5 lines, "… +N lines" is static text; 400-row diff cap likewise; no copy button on terminal or diff output (`toolCellGrammar.ts:19`, `TerminalBlock.tsx:59-65`, `DiffBlock.tsx:21,68-72`, `ToolCell.tsx:264-268`). Make markers expand; add copy.
- **H — Approval prompt steals focus** from the composer unconditionally on mount — including on virtualization *remount* when scrolling past an old approval (`ToolCell.tsx:322-328`).
- **H — Approval keyboard scheme is contradictory:** rows show `1./2./3.` prefixes and `(y)/(a)/(esc)` suffixes; digits do nothing; handler only works while the prompt has focus but the hint reads global (`ToolCell.tsx:361-368,409-417`).
- **H — Virtualization wipes expand state and swaps content** — `deferRichContent` replaces rows with plain-text stubs, unmounting every `useState` (expanded tool cells, reasoning, changed-files) (`ChatWindow.tsx:156-158,783-786`, `overscan: 0` at `:633`). Lift expand state to a store keyed by cell id.
- **M — Expandable vs static rows identical at rest** (chevron `opacity-0` until hover; no focus-within reveal) (`ToolCell.tsx:132-147`).
- **M — Collapsed failed cells look like successes** — status is only shimmer-while-running + auto-expand-on-fail; `ActivityGlyph.tsx` (the status-dot component) is dead code imported by nothing. Tint failed labels `text-error`.
- **M — `whitespace-pre-wrap` + `overflow-x-auto` are mutually exclusive** — nothing ever h-scrolls, `break-words` chops mid-token, wrapped lines get no hanging indent, column output destroyed (`TerminalBlock.tsx:52-56`, `DiffBlock.tsx:48,100`, `ToolCell.tsx:236,389`). For diff/terminal: `whitespace-pre` + real h-scroll.
- **M — 11px body type** (`app-code-compact`) on the app's primary evidence surface, while markdown code is 13px (`styles.css:700-703` and consumers). Unify on 13px.
- **M — No expand/collapse animation anywhere** — bare `{isOpen && …}`, content pops, transcript jumps (`ToolCell.tsx:170`, `ReasoningCell.tsx:73`, `ChangedFilesBar.tsx:59,101`). 150-180ms `grid-template-rows 0fr→1fr`.
- **M** Long labels truncate with no `title` (`ToolCell.tsx:128,203,298`).
- **L** ASCII `-` vs U+2212 `−` for removed counts (`ToolCell.tsx:179` vs `ChangedFilesBar.tsx:48,91`). ChangedFilesBar: `border-t` on the first row too; `rounded-xl` without `overflow-hidden` (last diff squares the corners); basename-only paths make two `index.ts` indistinguishable (`ChangedFilesBar.tsx:32,76,84`).
- **L** `\r`-redrawing progress bars become N duplicate lines; all SGR color stripped so red FAIL == green PASS (`TerminalBlock.tsx:24`, `toolCellGrammar.ts:229-231`). Head/tail split guesses `length/2` (`TerminalBlock.tsx:45`).

Reasoning (`transcript/ReasoningCell.tsx`):

- **M** Duration is timer-based in the component: historical rows say "Thought", live say "Thought for 8s", unmount mid-stream resets the clock (`:35-52`). Persist start/duration on the message part.
- **M** Collapsed by default while streaming — a single shimmer line with no progress visibility; disclosure chevron hidden until hover (`:31,64-68`).

Diffs:

- **H — Dark-only palette on `:root`** — `--diff-add-bg: #213a2b` etc. with white gutter text; only codex overrides for light. On cursor light theme, diffs are near-black slabs with invisible gutters (`styles.css:68-76`, `themes/cursor.css`). Add light diff palette to every light variant.
- **M** Add/del conveyed only by background color; `+`/`-` is `aria-hidden` — flat list for screen readers (`DiffBlock.tsx:106-108`).

Visuals & diagrams:

- **H — `InteractiveDiagram` is theme-blind** — hardcoded slate hexes throughout (`interactive-diagram.tsx:44-57,113,135-152,262,309,315`); black slab on light themes. `visual.tsx:53-85` already has `readThemeTokens()` — use it.
- **H — Double chrome:** VisualBlock's floating toolbar overlaps the diagram's own header + duplicate copy buttons (`visual.tsx:229` + `interactive-diagram.tsx:263-283`).
- **H — Gallery: nested `<button>` (invalid HTML)**, delete revealed only by hovering a zero-opacity element (no `group` class on any ancestor), and no delete confirmation (`visual-gallery.tsx:139-173,46-53`).
- **H — Visual iframe clips at 80vh** with `overflow: hidden`, no truncation hint; the Expand escape hatch is itself `opacity-0` until hover (`visual.tsx:229,251-258,303-316`).
- **M** Gallery modal: no `role="dialog"`, no focus trap/restore, no backdrop click (`visual-gallery.tsx:93-94`). Search fires an un-debounced IPC per keystroke with no stale-response guard (`:41-44`). Preview iframe fixed 400px, skips `buildVisualSrcDoc` so saved visuals render unthemed (`:202-206`).
- **M** `setParseError` called during render inside `useMemo` (`interactive-diagram.tsx:210-222`). Dagre told nodes are 200×56 but heights are unconstrained → overlapping nodes (`:41-42,104-124`). One fixed `h-80` viewport for any graph size (`:285`).
- **L** `visual.tsx`: leaked `setTimeout` (`:215`), Save→Saved label reflows toolbar (`:240-242`), breakout margins hardcode transcript padding at 4 breakpoints and are already drifting (`:227`). Gallery: three type badges return identical classes (`visual-gallery.tsx:63-72`); zero-results shows the "No saved visuals yet" empty state; `useEffect` missing `searchQuery` dep (`:35-39`).

---

## 7. UI primitives

Radii:

- **H — 12 primitives have no radius at all** — dialog, dropdown (+items), select (+trigger/items), tooltip, hover-card, input, textarea, badge, switch, progress, alert, command (`ui/*.tsx`). A rounded button inside a square dialog next to a square input. Add `rounded-lg` to surfaces, `rounded-md` to fields, `rounded-sm` to items, `rounded-full` to switch/progress/badge.
- **H — `*:focus-visible { border-radius: var(--radius-subtle) }`** changes the *element's* radius, unlayered so it beats every `rounded-*` utility — circles snap to 4px boxes on keyboard focus (`styles.css:391-395`). Delete the line; outlines follow element radius natively.
- **M — `[data-border-radius='none']` is dead** — all four theme files re-declare `--radius-*` later in source order at equal specificity (`styles.css:173` vs `themes/*.css`). Bump to `html[data-border-radius='none']` or reorder imports.

Dialogs:

- **H** Close button is a 16×16 hit target with mouse-click ring flash (`focus:` not `focus-visible:`) (`ui/dialog.tsx:69-75`).
- **H** `CommandDialog` renders its sr-only header *outside* `DialogContent` — broken `aria-labelledby`, permanent stray DOM (`ui/command.tsx:47-50`).
- **M** Overlay hardcodes `rgba(0,0,0,0.6)` ignoring per-theme `--overlay` — crushes light themes (`ui/dialog.tsx:40`). Uses `bg-background` not `bg-popover` → two-tone seam inside the model selector. No shadow despite `--shadow-elevated` existing everywhere. No max-height/internal scroll.
- **M** Two hand-rolled modals bypass Radix entirely — no focus trap/restore/scroll-lock (`providers/AddModelDialog.tsx:88-99`, `ai-elements/visual-gallery.tsx:93-94`); AddModelDialog's backdrop closes on `click`, so a text-selection drag that ends outside discards input.

Menus/selects/tooltips:

- **H — Destructive menu items look identical to normal ones** — `--text-secondary` + `--bg-hover`, zero danger affordance; same in badge and alert variants (`ui/dropdown-menu.tsx:77`, `ui/badge.tsx:16`, `ui/alert.tsx:12-13`). Use `--error*` tokens.
- **M** `SelectContent` defaults to `item-aligned` — no collision flipping; the popper styling branch is dead code (`ui/select.tsx:56-79`).
- **M** `TooltipProvider delayDuration={0}` (tooltip storm) + `sideOffset={0}` (touches trigger) (`ui/tooltip.tsx:9,36`) — and zero `TooltipContent` usages exist anyway. Adopt with `delayDuration={400}`, `sideOffset={6}`.
- **L** No `collisionPadding` on any popper; `SubContent` lacks max-height; tooltip uses inverted `bg-foreground` unlike every other popover.

Toasts:

- **H — `dismissible: false` on every toast** — errors block the corner for their full duration with no escape; the closeButton styling is dead code (`lib/notify.ts:21-22`, `ui/sonner.tsx:33-34`).
- **H — Toast surface is `--bg-subtle` = 3% white** — effectively transparent over content; all six `--toast-*` theme tokens are dead (`ui/sonner.tsx:28-34`).
- **M** Success/error/info visually identical (one icon class, `richColors` off). 2500ms too short for title+description+action, with no hover-pause recovery (`lib/toastConfig.ts:12`). `theme="system"` desyncs from the app's resolved mode.

Error boundary (`RendererErrorBoundary.tsx`):

- **H** No retry button — recovery requires *guessing* that switching conversations resets it; the copy even says so (`:37-51`). Add "Try again" + "Copy details".
- **M** Composer is inside the boundary — a transcript crash kills the input box too (`App.tsx:873-941`). Wrap ChatWindow alone.
- **L** Raw stack as primary content; `rounded-[24px]` matches no token; crashes never reach PostHog (`:26-28,41,46`).

Global CSS:

- **M — Unlayered transition rule beats Tailwind duration utilities** — every `<button>`/`[role=option]` is forced to `--duration-fast`; also sets duration with no `transition-property` (`styles.css:409-417`). Wrap selectors in `:where()`.
- **L** Confusable tokens: `bg-overlay` (scrim) vs `bg-bg-overlay` (surface) — one typo from an invisible modal. Rename scrim to `--scrim`. Self-referential `@theme` entries (`--text-xs: var(--text-xs)`) work only by cascade luck (`styles.css:290-323`). Dead Geist Mono preload in `index.html:11-13`. `data-atlas-motion` kill switch observed but never written (`ui/slot-label.tsx:14-40`).

---

## 8. Themes, tokens, contrast

- **H — `--ring` missing from 3 of 4 themes** — xai (monochrome) and cursor (orange) get a *blue* focus ring on every focused control (`styles.css:67`, only codex overrides). Same for `--accent-surface`.
- **H — Light mode broken for `default` and `xai`** — `App.tsx:538-540` sets `colorScheme: light` + `data-theme=light`, but only codex/cursor respond: light native scrollbars and form controls painted over dark palettes. Clamp `colorScheme` to what the design theme supports, or add light variants.
- **M — Missing palette vars per theme:** default/cursor/xai all lack `--ring --accent-surface --bg-composer --corner-shape --diff-* --tool-*` — dark-tuned diff and tool hues bleed into cursor's light theme.
- **H — WCAG failures:**
  - `--text-muted #64748b` on `#07080b` = 4.20:1 **fail** — and it is `text-muted-foreground`, i.e. all placeholders, dialog descriptions, menu shortcuts (`themes/default.css:33`).
  - `--text-faint` fails everywhere it carries real text: default 2.67:1, xai 2.65:1, codex 2.88:1 — used for placeholders (`styles.css:760`, `CommandPalette.tsx:52`).
  - cursor light `--text-muted` = 3.06:1 **fail** (`themes/cursor.css:32`).
  - Fix: raise muted tokens above 4.5:1; restrict `--text-faint` to decorative/disabled.
- **L** `[data-theme='default']` selector never matches (App writes only light/dark). Deprecated `--sidebar-expanded/collapsed` still shipped.

---

## 9. Settings & providers

Structure:

- **H** "Model settings" heading rendered twice, stacked (`SettingsWorkspace.tsx:209` + `providers/ModelSettingsPage.tsx:36`).
- **H** Group headings styled byte-identical to row descriptions — hierarchy is mush (`SettingsWorkspace.tsx:681,695-696`). Use `text-2xs uppercase tracking-[var(--tracking-label)]`.
- **M** Scroll position persists across section switches — navigate long→short section, land on blank (`SettingsWorkspace.tsx:207`). Reset scrollTop on section change. Section h1 also scrolls away (not sticky).
- **M** Seven dead "Soon" nav entries + two "Coming soon" groups + "Soon" pills — three mechanisms advertising unbuilt features (`SettingsWorkspace.tsx:104-112,178-197,358-367,456-461,717-727`). Remove.
- **M** Duplicate `GearIcon` for General and Keyboard nav (`:96,99`).
- **L** Three rail widths across the app: settings 292px, sites 260px, app sidebar 284px token — left edge jumps on animated view transitions.

Save/validation:

- **H — Three incompatible save models with no signaling:** instant auto-save (preferences) vs blur-commit (provider name/URL) vs explicit checkmark (API key) vs staged form (Add provider). Nothing confirms a blur-commit happened (`SettingsWorkspace.tsx:804-806`, `providers/ProviderDetail.tsx:42-68`). Pick one per surface + transient "Saved" state.
- **H — No unsaved-changes protection** — clicking any rail item discards a fully-typed provider form incl. staged models (`ModelSettingsPage.tsx:72`, `ProviderForm.tsx:38`).
- **H — "Add provider" validates nothing client-side** — empty submit → IPC failure → transient toast; `store.error` never rendered inline by any provider component (`ProviderForm.tsx:232-239`, `useProvidersStore.ts:110-113`).
- **H** Base-URL edits silently revert on empty; whitespace API key silently no-ops; the key's save checkmark appears/disappears while typing (`ProviderDetail.tsx:42-68,207-216`).
- **M** Dialog validation errors styled as ordinary tertiary hints — `--error*` tokens defined and unused (`AddModelDialog.tsx:139`). Test-connection result is toast-only, and its inflight state makes the *other* button say "Fetching…" (shared `isDiscovering`) (`ProviderForm.tsx:240-247`, `useProvidersStore.ts:190-207`). Test/fetch require an API key — permanently disabled for Ollama/LM Studio (`ProviderForm.tsx:45`).

Controls:

- **H — Switch on/off is a 12% vs 4% white wash** — unreadable at a glance; no focus ring, no disabled state; `--accent` unused by every Settings control (`SettingsWorkspace.tsx:997-1002`). Same weak `bg-bg-active` selection on all three segmented pickers (`:860,900,942`).
- **H — Providers subtree opts out of border radius entirely** — dozens of square surfaces (form fields, buttons, dialogs) vs rounded SettingsWorkspace; the user-facing Border-radius setting has zero effect there (`ProviderDetail.tsx`, `ProviderForm.tsx`, `AddModelDialog.tsx`, `OnboardingFlow.tsx`, `SitesWorkspace.tsx` — no `rounded-*` anywhere).
- **M — Two parallel component systems:** full shadcn `ui/` set exists but Settings hand-rolls Switch, buttons, modal, and uses native `<select>`s; `ui/` primitives imported by only 2 files. Consolidate or delete.
- **M** Three field heights (32/36/44px), two border treatments in one scroll. Add-provider key field lacks the reveal toggle the edit form has (`ProviderForm.tsx:157-168` vs `ProviderDetail.tsx:217-224`). No paste normalization/fingerprint for keys. `ProviderDetail` labels aren't `<label htmlFor>` — unclickable, invisible to AT (`ProviderDetail.tsx:343-345`).
- **L** Preset `<select>` uncontrolled (can't re-pick same preset), silently overwrites typed fields, `appearance-none` with no chevron (`ProviderForm.tsx:106-124`). NumberStepper: reset on the wrong side, hyphen vs `+` glyph mismatch, no unit (`SettingsWorkspace.tsx:744-763`). FontFamilyField: no validation/preview (`:780-831`).

Model management:

- **H — Import = one IPC round-trip per model** (each triggering a full list refetch); 200 models ⇒ 400 sequential calls with the UI claiming done; no progress/summary/cancel (`ProviderDetail.tsx:75-94`, `useProvidersStore.ts:145-149`). Batch via one `setModels`.
- **H — All discovered models imported wholesale** — no selection step, then delete one-at-a-time (`ProviderDetail.tsx:76-93`).
- **H — Model list unbounded** — no scroll container, no search, no virtualization; 300 models = 15,000px page (`ProviderDetail.tsx:248-300`, `ModelSettingsPage.tsx:52-53`).
- **H — Model delete: instant, no confirm, no undo, 14px trash beside 14px edit** (`ProviderDetail.tsx:288-295`).
- **M** "tools" is a toggle disguised as bare text; 14px icon hit targets (`:253-296`). Dialog can edit only 2 of a model's ~10 properties — capabilities unreachable for hand-added models (`AddModelDialog.tsx:79-84`). Provider-delete confirm styled as neutral, no Esc, name un-truncated (`ProviderDetail.tsx:142-170`). "Fetch from endpoint" — a write action — styled as an underlined text link (`:233-240`). Redundant Enabled-pill + Enable-button pair (`:128-138`).
- **M** "Add provider" CTA styled as a faint dashed discard item, and it's a no-op in the empty state (`ModelSettingsPage.tsx:58-87`).
- **L** `onCreated` no-op prop; grey "ready" dot while `--success` sits unused; `toneForMetricState` maps loading→warning (false alarm); `getDefaultKeybindingRules()` allocated per row per render; raw `Mod+Shift+K` serialization shown under every shortcut; Reset button on every row never disabled; shortcut conflicts permitted with a 10px footnote; no unbind affordance (`SettingsWorkspace.tsx:497-601,955-1133`, `ModelSettingsPage.tsx:94,137`).

---

## 10. Onboarding

- **H — Half the component is unreachable** — the "You're all set" screen and `onContinue` can never render, so the `ONBOARDING_COMPLETED` event never fires (`OnboardingFlow.tsx:14-39` vs `App.tsx:527,725`).
- **H — Not a flow:** three numbered "steps" are static text; the CTA unmounts everything; no progress, no back, no closure after adding a key (`OnboardingFlow.tsx:52-69`).
- **H — No skip, no re-entry** — the only button forces Settings; backing out without a key strands the user in an empty chat with onboarding gone forever (`App.tsx:517-521,725-732`).
- **M** Three different first-run surfaces with three different messages, one deep-linking to the wrong settings section (`OnboardingFlow.tsx:41-76`, `ChatWindow.tsx:732-746`, `ModelSettingsPage.tsx:58-62`, `useAppStore.ts:528`).
- **M — Window is undraggable during onboarding** — no drag region declared (`OnboardingFlow.tsx`).
- **M — First impression is an alien design system:** `.btn-primary` = uppercase mono with 1.4px letterspacing, hardcoded sizes — appears nowhere else (`styles.css:645-682`). Duplicate keychain sentence 120px apart (`OnboardingFlow.tsx:58,71-73`). Hand-inlined SVG check + mixed lucide/radix icon sets; `tracking-[0.2em]` vs the `--tracking-label` token (`:19-27,45`; app has four label-tracking values total).

---

## 11. Sites workspace

- **H — Native `window.prompt/confirm/alert` for create/delete/export/reset** — unstyled OS dialogs blocking the renderer (`sites/SitesWorkspace.tsx:432-456,658`). Use `ui/dialog` + toasts.
- **H — Hardcoded `#cf2d56` behind a token name that doesn't exist** (`--color-error` isn't in the contract; real token is `--error`) (`:85,256,537`).
- **M** Nine flat toolbar buttons; delete is icon-only, un-titled, and *dimmer* than neutral (danger tone maps to tertiary) (`:497-531,62`). Collapse secondary actions into an overflow menu.
- **M** Unsaved edits lost on any file/site switch — only a 10px `•` dirty marker (`:562,572,474`). File delete has no confirm (site delete does) from a hover-revealed 20px icon (`:207-214,564`). Direct `useSitesStore.setState` in a click handler; new-file path unvalidated (`:443,439-441`).
- **L** Tab labels are `capitalize`d raw state values; selected tab indicated only by text color (`:600-610`).

---

## 12. Cross-cutting rules (adopt as conventions)

1. **One scrollbar system** — constant width, thumb-only fade, `scrollbar-gutter: stable`, `overscroll-behavior: contain`. Never animate scrollbar width.
2. **Hover-revealed controls must also reveal on focus** — every `opacity-0 group-hover:opacity-100` needs `group-focus-within:opacity-100 focus-visible:opacity-100`. (ChatWindow actions, sidebar delete, tool chevrons, visual toolbar, gallery delete.)
3. **Hit targets ≥ 28px** — current 14-16px offenders: attachment remove, model edit/delete, dialog close, gallery delete, file delete.
4. **Destructive = red + confirm-or-undo** — currently zero destructive affordances use `--error*`, and model/file deletes have no confirm at all.
5. **One tooltip system** — adopt `ui/tooltip` (400ms delay, 6px offset) and remove native `title`-only affordances; icon-only controls with *no* explanation are the worst offenders.
6. **Tokens or nothing** — no hex colors, no `rounded-[Npx]`, no hardcoded `0.875rem`, no `h-[52px]`; radius on every primitive so both theme squircles and border-radius=none actually work.
7. **One dialog primitive** — port AddModelDialog and visual gallery to Radix Dialog (focus trap/restore, scroll lock, Esc, backdrop semantics for free).
8. **Expand/collapse animates** — 150-180ms `grid-template-rows 0fr→1fr`, reduced-motion-guarded, everywhere content discloses.
9. **Persist per-conversation UI state** — composer draft, attachments, expand states, scroll position.
10. **Every async action shows its three states** — inflight, success, failure, inline where the user is looking (provider test/import, update check, clipboard, key save).

## Dead code to delete

`ActivityGlyph.tsx` (unused) · `SidebarConversationRow` collapsed branch + `isActive` prop · `ModelSettingsPage` `onCreated` · `.markdown-body` CSS block · `.btn-primary/.btn-secondary/.input/.section-*` utility classes (or retokenize) · `--sidebar-expanded/collapsed` deprecated vars · `[data-theme='default']` selector · Geist Mono preload in `index.html` · `data-atlas-motion` observer · `CodeBlock` unreachable alias table + `meta` prop · `ChatWindow` `latencyMs`/`hasVision` props · select popper dead branch · sonner closeButton styling · `ApiFormatSelect` `disabled` prop · `SidebarSettingsMenu` dead ternary.
