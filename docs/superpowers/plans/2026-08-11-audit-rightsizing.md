# Audit-rightsizing Implementation Plan (2026-08-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the `feature-status` audit against the current working tree, commit the fixes that already exist there, and land the three genuinely-open items it never covered (worktree branch collision, orphaned `worktree:list` channel, subagent depth not plumbed into real turns).

**Architecture:** The audit was written against an older baseline: C1 (secret → keytar), C4 (depth cap + signal-aware slot queue), C5 (defensive spawn cleanup), and the chat-abort await are *already in the working tree, uncommitted*. This plan first commits those as one gate-checking task, then fixes C2 (8-char branch prefix → full UUID), wires `worktree:list` end-to-end, and plumbs `depth` through `SubagentContext`/`childExecutor` so the depth cap actually fires on real traffic. C3 is fabricated (columns are projected) — explicitly excluded.

**Tech Stack:** Electron main+preload+renderer, better-sqlite3, keytar, `node --import tsx --test` (NOT vitest), TypeScript.

## Global Constraints

- Tests run via `node --import tsx --test <file>` from repo root. Never vitest — it reports false failures.
- The Mimosa pre-commit hook may block every `git commit` over the pre-existing `sk-live-*` test fixtures. Each task's commit step tries `git commit`; **if it fails with a Mimosa/secret-scan block, do NOT retry with `--no-verify` or `MIMOSA_NO_GIT_GATE=1` — leave the change staged, record `COMMIT_BLOCKED: <task name>` in your report, and move on. The human lands blocked commits manually.**
- Do not re-implement anything already in the working tree. `git diff HEAD -- <path>` is the source of truth for what is committed vs. merely present.
- All file paths are repo-root-relative to `/Users/ollayor/Code/Projects/Atlas`.

---

### Task 1: Commit gate for in-tree audit fixes

**Files:**
- None created or modified — this task only commits what already exists in the working tree.

**Interfaces:**
- Consumes: existing uncommitted changes in `src/main/ai/agents/SubagentRuntime.ts`, `src/main/ai/agents/subagentTasks.ts`, `src/main/ipc/chat.ts`, `src/main/db/repositories/settingsRepo.ts`, `src/main/ai/core/ModelRegistry.ts`, `src/main/secrets/cloudSandboxSecretStore.ts`, plus their renderer/IPC callers.
- Produces: a HEAD where C1/C4-mechanism/C5/abort are committed, so later tasks' `git diff` runs are unambiguous.

- [ ] **Step 1: Run the full test suite to confirm the in-tree state is green**

Run: `node --import tsx --test tests/*.test.ts` from repo root.
Expected: PASS (49+ tests; exact count varies with the working tree — the important thing is 0 failures).

- [ ] **Step 2: Verify the four fixes are actually present but uncommitted**

