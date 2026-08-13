# Atlas — Current UI/UX State Audit

**Scope:** the renderer as it exists on branch `openai/codex-ui` (HEAD `27040a4`).
**Purpose:** baseline inventory feeding a design migration toward Codex-style agent UI.
**Method:** direct source read of `src/renderer/**`, `src/shared/{runtimeActivity,messageParts,contracts}.ts`, theme CSS, plus grep sweeps for hardcoded values and dead tokens.

Stack: Electron 41 + React 19.2 + TypeScript 6 + Tailwind **v4** (`@tailwindcss/vite`, **no `tailwind.config.js` — config lives in `@theme` inside `src/renderer/styles.css`**) + Zustand 5 + shadcn "new-york" primitives (`components.json:4`) + `ai` SDK v6 + `streamdown` for markdown + `@tanstack/react-virtual` for history.

---

## 0. Executive orientation

The renderer is a **single-window, two-column desktop shell** with no router: view switching is a `switch` on one store field. Theming is a **3-layer CSS custom-property system** (contract in `styles.css` → per-theme overrides in `themes/*.css` → Tailwind `@theme` alias layer) that is well-designed on paper but *widely bypassed* in components. Tool-call rendering is a **flat, generic timeline row** with no per-tool affordance — every tool, from `bash` to `web_fetch` to `site_write_file`, renders as name + one-line summary + JSON dump. The purpose-built `ai-elements/tool.tsx` collapsible and `ai-elements/confirmation.tsx` approval UI exist but are **dead code**.

---

## 1. App shell & layout

### 1.1 Root render tree

`src/renderer/main.tsx:16-20` mounts `<App/>` in `React.StrictMode`. CSS import order at `main.tsx:6-11`:
```
./styles.css → slot-text/style.css → themes/xai.css → themes/default.css → themes/landing.css → themes/cursor.css
```
All four theme files are always loaded; they gate on `[data-design-theme='…']` attribute selectors, so only one wins at runtime.

`App.tsx:881-900` wraps everything in:
- `<TooltipProvider>` (radix, global)
- `<AtlasToaster/>` (sonner) — `App.tsx:883`
- `<CommandPalette/>` — always mounted, visibility driven by `commandPaletteOpen` (`App.tsx:884-889`)
- `<VisualGallery/>` — always mounted, `galleryOpen` is **local React state**, not store (`App.tsx:124`, `890-897`)
- `{content}` — the view switch

### 1.2 Routing / view-switching model

There is **no router**. `App.tsx:631-879` is a nested ternary over `activeView`:

| `activeView` | Component | Store transitions |
|---|---|---|
| `'landing'` | `XAILandingPage` (`App.tsx:632-633`) | `openLanding` / `closeLanding` (`useAppStore.ts:531-532`) |
| `'sites'` | `SitesWorkspace` (`App.tsx:634-635`) | `openSites` / `closeSites` (`useAppStore.ts:533-534`) |
| `'settings'` | `SettingsWorkspace` (`App.tsx:636-702`) | `openSettings(section)` / `closeSettings` (`useAppStore.ts:528-530`) |
| `'chat'` (default) | shell below (`App.tsx:717-879`) | |

`AppView` type: `useAppStore.ts:59` — `'chat' | 'settings' | 'landing' | 'sites'`.
Initial state: `activeView: 'chat'`, `settingsSection: 'general'` (`useAppStore.ts:240-241`).

Two view-like states are **not** in `activeView` and take over the whole shell:
- `bootstrapping` → `<LoadingScreen/>` (`App.tsx:626`, defined `App.tsx:38-50`)
- `!initialized || bootstrapError` → `<ErrorScreen/>` (`App.tsx:627-629`, defined `App.tsx:52-68`)
- `showOnboarding && !hasCredential` → `<OnboardingFlow/>` — **local state** (`App.tsx:128`, `703-716`), so onboarding cannot be reached by command or deep link.

`settingsSection` (`SettingsSection` = `'general' | 'providers' | 'appearance' | 'keyboard' | 'usage' | 'privacy'`, `contracts.ts:232`) drives the settings sub-nav only.

View changes are wrapped in `runViewTransition()` at the call sites — `App.tsx:635, 650, 709, 738, 740, 815, 867` — not inside the store.

### 1.3 Chat shell regions

`App.tsx:718` root: `flex h-screen overflow-hidden bg-bg-base`.

**A. Sidebar** — `Sidebar.tsx:81-91`
- `<aside>` with `viewTransitionName: 'app-sidebar'`
- Width is an **inline style**, not a class: `width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)'` (`Sidebar.tsx:89`)
- `--sidebar-width: 17.75rem` (284px), `--sidebar-width-collapsed: 4.5rem` (72px) — `styles.css:82-83`
- **Not resizable.** Only binary collapse. No drag handle anywhere in the codebase.
- Collapsed state is **local React state** in `App.tsx:123` (`sidebarCollapsed`), so it is not persisted across restarts and not readable by the store.
- Collapsed variant drops the right border and applies `-mr-px` (`Sidebar.tsx:83-85`) — a 1px hack to hide the seam.

Sidebar internal stack (top→bottom):
1. Titlebar strip, `h-titlebar-height` (`Sidebar.tsx:93-160`), `WebkitAppRegion: 'drag'`
2. Action block: "New chat" + "Sites" buttons, `px-3 py-3` (`Sidebar.tsx:162-191`) — hidden when collapsed
3. Conversation list, `scrollbar-auto-hide min-h-0 flex-1 overflow-y-auto px-3` (`Sidebar.tsx:194`) — replaced by a bare `flex-1` spacer when collapsed (`Sidebar.tsx:286`), i.e. **the collapsed rail shows no conversations at all**
4. Footer: `SidebarSettingsMenu`, `border-t px-2 py-2` (`Sidebar.tsx:289-303`)

**B. Main panel** — `App.tsx:746-877`
- `relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-base`, `viewTransitionName: 'app-main-panel'`
- **B1. Titlebar** `App.tsx:755-806`: `h-titlebar-height shrink-0 px-5`, `WebkitAppRegion: 'drag'`, bottom border **only when sidebar is expanded** (`App.tsx:756`) — an inconsistency: collapsing the sidebar silently removes the main-panel underline.
  - Contents: conversation title (`text-[13px] font-normal text-text-secondary`, `App.tsx:766`), `·` separator using raw `text-[var(--text-faint)]` (`App.tsx:773`), model label `text-[12px]` (`App.tsx:775`), streaming pulse indicator with `role="status" aria-live="polite"` (`App.tsx:791-803`), and `<AppUpdateButton/>` right-aligned (`App.tsx:805`).
  - Inner content wrapper re-enables pointer interaction with `WebkitAppRegion: 'no-drag'` (`App.tsx:761`).
- **B2. `<ChatWindow/>`** inside `<RendererErrorBoundary resetKey={selectedConversationId}>` (`App.tsx:808-822`)
- **B3. `<Composer/>`** — same error boundary (`App.tsx:824-875`)

There is **no third pane** (no inspector / diff panel / terminal pane). No split view. No tabs.

### 1.4 Window chrome

- macOS traffic lights are accommodated by a hardcoded `w-20` (80px) spacer in the expanded sidebar titlebar (`Sidebar.tsx:99`). Collapsed mode drops the spacer entirely and puts two icon buttons at `px-2.5` (`Sidebar.tsx:95, 109-142`) — **the traffic lights will overlap those buttons on macOS**.
- Drag regions: `WebkitAppRegion: 'drag'` on both titlebars (`Sidebar.tsx:97`, `App.tsx:757`); global `no-drag` reset for `button, a, input, textarea, select` in `styles.css:576-582`.
- Window created in `src/main/bootstrap/createWindow.ts`.

### 1.5 Content width

- `--content-max: clamp(680px, 102vw, 860px)` (`styles.css:81`) → Tailwind `max-w-content-max` (`styles.css:202`).
- Used by the chat scroll content (`ChatWindow.tsx:948`) and the composer wrapper (`Composer.tsx:438`).
- Assistant messages additionally clamp to `max-w-[min(100%,76ch)]` (`ChatWindow.tsx:564, 625`), user messages to `max-w-[min(56%,560px)]` (`ChatWindow.tsx:537`) — three different, uncoordinated width systems in one column.

---

## 2. Design tokens

### 2.1 Architecture (3 layers)

1. **Contract layer** — `styles.css:10-107`, selector `:root, [data-theme='default']`. Note the selector bug: it targets `[data-theme='default']`, but `data-theme` is only ever set to `'light'` or `'dark'` (`App.tsx:517`). The `data-theme='default'` half of that selector is dead.
2. **Theme layer** — `themes/*.css`, selector `[data-design-theme='…']`, set by `App.tsx:530`.
3. **Tailwind alias layer** — `@theme { … }` at `styles.css:125-221`, maps `--color-bg-base: var(--bg-base)` etc. so `bg-bg-base`, `text-text-muted`, `border-border-default` are real utilities.

### 2.2 Runtime theming switches

| Attribute | Set at | Values | Effect |
|---|---|---|---|
| `data-theme` | `App.tsx:517` | `light` \| `dark` (resolved from `themeMode: 'light'\|'dark'\|'system'`, `contracts.ts:217`) | only consumed by `[data-theme='dark'][data-design-theme='cursor']` (`cursor.css:101`). **`default` and `xai` themes have no light variant at all** — picking "Light" with those themes changes only `color-scheme`. |
| `document.documentElement.style.colorScheme` | `App.tsx:518` | `light`\|`dark` | native form control rendering |
| `data-design-theme` | `App.tsx:530` | `default` \| `xai` \| `cursor` (`contracts.ts:218`) | selects the whole palette |
| `data-border-radius` | `App.tsx:534` | `theme-default` \| `none` (`contracts.ts:220`) | `[data-border-radius='none']` zeroes all `--radius-*` except `--radius-full` (`styles.css:110-118`) |
| `--ui-font-size`, `--code-font-size`, `--font-ui-family`, `--font-code-mono` | inline on `<html>`, `App.tsx:537-543` | px / font list | typography scaling |

