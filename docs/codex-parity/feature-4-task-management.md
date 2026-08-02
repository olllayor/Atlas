# Feature 4: Multi-Conversation Task Management

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. The `codex` design theme is the default.
> Gates: `npx tsc --noEmit` clean, `node --import tsx --test tests/*.test.ts` (371 tests),
> `pnpm build`. Branch: `codex-ui-redesign`.

## Goal
Transform the sidebar's flat conversation list into a Codex-style task
management surface. Conversations become "tasks" with status tracking
(queued/running/completed/failed), background execution while the user works
in another conversation, and task cards with status glyphs and elapsed time.

## How Codex does it
- **Sidebar is a task queue** — each row has a status indicator dot (spinner
  ring = running, hollow circle = queued, blue dot = unread/new, dim check =
  done) + title + right-aligned relative time.
- **Section headers**: `Up next`, `Unread`, `Read`; `Pinned`, `Projects`,
  `Chats` for conversations. Dim 13px, sentence-case, no uppercase/tracking.
- **Parallel execution** — multiple agents run in parallel across projects.
  Each task card shows live status: `In progress`, `Starts in 13min`, `5m`.
- **Task states as dots**, never colored panels.

## Atlas's current state
- **`src/renderer/components/Sidebar.tsx`** — flat list grouped by date buckets
  (Today/Yesterday/This week). Title + relative time. No status, no task concept.
- **`src/renderer/components/SidebarConversationRow.tsx`** — 72 lines, simple
  row with title + time + hover actions (rename/delete/pin).
- **`src/renderer/components/sidebarViewModel.ts`** — builds sidebar items with
  date buckets.
- **`src/renderer/stores/useAppStore.ts`** — `conversations` is flat array. One
  active conversation (`selectedConversationId`). No background execution.
- **`src/main/ai/core/ChatSessionRuntime.ts`** — one streaming session at a time.
- **`src/main/ai/core/ChatEngine.ts`** — processes turns. Single-session.
- **No task status field** on conversations (`contracts.ts`
  `ConversationSummary` has `id`, `title`, `createdAt`, `updatedAt`,
  `projectId` — no `status`).

## What to implement

### Backend (main process)
1. **Conversation status field** (`src/shared/contracts.ts`):
   - Add `status: ConversationStatus` to `ConversationSummary` where
     `ConversationStatus = 'idle' | 'running' | 'completed' | 'failed' | 'queued'`.
   - Add `lastError?: string | null`, `startedAt?: string | null`,
     `completedAt?: string | null`.
   - DB migration: add columns to `conversations` table (`src/main/db/schema.ts`).

2. **Background session management** (`ChatSessionRuntime.ts`):
   - Multiple concurrent `ChatSessionRuntime` instances — one per conversation
     actively streaming.
   - User starts turn in A, switches to B, starts turn → A keeps streaming.
   - Track in `Map<conversationId, ChatSessionRuntime>`.
   - Stream events per-conversation (keyed by `conversationId` in IPC payload).
   - Limit concurrent sessions (e.g., 3) — queue excess as `status: 'queued'`.

3. **Status transitions** (`ChatEngine.ts`):
   - Turn start: `status = 'running'`, `startedAt = now`.
   - Turn complete: `status = 'completed'`, `completedAt = now`.
   - Turn error: `status = 'failed'`, `lastError = message`.
   - Switch-away while running: stays `running` (background).
   - Persist to DB immediately (fire-and-forget).

### Frontend (renderer)
4. **Sidebar row status glyphs** (`SidebarConversationRow.tsx`):
   - Leading glyph: spinner ring (running), hollow circle (queued), dim check
     (completed), red dot (failed), no glyph (idle).
   - Running → elapsed time instead of relative time.
   - Glyph uses `motion-shimmer` for running state.
5. **Sidebar sections** (`sidebarViewModel.ts`): "Running" section at top
   when any conversation has `status: 'running'` or `'queued'`.
6. **Store** (`useAppStore.ts`): `conversationStatuses` map for live status.
7. **Background completion**: toast + unread dot when background task finishes.

## Files to read first
- `src/shared/contracts.ts` (`ConversationSummary`, `ConversationPage`)
- `src/main/db/schema.ts` (table definitions, migration pattern)
- `src/main/db/repositories/conversationsRepo.ts` (conversation CRUD)
- `src/main/ai/core/ChatSessionRuntime.ts` (session management)
- `src/main/ai/core/ChatEngine.ts` (turn processing, status updates)
- `src/renderer/components/SidebarConversationRow.tsx`
- `src/renderer/components/sidebarViewModel.ts`
- `src/renderer/stores/useAppStore.ts` (`conversations` selection)
- `src/renderer/components/workbench/WorkbenchPanel.tsx:331-335`
  (`TaskStatusGlyph` — already exists, reuse for sidebar)

## Acceptance criteria
- [ ] Conversations have `status` field (idle/running/completed/failed/queued)
- [ ] Conversation streams in background when user switches away
- [ ] Sidebar shows status glyphs (spinner/hollow/check/red dot)
- [ ] "Running" section at top of sidebar when tasks are active
- [ ] Elapsed time shows for running conversations
- [ ] Background completion shows notification + unread dot
- [ ] Concurrent session limit enforced (excess queued)
- [ ] `tsc` clean, all tests pass, build succeeds
- [ ] DB migration backward-compatible (old DBs get `status: 'idle'` default)

## Constraints
- DB migration backward-compatible (existing conversations default to `idle`/
  `completed` based on last message)
- Don't change IPC chat event payload shape — add `status` as new events
- `ChatSessionRuntime` refactor is riskiest — do incrementally (first 2
  concurrent, test, then increase)
- Status persistence fire-and-forget (don't block stream)
- Reuse `TaskStatusGlyph` from `WorkbenchPanel.tsx` for sidebar glyph