Run: `git diff HEAD --stat -- src/main/ai/agents/SubagentRuntime.ts src/main/ai/agents/subagentTasks.ts src/main/ipc/chat.ts src/main/db/repositories/settingsRepo.ts src/main/ai/core/ModelRegistry.ts`
Expected: non-zero diff lines for each. Cross-check the specific markers:
- `src/main/ipc/chat.ts` contains `await chatEngine.abort(requestId)` (abort fix).
- `src/main/ai/agents/subagentTasks.ts` contains `acquire(conversationId?: string, signal?: AbortSignal)` (C4).
- `src/main/db/repositories/settingsRepo.ts` imports `CloudSandboxSecretStore` (C1).
- `src/main/ai/agents/SubagentRuntime.ts` contains both `maxDepth` enforcement and `try { this.emitEvent(state, 'task.completed'); } catch {}` (C5).

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/agents/SubagentRuntime.ts src/main/ai/agents/subagentTasks.ts src/main/ipc/chat.ts src/main/db/repositories/settingsRepo.ts src/main/ai/core/ModelRegistry.ts src/main/secrets/cloudSandboxSecretStore.ts src/main/ipc/settings.ts src/main/ipc/conversations.ts src/main/index.ts src/preload/index.ts src/shared/contracts.ts src/shared/ipc.ts src/renderer/App.tsx src/renderer/components/SettingsWorkspace.tsx src/renderer/components/workspace/WorkspaceContextBar.tsx src/main/ai/tools/sandbox/ workers/cloud-sandbox/
git commit -m "fix: audit issues C1/C4/C5/abort — keytar secret, depth cap, signal-aware slot queue, awaited abort"
```

Expected: commit succeeds. If it fails with a Mimosa secret-scan block over `sk-live-*` in `tests/`, leave everything staged and report `COMMIT_BLOCKED: Task 1` — the human will run `git commit --no-verify` with the same message.

---

### Task 2: C1 — startup sweep for the legacy plaintext secret row + cold-cache test

**Files:**
- Modify: `src/main/index.ts` (insert one block immediately after the existing `primeCloudSandboxSecret()` call at line ~202)
- Modify: `src/main/db/repositories/settingsRepo.ts:340-348` (expose the sweep on the repo so index.ts stays thin)
- Test: `tests/settingsRepo.test.ts` (create if absent — see Step 1 note)

**Interfaces:**
- Consumes: `CloudSandboxSecretStore` (`src/main/secrets/cloudSandboxSecretStore.ts`), `database.settings` (`SettingsRepo`).
- Produces: `SettingsRepo.purgeLegacyCloudSandboxWorkerSecret(): void` — sync better-sqlite3 call. Later tasks and any future migration rely on this name.

**Context:** `setCloudSandboxWorkerSecret()` already deletes the legacy `chat.cloudSandboxWorkerSecret` row from `app_settings` on write, but a user upgrading from the vulnerable version who *never re-saves* keeps the plaintext row forever. The sweep runs once at startup.

- [ ] **Step 1: Write the failing test**

Check whether `tests/settingsRepo.test.ts` exists: `ls tests/settingsRepo.test.ts`. If it does, append; if not, create it with the repo's standard options (`node --import tsx --test`, `node:test`, temp DB via the same helper other repo tests use — copy the setup block from `tests/conversationsRepo.test.ts` if one exists, otherwise instantiate `SettingsRepo` against an in-memory better-sqlite3 database).

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

test('purgeLegacyCloudSandboxWorkerSecret removes the plaintext row and is idempotent', () => {
  // Arrange: seed the legacy row exactly the way the pre-keytar version did.
  db.prepare('INSERT INTO app_settings (key, value) VALUES (@key, @value)')
    .run({ key: 'chat.cloudSandboxWorkerSecret', value: 'whitespace-padded-secret' });

  const repo = new SettingsRepo(db); // match the actual constructor signature
  repo.purgeLegacyCloudSandboxWorkerSecret();

  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'chat.cloudSandboxWorkerSecret'").get();
  assert.equal(row, undefined);

  // Second call is a no-op, not an error.
  assert.doesNotThrow(() => repo.purgeLegacyCloudSandboxWorkerSecret());
});

test('cloudSandboxSecretCache is null until primeCloudSandboxSecret runs (cold-cache contract)', async () => {
  const repo = new SettingsRepo(db);
  assert.equal(repo.getCloudSandboxWorkerSecret(), null);
  assert.equal(repo.hasCloudSandboxWorkerSecret(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/settingsRepo.test.ts`
Expected: FAIL — `purgeLegacyCloudSandboxWorkerSecret is not a function`.

- [ ] **Step 3: Implement the repo method**

Add to `SettingsRepo` in `src/main/db/repositories/settingsRepo.ts`, next to `primeCloudSandboxSecret()` (current line ~346):

```typescript
  /**
   * One-shot migration for installs that saved the bearer token to
   * `app_settings` before the keytar store existed. Runs at startup; later
   * `setCloudSandboxWorkerSecret()` calls also clear it, but a user who never
   * re-saves would otherwise keep the plaintext copy forever.
   */
  purgeLegacyCloudSandboxWorkerSecret(): void {
    this.db
      .prepare('DELETE FROM app_settings WHERE key = @key')
      .run({ key: 'chat.cloudSandboxWorkerSecret' });
  }
```

- [ ] **Step 4: Wire into startup**

In `src/main/index.ts`, directly after the existing `await database.settings.primeCloudSandboxSecret().catch(...)` block (current line ~202):

```typescript
  // One-shot migration: drop any plaintext bearer token left by versions that
  // predated the keytar store. Idempotent; safe to run on every launch.
  database.settings.purgeLegacyCloudSandboxWorkerSecret();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/settingsRepo.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/db/repositories/settingsRepo.ts src/main/index.ts tests/settingsRepo.test.ts
git commit -m "fix(C1): purge legacy plaintext sandbox secret at startup; test cold-cache contract"
```