A `prefers-color-scheme` media listener re-resolves `system` mode live (`App.tsx:513-527`).

### 2.3 Full token table

Legend for **Used**: number of `.ts`/`.tsx` files under `src/renderer` referencing the token (via `var(--x)` or the Tailwind alias). CSS-only usage noted separately.

#### Backgrounds

| Token | `default` | `cursor` (light) | `cursor` (dark) | `xai` | Used |
|---|---|---|---|---|---|
| `--bg-base` | `#07080b` | `#f2f1ed` | `#26251e` | `#1f2228` | 11 |
| `--bg-panel` | `#0b0d12` | `#f7f7f4` | `#2d2c24` | `var(--bg-base)` | **0 — DEAD** (only `landing.css:82`) |
| `--bg-surface` | `#101319` | `#f2f1ed` | `#34332a` | `var(--bg-base)` | 2 |
| `--bg-elevated` | `#151922` | `#e6e5e0` | `#3b3a30` | `rgba(255,255,255,0.05)` | 8 |
| `--bg-overlay` | `#1a1e29` | `#f7f7f4` | *(not overridden — inherits light `#f7f7f4`)* ⚠️ | `#262932` | 9 |
| `--bg-code` | `rgba(0,0,0,0.3)` | `#ebeae5` | `#2d2c24` | `rgba(255,255,255,0.03)` | **0 in TSX** (used in `styles.css:322,330`) |
| `--bg-subtle` | `rgba(255,255,255,0.03)` | `#ebeae5` | `rgba(242,241,237,0.05)` | `rgba(255,255,255,0.03)` | 25 |
| `--bg-ghost` | `rgba(255,255,255,0.04)` | `#e6e5e0` | `rgba(242,241,237,0.08)` | `rgba(255,255,255,0.04)` | 6 |
| `--bg-hover` | `rgba(255,255,255,0.06)` | `#dcdbd6` | `rgba(242,241,237,0.08)` | `rgba(255,255,255,0.06)` | 28 |
| `--bg-active` | `rgba(255,255,255,0.12)` | `#d7d6d1` | `rgba(242,241,237,0.14)` | `rgba(255,255,255,0.1)` | 8 |
| `--bg-button` | `#ffffff` | `#ebeae5` | `#3b3a30` | `#ffffff` | 4 |
| `--bg-button-hover` | `rgba(255,255,255,0.88)` | `#dcdbd6` | `#454439` | `rgba(255,255,255,0.88)` | 3 |

⚠️ **`cursor` dark mode never overrides `--bg-overlay`** (`cursor.css:101-147` has no `--bg-overlay`), so every popover/dropdown/dialog in Cursor-dark renders with the *light* cream `#f7f7f4` while text is `#f2f1ed` cream → near-invisible menus. This is a live visual bug.

#### Borders

| Token | `default` | `cursor` light | `cursor` dark | `xai` | Used |
|---|---|---|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.06)` | `rgba(38,37,30,0.08)` | `rgba(242,241,237,0.06)` | `rgba(255,255,255,0.08)` | 11 |
| `--border-default` | `rgba(255,255,255,0.12)` | `rgba(38,37,30,0.15)` | `rgba(242,241,237,0.12)` | `rgba(255,255,255,0.14)` | **33 (most-used token)** |
| `--border-medium` | `rgba(255,255,255,0.16)` | `rgba(38,37,30,0.22)` | `rgba(242,241,237,0.18)` | `rgba(255,255,255,0.18)` | 5 |
| `--border-strong` | `rgba(255,255,255,0.28)` | `rgba(38,37,30,0.35)` | `rgba(242,241,237,0.32)` | `rgba(255,255,255,0.32)` | 19 |

#### Text

| Token | `default` | `cursor` light | `cursor` dark | `xai` | Used |
|---|---|---|---|---|---|
| `--text-primary` | `#ffffff` | `#26251e` | `#f2f1ed` | `#ffffff` | 29 |
| `--text-secondary` | `#cbd5e1` | `rgba(38,37,30,0.85)` | `rgba(242,241,237,0.85)` | `rgba(255,255,255,0.7)` | 33 |
| `--text-tertiary` | `#94a3b8` | `rgba(38,37,30,0.65)` | `rgba(242,241,237,0.6)` | `rgba(255,255,255,0.5)` | 29 |
| `--text-muted` | `#64748b` | `rgba(38,37,30,0.5)` | `rgba(242,241,237,0.5)` | `rgba(255,255,255,0.5)` | 35 |
| `--text-faint` | `#475569` | `rgba(38,37,30,0.35)` | `rgba(242,241,237,0.3)` | `rgba(255,255,255,0.3)` | 19 |
| `--text-inverse` | `#000000` | `#f2f1ed` | `#26251e` | `#1f2228` | 3 |

Note `xai` collapses `--text-tertiary` and `--text-muted` to the same value (`rgba(255,255,255,0.5)`) — a 6-step scale becomes 5 steps on that theme.

#### Semantic

| Token | `default` | `cursor` light | `cursor` dark | `xai` | Used |
|---|---|---|---|---|---|
| `--success` | `#34d399` | `#1f8a65` | `#34d399` | `rgba(255,255,255,0.7)` | 7 |
| `--success-bg` | `rgba(52,211,153,0.15)` | `rgba(31,138,101,0.12)` | *(inherits light)* | `rgba(255,255,255,0.05)` | **0 — DEAD** |
| `--success-border` | `rgba(52,211,153,0.2)` | `rgba(31,138,101,0.25)` | *(inherits)* | `rgba(255,255,255,0.2)` | **0 — DEAD** |
| `--success-text` | `#a7f3d0` | `#1f8a65` | *(inherits)* | `rgba(255,255,255,0.7)` | **0 — DEAD** |
| `--warning` | `#fbbf24` | `#c08532` | `#fbbf24` | `rgba(255,255,255,0.5)` | 6 |
| `--warning-bg` | `rgba(245,158,11,0.05)` | `rgba(192,133,50,0.12)` | *(inherits)* | `rgba(255,255,255,0.05)` | 1 |
| `--warning-border` | `rgba(245,158,11,0.2)` | `rgba(192,133,50,0.25)` | *(inherits)* | `rgba(255,255,255,0.2)` | 1 |
| `--warning-text` | `#fde68a` | `#c08532` | *(inherits)* | `rgba(255,255,255,0.5)` | 1 |
| `--error` | `#fb7185` | `#cf2d56` | `#fb7185` | `rgba(255,255,255,0.7)` | 24 |
| `--error-bg` | `rgba(244,63,94,0.1)` | `rgba(207,45,86,0.12)` | *(inherits)* | `rgba(255,255,255,0.05)` | 6 |
| `--error-border` | `rgba(244,63,94,0.2)` | `rgba(207,45,86,0.25)` | *(inherits)* | `rgba(255,255,255,0.3)` | 6 |
| `--error-text` | `#fecdd3` | `#cf2d56` | *(inherits)* | `rgba(255,255,255,0.7)` | 7 |

The success triad (`--success-bg/-border/-text`) is defined in all four themes and referenced by **zero** components. Meanwhile `ChatWindow.tsx:98-99` paints its "success" tool state with raw `bg-emerald-400` / `text-emerald-100`.

#### Accent — defined in themes, absent from the contract

`--accent`, `--accent-hover`, `--accent-text` exist in `default.css:54-56`, `cursor.css:53-55`, `cursor.css:134-135`, `xai.css:54-56` — but are **not declared in `styles.css:10-107`** and **not mapped in `@theme`**. Result:
- No `bg-accent` Tailwind utility resolves to them (the `bg-accent` seen in `ui/*.tsx` resolves to `--color-accent: var(--bg-active)` at `styles.css:139`, a grey, not the brand orange/blue).
- `context.tsx:143` reads `var(--accent-primary, var(--text-secondary))` — **`--accent-primary` is never defined anywhere in the repo**, so the context-usage progress ring always falls back to `--text-secondary`. Confirmed dead.
- `visual.tsx:236,240` use `text-accent` / `fill-accent` → resolves to `var(--bg-active)`.

#### Toasts — fully dead in TSX

`--toast-bg`, `--toast-border`, `--toast-text`, `--toast-icon`, `--toast-close`, `--toast-close-hover` are defined in all themes; **0 TSX references**. Check `ui/sonner.tsx` + `lib/toastConfig.ts` (see §4) — if those use the `toast-*` Tailwind aliases (`styles.css:188-193`) the count is via alias, otherwise the entire toast palette is unused.

#### UI / layout / motion

