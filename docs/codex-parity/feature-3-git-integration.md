# Feature 3: Git Integration (Status, Diff, Log, Branch, Commit)

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. The `codex` design theme is the default.
> Gates: `npx tsc --noEmit` clean, `node --import tsx --test tests/*.test.ts` (371 tests),
> `pnpm build`. Branch: `codex-ui-redesign`.

## Goal
Add full git integration so the agent and user can inspect and manage a git
repository from within Atlas. Deepens the existing `git_status` and `git_diff`
tools into a complete git surface: log, branch, commit, stash, and a git-backed
file-status view in the workbench.

## How Codex does it
- **`git_status`** and **`git_diff`** are first-class agent tools.
- **Git operations** render as borderless activity rows (`Ran git status`,
  `Ran git log`, `Committed: "fix: handle empty input"`).
- **PR review flow**: code-review findings with priority badges (P1/P2), bold
  titles, dim body, "Fix with Codex" action. Borderless, whitespace-separated.
- **Branch context** in the workspace context bar: `main` or `feature-branch`.
- **Diff panel** uses git diff output directly.

## Atlas's current state
- **`src/main/ai/tools/codeTools.ts:235-266`** — `runGit()` helper,
  `gitStatusToolExecute()` runs `git status --porcelain=v1 --branch`,
  `gitDiffToolExecute()` runs `git diff --no-color -U3 [--staged] [-- path]`.
  These work but are minimal.
- **`builtInTools.ts`** — imports `gitDiffToolExecute`, `gitStatusToolExecute`,
  registers as agent tools.
- **No `git_log`, `git_commit`, `git_branch`, `git_stash`** tools.
- **No git UI** — no branch selector, no commit dialog, no log view.
- **`WorkspaceContextBar.tsx`** — shows project folder, not git branch/status.
- **`projectsRepo.ts`** — projects have `folder` path; no git metadata.

## What to implement

### Backend (main process)
1. **Git tools** (`src/main/ai/tools/gitTools.ts` — new file):
   - `gitLogToolExecute({ maxCount?, path? })` → `git log --oneline --format=... --max-count=N`
   - `gitBranchToolExecute({ action: 'list'|'create'|'switch'|'delete', name? })` →
     `git branch` / `git checkout` / `git branch -d`
   - `gitCommitToolExecute({ message, amend?, addAll? })` →
     `git add -A` (optional) + `git commit -m "..." [--amend]`
   - `gitStashToolExecute({ action: 'push'|'pop'|'list'|'drop', message? })` →
     `git stash push/pop/list/drop`
   - All use existing `runGit()` helper (extract to shared from `codeTools.ts`).
   - Register in `builtInTools.ts` alongside existing git tools.
   - `git_commit` and `git_stash push` are **approval-gated** (add to
     `SIDE_EFFECTING_TOOL_NAMES` in `chatParameters.ts`).

2. **Git state service** (`src/main/workspace/GitStateService.ts`):
   - `getBranch(root)` → current branch name (or `HEAD detached`)
   - `getStatus(root)` → parsed `git status --porcelain` as `GitFileStatus[]`
   - `getLog(root, maxCount)` → `GitLogEntry[]` (`{ hash, shortHash, message,
     author, date, parents }`)
   - `isGitRepo(root)` → boolean (check for `.git` dir)
   - Cache with invalidation on file-change events.

3. **IPC** (`src/main/ipc/git.ts` — new file):
   - `git.state(conversationId)` → `{ isRepo, branch, ahead, behind, files }`
   - `git.log(conversationId, maxCount?)` → `GitLogEntry[]`
   - `git.branches(conversationId)` → `GitBranch[]` (`{ name, current, remote }`)

### Frontend (renderer)
4. **Branch selector** in `WorkspaceContextBar.tsx`: current branch, dropdown
   to switch/create.
5. **Git log view** in workbench (new tab or panel): commit list with hash,
   message, author, date. Click commit → show its diff.
6. **Commit dialog**: modal with message input, `--amend` toggle, `addAll` toggle.
7. **Store** (`useAppStore.ts`): `gitStateByConversation`, `gitLog`,
   `loadGitState()`, `loadGitLog()`, `commitChanges()`, `switchBranch()`.

## Files to read first
- `src/main/ai/tools/codeTools.ts` (`runGit`, `gitStatusToolExecute`, `gitDiffToolExecute`)
- `src/main/ai/tools/builtInTools.ts` (tool registration pattern)
- `src/shared/chatParameters.ts` (`SIDE_EFFECTING_TOOL_NAMES`, `APPROVAL_GATED_TOOL_NAMES`)
- `src/main/workspace/conversationWorkspace.ts` (workspace resolution)
- `src/renderer/components/workspace/WorkspaceContextBar.tsx`
- `src/main/ipc/projects.ts` (IPC pattern)
- `src/main/db/repositories/projectsRepo.ts` (project data model)

## Acceptance criteria
- [ ] Agent can call `git_log`, `git_branch`, `git_commit`, `git_stash` tools
- [ ] `git_commit` and `git_stash push` are approval-gated
- [ ] WorkspaceContextBar shows current git branch when a repo is attached
- [ ] Branch selector dropdown lists local branches and can switch
- [ ] Git log view shows recent commits with hash + message
- [ ] Commit dialog works (message, amend, addAll)
- [ ] Git state refreshes when files change (not stale)
- [ ] `tsc` clean, all tests pass, build succeeds
- [ ] Tests for `gitTools.ts` (mock `runGit`)

## Constraints
- Use existing `runGit()` helper — don't spawn git differently
- All git operations use `resolveWorkspaceCwd(workspace)` as cwd
- `git_commit` must be approval-gated (writes to repo)
- `.git` directory stays read-only (existing `PROTECTED_PROJECT_PATH_NAMES`)
- Don't add `simple-git` — `runGit()` is sufficient
- Git features only activate when project attached AND is a git repo