On Mimosa block: leave staged, report `COMMIT_BLOCKED: Task 2`.

---

### Task 3: C2 — full-UUID worktree branch names

**Files:**
- Modify: `src/main/workspace/WorktreeService.ts:109`
- Modify: `tests/worktreeService.test.ts:24-41` (extend the existing test; the display label moves to the view-model test in Task 4)
- Test: `tests/worktreeService.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorktreeService.provisionWorktree(repoRoot, conversationId)` now creates branch `atlas/<full-conversation-id>` (e.g. `atlas/3f9ab2c1-1234-5678-90ab-cdef01234567`). Callers (chip renderer, `conversations.ts`) treat the branch as opaque. Display shortening is Task 4's job.

**Context:** `git checkout -b atlas/3f9ab2c1-1234-5678-90ab-cdef01234567` is verified legal (smoke-tested under git 2.x). The renderer shortens for display only, so the stored ref stays collision-proof.

- [ ] **Step 1: Update the failing test to assert the full-UUID branch**

Replace the body of the existing test at `tests/worktreeService.test.ts:26` (`provisionWorktree checks out a branch named exactly like the chip label`) — rename it, since the label is no longer the contract:

```typescript
test('provisionWorktree creates a branch with the full conversation id (collision-proof)', async () => {
  const { root, cleanup } = makeGitRepo();
  try {
    const service = new WorktreeService();
    const wt = await service.provisionWorktree(root, CONVERSATION_ID);

    // The full UUID is the git ref; the renderer shortens it for display only.
    assert.equal(wt.branch, `atlas/${CONVERSATION_ID}`);
    assert.ok(resolve(wt.path).startsWith(resolve(root)));

    const listed = await service.listWorktrees(root);
    assert.ok(listed.some((entry) => resolve(entry.path) === resolve(wt.path)));
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/worktreeService.test.ts`
Expected: FAIL — `AssertionError: 'atlas/3f9ab2c1' === 'atlas/3f9ab2c1-1234-5678-90ab-cdef01234567'`.

- [ ] **Step 3: Change one line**

In `src/main/workspace/WorktreeService.ts:109`:

```typescript
// Before
const branchName = `atlas/${conversationId.slice(0, 8)}`;
// After — full UUID: 8-hex prefixes collide under birthday-paradox and silently
// attach two conversations to one branch.
const branchName = `atlas/${conversationId}`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/worktreeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression-check the rest of the suite**

Run: `node --import tsx --test tests/worktreeService.test.ts tests/executionTargetViewModel.test.ts`
Expected: PASS. If `executionTargetViewModel.test.ts` fails because it asserts on the old short label, update Task 4's change first — that file is the one place the shortening is still correct.

- [ ] **Step 6: Commit**

```bash
git add src/main/workspace/WorktreeService.ts tests/worktreeService.test.ts tests/executionTargetViewModel.test.ts
git commit -m "fix(C2): use full conversation UUID for worktree branch names; shorten for display only"
```

(On Mimosa block: leave staged, report `COMMIT_BLOCKED: Task 3`.)

---

### Task 4: Move the short branch label out of the branch contract

**Files:**
- Modify: `src/renderer/components/workspace/executionTargetViewModel.ts:46-55`
- Test: `tests/executionTargetViewModel.test.ts`

**Interfaces:**
- Consumes: the full-UUID branch name Task 3 now stores.
- Produces: `worktreeBranchShort(conversationId)` still returns `atlas/<first8>` for the chip, unchanged — but its doc comment no longer claims the git branch is also short. No signature change; the renderer (`WorkspaceContextBar.tsx:210`) keeps calling it with the raw `conversationId`.

**Context:** This is a documentation/test-clarity task, not a behavior change. It exists so a future reader doesn't "fix" the view-model to match the (now-full) git ref and reintroduce the collision.

- [ ] **Step 1: Characterization-test the existing display behavior**

In `tests/executionTargetViewModel.test.ts`, add (the helper already behaves this way — this is a characterization test that will PASS on first run, and that's fine; it locks the display contract so Task 3's storage change can't silently drift it):

```typescript
test('worktreeBranchShort returns atlas/<first8> for display regardless of stored ref length', () => {
  // The stored git ref is the full UUID; this helper is purely cosmetic.
  assert.equal(
    worktreeBranchShort('3f9ab2c1-1234-5678-90ab-cdef01234567'),
    'atlas/3f9ab2c1',
  );
  assert.equal(worktreeBranchShort(undefined), null);
  assert.equal(worktreeBranchShort('short'), null);
});
```

- [ ] **Step 2: Run test — expect it to PASS (characterization, not red-green)**

Run: `node --import tsx --test tests/executionTargetViewModel.test.ts`
Expected: PASS. This test exists so that if a future change "helpfully" re-lengthens the display string to match the full git ref, it fails here and forces an explicit decision.

- [ ] **Step 3: Correct the misleading comment**

In `src/renderer/components/workspace/executionTargetViewModel.ts:46-55`, replace the JSDoc block and inline comment:

```typescript
/**
 * Chip label for a worktree branch: `atlas/<first 8 of conversation id>`.
 *
 * Purely cosmetic. The stored git ref uses the FULL conversation id
 * (`atlas/<uuid>`, see `WorktreeService.provisionWorktree`) — never shorten
 * the real branch name to match this display string, because 8-hex prefixes
 * collide under the birthday paradox.
 */
