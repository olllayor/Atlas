import { Check, Pause, Play, Target, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import type { ConversationGoalView } from '../../../shared/contracts';
import { useAppStore } from '../../stores/useAppStore';
import { notifyError } from '../../lib/notify';
import { cn } from '../../lib/utils';

/**
 * The goal dock (/goal): one strip between transcript and composer showing the
 * conversation's persistent objective and its controls — the same visual
 * grammar as the queued-messages dock beside it, because both answer "what is
 * still owed here".
 *
 * Codex's TUI keeps the current goal visible and its actions reachable without
 * waiting for a model turn; this row is that surface. Hidden entirely when the
 * conversation has no live goal.
 */

const STATUS_LABEL: Record<ConversationGoalView['status'], string> = {
  active: 'active',
  paused_user: 'paused',
  paused_stalled: 'stalled',
  complete: 'complete',
  blocked: 'blocked',
  cleared: 'cleared',
};

export function GoalDock({ conversationId }: { conversationId: string | null }) {
  const goal = useAppStore((state) =>
    conversationId ? state.goalsByConversation[conversationId] ?? null : null
  );
  const pauseGoal = useAppStore((state) => state.pauseGoal);
  const resumeGoal = useAppStore((state) => state.resumeGoal);
  const clearGoal = useAppStore((state) => state.clearGoal);
  const setGoal = useAppStore((state) => state.setGoal);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (!conversationId || !goal || goal.status === 'cleared') {
    return null;
  }

  const isActive = goal.status === 'active';
  const settled = goal.status === 'complete' || goal.status === 'blocked';

  const saveEdit = async () => {
    const objective = draft.trim();
    setEditing(false);
    if (!objective || objective === goal.objective) return;
    try {
      // Edit mode: same goal row, counters kept — not a replacement, and a
      // paused goal stays paused.
      await setGoal(conversationId, objective, 'edit');
    } catch (error) {
      notifyError('Could not update the goal', error);
    }
  };

  return (
    <div
      role="region"
      aria-label="Persistent goal"
      className="border-t border-border-subtle bg-bg-base/60 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
        <Target
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            isActive ? 'text-text-secondary' : 'text-text-faint'
          )}
        />

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void saveEdit();
              if (event.key === 'Escape') setEditing(false);
            }}
            aria-label="Edit goal"
            maxLength={4000}
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
            placeholder="Describe the objective…"
          />
        ) : settled ? (
          <span className="min-w-0 flex-1 truncate text-text-secondary" title={goal.objective}>
            {goal.status === 'blocked' && goal.blockerNote ? (
              <span className="text-text-muted">Blocked: {goal.blockerNote} — </span>
            ) : null}
            {goal.objective}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setDraft(goal.objective);
            }}
            title={`${goal.objective} — click to edit`}
            className="min-w-0 flex-1 truncate text-left text-text-secondary transition-colors hover:text-text-primary"
          >
            {goal.objective}
          </button>
        )}

        {!editing ? (
          <>
            <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-px text-2xs text-text-muted">
              {STATUS_LABEL[goal.status]}
            </span>
            <span className="shrink-0 text-2xs tabular-nums text-text-faint" title="Turns used against this goal">
              {Math.min(goal.turnCount, goal.turnCap)}/{goal.turnCap}
            </span>
          </>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {editing ? (
            <button
              type="button"
              onClick={() => void saveEdit()}
              title="Save objective"
              className="flex size-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}

          {!editing && !settled ? (
            isActive ? (
              <button
                type="button"
                onClick={() => void pauseGoal(conversationId)}
                title="Pause: stop automatic continuation after persisting the pause"
                aria-label="Pause goal"
                className="flex size-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <Pause className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void resumeGoal(conversationId)}
                title={
                  goal.status === 'paused_stalled'
                    ? 'Resume: grants a fresh streak and continues the loop'
                    : 'Resume'
                }
                aria-label="Resume goal"
                className="flex size-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            )
          ) : null}

          {!editing && goal.status === 'blocked' ? (
            <button
              type="button"
              onClick={() => void resumeGoal(conversationId)}
              title="Retry: you decided the blocker cleared — back to active with a fresh streak"
              aria-label="Retry goal"
              className="flex size-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}

          {!editing ? (
            confirmingClear ? (
              <>
                <span className="text-2xs text-text-muted">Delete?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingClear(false);
                    void clearGoal(conversationId);
                  }}
                  className="rounded-md px-1.5 py-0.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  title="Keep the goal"
                  aria-label="Cancel delete"
                  className="flex size-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                title="Clear this goal"
                aria-label="Clear goal"
                className="flex size-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