| Token | `default` | `cursor` | `xai` | Used |
|---|---|---|---|---|
| `--overlay` | `rgba(0,0,0,0.4)` | `rgba(38,37,30,0.4)` / dark `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.6)` | 10 (but see offenders — dialogs hardcode `bg-black/60`) |
| `--scrollbar` | `rgba(255,255,255,0.1)` | `rgba(38,37,30,0.15)` | `rgba(255,255,255,0.1)` | 2 (CSS only) |
| `--scrollbar-hover` | `rgba(255,255,255,0.18)` | `rgba(38,37,30,0.25)` | `rgba(255,255,255,0.18)` | **0 in TSX** (CSS `styles.css:362`) |
| `--content-max` | `clamp(680px,102vw,860px)` | *(not overridden)* | *(not overridden)* | 2 |
| `--sidebar-width` | `17.75rem` | — | — | 1 |
| `--sidebar-width-collapsed` | `4.5rem` | — | — | 1 |
| `--sidebar-expanded` | `284px` | — | — | **0 — explicitly marked deprecated at `styles.css:84`, still exported to `@theme` at `styles.css:205`** |
| `--sidebar-collapsed` | `68px` | — | — | **0 — deprecated, `styles.css:85`/`206`** |
| `--titlebar-height` | `3.25rem` | — | — | 2 |
| `--shadow-elevated` | `0 25px 50px -12px rgba(0,0,0,0.5)` | 3-layer warm | `none` | 10 |
| `--shadow-sm` / `--shadow-md` | **undefined** | defined `cursor.css:86-87` | **undefined** | 1 each — `context.tsx:155` uses `shadow-sm`/`shadow-md`, which are Tailwind's *built-in* shadows, not these tokens. The cursor-only tokens are dead. |

#### Radius — defined everywhere, essentially unused

| Token | `default` | `cursor` | `xai` | `[data-border-radius=none]` | Used in TSX |
|---|---|---|---|---|---|
| `--radius-sm` | `0.375rem` | `0.25rem` | `0px` | `0px` | 4 (via `rounded-[var(--radius-sm)]`) |
| `--radius-md` | `0.5rem` | `0.5rem` | `0px` | `0px` | **0** |
| `--radius-lg` | `0.75rem` | `0.625rem` | `0px` | `0px` | **0** |
| `--radius-xl` | `1rem` | `0.75rem` | `0px` | `0px` | **0** |
| `--radius-2xl` | `1.25rem` | `1rem` | `0px` | `0px` | **0** |
| `--radius-subtle` | `4px` | `0.25rem` | `4px` | `0px` | **0 in TSX** (`styles.css:276`) |
| `--radius-full` | `9999px` | `9999px` | `9999px` | preserved | **0 in TSX** (`styles.css:357`) |

**This is the single largest token-system failure.** `MIGRATION.md` Phases 7–11 record that the xAI migration *manually stripped `rounded-*` from every component*. The consequence: the user-facing "Border radius" setting (`App.tsx:660-663`) and the `--radius-*` variables in all three themes are effectively inert, while components that *do* round use hardcoded classes — `rounded-2xl` (`Composer.tsx:441`), `rounded-full` (`ChatWindow.tsx:1026`, `Composer.tsx:245,254`), `rounded-[10px]` (`ChatWindow.tsx:260`), `rounded-[6px]` (`Composer.tsx:110,121`), `rounded-lg` (`Composer.tsx:311`), `rounded-xl` (`App.tsx:55`), `rounded-md` (`styles.css` `.btn-primary`). None of these respond to the theme or the setting.

#### Motion tokens — declared, never referenced

`--duration-fast` (`150ms` / `80ms` xai), `--duration-normal` (`200ms` / `150ms`), `--duration-slow` (`400ms` / `300ms` cursor / `200ms` xai), `--easing-default` (`cubic-bezier(0.22,1,0.36,1)` / `ease` cursor / `cubic-bezier(0,0,0.2,1)` xai).

**0 TSX references.** They are consumed only by the three blanket rules in `styles.css:283-291` (`button, input, [role=option], [role=button]` and `.panel, .drawer, aside`) and the `.btn-*` / `.input` utilities. Every component-level transition uses the bare Tailwind `transition` class (default 150ms `cubic-bezier(0.4,0,0.2,1)`) — so **the theme's motion character never reaches the components**. `styles.css:218-220` exports them to `@theme` as `--duration-*`, which would make `duration-fast` a utility, but nothing uses it.

### 2.4 Concrete token-bypass offenders

**Semantic colors replaced by raw Tailwind palette (the worst cluster — tool status):**

| file:line | class |
|---|---|
| `ChatWindow.tsx:91` | `dot: 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.12)]'` |
| `ChatWindow.tsx:92` | `badge: 'border-amber-400/25 bg-amber-400/10 text-amber-100'` |
| `ChatWindow.tsx:93` | `summary: 'text-amber-100/80'` |
| `ChatWindow.tsx:98` | `dot: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.12)]'` |
| `ChatWindow.tsx:99` | `badge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'` |
| `ChatWindow.tsx:104` | `dot: 'bg-rose-400 shadow-[0_0_0_3px_rgba(251,113,133,0.14)]'` |
| `ChatWindow.tsx:105` | `badge: 'border-rose-400/20 bg-rose-400/10 text-rose-100'` |
| `ChatWindow.tsx:106` | `summary: 'text-rose-100/80'` |
| `ChatWindow.tsx:110` | `dot: 'bg-zinc-400 shadow-[0_0_0_3px_rgba(161,161,170,0.12)]'` |
| `ChatWindow.tsx:111` | `badge: 'border-zinc-400/20 bg-zinc-400/10 text-zinc-200'` |
| `ChatWindow.tsx:112` | `summary: 'text-zinc-300/80'` |
| `ChatWindow.tsx:116` | `dot: 'bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.12)]'` |
| `ChatWindow.tsx:117` | `badge: 'border-sky-400/20 bg-sky-400/10 text-sky-100'` |
| `ChatWindow.tsx:281` | approve button `border-emerald-400/25 bg-emerald-400/10 text-emerald-100 … hover:bg-emerald-400/15` |
| `ChatWindow.tsx:297` | deny button `border-rose-400/20 bg-rose-400/10 text-rose-100 … hover:bg-rose-400/15` |
| `ChatWindow.tsx:313` | `text-emerald-100/80` |
| `ChatWindow.tsx:320` | `text-zinc-300/80` |
| `interactive-diagram.tsx:317` | `!text-[10px] !text-slate-500` |

Consequence: **on the `cursor` (light cream) theme the entire tool timeline is unreadable** — `text-emerald-100` (near-white) on a cream background, `text-amber-100` on cream, etc.

**Literal `text-white` / `bg-black` (should be `--text-primary` / `--overlay`):**

| file:line | note |
|---|---|
| `CommandPalette.tsx:40` | `… bg-bg-base p-0 text-white` |
| `CommandPalette.tsx:47` | input `text-white` |
| `CommandPalette.tsx:60` | `data-[selected=true]:text-white` |
| `Sidebar.tsx:167` | new-chat `hover:text-white` |
| `Sidebar.tsx:183` | sites `hover:text-white` |
| `Sidebar.tsx:213` | active row `text-white` |
| `Sidebar.tsx:248` | confirm-delete `hover:text-white` |
| `SidebarSettingsMenu.tsx:132` | dropdown `text-white` |
| `SidebarSettingsMenu.tsx:160,172,180,195,204` | 5× `focus:text-white` |
| `SettingsWorkspace.tsx:566` | active nav `text-white` |
| `SettingsWorkspace.tsx:997` | switch thumb `bg-white` |
| `ModelSelector.tsx:119` | `hover:text-white` |
| `Composer.tsx:125,129,245,254` | 4× `text-white` / `hover:text-white` |
| `ChatWindow.tsx:638` | retry `hover:text-white` |
| `confirmation.tsx:64` | `text-white` (dead component, but still) |
| `AppUpdateButton.tsx:42` | `hover:text-white` |
| `ui/button.tsx:14` | destructive `bg-destructive text-white` |
| `RendererErrorBoundary.tsx:46` | `bg-black/20` |
| `AddModelDialog.tsx:89` | overlay `bg-black/60` (should be `bg-overlay`) |
| `visual-gallery.tsx:93` | overlay `bg-black/60 backdrop-blur-sm` (should be `bg-overlay`) |
| `ui/dialog.tsx:40` | overlay `bg-[rgba(0,0,0,0.6)]` (should be `bg-overlay`) |
| `SitesWorkspace.tsx:636` | iframe `bg-white` (arguably correct for a site preview) |

Every `text-white` is wrong on the `cursor` light theme, where `--text-primary` is `#26251e`.

**Literal hex/rgba in TSX:**

| file:line | value |
|---|---|
| `SidebarConversationRow.tsx:51,60` | `color="rgba(255,255,255,0.5)" glowColor="rgba(255,255,255,0.15)"` |
| `reasoning.tsx:145` | `color="rgba(255,255,255,0.5)" glowColor="rgba(255,255,255,0.15)"` |
| `ui/brush-spinner.tsx:18-19` | defaults `rgba(255,255,255,0.9)` / `rgba(255,255,255,0.25)` |
| `CodeBlock.tsx:324` | `background: highlighted?.bg ?? 'linear-gradient(180deg, rgba(255,255,255,0.015), rgba(255,255,255,0.008))'` |
| `context.tsx:142` | `var(--warning, #f59e0b)` — the fallback is a different amber than `--warning` in any theme |
| `interactive-diagram.tsx:45-56, 112, 120, 138, 141, 145, 150, 262, 302, 309, 315` | ~15 literal slate/blue/green hexes; whole component is a hardcoded dark palette |
| `visual.tsx:57-65` | full hardcoded fallback palette (mitigated: `visual.tsx:75-83` reads live CSS vars first — this is the *only* place in the codebase that resolves tokens at runtime) |
| `SitesWorkspace.tsx:85, 256, 537` | `text-[var(--color-error,#cf2d56)]` — `--color-error` is a `@theme` alias, valid, but the literal fallback is cursor-specific |

### 2.5 Dead-token summary

