# Execution Target Chip Picker — Design

**Date:** 2026-08-08
**Status:** Approved direction (Option A), pending spec review
**Branch context:** `feat/agents/openrouter-deepseek-chat`

## Problem

The sidebar "Atlas Work / Atlas Code" mode dropdown currently carries three unrelated concepts: app mode, agent access (permission ladder), and execution target (local / worktree / cloud). Execution target is per-conversation *environment context* — the same category as the project chip and branch chip it already renders beside in the `WorkspaceContextBar`. Nesting it under the app-mode heading is a category error and makes it unreachable except through a sidebar control.

Market check confirms this: every local-first agent puts execution environment selection at the composer, as context — Cursor (dropdown under the agent input next to the model picker), Codex cloud (repo/environment selectors in the task composer), t3code (mode control in the message composer). Cloud-first products (Copilot) remove the in-conversation choice entirely. No product groups it under an app-mode switcher.

## Decision (Option A)

The "Local / Worktree / Cloud" chip in `WorkspaceContextBar` becomes the **picker** for execution target. The mode dropdown keeps a synced mirror of the EXECUTION TARGET section for one release, then the section is removed.

Locked decisions (from design Q&A):

1. **Chip visibility:** the chip row is always visible per conversation — the `isUntouchedSession` gate (`App.tsx:1496`) is removed for the context bar. Note there is **no existing compact variant** in the component; the bar renders identically in both states (it already sits as a sibling below `ChatWindow`, so no layout reflow). If the always-on bar feels heavy over a long transcript, a follow-up visual pass can add a reduced treatment — flagged as a polish task, not part of this change.
2. **Worktree cleanup:** switching a conversation away from `worktree` detaches the row but keeps the worktree on disk. The picker menu exposes the explicit lifecycle actions "Reveal in Finder" and "Remove worktree…" (existing `worktree:remove` IPC, `conversations.ts:210-222`).
3. **Migration:** the mode dropdown keeps the EXECUTION TARGET radio group as a mirror (same props, zero state plumbing changes), with a subtle "(moved to context bar)" hint, for one release.

## Components

### 1. `ExecutionTargetChip` — extracted component in `WorkspaceContextBar.tsx`

The inline chip JSX at `WorkspaceContextBar.tsx:177-224` extracts into a named component. Behavior change:

- **Today:** click reveals folder / opens settings (indicator only).
- **New:** click opens a `DropdownMenu` anchored to the chip:
  - `DropdownMenuRadioGroup` with the existing `EXECUTION_TARGETS` catalog (`workspaceModes.ts:105-135`), reusing the disable rules already in `WorkspaceModeSwitch.tsx:164-203`:
    - `worktree` disabled when `!isGitRepo`, tagline "Requires a git repository attached"
    - `cloud` disabled when `!cloudSandboxEnabled`, tagline "Enable in Settings → Beta" (clicking the row still opens the Settings beta section — keeps the existing affordance)
  - Separator + action rows, rendered only when relevant:
    - "Reveal in Finder" — when target is `worktree` and `worktreeRoot` set, or `local` and project root set (preserves today's click behavior as an explicit menu item)
    - "Remove worktree…" — when the conversation has a `worktreeRoot`; calls `worktree:remove` IPC
- Chip label/icon stay as today: `Laptop`/"Local", `GitFork`/"Worktree", `Cloud`/"Cloud" (brand-colored for non-local targets). When on worktree, the label appends the short branch name (`atlas/<id-8>`), derived from `worktreeRoot` + conversation id, e.g. "Worktree · atlas/3f9ab2c1".
- `aria-label` updated from "— click to reveal folder" to reflect its picker role, e.g. "Execution target: Worktree — change or manage".

### 2. `WorkspaceContextBar` — persistent

- Remove the `isUntouchedSession` conditional in `App.tsx:1496`; render the bar whenever a conversation is selected.
- The bar already receives `conversationId`, `mode`, `executionTarget`, `project`, `workspace instructions`, etc. — no new props required at the App level except the two new callbacks below.
- New props: `onExecutionTargetChange(target: ExecutionTarget)` and `onRemoveWorktree()` — wired in `App.tsx` to the existing `handleExecutionTargetChange` (setConversationWorkspace) and to a new `worktree:remove` preload binding call followed by a conversation refresh.

### 3. Mode dropdown mirror (temporary)

- `WorkspaceModeSwitch.tsx` `AccessMenuContent`: keep the EXECUTION TARGET section exactly as-is, but rename the label to "Execution target · also in the context bar" (uppercase styling unchanged). No structural changes.
- Follow-up task (next release, separate PR): delete lines 164-203 section entirely.

### 4. Preload / IPC

- `worktree:remove` and `worktree:list` channels exist (`ipc.ts:49-50`) and the main handler exists (`conversations.ts:210-222`), but `rg` finds **no preload binding** for them. Add `worktree.remove(conversationId, force?)` to `src/preload/index.ts` under the existing `atlasChat` namespace (matching how `conversations.setWorkspace` is exposed), and extend the `AtlasChatApi` typing accordingly.

## Data flow

```
User clicks chip
  → DropdownMenu (ExecutionTargetChip)
  → onExecutionTargetChange(target)
  → App.handleExecutionTargetChange (App.tsx:471)
  → setConversationWorkspace IPC (conversations.ts:141-208)
      ├─ worktree: provisionWorktree(repoRoot, conversationId) → writes worktree_root col
      ├─ cloud: asserts beta flag + worker URL
      └─ mirrors to settingsRepo (new-conversation default)
  → conversation summary refresh → chip re-renders with new icon/label
```

Remove worktree:

```
Picker "Remove worktree…"
  → worktree.remove(conversationId) IPC
  → WorktreeService.removeWorktree → conversations row reset to local/inherit
  → refresh → chip shows Local
```

No new DB columns, no new repositories, no state-store changes. `worktreeRoot` already reaches the bar (`WorkspaceContextBar.tsx:110`, contract at `contracts.ts:508`).

## Error handling

- **Worktree provision failure** (non-git repo, worktree add fails): existing `withUserFacingErrors` path in `conversationsSetWorkspace` toasts; chip state does not change because the conversation row is untouched. Picker closes.
- **Cloud disabled:** row disabled with "Enable in Settings → Beta"; when the conversation has no project (`project?.exists` false), the whole chip row is already hidden today — unchanged.
- **Remove worktree while it's the active target:** main-process handler already resets the conversation to `local` first (`conversations.ts:219`), so the chip never renders a dangling worktree state.
- **Remove worktree with uncommitted changes:** pass no `force`; main process refuses (existing refusal semantics); toast surfaces the error text. Confirm dialog in the menu flow (native `confirm` is avoided in this codebase — reuse the existing modal/alert pattern used by "Detach project").

## Testing

- **`tests/workspaceContextBar.test.tsx`** (new render test, matching existing component test patterns):
  - chip renders correct icon/label per target, including "Worktree · atlas/xxxxxxxx" when `worktreeRoot` set
  - menu disables worktree when `!isGitRepo`, cloud when beta off
  - selecting a target fires `onExecutionTargetChange` with the right value
  - "Remove worktree…" appears only with a `worktreeRoot` and calls the handler
- **`tests/conversationsWorkspace.test.ts`** (existing harness, extend): `conversationsSetWorkspace` still provisions/resets as before (no logic change — guard against regression).
- Manual smoke matrix: empty session → switch all three targets; mid-conversation → switch local↔worktree, verify transcript context bar updates; remove worktree from both active and detached states.

## Out of scope

- Auto-removal / pruning of stale worktrees (rejected in Q&A; may revisit later).
- Moving agent-access permissions out of the mode dropdown (separate question; untouched).
- Mirroring project files into the cloud isolate (known backend gap, unrelated).
- Final removal of the dropdown mirror section (follow-up PR, one release later).

## Competitive references

- Cursor background agents — env dropdown under composer: https://cursor.com/docs/background-agent
- Codex CLI — fused `/approvals` picker: https://github.com/openai/codex
- t3code — composer mode control, worktrees as user-managed practice: https://github.com/pingdotgg/t3code (`docs/user/permission-modes.md`, `docs/user/source-control.md`)
- GitHub Copilot coding agent — no env picker, implied by surface: https://docs.github.com/en/copilot/concepts/coding-agent/coding-agent
