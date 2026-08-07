# T3 — Client fold, Agents panel, quiet timeline, spawn CTA

**Depends on:** [T1](01-contracts-and-activity-ids.md) (contracts), [T2](02-subagent-runtime.md) (to have anything to show).
**Surface:** `src/renderer/`, `tests/`.

## Why

The PR's central UX claim: agent activity should be **re-homed, not hidden**. Agent tool
rows leave the main timeline and appear in a dedicated panel; the chat keeps exactly one
always-visible row per spawn batch. Everything else about a running fleet — status, model,
tokens, last tool — lives in the panel.

The fold that makes this possible is a **pure function over persisted activities**. That
is what makes it testable, and t3code put ~30 tests on it because every invariant in it
traces to a bug they had already shipped once.

## Deliverables

### 1. `src/renderer/lib/agentFold.ts` (new) — pure, no React

```ts
export type RuntimeAgent = {
  id: string;
  kind: 'subagent' | 'nested';
  title: string;
  role: string | null;
  model: string | null;
  status: RuntimeTaskStatus;
  activationCount: number;
  usage: RuntimeTaskUsage | null;
  progress: string | null;
  lastToolName: string | null;
  result: string | null;
  error: string | null;
  outputFile: string | null;
  parentAgentId: string | null;
  recentActivity: ReadonlyArray<{ at: string; summary: string }>;  // ring buffer, cap 6
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export function foldAgents(activities: readonly WorkLogEntry[]): AgentPanelModel;
export function isBackgroundTaskActivity(entry: WorkLogEntry): boolean; // agentKind !== 'agent'
export function isTerminalAgentStatus(s: RuntimeTaskStatus): boolean;
export function isActiveAgentStatus(s: RuntimeTaskStatus): boolean;     // pending|running|waiting
```

**Invariants the fold must encode** (each gets a test — these are the expensive lessons):

- **Identity vs activation.** An agent id is reusable; each start increments
  `activationCount`. Reactivation clears `result`/`error`/`completedAt` — a re-run must not
  render its previous run's failure.
- **Completion can create.** A terminal row with no start row still produces an agent.
- **Late start only fills.** A `task.started` arriving after terminal fills missing
  metadata and never downgrades status or overwrites a known field with null.
- **Max-merge usage** (`mergeTaskUsage` from T1) — field-wise, idempotent under duplicates.
- **First-write terminal timestamps.** `completedAt` is set once; a duplicate terminal row
  does not move it.
- **Idle is non-terminal but not active.** It renders as settled and must not pin a
  "working" indicator, but it is resumable and keeps its roster row.
- **Bounds.** Roster capped (100), activity ring buffer capped (6), summaries truncated
  (~180 chars) with an ellipsis. Consecutive identical summaries dedupe.
- **Unstamped rows are background.** No `agentKind` ⇒ ordinary work-log row, exactly as
  before this feature existed.

### 2. `src/renderer/components/agents/AgentsPanel.tsx` (new)

The **only** roster surface. Flat rows, no unfold-into-transcript:

- Live agents first, as bordered rows: title, role/model chip, status dot, elapsed timer,
  token count, current activity line.
- Settled agents collapse to one line each under an **"Earlier"** section.
- Row click reveals `recentActivity` + result/error inline. `outputFile`, when present,
  is a link into the existing file viewer.
- Empty state when a conversation has never spawned an agent — do not show the panel tab at all.

Mount it beside the existing workbench/right-hand surfaces (see
`src/renderer/components/workbench/`). Follow the existing panel store pattern; if panel
state is persisted with a version, **bump the version** — t3code's `RIGHT_PANEL_STORAGE_VERSION`
7→8 was a called-out risk, and silently reusing a stale shape is worse than one reset.

### 3. Quiet timeline

In the transcript timeline logic (`ActivityBlock` and whatever assembles its entries):

- Rows where `agentKind === 'agent'` **or** `agentId` is set are removed from the main
  work log and belong to the panel.
- Rows with `timelineBypass` never render in the timeline.
- Background rows (unstamped, shells, monitors) stay ordinary work-log rows — unchanged
  behaviour.

### 4. Spawn CTA row

One row per spawn batch, rendered in the timeline where the batch started:

> `▸ 4 agents · 2 running · 128k tokens` → opens the Agents panel

Two exemptions, both non-negotiable and both regression-tested:

- **Exempt from the turn fold.** Agents outlive their launching turn; folding the CTA when
  the turn settles makes a still-running fleet invisible.
- **Exempt from `+N more` overflow.** Select by membership and then filter the *original*
  ordered list — do **not** concatenate two filtered lists, which reorders a mid-group
  spawn row above earlier tool rows. This was a review finding in the PR; inherit the fix,
  not the bug.

Membership is pinned at the first row of the batch so a parallel batch doesn't spawn N CTAs.
Also: only render the `+N more` toggle when `N > 0`.

## Tests — `tests/agentFold.test.ts` (+ a timeline-rows test)

Aim for ~25 cases. Build fixtures from **real persisted activities** — dump a genuine
conversation's `WorkLogEntry[]` to JSON and fold that, rather than hand-writing rows that
encode your assumptions about the emitter. t3code found three schema-vs-wire divergences
this way.

Minimum coverage: every invariant bullet above, plus:
- timeline drops agent rows and keeps background rows;
- CTA survives a settled turn fold;
- CTA stays in chronological position when the group overflows.

## Definition of done

`pnpm test`, `pnpm build`, and `pnpm lint` green; a live conversation with 4 spawned agents
shows a quiet transcript with one CTA row and a panel with four live rows that settle correctly.
