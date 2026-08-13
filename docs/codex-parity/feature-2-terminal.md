# Feature 2: Integrated Terminal Panel

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. The `codex` design theme is the default.
> Gates: `npx tsc --noEmit` clean, `node --import tsx --test tests/*.test.ts` (371 tests),
> `pnpm build`. Branch: `codex-ui-redesign`.

## Goal
Add a real PTY-backed persistent terminal to the WorkbenchPanel "Terminal" tab.
Currently it's an "honest stub" showing `command_execution` tool calls as a
session log. This adds an interactive shell the user can type into, with
streaming output, command history, and working-directory persistence tied to
the conversation's project.

## How Codex does it
- **Terminal panel** in the workbench (right-hand). Standard terminal emulator:
  dark background, mono font, ANSI color support.
- **Agent commands appear inline** — when the agent runs `bash`, the command and
  output stream into the terminal panel as well as the transcript.
- **User can type** — the terminal is interactive, not read-only.
- **Working directory** follows the conversation's project root.
- **ANSI rendering** with full SGR color support.

## Atlas's current state
- **`WorkbenchPanel.tsx`** — `terminal` tab renders tool-call output as a log,
  not a real terminal.
- **`TerminalBlock.tsx`** — renders ANSI output from `bash` tool calls using
  `stripAnsi()` and basic formatting. Not interactive.
- **`ansi-to-react`** is a dependency (`package.json`) but imported nowhere in
  `src/renderer` — ANSI sequences from `bash` render as literal garbage.
- **`src/main/ai/tools/toolRuntime.ts`** — `bashToolExecute` runs commands via
  `runCommand()` (child_process.exec), captures stdout/stderr, returns combined
  output. No PTY, no streaming, no interactivity.
- **`ToolApprovalController`** — gates shell commands in `ask` mode.
- **No `node-pty` dependency** — needs to be added.
- **`resolveWorkspaceCwd()`** — resolves cwd from conversation's project root.

## What to implement

### Backend (main process)
1. **PTY service** (`src/main/terminal/PtyService.ts`):
   - Spawn a PTY per conversation using `node-pty` (add to `dependencies` and
     `pnpm.onlyBuiltDependencies` in `package.json`).
   - Each conversation gets one persistent shell. cwd =
     `resolveWorkspaceCwd(workspace)` — tied to project root.
   - Stream stdout/stderr to renderer via IPC events.
   - Accept input from renderer (key-by-key or line-by-line).
   - Track command history per conversation (persist to SQLite
     `terminal_history` table: id, conversation_id, command, exit_code,
     started_at, finished_at).
   - Lifecycle: spawn on first use, kill on conversation close/app quit.
   - Resize: forward `cols`/`rows` to PTY on window resize.

2. **IPC channels** (`src/main/ipc/terminal.ts`):
   - `terminal.start(conversationId)` → `{ ptyId }` — spawns or returns existing
   - `terminal.input(conversationId, data)` → writes to PTY stdin
   - `terminal.resize(conversationId, cols, rows)` → resizes PTY
   - `terminal.kill(conversationId)` → kills PTY
   - **Events** (main→renderer): `terminal.output(conversationId, data, kind)`
     where kind is `'stdout'|'stderr'|'exit'`, data is raw string (ANSI included)
   - `terminal.history(conversationId)` → `TerminalHistoryEntry[]`

3. **Agent command bridge**: when the agent's `bash` tool runs a command, also
   write the command + output into the terminal panel (so the user sees what
   the agent is doing in the terminal, not just the transcript). Write-only
   bridge — the agent's command runs in its own `runCommand()` call (with
   approval), output forwarded to the terminal as read-only dim lines.

### Frontend (renderer)
4. **Terminal component** (`src/renderer/components/workbench/TerminalPanel.tsx`):
   - Render using `xterm` (add `@xterm/xterm` + `@xterm/addon-fit`) OR a simpler
     custom renderer using `ansi-to-react` for output + textarea input row.
   - Subscribe to `terminal.output` events, write to terminal.
   - Input: when focused, keystrokes → `terminal.input`.
   - Command history: Up/Down arrows cycle.
   - Agent's commands appear as dim, prefixed lines (`› npm test`).

5. **WorkbenchPanel integration**: replace Terminal tab stub with
   `<TerminalPanel conversationId={...} />`.

6. **Store** (`useAppStore.ts`): `terminalOutputByConversation`,
   `terminalHistory`, `sendTerminalInput()`, `resizeTerminal()`.

## Files to read first
- `src/renderer/components/workbench/WorkbenchPanel.tsx`
- `src/renderer/components/transcript/TerminalBlock.tsx`
- `src/main/ai/tools/toolRuntime.ts` (`runCommand`, `bashToolExecute`)
- `src/main/ai/tools/toolWorkspace.ts` (`resolveWorkspaceCwd`)
- `src/main/ipc/sites.ts` (IPC pattern with events)
- `src/main/index.ts` (IPC registration, `onlyBuiltDependencies`)
- `package.json` (`onlyBuiltDependencies` lists `better-sqlite3`, `electron`)

## Acceptance criteria
- [ ] Terminal tab shows a real interactive shell tied to the project
- [ ] User can type commands and see streaming output with ANSI colors
- [ ] Command history persists across restarts (Up/Down to navigate)
- [ ] Agent's `bash` commands appear in terminal as dim prefixed lines
- [ ] Terminal resizes when workbench panel is resized
- [ ] Terminal killed on conversation close or app quit
- [ ] `tsc` clean, all tests pass, build succeeds
- [ ] `node-pty` rebuilds correctly (`pnpm rebuild`)

## Constraints
- `node-pty` is a native module — add to `pnpm.onlyBuiltDependencies`, test
  `electron-rebuild`
- Follow existing IPC event pattern (see `sites.ts`)
- Terminal respects `ToolApprovalController` — user-typed commands in `ask` mode
  run directly (user approved by typing)
- Don't break the `bash` tool's existing approval flow
- Terminal output is NOT persisted as message content (ephemeral) — only
  command history is persisted