Never referenced by any component: `--bg-panel`, `--success-bg`, `--success-border`, `--success-text`, `--toast-*` (6), `--accent`, `--accent-hover`, `--accent-text`, `--scrollbar-hover`, `--sidebar-expanded`, `--sidebar-collapsed`, `--radius-md/-lg/-xl/-2xl/-subtle/-full`, `--duration-fast/-normal/-slow`, `--easing-default`, `--shadow-sm`, `--shadow-md`.
Referenced but undefined: `--accent-primary` (`context.tsx:143`).

---

## 3. Typography

### 3.1 Font stacks

| Variable | `default` / contract | `cursor` | `xai` |
|---|---|---|---|
| `--font-ui-family` | `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'` (`styles.css:75`) | same minus emoji fallbacks (`cursor.css:71`) | same as default (`xai.css:72`) |
| `--font-mono-system` | `'SF Mono','SFMono-Regular',ui-monospace,Consolas,'Liberation Mono',Menlo,monospace` (`styles.css:76`) | `ui-monospace,'SFMono-Regular','Menlo','Monaco','Consolas','Liberation Mono','Courier New',monospace` | `'GeistMono','Menlo','Cascadia Code','Consolas',monospace` — **GeistMono is never loaded** (no `@font-face`, no npm font package), so xAI silently falls back to Menlo |
| `--font-code-sans` | `var(--font-ui-family)` | same | same |
| `--font-code-mono` | `var(--font-mono-system)` | same | same |

`@theme` maps `--font-sans: var(--font-ui-family)` and `--font-mono: var(--font-code-mono)` (`styles.css:199-200`), so `font-sans`/`font-mono` utilities are token-aware.

**A latent bug:** `App.tsx:541-542` writes `--font-ui-family` and `--font-code-mono` inline on `<html>` using fallback variables `--font-ui-system` and `--font-mono-system` (`App.tsx:112`). `--font-ui-system` is **never defined anywhere**. When the user leaves the UI font override empty, `buildFontFamilyValue` returns `var(--font-ui-system)` (`App.tsx:114`), which resolves to nothing → **`--font-ui-family` becomes empty and the whole app falls back to the browser default font**. `--font-mono-system` *is* defined, so the code font path works. This is a real, shipping regression.

`.btn-primary` / `.btn-secondary` (`styles.css:446, 469`) and `landing.css` use `--font-mono-system` directly rather than `--font-mono`, so they ignore the user's code-font override.

### 3.2 The `--ui-font-size` scaling mechanism

`App.tsx:539` sets `--ui-font-size: {appearance.uiFontSize}px` on `<html>`. Default `15px` (`styles.css:73`). Six utility classes consume it (`styles.css:509-531`):

```
.ui-text-size-base      → var(--ui-font-size)             15px
.ui-text-size-minus-1   → calc(var(--ui-font-size) - 1px) 14px
.ui-text-size-minus-2   → -2px                            13px
.ui-text-size-minus-3   → -3px                            12px
.ui-text-size-minus-4   → -4px                            11px
.ui-text-size-minus-5   → -5px                            10px
```

**Adoption is 14 call-sites across the whole renderer** (`Sidebar.tsx`, `SidebarConversationRow.tsx`, a couple more). Everything else uses arbitrary pixel values that do **not** scale:

```
43× text-[13px]    38× text-[11px]    36× text-[12.5px]  31× text-[12px]
21× text-[10px]    16× text-[9px]     12× text-[11.5px]   9× text-[10.5px]
 6× text-[14px]     5× text-[17px]     4× text-[13.5px]   2× text-[9.5px]
 2× text-[15.5px]   1× each: text-[8px] text-[28px] text-[20px] text-[15px] text-[14.5px]
```

That is **231 arbitrary font-size declarations across 18 distinct values**, of which 8 are fractional (`.5px`). Net effect: the Settings → Appearance → "UI font size" slider changes almost nothing visible in the chat surface, and there is no type scale — sizes were chosen ad hoc per component.

### 3.3 Code typography

`--code-font-size` default `13px` (`styles.css:74`), set live at `App.tsx:540`. Three consuming utilities (`styles.css:491-507`):
- `.app-code-text` — `var(--code-font-size)` / lh 1.55
- `.app-code-compact` — `calc(… - 2px)` / lh 1.45
- `.app-code-chip` — `calc(… - 2.5px)` / lh 1
Plus `.markdown-body pre` (`styles.css:326`) and `.markdown-body code` at `calc(… - 1px)` (`styles.css:334`).

`ReasoningContent` overrides code size back to a hardcoded `[&_pre]:text-[12.5px]` (`reasoning.tsx:200`), defeating the setting inside reasoning blocks.

### 3.4 Other typographic constants

- Body: `font-optical-sizing: auto`, `text-rendering: optimizeLegibility`, `-webkit-font-smoothing: antialiased` (`styles.css:234-242`).
- Assistant message body: `text-[15.5px] leading-[1.85] tracking-[-0.01em]` (`ChatWindow.tsx:425, 488`).
- User message body: `text-[13.5px] leading-[1.65rem]` (`ChatWindow.tsx:541`) — **assistant text is 2px larger than user text**, with a `rem` line-height mixed into a `px` font-size.
- Empty-state headline: `text-[28px] font-light leading-[1.15] tracking-[-0.02em]` (`ChatWindow.tsx:728`).
- Uppercase micro-labels use `tracking-[0.12em]`, `tracking-[0.14em]`, `tracking-[0.16em]`, `tracking-[0.18em]` in different files — four uncoordinated values.
- `landing.css` defines a separate display scale (`.xai-display` `clamp(64px,14vw,220px)` at weight 200, `.xai-section-heading`, `.xai-body` fixed `15px`, `.xai-meta` fixed `10px`) that ignores `--ui-font-size` entirely.

---

## 4. Component inventory

### 4.1 Shell & navigation

| Component | File | Purpose / treatment | States |
|---|---|---|---|
| `App` | `App.tsx:121` | View switch, global keydown handler, theme/attribute effects, 60s `nowMs` ticker (`App.tsx:133-136`) for relative timestamps | bootstrapping / error / onboarding / chat / settings / sites / landing |
| `LoadingScreen` | `App.tsx:38-50` | Centered inline `<svg>` spinner (not `ui/spinner`) + "Loading…" `text-sm text-text-muted` | — |
| `ErrorScreen` | `App.tsx:52-68` | `max-w-md rounded-xl border-error-border bg-bg-elevated p-8 shadow-elevated` + `.btn-secondary` Retry. **Only place in the app using `rounded-xl`** | — |
| `Sidebar` | `Sidebar.tsx:52` | see §1.3 | expanded / collapsed; per-row: idle / active / running / delete-pending |
| `SidebarConversationRow` | `SidebarConversationRow.tsx` | Row internals: primary/secondary label, timestamp, status spinner (`BrushSpinner`), jump-hint badge | running / error / aborted / idle; collapsed variant |
| `SidebarSettingsMenu` | `SidebarSettingsMenu.tsx` | Radix dropdown, `w-[260px]` (`:132`), items at `text-[13px]` | open/closed; update-available badge |
| `AppUpdateButton` | `AppUpdateButton.tsx` | Titlebar CTA | idle / checking / available / downloading / downloaded / error |
| `CommandPalette` | `CommandPalette.tsx:28` | `CommandDialog` (cmdk), grouped by `section`, `max-h-[420px]`, shortcut chips | open/closed, empty result, disabled items |
| `RendererErrorBoundary` | `RendererErrorBoundary.tsx` | Catches render errors, resets on `selectedConversationId` change | error |

### 4.2 Chat surface

| Component | File | Purpose / treatment |
|---|---|---|
| `ChatWindow` | `ChatWindow.tsx:766` | Virtualized history (`@tanstack/react-virtual`) + `use-stick-to-bottom`. Row gap `22px` (`:55`), overscan 4 leading / 2 trailing (`:53-54`, custom `rangeExtractor` at `:673-686` that drops trailing overscan while streaming). Estimated heights are a hand-tuned heuristic (`:688-706`). |
| `MessageRow` | `ChatWindow.tsx:513` | Branches user vs assistant. User: right-aligned bordered box `max-w-[min(56%,560px)]`. Assistant: left-aligned `max-w-[min(100%,76ch)]`. Hover-revealed copy/regenerate toolbar (`opacity-0 → group-hover:opacity-100`, `:545, :577`). |
| `AssistantParts` | `ChatWindow.tsx:431` | Maps `ChatMessagePart[]` → `ReasoningRow` / `ToolRow` / `AttachmentRow` / `VisualBlock` / `MessageResponse`. `deferRichContent` renders `AssistantTextFallback` for rows outside the visible virtual range (`:446-448`) — a plain `whitespace-pre-wrap` div, so **scrolling fast shows unstyled markdown then pops into rendered markdown**. |
| `StreamingRow` | `ChatWindow.tsx:604` | Live draft. Three sub-states: streaming / error card / aborted card. |
| `SuggestionsState` | `ChatWindow.tsx:708` | Empty state: headline, capability chips (files / images / tools), 2×3 suggestion grid. Suggestion prompts are hardcoded at `:57-64` and generic ("Explain quantum computing"), not agent-oriented. |
| `MessageMeta` | `ChatWindow.tsx:123` | Latency chip (`.app-code-chip`, `rounded-full`) + model chip (square, `text-[10.5px]`) — **two chips in one row with different radii and different type systems**. |
| `MessageResponse` | `message.tsx:336` | `React.lazy` + `Suspense` around `MessageResponseContent`; fallback is plain text. `memo`'d on `children` + `isAnimating`. |
| `MessageResponseContent` | `MessageResponseContent.tsx:24` | `Streamdown` with cjk/code/math/mermaid plugins; **all markdown element styling is one 1,100-character arbitrary-variant class string** (`:28`). |
| `CodeBlock` | `CodeBlock.tsx` | Lazy shiki via `@streamdown/code` (`:44-49`) with a 120-entry highlight cache (`:35`). Copy + download buttons, `SlotLabel` filename chip. Background falls back to a hardcoded white gradient (`:324`). |
| `Reasoning*` | `reasoning.tsx` | Collapsible. Auto-opens while streaming, auto-closes when streaming ends (`:81-100`). Live seconds counter. Header icon box `size-9`, chevron box `size-7.5`. |
| `ToolRow` | `ChatWindow.tsx:175` | see §5 |
| `Composer` | `Composer.tsx:324` | see §4.3 |
| `Attachment*` | `attachments.tsx` | Inline pill + hover-card preview |
| `VisualBlock` / `VisualGallery` / `RiveVisual` / `InteractiveDiagram` | `visual.tsx`, `visual-gallery.tsx`, `rive-visual.tsx`, `interactive-diagram.tsx` | Generative-visual feature. `interactive-diagram.tsx` and `rive-visual.tsx` have **0 importers** — dead. |

