# Feature 1: Right-hand Diff Panel (File-Change Browser)

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. The `codex` design theme is the default.
> Gates: `npx tsc --noEmit` clean, `node --import tsx --test tests/*.test.ts` (371 tests),
> `pnpm build`. Branch: `codex-ui-redesign`.

## Goal
Deepen the WorkbenchPanel "Changes" tab from a tool-call-reader into a real
file-change browser. When the agent edits files (`write_file`, `edit_file`,
`site_write_file`), the Changes tab shows a structured file tree with per-file
unified diffs, aggregate +/− counts, and accept/revert — backed by real
filesystem state, not just tool-call output strings.

## How Codex does it
- **Changed-files bar** (end of turn): `Changed 8 files +23 −16 | Review ›` —
  full-width rounded-xl elevated bar. "Review" opens the diff panel.
- **IDE-style expansion**: `2 files edited +123 −42 · Review ↗` then one row
  per file: `slider.tsx +83 −0` with chevron, hairline separators, each
  expandable to its unified diff.
- **Diff panel** (workbench right): file tree on top, selected diff below.
  GitHub palette, hunk-level collapse/expand, accept/revert per hunk or file.
- **No cards, no borders** on file rows — hairline separators only,
  opacity-based hierarchy, weight 400.

## Atlas's current state
- **`src/renderer/components/workbench/WorkbenchPanel.tsx`** — has `changes`
  tab but it's an "honest stub" reading `ChatToolPart[]` from messages. No file
  tree, no aggregate view, no accept/revert.
- **`src/renderer/components/transcript/ChangedFilesBar.tsx`** — implements the
  end-of-turn bar with inline expansion. Has `disambiguateNames()`,
  `parseUnifiedDiff()`, per-file `DiffBlock`. Comment at line 7 says the prop
  path to the workbench panel is missing.
- **`src/main/ai/tools/codeTools.ts`** — `writeFileToolExecute` and
  `editFileToolExecute` compute unified diffs via `buildUnifiedDiff()` (LCS-based,
  consumed by `parseUnifiedDiff` in `src/shared/toolCellGrammar.ts`).
- **`src/shared/toolCellGrammar.ts`** — has `DiffFile`, `ChangedFilesSummary`,
  `parseUnifiedDiff()`, `buildToolCells()`, `collectChangedFiles()`.
- **`src/renderer/components/transcript/DiffBlock.tsx`** — renders unified diff
  with GitHub palette tokens.
- **No git-backed file tree** — Changes tab doesn't read the filesystem.

## What to implement

### Backend (main process)
1. **File-change tracking service** (`src/main/workspace/FileChangeTracker.ts`):
   - Track every `write_file`/`edit_file`/`site_write_file` per conversation.
     Store: `{ conversationId, filePath, beforeContent, afterContent, diff,
     timestamp, toolCallId, accepted: boolean }`.
   - Intercept diff-producing tools on completion. Follow `ToolExecutionTracker`
     pattern.
   - SQLite via new `fileChangesRepo` (table `file_changes`: id,
     conversation_id, file_path, before_hash, after_hash, diff_text,
     status 'pending'|'accepted'|'reverted', created_at).
   - Revert: restore `beforeContent` to disk (only `accepted: false`, only
     `code` mode, valid root via `canWriteFiles()`).

2. **IPC** (`src/main/ipc/fileChanges.ts`):
   - `fileChanges.list(conversationId)` → `FileChange[]`
   - `fileChanges.revert(conversationId, changeId)` → restores beforeContent
   - `fileChanges.accept(conversationId, changeId)` → marks accepted
   - `fileChanges.summary(conversationId)` → `{ fileCount, added, removed, files }`

3. **Git integration for the file tree** (optional, recommended):
   - When a project is attached (code mode) and is a git repo, use
     `gitStatusToolExecute` logic to show git-tracked changes alongside
     tool-produced changes.
   - `fileChanges.gitStatus(conversationId)` → parsed `git status --porcelain`
     as `GitFileStatus[]` (`{ path, status 'M'|'A'|'D'|'??', staged }`).

### Frontend (renderer)
4. **WorkbenchPanel Changes tab rewrite**: Replace tool-call-reader with
   file-change browser. File tree grouped by directory, each row = path +
   `+A −D` + chevron. Hairline separators, borderless, weight 400. Selected
   file's diff in `DiffBlock` below tree. "Review" on `ChangedFilesBar`
   switches to workbench Changes tab.
5. **Store** (`useAppStore.ts`): `fileChangesByConversation`,
   `loadFileChanges()`, `revertFileChange()`, `acceptFileChange()`.

## Files to read first
- `src/renderer/components/workbench/WorkbenchPanel.tsx`
- `src/renderer/components/transcript/ChangedFilesBar.tsx`
- `src/main/ai/tools/codeTools.ts` (`buildUnifiedDiff`)
- `src/shared/toolCellGrammar.ts` (`DiffFile`, `parseUnifiedDiff`)
- `src/main/ai/tools/ToolExecutionTracker.ts` (tracking pattern)
- `src/main/db/repositories/toolExecutionsRepo.ts` (repo pattern)
- `src/renderer/components/transcript/DiffBlock.tsx`
- `src/main/ipc/sites.ts` (IPC pattern)

## Acceptance criteria
- [ ] Changes tab shows file tree of all agent-modified files, +/− counts
- [ ] Selecting a file shows its unified diff in `DiffBlock`
- [ ] "Review" on `ChangedFilesBar` switches to workbench Changes tab
- [ ] Revert restores beforeContent to disk, updates list
- [ ] Accept marks change accepted (dimmed/strikethrough)
- [ ] Git status changes appear in tree when a git project is attached
- [ ] `tsc` clean, all tests pass, build succeeds
- [ ] New tests for `FileChangeTracker` and `fileChangesRepo`

## Constraints
- Don't change `ChatToolPart` schema or IPC chat channels
- Follow existing repo pattern (`toolExecutionsRepo.ts`)
- Use existing `buildUnifiedDiff` — don't add a diff library
- Revert only in `code` mode with valid workspace root (`canWriteFiles()`)
- UI must use `codex` theme tokens (no hardcoded colors/sizes)
