import { ipcMain } from 'electron/main';

import type { ConversationGoalView } from '../../shared/contracts';
import type { ConversationGoalRecord } from '../db/repositories/conversationGoalsRepo';
import { MAX_GOAL_OBJECTIVE_CHARS } from '../db/repositories/conversationGoalsRepo';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { GoalRuntime } from '../ai/goal/goalRuntime';
import type { ChatEngine } from '../ai/core/ChatEngine';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

function toView(goal: ConversationGoalRecord): ConversationGoalView {
  return {
    id: goal.id,
    conversationId: goal.conversationId,
    objective: goal.objective,
    status: goal.status,
    ...(goal.blockerKind ? { blockerKind: goal.blockerKind } : {}),
    ...(goal.blockerNote !== null ? { blockerNote: goal.blockerNote } : {}),
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    turnCount: goal.turnCount,
    turnCap: goal.turnCap,
  };
}

/**
 * Renderer control surface for `/goal`. Mutations run through the GoalRuntime
 * (the only state-machine writer). The pause handler enforces the
 * persist-before-cancel ordering — the goal row is already `paused_user` in
 * SQLite by the time any generation is aborted, so a user stop can never be
 * rewritten as an infrastructure failure.
 */
export function registerGoalsIpc(options: {
  goalRuntime: GoalRuntime;
  chatEngine: ChatEngine;
}): void {
  const { goalRuntime, chatEngine } = options;

  ipcMain.handle(
    IPC_CHANNELS.goalsSet,
    withUserFacingErrors(IPC_CHANNELS.goalsSet, (event, payload: { conversationId: string; objective: string; mode?: 'replace' | 'edit' }) => {
      assertTrustedSender(event);
      if (typeof payload?.conversationId !== 'string') throw new Error('A conversation id is required.');
      const objective = typeof payload.objective === 'string' ? payload.objective.trim() : '';
      if (!objective) throw new Error('An objective is required.');
      if (objective.length > MAX_GOAL_OBJECTIVE_CHARS) {
        throw new Error(`An objective must be at most ${MAX_GOAL_OBJECTIVE_CHARS} characters.`);
      }
      const goal =
        payload.mode === 'edit'
          ? goalRuntime.editGoal(payload.conversationId, objective)
          : goalRuntime.setGoal(payload.conversationId, objective);
      if (!goal) throw new Error('No live goal to edit. Set the goal first.');
      return toView(goal);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.goalsPause,
    withUserFacingErrors(IPC_CHANNELS.goalsPause, (event, conversationId: string) => {
      assertTrustedSender(event);
      if (typeof conversationId !== 'string') throw new Error('A conversation id is required.');
      const goal = goalRuntime.pause(conversationId);
      chatEngine.abortActiveTurn(conversationId);
      return goal ? toView(goal) : null;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.goalsResume,
    withUserFacingErrors(IPC_CHANNELS.goalsResume, (event, conversationId: string) => {
      assertTrustedSender(event);
      if (typeof conversationId !== 'string') throw new Error('A conversation id is required.');
      // Resume covers both stopped states a Play button can sit on: paused
      // (user/stall) and blocked — the human says the blocker cleared.
      const live = goalRuntime.getActive(conversationId);
      const goal =
        live?.status === 'blocked'
          ? goalRuntime.retryBlocked(conversationId)
          : goalRuntime.resume(conversationId);
      return goal ? toView(goal) : null;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.goalsClear,
    withUserFacingErrors(IPC_CHANNELS.goalsClear, (event, conversationId: string) => {
      assertTrustedSender(event);
      if (typeof conversationId !== 'string') throw new Error('A conversation id is required.');
      const latest = goalRuntime.clear(conversationId);
      return latest ? toView(latest) : null;
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.goalsGet,
    withUserFacingErrors(IPC_CHANNELS.goalsGet, (event, conversationId: string) => {
      assertTrustedSender(event);
      if (typeof conversationId !== 'string') return null;
      const goal = goalRuntime.getActive(conversationId);
      return goal ? toView(goal) : null;
    })
  );
}