### 4.3 Composer

`Composer.tsx:436-526`. Outer `px-5 py-3 lg:px-6` → `mx-auto max-w-content-max` → `<PromptInput>` shell: `overflow-hidden rounded-2xl border border-[var(--border-default)] bg-bg-base transition-colors focus-within:border-[var(--border-strong)]` (`:441`).

Stack: `ComposerAttachmentsHeader` (`:449`) → `PromptInputBody` with `MentionAutocompleteList` overlay + `PromptInputTextarea` (`:451-491`) → `ComposerFooter` (`:493`).

Footer left cluster (`:243-266`): attach (`PlusIcon`, `size-8 rounded-full`), visual gallery (`Palette`, `size-8 rounded-full`), `ToolPermissionModeControl`.
Footer right cluster (`:270-318`): `Context` ring → `ModelSelector` → `ReasoningEffortControl` → `PromptInputSubmit` (`size-8 rounded-lg bg-primary`).

Textarea autosize: manual `el.style.height` clamp to 180px in an effect (`:360-365`), duplicated by an inline `style={{ maxHeight: '180px' }}` (`:488`). Focus is driven by a `composerFocusNonce` counter in the store (`:367-369`).

Submit/stop is a single button whose icon swaps by `status` (`prompt-input.tsx:1240-1250`): `CornerDownLeft` → `BrushSpinner` (submitted) → `Square` (streaming) → `X` (error). Enter submits, Shift+Enter newlines, Backspace-on-empty removes the last attachment (`prompt-input.tsx:1015-1029`).

`ai-elements/prompt-input.tsx` is **1,477 lines** exporting ~45 components (`PromptInputTabs*`, `PromptInputCommand*`, `PromptInputSelect*`, `PromptInputActionAddScreenshot`, …). Atlas imports **11** of them (`Composer.tsx:42-53`). The rest is unreferenced vendored surface area.

### 4.4 shadcn primitives (`src/renderer/components/ui/`)

<!-- UI_PRIMITIVES_SECTION -->

### 4.5 Settings & providers

<!-- SETTINGS_SECTION -->

### 4.6 Sites, landing, and secondary surfaces

<!-- SITES_SECTION -->

---

## 5. Tool-call / agent-action rendering — deep pass

### 5.1 Data model, end to end

**Wire format.** The main process emits `RuntimeEventEnvelope` (`contracts.ts:601-617`):
```ts
{ eventId, conversationId, turnId, requestId, sequence, occurredAt,
  activityType, tone, toolType?: CanonicalToolType|null,
  messageId?, toolCallId?, approvalId?, provider, providerEventType?,
  payload: Record<string, unknown> }
```
`CanonicalToolType` (`contracts.ts:591-597`): `command_execution | file_change | mcp_tool_call | dynamic_tool_call | web_search | image_view`, inferred by string-matching the tool name in `runtimeActivity.ts:22-56`.

**Two parallel representations exist:**

1. `WorkLogEntry` (`contracts.ts:619+`), built by `deriveWorkLogEntry()` (`runtimeActivity.ts:87-160`). Carries `title`, `summary`, `status` (`running | pending_approval | resolved | completed | denied | error`), `tone`, `toolType`, `isFinal`, `sequence`, `createdAt`/`updatedAt`. There is a converter `workLogEntryToChatToolPart()` (`runtimeActivity.ts:179-205`).
2. `ChatToolPart` (`messageParts.ts`, via `ChatMessagePart`) — what the UI actually renders.

**The renderer never uses the WorkLog.** `applyRuntimeEventToMessageParts()` (`runtimeActivity.ts:207-332`) *downgrades* each envelope back into a legacy `StreamEvent` and feeds it to `applyStreamEventToParts()` (`messageParts.ts:163-366`). Every field the WorkLog adds — `toolType`, `tone`, `sequence`, `createdAt`/`updatedAt`, `isFinal`, `turnId` — is **discarded at that boundary**. Grep confirms: `toolType` appears nowhere under `src/renderer`.

**What the UI receives** (`ChatToolPart`, produced at `messageParts.ts:169-322`):
```ts
{ id, type: 'tool', toolCallId, requestId, toolName, state,
  rawInput?: string, input?: unknown, output?: unknown, errorText?: string,
  dynamic?, providerExecuted?, title?, preliminary?,
  approval?: { id, approved?: boolean, reason?: string } }
```
`state` ∈ `input-streaming | input-available | approval-requested | approval-responded | output-available | output-partial | output-error | output-denied`.

**Notably absent from the UI payload:** start/end timestamps, duration, tool category, exit code, working directory, file paths, diff hunks, byte counts, token cost. `ToolResultNormalizer.ts:1` truncates every input and output preview to **900 chars** before it ever reaches the renderer.

**Fan-out.** `streamEventReducers.ts:241-314` (`applyStreamingEvent`) applies each event twice — once to `draftsByConversation[cid].parts` and once to the trailing `status === 'streaming'` assistant message in `conversationDetails[cid].messages` (`:373-381`). `applyRecoveredRuntimeEventsToStore` (`:140-235`) replays gaps by sequence number; `applyRuntimeSnapshotToStore` (`:67-108`) hard-replaces from a main-process snapshot.

### 5.2 The component that actually renders a tool call

**`ToolRow` — `ChatWindow.tsx:175-368`.** Not `ai-elements/tool.tsx`.

Structure:
```
<div class="relative mb-1.5 pl-5">
  <span class="absolute left-[7px] top-0 bottom-[-10px] w-px bg-border-subtle/80"/>   ← timeline rail
  <span class="absolute left-[4px] top-[11px] size-[7px] rounded-full {statusDot}"/>  ← status dot
  <div class="rounded-[10px] px-2.5 py-1.5 hover:bg-bg-hover/60">
    row: [ name  ·  one-line summary ]        [ badges ]  [ chevron ]
    (conditional approval button strip)
    (conditional details panel)
  </div>
</div>
```

- **Name** (`:264-266`): `text-[12.5px] font-medium tracking-[-0.01em] text-text-primary`, from `part.title?.trim() || part.toolName.replace(/[_-]+/g,' ')` (`:186`) — so `read_file` renders as "read file", `site_write_file` as "site write file". No icon, no verb/object split.
- **Summary** (`:267-269`, computed `:204-227`): first non-empty of approval reason → `errorText` → denied message → `String(output)` whitespace-collapsed → `String(rawInput)` whitespace-collapsed → `'Result available'` / `'Running'`. For a `bash` call this shows the *JSON-stringified arguments* (`{"command":"ls -la"}`) as the subtitle. Truncated with `truncate`, `text-[11px] leading-5`.
- **Status badge** (`:336-338`): `h-5 border px-1.5 text-[9px] uppercase tracking-[0.12em]` + palette classes from `getToolStatusClasses` (`:87-121`). Labels from `getToolStatusLabel` (`:66-85`): Queued / Running / Needs approval / Approved / Done / Partial / Error / Denied.
- **Special-case badge**: `web_fetch` with `output.fetchMode === 'jina-reader'` gets a "Via Jina" chip (`:200-203`, `:328-335`). This is the **only** per-tool affordance in the entire UI.
- **Disclosure** (`:339-350`): chevron button, `aria-expanded`, `aria-label="Show/Hide reasoning details"` — the label says *reasoning*, which is wrong for a tool row.

**Collapsed/expanded default** (`:229-233`):
```ts
useEffect(() => {
  const shouldForceOpen = state === 'approval-requested' || 'output-error' || 'output-denied';
  setIsOpen(shouldForceOpen);
}, [part.state]);
```
Default is **collapsed**, force-opened on approval/error/denied. Because this effect runs on every `state` change and calls `setIsOpen` unconditionally, **any manual expand is silently reverted the moment the tool transitions state** (e.g. `input-available` → `output-available` snaps it shut).

**Expanded body** (`:354-364`): `border-l border-border-subtle/70 pl-3`, containing `<ToolInput>` then `<ToolOutput>` from `ai-elements/tool.tsx`.

### 5.3 How command output / file edits / diffs / search results are displayed

**There is no differentiated rendering.** All of it goes through two generic panels:

- `ToolInput` — `tool.tsx:300-319`. Header strip `Input` at `text-[9px] uppercase tracking-[0.14em]`, body is `<CodeBlock code={JSON.stringify(input,null,2)} language="json"/>`.
- `ToolOutput` — `tool.tsx:326-382`. Header strip `Output`; body is `MessageResponse` (markdown) if the output is a string, otherwise `renderNodeOrCode()` (`tool.tsx:77-103`) which JSON-stringifies into a `json`-highlighted `CodeBlock`. Error variant (`:332-354`) is a bordered box with `AlertTriangle` + `Error` label.

