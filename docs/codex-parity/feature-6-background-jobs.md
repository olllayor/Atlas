# Feature 6: Background-Job Lifecycle Surfacing

> **Atlas context:** Electron 41 + React 19.2 + TS 6 + Tailwind v4 + Zustand 5 +
> shadcn + `ai` SDK v6 + `better-sqlite3`. Gates: `npx tsc --noEmit` clean,
> `node --import tsx --test tests/*.test.ts`, build green. Branch: `dev`.

## Goal

Give background jobs (`run_in_background`) the full Codex-app lifecycle path:
visible while live, quiet when settled, and *somewhere to land* after
completion — instead of vanishing. Three phases, each independently shippable:

1. **P1 — jobs feed Activity.** A conversation with live background jobs reads
   as `running` in sidebar rows, the activity bell, and ⌘⌥A cycling.
2. **P2 — output tail.** The Tasks-tab jobs section shows the last few lines of
   a live job's output (the CLI `/ps` `↳` preview, bounded).
3. **P3 — AgentsPanel spec pass.** Bring its headers/chrome in line with the
   §5 status-list grammar every other surface follows.

## How Codex does it

Sources: developers.openai.com/codex — `code-review`, `long-running-work`,
`notifications`, `automations`; captured frames in `reference-visual-spec.md`
and `research-raw.md`.

- **Right panel holds artifacts, not processes.** It is the review pane
  (diff scopes incl. `Last turn`). Running work never gets a process-list tab.
- **Liveness is ambient, at three distances:**
  - *In-thread*: shimmering status header + trace rows.
  - *Near composer*: goal progress row — pause/resume/edit/clear above the input.
  - *Ambient*: sidebar dots, **Activity view** (bell, groups chats by
    needs-input / running / waiting), Pets.
- **Completion lands somewhere.** Finished work funnels to the review pane or
  the Scheduled/Triage inbox (runs with findings stay, empty runs auto-archive).
  OS notifications tiered never/background-only/always.
- **One truth for liveness.** Issue #24287: renderer surfaces that disagree
  about active state are a critical bug, not a cosmetic one. Every surface must
  project the same backend state.

## Atlas's current state

Already shipped (this effort, earlier commits):

- `JobsChip` in the context bar: `StatusDot` pulse while live, settles to
  hidden after 5 s, rows capped at 12 + "N more", 80-char label truncation,
  stop buttons.
- Workbench Tasks tab: `JobsSection` ("Background jobs") in the task-row
  grammar, plus a pulse on the Tasks tab strip while tools OR jobs run.
- Shared `useConversationJobs(conversationId)` hook — one subscription shape
  for chip and workbench.
- `TaskStatusGlyph` extracted so tool rows and job rows share the §5 glyph set.

Gaps:

- **Jobs are invisible to attention.** `deriveAttentionState` (`lib/attention.ts`)
  knows drafts, approvals, subagent liveness, persisted status, follow-ups,
  unread turns — but nothing about `BackgroundJobRegistry`. A chat whose only
  activity is a 20-minute training run shows as idle everywhere.
- **No aftermath.** When a job settles, the chip fades out and nothing collects
  the fact. Codex routes completion to review/inbox/bell.
- **No output visibility.** `TrackedJob.readOutput` exists in main; the renderer
  gets none of it.
- **AgentsPanel chrome** violates spec §5 (uppercase tracked headers vs dim
  sentence-case).

## What to implement

### P1 — jobs feed Activity (main → renderer, additive)

1. **Registry rollup** (`BackgroundJobRegistry`): `listAll(): JobSnapshot[]`
   over the in-memory store. No filtering beyond what `list()` does.
2. **IPC** (`shared/ipc.ts`, `main/ipc/jobs.ts`, `preload/index.ts`,
   `shared/contracts.ts`): `jobsListAll` channel returning `JobSnapshotView[]`.
   Additive; existing channels untouched.
3. **Renderer read model** (`renderer/lib/jobActivity.ts`, pure):
   `ConversationJobSummary = { live: number; total: number }`;
   `summarizeJobsByConversation(jobs): Map<string, ConversationJobSummary>`;
   `jobSummaryToAttention(summary)` helper.
4. **Hook** (`renderer/hooks/useConversationJobSummaries.ts`): subscribes to
   `window.atlasChat.jobs.subscribe` **once per window** (events carry
   `snapshot.conversationId`), seeds from `listAll()` on mount, maintains
   `Map<string, ConversationJobSummary>` in component state. Per-conversation
   consumers keep using `useConversationJobs`; this one is for whole-app views.
5. **Attention** (`lib/attention.ts`): extend `AttentionInput` with
   `backgroundJobsLive?: number`. Live > 0 ⇒ `running`. Ordering unchanged —
   jobs are work, not a new tier.
6. **Wire both derivation sites**: `App.tsx` ⌘⌥A block (~line 1208) and
   `buildSidebarItems` in `sidebarViewModel.ts` (new optional param, default
   absent = no behavior change). Bell and rows update through existing props.

### P1b — failed jobs want a human (deferred)

Failed-unseen jobs should light `unread` until the conversation is opened.
Requires read-tracking (mirror `unreadByConversation` +
`markConversationRead`). Deliberately deferred: needs a read-semantics design
(job ids vs conversation-level), and failures already surface in-transcript.

### P2 — output tail

1. Contracts: `JobSnapshotView.tail?: string` — last ≤ 2 KB, line-bounded,
   trailing partial line dropped.
2. Registry: `snapshot()` includes tail for kinds whose producer exposes
   `readOutput` (stream kinds). Bounded work per broadcast — cap bytes, no
   regex over megabytes.
3. `JobsSection` rows render the tail dim under the label (`↳` style), last
   2 lines. Chip unchanged (too small for previews).
4. First read the producers (`main/ai/tools/terminalTools.ts`,
   `jobTools.ts`) to confirm which kinds stream.

### P3 — AgentsPanel spec pass

Headers → dim sentence-case (`text-sm font-normal text-text-tertiary`),
drop uppercase/tracking and the header border, match Tasks-tab section rhythm.
Roster summary line may keep numbers but loses the box.

## Files to read first

- `src/main/ai/jobs/BackgroundJobRegistry.ts` (store, snapshot, listeners)
- `src/main/ipc/jobs.ts`, `src/shared/ipc.ts` (channel naming)
- `src/preload/index.ts` (`window.atlasChat.jobs` bridge)
- `src/renderer/lib/attention.ts` (+ `tests/attention.test.ts`)
- `src/renderer/components/sidebarViewModel.ts:407-460`
- `src/renderer/App.tsx:1201-1224` (⌘⌥A)

## Acceptance criteria

- [ ] Conversation with a live background job: sidebar dot pulses, bell badge
      counts it, ⌘⌥A reaches it — same moment the chip pulses (one projection).
- [ ] All jobs settled: attention returns to prior level without stale runs.
- [ ] No IPC shape changes; new channel additive; `tsc` clean; all tests pass.
- [ ] P2: live job rows show a ≤2-line dim tail; settled rows show detail/
      elapsed as today; no tail for non-stream kinds.
- [ ] P3: AgentsPanel headers match §5 grammar; no uppercase/tracked labels.

## Constraints

- Single liveness source: everything derives from registry events + snapshots.
  No polling loops in renderers.
- Per-conversation hooks stay fenced by `conversationId`; the summaries hook is
  window-global by design (bell/sidebar need cross-conversation truth).
- Attention ordering is frozen (`needsInput → running → queued → unread`);
  jobs fold into `running`, they do not add a tier.