export function worktreeBranchShort(conversationId: string | undefined): string | null {
  if (!conversationId || conversationId.length < 8) return null;
  return `atlas/${conversationId.slice(0, 8)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/executionTargetViewModel.test.ts tests/worktreeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/workspace/executionTargetViewModel.ts tests/executionTargetViewModel.test.ts
git commit -m "docs(C2): make worktreeBranchShort explicitly display-only; full UUID stays the git ref"
```

(On Mimosa block: leave staged, report `COMMIT_BLOCKED: Task 4`.)

---

### Task 5: Implement `worktree:list` end-to-end

**Files:**
- Modify: `src/shared/ipc.ts:55` (channel already declared — keep `'worktree:list'`)
- Modify: `src/shared/contracts.ts` (add `WorktreeInfoSummary` type and `listWorktrees` to `RendererApi.conversations`, after `removeWorktree` at line ~2015)
- Modify: `src/preload/index.ts` (add bridge next to `removeWorktree` at line ~64)
- Modify: `src/main/ipc/conversations.ts` (add handler next to `worktreeRemove` at line ~233)
- Test: `tests/worktreeListIpc.test.ts` (new; exercises the handler with a stubbed database + service)

**Interfaces:**
- Consumes: `worktreeService.listWorktrees(repoRoot)` (`src/main/workspace/WorktreeService.ts:44`), `describeConversationWorkspace(...)` (`src/main/conversationWorkspace.ts` — imported in `conversations.ts`).
- Produces:
  - `type WorktreeInfoSummary = Pick<WorktreeInfo, 'path' | 'head' | 'branch' | 'isMain' | 'isLocked' | 'isPrunable'>`
  - `RendererApi.conversations.listWorktrees(conversationId: string): Promise<WorktreeInfoSummary[]>`
  - IPC handler bound to `IPC_CHANNELS.worktreeList`.

- [ ] **Step 1: Write the failing test**

Create `tests/worktreeListIpc.test.ts`. Follow the handler-test pattern used by the other conversation IPC tests (look for an existing `tests/conversationsIpc*.test.ts`; if none exists, test the handler function directly by extracting it, not by mocking Electron — see how `worktreeRemove` is factored).

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';

test('worktreeList handler returns [] and never throws when the project root is missing', async () => {
  // Arrange a conversation whose attached project path does not exist on disk.
  const result = await invokeWorktreeList('conv-with-dead-project');
  assert.deepEqual(result, []);
});

test('worktreeList handler maps WorktreeInfo to WorktreeInfoSummary, dropping internal fields', async () => {
  const result = await invokeWorktreeList('conv-with-live-worktree');
  assert.equal(result.length, 1);
  assert.equal(typeof result[0].path, 'string');
  assert.equal(typeof result[0].isMain, 'boolean');
  assert.ok(!('lockReason' in result[0]), 'summary must not promise lockReason');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/worktreeListIpc.test.ts`
Expected: FAIL — `invokeWorktreeList is not defined` / handler does not exist.

- [ ] **Step 3: Add the contract type**

In `src/shared/contracts.ts`, near `ConversationWorkspace` (line ~500):

```typescript
/** Subset of WorktreeService's WorktreeInfo the renderer is allowed to see. */
export type WorktreeInfoSummary = {
  path: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  isLocked?: boolean;
  isPrunable?: boolean;
};
```

In the same file's `RendererApi.conversations` block, after `removeWorktree` (line ~2015):

```typescript
    removeWorktree: (conversationId: string, force?: boolean) => Promise<ConversationWorkspace>;
    listWorktrees: (conversationId: string) => Promise<WorktreeInfoSummary[]>;
```

- [ ] **Step 4: Add the preload bridge**

In `src/preload/index.ts`, directly after the `removeWorktree` entry (line ~64, inside the `conversations` group):

```typescript
    removeWorktree: (conversationId, force) =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeRemove, { conversationId, force }),
    listWorktrees: (conversationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.worktreeList, conversationId),
```

- [ ] **Step 5: Add the main-process handler**

In `src/main/ipc/conversations.ts`, directly after the `worktreeRemove` handler block (ends current line ~256):

```typescript
  ipcMain.handle(
    IPC_CHANNELS.worktreeList,
    withUserFacingErrors(IPC_CHANNELS.worktreeList, async (event, conversationId: string) => {
      assertTrustedSender(event);
      const ws = describeConversationWorkspace(database, conversationId);
      // No attached project or the folder is gone on disk: the empty state, not an error.
      if (!ws.project?.exists) return [];
      const list = await worktreeService.listWorktrees(ws.project.root);
      // Map to the contract type so we never leak WorktreeInfo internals across IPC.
      return list.map(({ path, head, branch, isMain, isLocked, isPrunable }) => ({
        path, head, branch, isMain, isLocked, isPrunable,
      }));
    })
  );
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test tests/worktreeListIpc.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check + full suite**

Run: `npx tsc --noEmit` then `node --import tsx --test tests/*.test.ts`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/shared/contracts.ts src/preload/index.ts src/main/ipc/conversations.ts tests/worktreeListIpc.test.ts
git commit -m "feat: implement worktree:list IPC end-to-end"
```

(On Mimosa block: leave staged, report `COMMIT_BLOCKED: Task 5`.)

---

### Task 6: C4 — plumb `depth` into real spawn traffic

**Files:**
- Modify: `src/main/ai/tools/agentTools.ts:10-16` (add `depth` to `SubagentContext`) and `:51-58` (pass it in the `spawn_batch` call)
- Modify: `src/main/ai/core/ChatSessionRuntime.ts:1148-1157` (build `subagentContext` with depth)
- Modify: `src/main/ai/agents/SubagentRuntime.ts:41-51` (add `depth` to `ChildTurnExecutor` input) and ~`:318` (pass `depth` into `childExecutor` invocation)
- Test: `tests/subagentRuntime.test.ts` (add a depth-cap integration test)

**Interfaces:**
- Consumes: the depth-cap already enforced in `SubagentRuntime.spawn` (rejects when `depth > maxDepth`, written in Task 1's in-tree state).
- Produces:
  - `SubagentContext = { conversationId, turnId, parentAgentId?, parentToolCallId?, parentSignal?, depth? }` — `depth` is the caller's own depth (root turn = 0).
  - `ChildTurnExecutor` input gains `depth?: number`.
  - `ChildTurnExecutor` input keeps `signal: AbortSignal` and `parentAgentId?: string` unchanged for back-compat.

**Context:** Without this, every `spawn_agent` call computes `childDepth = 1` and the `maxDepth` cap never fires on real traffic — the mechanism in the working tree only constrains code that already passes `depth` explicitly (i.e. tests).

- [ ] **Step 1: Write the failing test**

In `tests/subagentRuntime.test.ts`, add:

```typescript
test('nested spawn beyond maxDepth is rejected with a depth error', async () => {
  const mockRepo = {
    recordEvent: (envelope: RuntimeEventEnvelope) => envelope,
  };
  const runtime = new SubagentRuntime({
    runtimeStateRepo: mockRepo,
    maxDepth: 1,
    // The child executor itself tries to fan out one more level — the thing
    // real traffic does through executeTurn + createAgentTools.
    childExecutor: async ({ prompt, depth, signal }) => {
      if ((depth ?? 0) >= 1) {
        // Grandchild: should have been refused before reaching here.
        return { content: 'SHOULD_NOT_RUN', status: 'completed' as const };
      }
      const tools = createAgentTools(runtime, {
        conversationId: 'conv-1',
        turnId: 'turn-child',
        parentAgentId: 'agent-child',
        depth: (depth ?? 0) + 1,
        parentSignal: signal,
      });
      const result = await (tools.spawn_agent as any).execute(
        { tasks: [{ title: 'grandchild', prompt: 'go deeper' }] },
        { toolCallId: 'grandchild-call' },
      );
      return { content: JSON.stringify(result), status: 'completed' as const };
    },
  });

  const [root] = await runtime.spawnBatch({
    conversationId: 'conv-1',
    parentTurnId: 'turn-root',
    parentToolCallId: 'root-call',
    depth: 0,
    tasks: [{ title: 'child', prompt: 'spawn a grandchild' }],
  });

  assert.equal(root.status, 'completed');
  const inner = JSON.parse(root.result ?? '{}');
  // The grandchild task must surface a depth rejection, not a silent no-op.
  assert.match(JSON.stringify(inner), /depth|exceeds maximum/i);
});
```

(`RuntimeEventEnvelope` is already imported at the top of this test file; reuse the local `mockRepo` shape from the earlier tests, don't invent a shared helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/subagentRuntime.test.ts`
Expected: FAIL — the grandchild currently runs because `depth` never reaches `spawnBatch` through `SubagentContext`.

- [ ] **Step 3: Add `depth` to `SubagentContext` and pass it to `spawnBatch`**

In `src/main/ai/tools/agentTools.ts:10-16`:

```typescript
export type SubagentContext = {
  conversationId: string;
  turnId: string;
  parentAgentId?: string;
  parentToolCallId?: string;
  parentSignal?: AbortSignal;
  /** This turn's nesting depth (root = 0). Lets SubagentRuntime enforce maxDepth. */
  depth?: number;
};
```

And in the `spawn_agent` `execute` (line ~51), add `depth: context.depth` to the `spawnBatch` call's argument object.

- [ ] **Step 4: Build the child's `subagentContext` with the incremented depth**

In `src/main/ai/core/ChatSessionRuntime.ts:1148-1157`, change the `subagentContext` literal:

```typescript
    const subagentContext = subagentRuntime
      ? {
          conversationId: request.conversationId,
          turnId: assistantMessageId ?? requestId,
          parentSignal: signal,
          depth: (depth ?? 0), // root turn = 0; children spawned from here get +1 via spawnBatch
        };
```

(`depth ?? 0` and the drop of the old `A ? {...} : {}` conditional spread are both required: root turns must record `depth: 0`, and the plain-object form keeps the type narrow without a conditional spread that `tsc` widens.)

This does require `depth` in scope: `ExecuteTurnRequest` currently ends at `allowedTools?: string[]` (line ~103, no `depth` field), so Step 4b below adds it there and destructures it in `executeTurn`.

- [ ] **Step 5: Pass the incremented depth from the runtime into the child executor**

In `src/main/ai/agents/SubagentRuntime.ts`:
- Add `depth?: number` to the `ChildTurnExecutor` input type (line ~41).
- In `spawn()`, where `this.childExecutor({...})` is invoked (currently ~line 311 / new line ~318), pass `depth` through: `depth` is the local computed at line 287 — forward it.

In `src/main/ai/core/ChatEngine.ts`, in the `childExecutor` implementation (line ~281), forward `depth` into the `executeTurn` call so Step 4 sees it:

```typescript
turnResult = await this.runtime.executeTurn({
  // ...existing fields...
  parentAgentId,
  depth, // NEW — lets the grandchildren this turn spawns be depth-capped
  allowedTools: tools,
  // ...
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test tests/subagentRuntime.test.ts`
Expected: PASS — including the new `nested spawn beyond maxDepth` test.

- [ ] **Step 7: Type-check + full suite**

Run: `npx tsc --noEmit` then `node --import tsx --test tests/*.test.ts`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/ai/tools/agentTools.ts src/main/ai/core/ChatSessionRuntime.ts src/main/ai/agents/SubagentRuntime.ts src/main/ai/core/ChatEngine.ts tests/subagentRuntime.test.ts
git commit -m "fix(C4): plumb depth through SubagentContext/childExecutor so maxDepth fires on real traffic"
```

(On Mimosa block: leave staged, report `COMMIT_BLOCKED: Task 6`.)