Concretely, for the eight built-in tools (`builtInTools.ts:61-157`: `read_file`, `grep_search`, `glob_search`, `web_search`, `web_fetch`, `bash`, `get_current_time`, `search_model_catalog`) and the eight site tools (`siteTools.ts:65-184`: `site_create`, `site_list`, `site_read_file`, `site_write_file`, `site_delete_file`, `site_build`, `site_preview`, `site_publish`):

| Expected treatment | Actual |
|---|---|
| `bash` — command echo, streamed stdout/stderr in a terminal block, exit code | `{"command":"…"}` as JSON in the Input panel; stdout as markdown-rendered text in the Output panel; no exit code surfaced; truncated at 900 chars |
| `read_file` — file path chip, line range, syntax-highlighted excerpt | JSON args + markdown output; language always guessed as `json` for object outputs |
| `site_write_file` / `apply_patch` — unified diff with +/− gutters | JSON blob containing the whole file content |
| `grep_search` / `glob_search` — grouped hit list, file:line, match highlight | JSON array dump |
| `web_search` — result cards with title/URL/snippet | JSON array dump |
| `web_fetch` — page title, favicon, URL | JSON, plus the one "Via Jina" chip |

`ansi-to-react` **is a dependency** (`package.json`) but is imported nowhere in `src/renderer` — ANSI escape sequences from `bash` render as literal garbage.

No grouping: consecutive tool calls are independent sibling `ToolRow`s joined only by the 1px rail. No parent/child nesting, no turn boundaries, no collapse-all, no "N tools ran" summary.

### 5.4 Timing

**None is displayed per tool.** `MessageMeta` (`ChatWindow.tsx:123-147`) shows one whole-message latency chip (`(latencyMs/1000).toFixed(1)s`). The `WorkLogEntry` carries `createdAt`/`updatedAt` (`runtimeActivity.ts:157-158`) but those never cross into `ChatToolPart`. Reasoning blocks are the only element with a live timer (`reasoning.tsx:89-99`, 1s interval).

### 5.5 Approvals

**Backend.** `ToolApprovalController` (`src/main/ai/core/ToolApprovalController.ts`) tracks `pendingByRequest: Map<requestId, Map<approvalId, PendingApproval>>` and `grantedScopesByConversation: Map<conversationId, Set<scopeKey>>`. `accept_for_session` adds `pending.sessionScopeKey` to the conversation grant set (`:52-59`). Scope keys are `"{toolType}:{toolName}"` (`runtimeActivity.ts:58-60`). Modes come from `TOOL_PERMISSION_MODES` (`chatParameters.ts:27`), default `'ask'` (`:54`).

**UI.** Inline in `ToolRow`, `ChatWindow.tsx:272-310`. When `state === 'approval-requested'`:
- Reason line, `text-[10.5px] text-text-faint` (`:274-276`)
- Four `h-6` buttons in a wrapping flex row (`:277-308`): **Approve** (emerald), **Session** (neutral), **Deny** (rose), **Cancel** (ghost)
- All disabled while `submittingApproval != null` (`:280`) with `disabled:opacity-60`; no spinner, no per-button pending state
- Response goes through `onRespondToolApproval` → `respondToolApproval` in the store → IPC

Post-decision confirmations: `CheckCircle2 + "Approval granted"` (`:312-317`) or `XCircle + deniedMessage` (`:319-324`).

