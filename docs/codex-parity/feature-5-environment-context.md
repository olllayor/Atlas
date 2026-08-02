# Feature 5: Environment & Workspace Context Bar

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. The `codex` design theme is the default.
> Gates: `npx tsc --noEmit` clean, `node --import tsx --test tests/*.test.ts` (371 tests),
> `pnpm build`. Branch: `codex-ui-redesign`.

## Goal
Deepen the `WorkspaceContextBar` from a minimal project-folder display into a
rich Codex-style environment context bar. Show the current working directory,
git branch, language/framework detection, environment variables, and a quick
"environment" panel for configuring the agent's execution context.

## How Codex does it
- **Context selector** in the composer: "Choose project: main" + "On my
  computer" environment toggle + "Do anything" action affordance.
- **Status line** in the composer footer: `gpt-5.6-sol default · /tmp/project`.
- **Environment panel**: container, dependencies, secrets — route-based settings.
- **Branch context** in the workspace bar: `main` or `feature-branch`.
- **Project detection**: auto-detects project type (Node, Python, Rust, etc.)

## Atlas's current state
- **`src/renderer/components/workspace/WorkspaceContextBar.tsx`** — shows project
  folder + workspace mode switch. Minimal: folder icon + path + "Chat | Work"
  toggle. No git branch, no environment detection, no env vars.
- **`src/renderer/components/workspace/WorkspaceModeSwitch.tsx`** — the
  "Chat | Work" segmented control.
- **`src/main/workspace/conversationWorkspace.ts`** — resolves the workspace
  (mode, projectId, project). Returns `ConversationWorkspace`.
- **`src/main/db/repositories/projectsRepo.ts`** — projects have `id`, `folder`,
  `name`, `exists`. No language/framework detection, no env vars.
- **`src/main/ai/tools/builtInTools.ts`** — `describeWorkspaceModeForPrompt()`.
- **No environment variable management** — agent's shell commands inherit
  the Electron process env.

## What to implement

### Backend (main process)
1. **Project detection service** (`src/main/workspace/ProjectDetector.ts`):
   - `detectProjectType(root)` → `{ type: 'node'|'python'|'rust'|'go'|'unknown',
     packageManager?: string, framework?: string, entryFile?: string }`
   - Detection: `package.json` → Node (check `packageManager`, deps for
     `next`/`react`/`express`). `pyproject.toml`/`requirements.txt` → Python.
     `Cargo.toml` → Rust. `go.mod` → Go.
   - `detectGitInfo(root)` → `{ branch, isRepo, ahead, behind }` (reuse
     `GitStateService` from Feature 3).
   - `detectEnvFile(root)` → reads `.env`/`.env.local` keys (not values).
   - Cache results, invalidate on file-change events.

2. **Environment variables** (`src/main/workspace/EnvStore.ts`):
   - Per-project env vars in SQLite (`project_env_vars`: id, project_id,
     key, value_encrypted, created_at).
   - `getEnvForProject(projectId)` → `Record<string, string>` (decrypted,
     encrypted at rest via `keytar`).
   - `setEnvVar(projectId, key, value)` → encrypts and stores.
   - `deleteEnvVar(projectId, key)` → removes.
   - Merge project env vars into `process.env` for child processes
     (`bash`/`write_file`/etc).

3. **IPC** (`src/main/ipc/workspace.ts` — new, or extend `projects.ts`):
   - `workspace.context(conversationId)` → `{ project, projectType, gitInfo,
     envKeys, mode }`
   - `workspace.env.list(projectId)` → `EnvVar[]` (key + masked value)
   - `workspace.env.set(projectId, key, value)` → stores
   - `workspace.env.delete(projectId, key)` → removes

### Frontend (renderer)
4. **WorkspaceContextBar deepening** (`WorkspaceContextBar.tsx`):
   - Show: project folder (truncated) + git branch chip + project type badge
     (e.g., `Node · pnpm`).
   - Click the bar → opens context popover/drawer with: full path (reveal in
     Finder), project type details, git status summary, env vars list
     (keys, masked values, edit/delete), "Open in Terminal" (Feature 2),
     "Open in Finder" button.
5. **Environment panel** (settings or drawer): key/value table, add/edit/delete,
   masked values with reveal toggle (reuse `ApiKeyInput` pattern from
   `providers/ApiKeyInput.tsx`).
6. **Composer status line** (`Composer.tsx`): show `model · /path/to/project`
   in the composer footer alongside existing token/usage indicator.

## Files to read first
- `src/renderer/components/workspace/WorkspaceContextBar.tsx`
- `src/renderer/components/workspace/WorkspaceModeSwitch.tsx`
- `src/main/workspace/conversationWorkspace.ts`
- `src/main/db/repositories/projectsRepo.ts`
- `src/main/ai/tools/builtInTools.ts` (`describeWorkspaceModeForPrompt`)
- `src/main/ai/tools/toolRuntime.ts` (`bashToolExecute` — where env merges)
- `src/main/secrets/keychain.ts` (encryption pattern for env values)
- `src/renderer/components/providers/ApiKeyInput.tsx` (masked input pattern)
- `src/renderer/components/Composer.tsx` (composer footer)

## Acceptance criteria
- [ ] WorkspaceContextBar shows folder + git branch + project type badge
- [ ] Clicking the bar opens context drawer with full details
- [ ] Project type auto-detected (Node/Python/Rust/Go) with framework hints
- [ ] Environment variables addable/editable/deletable per project
- [ ] Env vars encrypted at rest (using keytar/keychain)
- [ ] Env vars merged into agent's shell command environment
- [ ] Composer footer shows `model · /path` status line
- [ ] "Open in Finder" reveals the project folder in Finder
- [ ] `tsc` clean, all tests pass, build succeeds
- [ ] Tests for `ProjectDetector` (mock fs) and `EnvStore` (mock keychain)

## Constraints
- Env var values encrypted at rest — reuse `keytar`-based pattern from
  `keychain.ts` (don't store plaintext in SQLite)
- Env var values masked (••••) with reveal toggle in UI
- Don't auto-load `.env` files — only explicitly-configured project env vars
  merge into child processes
- Project detection must not block UI — async, cached
- File-change invalidation: `fs.watch` on project root (debounced)
- Context drawer uses Codex design tokens (borderless, hairlines, weight 400)

