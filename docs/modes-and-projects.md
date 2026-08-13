# Modes and projects

Atlas has two workspace modes, **Work** and **Code**, one per conversation. Chat is not a
mode: it is what both modes do.

Sections 1-3 are the research that produced that design — what Atlas had before, and how
[T3 Code](https://github.com/pingdotgg/t3code) and [OpenAI Codex](https://github.com/openai/codex)
model the same problem. Section 4 is what shipped and where it lives.

## 1. What Atlas had before this change

### The Chat / Work pill is not a mode

`src/renderer/App.tsx:993-1030` renders a two-tab segmented control labelled Chat and
Work. Both tabs write the same boolean:

```
const [workbenchOpen, setWorkbenchOpen] = usePersistentFlag('atlas.workbench.open', false)
```

Nothing else in the app reads it. Same model, same tool set, same system prompt, same
permissions in both positions. The pill is a right-panel visibility toggle wearing the
costume of a mode. Two consequences:

- The state is a single global `localStorage` flag, so switching conversations carries
  the other thread's layout. A mode would be per-conversation.
- Naming it "Work" promises capability the tab does not grant.

### The behaviour axes that do exist

| Axis | Type | Scope | Where |
| --- | --- | --- | --- |
| Tool permission | `read-only \| ask \| full-access` | global setting | `src/shared/chatParameters.ts:113`, `App.tsx:1116` |
| Tools on/off | `enableTools` boolean | per request | `ChatSessionRuntime.ts:360` |
| Reasoning effort | 8-value ladder | per conversation | `chatParameters.ts:10` |
| Model | provider + model id | per conversation | `conversations.default_model_id` |

Three of those four overlap on the question "what may the agent do", and none of them is
the pill.

### The tools

`src/main/ai/tools/builtInTools.ts` exposes `read_file`, `grep_search`, `glob_search`,
`web_search`, `web_fetch`, `bash`, `get_current_time`, `search_model_catalog`, plus the
site tools (`site_create/read/write/delete/build/preview/publish`, `siteTools.ts`).

There is **no file write or patch tool for the local filesystem**. `bash` can technically
write, but nothing is structured, so:

- `toolCellKind()` (`src/shared/toolCellGrammar.ts:122-151`) only classifies a call as
  `edit` when the tool name contains write/edit/patch — today only `site_write_file`.
- The workbench Changes tab is therefore empty for every non-site conversation, which
  `WorkbenchPanel.tsx:2-18` documents honestly ("Atlas has none of those").

### No project root

Every filesystem tool resolves against the Electron process cwd:

```
src/main/ai/tools/toolRuntime.ts:335   return process.cwd()
src/main/ai/tools/toolRuntime.ts:417   runCommand('rg', args, { cwd: process.cwd(), … })
src/main/ai/tools/toolRuntime.ts:777   const cwd = process.cwd()
```

There is no folder picker outside site export (`SiteExporter.ts:53`), no project record,
no path sandbox, and no git integration at all (no `git` spawn anywhere in `src/main`, no
git or pty dependency in `package.json`).

### What is already in place

The persistence spine is further along than the UI suggests — `src/main/db/schema.ts`
already has `conversation_events` (monotonic `sequence`), `conversation_activities`,
`conversation_turns`, `approval_requests`, `conversation_checkpoints`, and
`provider_sessions`. That is the same event/projection/checkpoint shape T3 Code uses. The
checkpoints are logical only (message/activity sequence plus a `file_change_summary` text
column) — no filesystem snapshot.

## 2. How T3 Code models it

T3 Code is an "agent harness control surface": it drives external CLI agents (Codex,
Claude Code, Cursor, Grok, OpenCode) over JSON-RPC and normalises their events into its
own domain model. Different from Atlas (which owns its harness in-process via the AI
SDK), but the domain model is the interesting part.

### Zero product modes. Two orthogonal axes plus project binding

```ts
// packages/contracts/src/orchestration.ts:118-128
RuntimeMode            = "approval-required" | "auto-accept-edits" | "auto" | "full-access"
DEFAULT_RUNTIME_MODE   = "full-access"
ProviderInteractionMode = "default" | "plan"
AssistantDeliveryMode  = "buffered" | "streaming"
```

- **Runtime mode** = access. It compiles down to provider settings —
  `CodexSessionRuntime.ts:264-298` maps it to `approvalPolicy` + `sandbox` +
  `approvalsReviewer` (`approval-required` → `untrusted`/`read-only`, `auto-accept-edits`
  → `on-request`/`workspace-write`, `auto` → same plus `auto_review`, `full-access` →
  `never`/`danger-full-access`). Claude's adapter maps the same enum to
  `acceptEdits` (`ClaudeAdapter.ts:3513`).
- **Interaction mode** = collaboration style. It compiles down to injected
  `developer_instructions` (`CodexSessionRuntime.ts:338-359`).
- Both live **on the thread** (`OrchestrationThread`, `orchestration.ts:352-388`) and both
  have dedicated commands (`thread.runtimeMode.set`, `thread.interactionMode.set`).

Crucially, the composer menu (`apps/web/src/components/chat/CompactComposerControlsMenu.tsx`)
labels them:

```
Mode:    ( ) Chat   ( ) Plan
Access:  ( ) Supervised  ( ) Auto-accept edits  ( ) Auto  ( ) Full access
```

So in the product that is furthest along on this exact problem, **"Chat" is the name of
the default interaction mode, not a separate app mode** — and there is no "Work" or
"Coding" mode at all. What we would call "coding" is not a mode; it is a consequence of
the thread being bound to a project.

### Project is the capability carrier

```ts
// orchestration.ts:213-224
OrchestrationProject = {
  id, title,
  workspaceRoot,             // the folder. required.
  repositoryIdentity,        // resolved git remote identity
  defaultModelSelection,
  scripts: ProjectScript[],
  createdAt, updatedAt, deletedAt,
}

// orchestration.ts:352-388 (thread)
projectId,                   // required — no thread exists outside a project
branch: string | null,
worktreePath: string | null, // when set, the thread runs here instead of the main tree
```

- `thread.create` requires `projectId` (`orchestration.ts:554-568`). There is no
  project-less chat surface. Nothing is gated behind a mode because everything is
  already inside a project.
- Project creation is `project.create { title, workspaceRoot, createWorkspaceRootIfMissing }`
  (`orchestration.ts:526-535`), driven from the command palette
  (`CommandPalette.tsx:1520`). Because the web client cannot use a native dialog, the
  server exposes a directory browser (`apps/server/src/workspace/WorkspaceEntries.ts`).
- Per-project scripts come from a checked-in `t3.json` at the workspace root
  (`T3ProjectFileLoader.ts`), decoded best-effort — missing or invalid resolves to none.
  Each script has `{ name, command, icon, runOnWorktreeCreate, previewUrl, autoOpenPreview }`.
  The repo's own `t3.json` uses it to symlink `.env` into fresh worktrees.
- `ThreadEnvMode = "local" | "worktree"` (`settings.ts:141`) decides whether a new thread
  gets its own git worktree.

### Checkpoints are real filesystem snapshots

`apps/server/src/checkpointing/CheckpointStore.ts` captures a commit into a **hidden git
ref** using an isolated temporary index, so per-turn diff and revert work without touching
the user's index or branch. `CheckpointReactor` captures on turn start/complete and
publishes typed receipts (`checkpoint.baseline.captured`, `checkpoint.diff.finalized`,
`turn.processing.quiesced`) that tests wait on instead of polling git.

### Plan mode is a first-class artifact, not a vibe

`CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS` (`apps/server/src/provider/CodexDeveloperInstructions.ts:14-135`)
is worth reading in full. The load-bearing parts:

- Mode is sticky and only a developer message can end it: "If a user asks for execution
  while still in Plan Mode, treat it as a request to **plan the execution**".
- Explicit allowed/forbidden list — reads, searches, dry runs, builds that touch only
  caches are fine; edits, formatters, patches, migrations are not. "If the action would
  reasonably be described as 'doing the work' rather than 'planning the work', do not do it."
- Three phases: ground in the environment → intent chat → implementation chat. Explore
  before asking; ask only what exploration cannot answer.
- Questions go through a `request_user_input` tool with multiple choice, and that tool is
  **only available in plan mode** — the default-mode block says calling it errors
  (`:143-147`).
- The final plan is wrapped in a `<proposed_plan>` block so the client can render it
  specially. Parsed into `OrchestrationProposedPlan { planMarkdown, implementedAt,
  implementationThreadId }` (`orchestration.ts:244-255`) and surfaced as a plan card plus
  `PlanSidebar.tsx`. Empty composer + Implement sends
  `"PLEASE IMPLEMENT THIS PLAN:\n…"` in `default` mode; typing text instead keeps you in
  plan mode (`apps/web/src/proposedPlan.ts:72-93`).
- The default-mode block explicitly *cancels* the plan block: "Any previous instructions
  for other modes (e.g. Plan mode) are no longer active." Modes are also defended at the
  sandbox layer, not just in the prompt.

Two more details worth copying verbatim:

- Runtime mode is always sent explicitly on resume, never omitted, because "omitting the
  field on resume keeps the thread's previous reviewer, which would leave auto_review
  sticky after switching modes" (`CodexSessionRuntime.ts:267-269`).
- New-thread inheritance is a stated rule (`useHandleNewThread.ts:69-73`): a new thread
  carries the user's *working mode* — model (incl. reasoning effort), access mode,
  interaction mode — while branch, worktree, and env mode never carry implicitly.

## 3. How OpenAI Codex models it

Codex is the other reference, and it agrees with T3 Code on the shape while going further
on the sandbox. Three findings drove the implementation below.

**A mode is a preset over settings, not a permission level.**

```rust
// codex-rs/protocol/src/config_types.rs:630-650
pub enum ModeKind { Plan, #[default] #[serde(alias = "code", alias = "pair_programming", …)] Default, … }
pub const TUI_VISIBLE_COLLABORATION_MODES: [ModeKind; 2] = [ModeKind::Default, ModeKind::Plan];

// :757-763
pub struct CollaborationModeMask {
    pub name: String,
    pub mode: Option<ModeKind>,
    pub model: Option<String>,
    pub reasoning_effort: Option<Option<ReasoningEffort>>,
    pub developer_instructions: Option<Option<String>>,
}
```

A mode is a *mask* applied over `{model, reasoning_effort, developer_instructions}`, and
the TUI simply cycles the visible presets (`tui/src/collaboration_modes.rs:36-50`). Note
the serde alias: `"code"` deserialises to `Default`. Codex once had a mode by that name.

**Reads are unrestricted; writes are the axis that gets a boundary.**

```rust
// codex-rs/protocol/src/protocol.rs:997-1044
pub enum SandboxPolicy {
    DangerFullAccess,
    ReadOnly { network_access: bool },
    ExternalSandbox { network_access: NetworkAccess },
    WorkspaceWrite { writable_roots, network_access, exclude_tmpdir_env_var, exclude_slash_tmp },
}

// :1147-1155
pub fn has_full_disk_read_access(&self) -> bool { true }
```

`WorkspaceWrite` resolves to cwd + `/tmp` + `TMPDIR` (`:1187-1235`), and approval policy
(`AskForApproval::{UnlessTrusted, OnRequest, Granular, Never}`, `:910-933`) is a separate
enum from the sandbox. Two dials, not one.

**Inside a writable root, some paths still are not.**

```rust
// codex-rs/protocol/src/permissions.rs:1592-1629
fn default_read_only_subpaths_for_writable_root(...) -> Vec<AbsolutePathBuf> {
    // .git (directory, or the gitdir a worktree's .git file points at)
    // the agents metadata directory
    // .codex — protected even before it exists, so first creation goes through approval
}
```

This is the escalation guard: a writable `.git/hooks` turns one file edit into arbitrary
code execution on the user's next commit.

## 4. What Atlas ships: Work and Code

Two modes, named Work and Code, one per conversation. Chat is not a mode — it is what
both modes do. Plan mode is deliberately out of scope.

| | Work | Code |
| --- | --- | --- |
| Project folder | optional | required |
| Shell working directory | project root, else `$HOME` | project root |
| File reads | anywhere on disk | anywhere on disk |
| File writes | none | inside the project only, `.git`/`.atlas`/`.hg`/`.svn` refused |
| Shell policy | read-only command blocklist | unrestricted, gated by the permission ladder |
| Extra tools | sites, visuals | `write_file`, `edit_file`, `git_status`, `git_diff` |
| Workbench tabs | Tasks | Changes, Terminal, Tasks |

The permission ladder (`read-only` / `ask` / `full-access`) is unchanged and stays
**orthogonal**: the mode decides which tools exist, the ladder decides which of them pause
or are withheld. `read-only` in Code mode still means no writes and no shell.

### Where it lives

**Contracts** — `src/shared/workspaceModes.ts` holds `WorkspaceMode`, the preset table,
`isWorkspaceModeReady`, and `PROTECTED_PROJECT_PATH_NAMES`. `src/shared/contracts.ts` adds
`WorkspaceProject`, `ConversationWorkspace`, and the projects API surface.

**Storage** — a `projects` table (`id, title, root UNIQUE, …`) plus
`conversations.workspace_mode` and `conversations.project_id`
(`src/main/db/schema.ts`). Existing conversations migrate to `work` with no project, so
nothing gains capability by upgrading. `exists` and `isGitRepository` are computed per
read (`projectsRepo.ts`) — a folder can be deleted while Atlas is closed, and a stale flag
would hand the model a root that is not there.

**The boundary** — `src/main/ai/tools/toolWorkspace.ts`. `resolveWritablePath` refuses in
three steps (wrong mode → no project → outside the root), then applies Codex's protected
metadata rule. `resolveWorkspaceCwd` falls back to `$HOME` rather than `process.cwd()`,
which in a packaged app is a path no user chose. Every `process.cwd()` in `toolRuntime.ts`
is gone.

The workspace is resolved in the main process from the conversation row
(`src/main/workspace/conversationWorkspace.ts`) and passed to the runtime as a resolver,
never accepted from the renderer — a writable root the client can name is not a boundary.

**Tools** — `src/main/ai/tools/codeTools.ts` implements `write_file`, `edit_file`,
`git_status`, and `git_diff`. The editing tools return a **unified diff string**, not a
JSON envelope, because that string is what `parseUnifiedDiff`
(`src/shared/toolCellGrammar.ts:284`) renders in the transcript and in the workbench
Changes tab. `edit_file` refuses an ambiguous match unless `replace_all` is set. Diff
output gets a larger preview budget than other tools (`ToolResultNormalizer.ts`) so hunks
are not silently truncated out of the UI.

**Prompt** — `describeWorkspaceModeForPrompt` (`builtInTools.ts`) states the mode, the
root, and what is refused. The Work-mode block explicitly cancels Code-mode instructions,
copying Codex's default-mode block: history from an earlier Code turn stays in the
transcript, and without the cancellation the model reads its own past behaviour as licence.

**UI** — `src/renderer/components/workspace/WorkspaceModeSwitch.tsx`:

- `WorkspaceModeSwitch` — the Work/Code segmented control in the title bar, with a warning
  glyph when Code has no folder.
- `ProjectChip` — the attached folder, its path in the tooltip, and the menu to switch,
  reveal, or detach it.
- `WorkspaceGate` — a strip above the composer when Code has no usable folder. A gate, not
  a silent downgrade to Work.
- `WorkbenchToggle` — panel visibility, finally its own control instead of a fake mode.

Selecting Code opens the workbench once as a convenience; the toggle still wins afterwards.
`Mod+Shift+E` toggles the mode, and both actions are in the command palette.

**Carry rule** — a new conversation inherits mode and project from the user's last choice
(`registerConversationsIpc`, `conversationsRepo.create`), matching T3 Code's rule that the
working mode follows you while branch and worktree never do. A remembered project that has
since been deleted is dropped rather than resurrected.

### Deliberately not built

- **Plan mode.** Out of scope by decision, not by oversight. The prompt-cancellation
  pattern above is the piece worth reusing if it is ever added.
- **Git worktrees per conversation**, `atlas.json` project scripts, and a real PTY for the
  Terminal tab (needs a `node-pty` dependency Atlas does not have).
- **Filesystem checkpoints.** `conversation_checkpoints` is still logical only. Codex-style
  hidden-ref checkpoints would make per-turn revert real, and are the natural next step now
  that a project root exists.
- **Network as a separate axis.** Codex splits `network_access` from filesystem access;
  Atlas still ties web tools to the permission ladder.