**Weaknesses:** no keyboard affordance (no Enter/Esc binding, no focus trap, no autofocus on Approve); no diff/command preview of *what* is being approved beyond the generic summary line; no scope disclosure ("Session" doesn't say what scope it grants); four buttons at `text-[10.5px]` in a 24px-tall row is below comfortable hit-target size; the approval strip is inside a hover-highlighted div, competing with the row's `hover:bg-bg-hover/60`.

**`ai-elements/confirmation.tsx` is a complete, purpose-built approval component (173 lines: `Confirmation`, `ConfirmationTitle`, `ConfirmationRequest`, `ConfirmationAccepted`, `ConfirmationRejected`, `ConfirmationActions`, `ConfirmationAction`) with `ChatToolApproval`-aware state gating — and it has zero importers.** Verified by grep.

### 5.6 Reasoning rendering

`ReasoningRow` (`ChatWindow.tsx:149-173`) wraps `Reasoning` / `ReasoningTrigger` / `ReasoningContent` (`reasoning.tsx`).
- `defaultOpen={false}` (`:165`); `Reasoning` force-opens while `isStreaming` and force-closes on stop (`reasoning.tsx:81-100`) — the same "user choice gets stomped" pattern as `ToolRow`.
- Duration: seeded from message `latencyMs` (`ChatWindow.tsx:166`) or a live 1s ticker; formatted `Ns` / `Nm Ns` (`reasoning.tsx:32-45`); rendered as a bordered chip at `text-[9.5px]` (`reasoning.tsx:170-172`).
- Trigger: 36px icon box (`size-9`) with `BrushSpinner` while streaming / `BrainCircuit` when idle; title "Reasoning" ↔ "Thought process"; static subtitle "Reasoning notes".
- Content: `MessageResponse` at `text-[13px] leading-[1.7]` with inline-code overrides (`reasoning.tsx:200`).
- **Visual mismatch:** the reasoning block is a bordered card with a 36px icon; the tool rows next to it are borderless timeline entries with a 7px dot. They read as two unrelated systems stacked in one column.

### 5.7 Dead tool UI

`ai-elements/tool.tsx` exports `Tool` (`:202`), `ToolHeader` (`:228`), `ToolContent` (`:289`), `getStatusBadge` (`:105`) — a complete `Collapsible`-based tool card with `defaultOpen = true`, an icon chip, a two-line header, and eight monochrome status badges. **Grep confirms zero usages of `<Tool>`, `<ToolHeader>`, `<ToolContent>` anywhere.** `ChatWindow.tsx:34` imports only `{ ToolInput, ToolOutput }`.

So the repo carries **three** tool-status vocabularies simultaneously:
1. `getStatusBadge` in `tool.tsx:105-198` — token-based monochrome badges (dead)
2. `getToolStatusClasses` in `ChatWindow.tsx:87-121` — raw Tailwind palette (live)
3. `WorkLogEntryStatus` + `tone` in `contracts.ts` / `runtimeActivity.ts` — never reaches the UI

---

## 6. Interaction & motion

### 6.1 Keyboard

Defaults in `src/shared/keybindings.ts:90-193` (`modKey` = Cmd on mac, Ctrl elsewhere):

| Command | Shortcut | `when` |
|---|---|---|
| `app.commandPalette.toggle` | `Mod+K` | — |
| `sidebar.toggle` | `Mod+B` | `view.chat` |
| `chat.new` | `Mod+N` | — |
| `settings.open` | `Mod+,` | — |
| `composer.focus` | `Mod+Shift+L` | `view.chat` |
| `models.openSwitcher` | `Mod+Shift+M` | `view.chat` |
| `conversation.previous` | `Mod+Alt+↑` | `view.chat` |
| `conversation.next` | `Mod+Alt+↓` | `view.chat` |
| `conversation.jump.1..9` | `Mod+1` … `Mod+9` | `view.chat` |

`when` clauses are a mini-language (identifier / not / and / or, parsed at `keybindings.ts:196+`) over five context flags: `view.chat`, `view.settings`, `commandPalette.open`, `modelPicker.open`, `composer.focus` (`keybindings.ts:23-29`; context built at `App.tsx:306-315`).

Dispatch: a single `window` `keydown` listener (`App.tsx:545-624`). `isEditableTarget()` blocks commands inside inputs unless `allowWhileEditable` (`App.tsx:580-582`); all General commands set it, both Navigation commands do not (`keybindingCommands.ts:12-73`).

**Shortcut hints.** Holding the modifier reveals inline shortcut chips — `showConversationJumpHints`, `showNewChatShortcutHint`, `showSidebarToggleShortcutHint` (`App.tsx:125-127`), recomputed on every `keydown` **and** `keyup`, cleared on `blur` (`App.tsx:609-613`). Rendered in `Sidebar.tsx:120-124, 136-140, 151-157, 173-177`. This means **three `setState` calls fire on every single keystroke in the app**, including while typing in the composer.

**Gaps:** no shortcut to expand/collapse a tool call, approve/deny a pending approval, copy a message, stop generation (Esc does nothing), retry, or open the model picker while streaming. Command palette has 8 visible commands; the 9 jump commands are hidden (`keybindingCommands.ts:72`).

### 6.2 Command palette

`CommandPalette.tsx:28-82`, built on `ui/command.tsx` (cmdk) + `CommandDialog`. Grouped by `section` (`General` / `Navigation`, `:29-36`). Items show title `text-[13px]` + description `text-[11px]` + a shortcut chip. Fuzzy match value is `"{title} {description}"` (`:64`). Disabled logic lives in `App.tsx:365-370` (sidebar toggle off-chat, model switcher when streaming, prev/next with no selection). Empty state: "No matching commands." (`:51`).

Palette contains **only navigation/UI commands** — nothing about tools, approvals, models, providers, conversations by name, or settings sections.

### 6.3 View transitions

`lib/viewTransitions.ts:15-34` — `document.startViewTransition` with `flushSync`, guarded by `prefers-reduced-motion` (`:11-13`) and feature detection (`:22-25`). CSS at `styles.css:405-436`: named groups `app-sidebar` / `app-main-panel`, **180ms** `cubic-bezier(0.22,1,0.36,1)`, zeroed under reduced motion (`:427-435`).

Applied to: sidebar collapse (`App.tsx:419-422`), open settings (`:428-431`, `:738`), close settings (`:650`), open/close sites (`:635`, `:740`), onboarding→providers (`:709`), open settings from chat (`:815`, `:867`).
**Not** applied to: `openLanding` / `closeLanding` (`App.tsx:739`, `:633`), conversation switching, model switching.

Note the transition duration is hardcoded `180ms` in CSS while `--duration-normal` is `200ms`/`150ms` depending on theme — they disagree.

### 6.4 Animation inventory

Whole-renderer grep:

| class | count | where |
|---|---|---|
| `animate-spin` | 15 | refresh icons, `Loader2`, `CircleDashed` |
| `animate-in` / `animate-out` | 7 / 7 | radix `data-[state]` on dialog/dropdown/select/hover-card/tooltip |
| `animate-ping` | 2 | streaming pulse (`App.tsx:798`, `ChatWindow.tsx:454`) |
| `animate-pulse` | 1 | |
| `animate-accordion-up` / `-down` | 1 each | `ui/accordion.tsx` — **the `accordion-up`/`accordion-down` keyframes are not defined in `styles.css` or any theme file.** Under Tailwind v4 with no config file, these animations do not exist; the accordion snaps. |

`motion` (framer) is a dependency but imported **only** by `ui/brush-spinner.tsx:2`.

Transition durations in TSX: `duration-200` ×3, `duration-300` ×1. Everything else relies on the bare `transition` utility (150ms) or the blanket rules in `styles.css:283-291`.

`Collapsible` (`ui/collapsible.tsx`) is an unstyled radix passthrough — **no height animation**, so both tool details and reasoning content pop open instantly.

There is no layout animation on message insert, no stagger, no skeleton shimmer, no optimistic-send animation.

---

## 7. States

### 7.1 Loading

| Surface | Treatment |
|---|---|
| App bootstrap | `LoadingScreen`, inline SVG spinner + "Loading…" (`App.tsx:38-50`) |
| Conversation load | `ConversationEmptyState` with `RefreshCw animate-spin h-10 w-10`, title "Loading conversation", `role="status" aria-live="polite"` (`ChatWindow.tsx:906-913`) |
| Older messages | Button flips label to "Loading older messages…" + spinning icon; also auto-loads when `visibleRange.startIndex === 0` (`ChatWindow.tsx:876-887`, `952-964`) |
| Model refresh | `isRefreshingModels` flag → spinner in `ModelSelector` / `SidebarSettingsMenu` |
| Approval submit | `disabled:opacity-60` only, no spinner (`ChatWindow.tsx:280-306`) |
| Message send | No optimistic pending state distinct from `streaming` |
| Code highlighting | Async; block renders unhighlighted then repaints (`CodeBlock.tsx:44-56`) |

Four different loading idioms (inline SVG, `RefreshCw animate-spin`, `BrushSpinner`, `ui/spinner`) coexist.

### 7.2 Empty

- **No conversation selected / no messages**: `SuggestionsState` (`ChatWindow.tsx:708-764`) — headline "What can I help with?", capability chips, 6 suggestion cards. Shown both when `!detail` (`:915`) and when `detail && messages.length === 0` (`:966-969`); the second path additionally centers via `min-h-full justify-center` (`:949`).
- **No credential**: `showSetupPrompt` warning card, `border-warning-border bg-warning-bg`, "Add your API key to start" + `.btn-primary` (`ChatWindow.tsx:921-935`). The *only* place `--warning-*` tokens are used.
- **Empty command palette**: "No matching commands." (`CommandPalette.tsx:51`)
- **Empty sidebar**: no empty state — the conversation list simply renders nothing under the "Conversations" heading.
- Generic `ConversationEmptyState` (`conversation.tsx:43-70`) uses `text-muted-foreground` / `text-sm`, a different type system from every caller.

### 7.3 Error

| Surface | Treatment |
|---|---|
| Bootstrap failure | `ErrorScreen`, `rounded-xl border-error-border bg-bg-elevated shadow-elevated` + Retry (`App.tsx:52-68`) |
| Render crash | `RendererErrorBoundary`, `bg-black/20` `<pre>` for the stack (`:46`) |
| Stream error | `StreamingRow` error card: `border-error-border bg-error-bg p-4`, `AlertCircle`, title + message + Retry button with `hover:text-white` (`ChatWindow.tsx:626-645`) |
| Aborted | `border-border-subtle bg-bg-subtle p-4`, `StopCircle`, "Generation stopped" (`ChatWindow.tsx:656-661`) |
| Tool error | `ToolRow` badge "Error" + rose palette + auto-expanded `ToolOutput` error box (`tool.tsx:332-354`) |
| Attachment error | Plain text line above the footer, `text-[11px] text-[var(--text-tertiary)]` (`Composer.tsx:240`) — no icon, no error color |
| Toasts | `sonner` via `AtlasToaster` + `lib/notify.ts` |

Five different error visual languages: bordered card w/ radius, bordered card w/o radius, plain text, badge, toast.

### 7.4 Streaming

- Titlebar: ping-dot + "Streaming" with `role="status" aria-live="polite"` (`App.tsx:791-803`)
- Empty draft: ping-dot + "Thinking…" `text-[13.5px] text-text-muted` (`ChatWindow.tsx:451-458`) — a *third* copy of the same ping-dot markup
- Sidebar row: `BrushSpinner` + secondary label "Thinking…" (`sidebarViewModel.ts:68-70`)
- Text: `MessageResponse isAnimating` on the last part only (`ChatWindow.tsx:489`)
- Reasoning: force-open + live timer
- Scroll: `use-stick-to-bottom` with `resize: 'instant'` while streaming (`ChatWindow.tsx:782`); trailing overscan dropped to 0 (`:675`); `scrollToBottom` forced on every new `requestId` with `ignoreEscapes: true` (`:889-899`) — **this overrides the user scrolling up at the start of each turn**
- Composer: submit button becomes a stop square; model picker and reasoning-effort controls disable (`Composer.tsx:292, 306, 312`)
- "Jump to latest" pill appears when `!isAtBottom` (`ChatWindow.tsx:1022-1031`) — the only `rounded-full` `shadow-elevated` element in the chat surface

---

## 8. Weak spots

Ordered by impact on a design migration.

### 8.1 Tool-call rendering is the weakest surface (blocking)

1. **No per-tool rendering.** One generic row for 16+ tools. `CanonicalToolType` is computed server-side and thrown away at `runtimeActivity.ts:207-332`. Nothing in `src/renderer` reads `toolType`.
2. **The subtitle shows JSON.** `headerSummary` (`ChatWindow.tsx:204-227`) falls through to `String(rawInput)` — a `bash` call's headline reads `{"command":"npm test"}`.
3. **No diffs.** File-change tools dump full file contents as JSON. No unified-diff renderer exists anywhere in the repo.
4. **No terminal output.** `ansi-to-react` is installed and unused; stdout renders through the markdown pipeline, so backticks/asterisks in program output get formatted.
5. **900-char truncation** applied in main (`ToolResultNormalizer.ts:1`) with no "show full output" affordance.
6. **Expand state is destroyed on every status change** (`ChatWindow.tsx:229-233`).
7. **No timing per call.** Data exists on `WorkLogEntry`, never forwarded.
8. **No grouping / turn structure.** Flat sibling rows.
9. **Three parallel status vocabularies**, one of them dead (`tool.tsx`), one bypassing all tokens (`ChatWindow.tsx`).
10. **`ai-elements/tool.tsx` (382 lines) and `ai-elements/confirmation.tsx` (173 lines) are fully dead.** ~555 lines of purpose-built, token-correct tool UI shipped and unused.
11. **`aria-label="Show/Hide reasoning details"` on the tool disclosure** (`ChatWindow.tsx:345`) — copy-paste from the reasoning component.

### 8.2 Token system is defined but not enforced

12. **Radius is completely broken.** Six of seven `--radius-*` tokens have zero component usage; the user setting and all theme radius values are inert; components hardcode `rounded-2xl` / `rounded-lg` / `rounded-[10px]` / `rounded-[6px]` / `rounded-full` / `rounded-xl`. (Root cause documented in `MIGRATION.md` Phases 7–11.)
13. **Motion tokens have zero component usage.** `--duration-*` / `--easing-default` never leave `styles.css`.
14. **18 raw-palette color classes in `ChatWindow.tsx:87-121, 281-320`** make the tool timeline unreadable on the `cursor` light theme.
15. **~24 `text-white` / `bg-white` / `bg-black` sites** (full list §2.4) break every light theme.
16. **Dialog/overlay backgrounds hardcode black** (`ui/dialog.tsx:40`, `AddModelDialog.tsx:89`, `visual-gallery.tsx:93`) while `--overlay` exists and is theme-aware.
17. **`--accent` / `--accent-hover` / `--accent-text` are defined in every theme but missing from the contract and from `@theme`** — the brand accent (`#f54e00` Cursor orange, `#3b82f6` default blue) is unreachable from any component.
18. **`--accent-primary` is referenced and never defined** (`context.tsx:143`).
19. **Cursor dark mode never overrides `--bg-overlay`** (`cursor.css:101-147`) → cream popovers with cream text in dark mode.
20. **`default` and `xai` themes have no light variant.** Selecting "Light" mode with them changes only `color-scheme`.
21. **Dead tokens:** `--bg-panel`, `--success-bg/-border/-text`, all six `--toast-*`, `--scrollbar-hover`, `--sidebar-expanded`, `--sidebar-collapsed` (the last two are explicitly labelled deprecated at `styles.css:84-85` yet still exported to `@theme` at `:205-206`).
22. **`:root, [data-theme='default']` selector** (`styles.css:11`) targets a `data-theme` value that is never set.

### 8.3 Typography has no scale

23. **231 arbitrary `text-[Npx]` declarations across 18 values**, 8 of them fractional. The 6 `ui-text-size-*` utilities have 14 call sites total.
24. **The UI font-size setting is therefore ~94% inert** in the chat surface.
25. **`--font-ui-system` is referenced but never defined** (`App.tsx:112-118`) → when the user's UI font override is empty, `--font-ui-family` resolves to nothing and the app falls back to the browser default font. Live regression.
26. **GeistMono is referenced by the xAI theme** (`xai.css:73`) **but never loaded** — no `@font-face`, no font package.
27. Assistant body `15.5px` vs user body `13.5px` (`ChatWindow.tsx:488` vs `:541`), with `leading-[1.85]` vs `leading-[1.65rem]` mixing units.
28. Four uncoordinated uppercase tracking values (`0.12em`, `0.14em`, `0.16em`, `0.18em`).

### 8.4 Accessibility

29. **Only 12 files use `focus-visible`**, all but two of them `ui/*` primitives. The app-level buttons (`Sidebar.tsx`, `ChatWindow.tsx`, `CommandPalette.tsx`, `SettingsWorkspace.tsx`) rely entirely on the global `*:focus-visible { outline: 2px solid var(--border-strong) }` rule at `styles.css:273-277` — which uses a low-contrast border color as the ring on every theme (`rgba(255,255,255,0.28)` on `default`).
30. **No focus management on approvals.** Approve/Deny buttons are not focused, not reachable by shortcut, and not announced.
31. **Tool state changes are not announced.** The tool region has no `aria-live`; only the titlebar and the message log do.
32. **No `role`/`aria` on the tool timeline.** `ToolRow` is a bare `div`; the status dot and rail are `aria-hidden` (correct) but the row itself has no accessible name or state.
33. **Chevron disclosure is the only expand affordance** — the header text is not clickable, so the hit target is 20×20 px.
34. **Approval buttons are 24px tall with 10.5px text** — below the 44px/24px minimum recommendations.
35. **`SlotLabel`, `MentionAutocompleteList`** and several composer controls: verify aria (see §4.4/§4.6 sub-agent notes).
36. Aria coverage by file is thin: `SettingsWorkspace` 10, `ChatWindow` 10, `Sidebar` 7, `ModelSelector` 7; most other components 0–2.

### 8.5 Layout & structure

37. **Main-panel titlebar border disappears when the sidebar collapses** (`App.tsx:756`).
38. **Collapsed sidebar overlaps macOS traffic lights** — the `w-20` spacer only exists in the expanded branch (`Sidebar.tsx:99` vs `:95`).
39. **Collapsed sidebar shows no conversations at all** (`Sidebar.tsx:285-287`) — the rail is a dead 72px column with two buttons.
40. **Sidebar is not resizable** and its collapsed state is component-local (`App.tsx:123`), so it is not persisted.
41. **Three competing content widths** in one column: `--content-max` (680–860px), `76ch` for assistant, `min(56%,560px)` for user.
42. **`galleryOpen` and `showOnboarding` are local `App` state**, not store — unreachable from the command palette or keybindings.

### 8.6 Duplication & dead code

43. `ai-elements/tool.tsx` (382 lines) — `Tool`/`ToolHeader`/`ToolContent`/`getStatusBadge` dead.
44. `ai-elements/confirmation.tsx` (173 lines) — entirely dead.
45. `ai-elements/interactive-diagram.tsx` (324 lines) — 0 importers.
46. `ai-elements/rive-visual.tsx` (186 lines) — 0 importers.
47. `ai-elements/prompt-input.tsx` — 1,477 lines, ~45 exports, 11 used.
48. `ai-elements/conversation.tsx` — only `ConversationEmptyState` is used; `Conversation`, `ConversationContent`, `ConversationScrollButton`, `ConversationDownload`, `messagesToMarkdown` are dead (ChatWindow re-implements sticky-scroll and the jump button itself at `ChatWindow.tsx:780, 1022-1031`).
49. `ai-elements/message.tsx` — `MessageBranch*` (7 components, ~180 lines) dead; only `MessageResponse` is used.
50. **The ping-dot streaming indicator is copy-pasted three times** (`App.tsx:797-800`, `ChatWindow.tsx:453-456`, and the sidebar spinner variant).
51. **`text-[var(--text-x)]` vs `text-text-x`** — both spellings are used for the same token throughout, sometimes in the same file (`ChatWindow.tsx:274` `text-text-faint` vs `:740` `text-[var(--text-muted)]`).
52. `MessageResponseContent.tsx:28` — a single ~1,100-character `className` carrying the entire markdown stylesheet; unmaintainable and impossible to theme per-context.
53. `styles.css` defines `.btn-primary` / `.btn-secondary` / `.card` / `.input` / `.section-title` / `.section-desc` (uppercase mono, 1.4px tracking) that duplicate and conflict with `ui/button.tsx` and `ui/input.tsx` variants. `.btn-primary` is used in `ChatWindow.tsx:929`, `.btn-secondary` in `App.tsx:61` — mixing two button systems in the same app.
54. `.input:focus { box-shadow: 0 0 0 3px var(--border-strong) }` (`styles.css:551-554`) uses a *border* token as a 3px focus ring — visually a thick grey halo.

### 8.7 Performance-adjacent UX

55. **Three `setState` calls per keystroke** for shortcut hints (`App.tsx:551-568`), fired on `keydown` *and* `keyup`, app-wide.
56. **`deferRichContent`** renders unstyled plaintext for off-screen rows (`ChatWindow.tsx:446-448`) — fast scrolling shows raw markdown that then reflows.
57. **Virtualizer height estimates are hand-tuned magic numbers** (`ChatWindow.tsx:688-706`: `156 + len/100*24 + tools*52 + reasoning*56 + visuals*320`), so scroll position jumps when tool rows expand.
58. **`scrollToBottom({ ignoreEscapes: true })` on every new `requestId`** (`ChatWindow.tsx:889-899`) yanks the user back down at the start of each turn even if they deliberately scrolled up.
59. `nowMs` ticks every 60s and is a dependency of `buildSidebarConversationItems` (`App.tsx:133-136, 287-295`) → full sidebar recompute every minute.

---

## Appendix A — file map

```
src/renderer/
  App.tsx                          901  shell, view switch, keyboard, theme effects
  main.tsx                          20  mount + CSS import order
  styles.css                       582  token contract + @theme + base + utilities
  themes/default.css                94
  themes/cursor.css                147  (only theme with a dark variant)
  themes/xai.css                    94
  themes/landing.css               162  marketing-only classes
  components/
    ChatWindow.tsx                1034  history, virtualization, ToolRow, states
    Composer.tsx                   527
    Sidebar.tsx                    306
    SettingsWorkspace.tsx         1275
    CodeBlock.tsx                  332
    ModelSelector.tsx              294
    SidebarSettingsMenu.tsx        217
    MentionAutocomplete.tsx        166
    SidebarConversationRow.tsx     101
    CommandPalette.tsx              82
    OnboardingFlow.tsx              91
    AppUpdateButton.tsx             66
    RendererErrorBoundary.tsx       57
    XAILandingPage.tsx              39  + xai/*.tsx (6 files)
    ai-elements/
      prompt-input.tsx            1477  ~45 exports, 11 used
      attachments.tsx              388
      tool.tsx                     382  ToolInput/ToolOutput used; rest DEAD
      context.tsx                  367
      message.tsx                  365  MessageResponse used; MessageBranch* DEAD
      interactive-diagram.tsx      324  DEAD
      visual.tsx                   321
      model-selector.tsx           244
      visual-gallery.tsx           219
      reasoning.tsx                210
      rive-visual.tsx              186  DEAD
      confirmation.tsx             173  DEAD
      conversation.tsx             168  only ConversationEmptyState used
      MessageResponseContent.tsx    36
    ui/                                 23 shadcn primitives
    providers/                          5 files
    composer/                           2 files
    sites/SitesWorkspace.tsx       672
  lib/  keybindings.ts 384, keybindingCommands.ts 100, viewTransitions.ts 34,
        messageRendering.ts 31, notify.ts 34, toastConfig.ts 17, utils.ts, posthog.ts
  stores/ useAppStore.ts 1162, streamEventReducers.ts 381, useSitesStore.ts 348,
          useProvidersStore.ts 234, conversationCache.ts 126
src/shared/
  runtimeActivity.ts               332  WorkLog derivation + envelope→StreamEvent downgrade
  messageParts.ts                  404  ChatMessagePart reducer
  contracts.ts                          types incl. CanonicalToolType, WorkLogEntry
  keybindings.ts                        defaults + when-clause parser
```

## Appendix B — reference docs in-repo

- `DESIGN.md` — a 19KB spec of **Cursor's** design system (colors, CursorGothic/jjannon/berkeleyMono type scale, component specs). The `cursor` theme in `themes/cursor.css` implements roughly the color half of it; none of the fonts, the type scale, or the "Timeline / Feature Colors" (`#dfa88f` thinking, `#9fc9a2` grep, `#9fbbe0` read, `#c0a8dd` edit — i.e. **per-tool-type colors**) were adopted.
- `MIGRATION.md` — an 11-phase xAI brutalist migration checklist, all boxes ticked. Phases 7–11 are the documented cause of the radius-token failure and of the monochrome badge system in `tool.tsx` (which was then bypassed by the colored badges in `ChatWindow.tsx`).
