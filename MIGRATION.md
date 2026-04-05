# xAI Design Migration Tracker

## Phase 0: Setup & Audit
- [x] IPC audit — no insertCSS, no main-process style injection
- [x] Semantic color grep audit — 32 instances cataloged across 10 files
- [x] Template literal grep audit — clean (no computed class strings)
- [x] MIGRATION.md created

## Phase 1: Foundation — CSS Variables + @theme
- [x] styles.css rewritten with xAI tokens (#1f2228 bg, white-opacity text/borders)
- [x] @theme block overrides (all radius 0px, shadow none, font-mono GeistMono)
- [x] Body font-smoothing + focus rings + targeted motion
- [x] CSS alias chain (old vars → new values for backward compat)

## Phase 2: Utility Classes
- [x] .btn-primary — white bg, dark text, GeistMono uppercase, 1.4px tracking
- [x] .btn-secondary — transparent bg, white text, border-strong, GeistMono uppercase
- [x] .card — 0px radius, bg-subtle, border-default, no shadow
- [x] .input — 0px radius, transparent bg, border-strong, blue focus ring
- [x] .section-title / .section-desc — font-normal, white-opacity text

## Phase 3: App Layout
- [x] App.tsx — removed all radial/linear gradient backgrounds
- [x] AppUpdateButton.tsx — stripped glassmorphism, shadows, backdrop-blur, blue tones

## Phase 4: Sidebar
- [x] Sidebar.tsx — solid #1f2228 bg, removed gradients/radials, sharp active items, flat shortcut hints
- [x] SidebarConversationRow.tsx — 0px radius, monochrome status colors, white spinner
- [x] SidebarSettingsMenu.tsx — 0px radius dropdown, solid bg, no blur/shadow, monochrome profile card

## Phase 5: ChatWindow
- [x] ChatWindow.tsx — sharp user bubbles (no gradient), monochrome suggestion cards, 0px meta chips, icon+text error states
- [x] → Accessibility checkpoint: error states have icon+text, focus rings in place

## Phase 6: Composer
- [x] Composer.tsx — removed glassmorphic gradient container, white submit button (no blue), sharp attachment pills, monochrome footer

## Phase 7: AI Elements
- [x] reasoning.tsx — 0px radius, white icon (no purple), no shadows/blur
- [x] tool.tsx — 0px radius, monochrome status badges (no amber/emerald/red), no gradients
- [x] confirmation.tsx — 0px radius, no red destructive gradient
- [x] context.tsx — 0px trigger, white progress ring (no blue-purple), solid bg hover card
- [x] conversation.tsx — 0px scroll/download buttons
- [x] message.tsx — 0px user bubbles, transparent bg + border
- [x] model-selector.tsx — 0px logos, no shadows, flat white-opacity
- [x] prompt-input.tsx — delegated to InputGroup (migrated in Phase 10)
- [x] attachments.tsx — 0px all variants, no backdrop-blur
- [x] MessageResponseContent.tsx — 0px inline code

## Phase 8: Settings + Onboarding
- [x] SettingsWorkspace.tsx — solid bg, 0px cards, monochrome nav/status/switches, no gradients
- [x] OnboardingFlow.tsx — sharp card, monochrome success/error, 0px toggle

## Phase 9: Dialogs + Overlays
- [x] CommandPalette.tsx — 0px dialog, solid bg, no blur/shadow, monochrome shortcuts
- [x] ui/dialog.tsx — 0px radius, no shadow, solid overlay
- [x] ui/command.tsx — 0px items/input
- [x] ui/dropdown-menu.tsx — 0px content/items, no shadow
- [x] ui/hover-card.tsx — 0px, no shadow

## Phase 10: UI Primitives
- [x] ui/button.tsx — 0px radius, stripped rounded from CVA
- [x] ui/input.tsx — 0px radius, no shadow
- [x] ui/textarea.tsx — 0px radius
- [x] ui/badge.tsx — 0px radius, monochrome variants
- [x] ui/alert.tsx — 0px radius, monochrome destructive
- [x] ui/select.tsx — 0px radius
- [x] ui/accordion.tsx — 0px radius
- [x] ui/sonner.tsx — monochrome toast styling
- [x] ui/brush-spinner.tsx — white gradient (no purple)
- [x] ui/avatar.tsx — kept rounded-full (only exception)
- [x] ui/switch.tsx — 0px track/thumb
- [x] ui/progress.tsx — 0px
- [x] ui/input-group.tsx — 0px addons/buttons
- [x] ui/button-group.tsx — 0px handling
- [x] ui/tooltip.tsx — 0px content

## Phase 11: Misc + Final Polish
- [x] CodeBlock.tsx — 0px radius, bg-white/[0.03], monochrome copy button
- [x] EmptyState.tsx — monospace display, 0px suggestion cards
- [x] ModelSelector.tsx — 0px trigger, monochrome free filter/badges
- [x] TypeScript typecheck: clean (only pre-existing TS2688 errors)
- [x] MIGRATION.md fully updated
