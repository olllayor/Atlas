# Codex-like Feature Implementation Prompts

> Five deep, self-contained prompts for AI agent sessions. Each is designed to be
> pasted into a fresh session and drive the feature end-to-end (research → plan →
> implement backend + data → test). UI implementation follows in a separate pass.
>
> **Context for every prompt:** Atlas is an Electron 41 + React 19.2 + TypeScript 6
> desktop chat client (OpenRouter-first BYOK). Stack: Tailwind v4 (no config file,
> `@theme` in `styles.css`), Zustand 5, shadcn "new-york" primitives, `ai` SDK v6,
> `streamdown` for markdown, `@tanstack/react-virtual` for history, `better-sqlite3`
> for persistence. The renderer has a 3-layer CSS custom-property theme system
> (contract in `styles.css` → per-theme overrides in `themes/*.css` → `@theme`
> alias layer). The `codex` design theme is the default. All gates: `npx tsc --noEmit`
> clean, `node --import tsx --test tests/*.test.ts` (371 tests), `pnpm build`.

## The 5 Features

| # | Feature | Prompt File | Risk | Depends On |
|---|---------|-------------|------|------------|
| 1 | Right-hand Diff Panel | [feature-1-diff-panel.md](./feature-1-diff-panel.md) | Medium | Feature 3 (git) |
| 2 | Integrated Terminal | [feature-2-terminal.md](./feature-2-terminal.md) | Medium (native module) | — |
| 3 | Git Integration | [feature-3-git-integration.md](./feature-3-git-integration.md) | Low | — |
| 4 | Multi-Conversation Task Mgmt | [feature-4-task-management.md](./feature-4-task-management.md) | High (DB migration) | — |
| 5 | Environment & Workspace Context | [feature-5-environment-context.md](./feature-5-environment-context.md) | Low | Feature 3 (git) |

## Recommended Implementation Order

1. **Feature 5** (Environment & Workspace Context) — lowest risk, pure detection + display.
   Foundation for Features 1-3.
2. **Feature 3** (Git Integration) — extends existing `runGit()` helper, no risky refactors.
3. **Feature 1** (Diff Panel) — depends on Feature 3's git status for the file tree.
   Medium risk (new DB table, revert logic).
4. **Feature 4** (Task Management) — highest risk (DB migration, concurrent sessions).
   Do last, after the other features are stable.
5. **Feature 2** (Terminal) — independent but needs `node-pty` (native module).
   Can be done in parallel with any feature, but test the rebuild carefully.

> **After all 5 features are implemented**, a separate UI pass will wire the
> Codex design language onto each new surface — borderless rows, tint-based
> elevation, dim activity rows, status glyphs, hairline separators, and the
> `codex` theme tokens throughout.

