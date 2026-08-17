import type { ToolSet } from 'ai';
import { tool } from 'ai';
import type { ModelMessage } from 'ai';
import { z } from 'zod';

import {
  formatCompletionNotice,
  type BackgroundJobRegistry,
  type JobSnapshot
} from '../jobs/BackgroundJobRegistry';

/**
 * The model-facing controller for background jobs, ported from DeepSeek
 * Harness's `tool-jobs` package: three kind-independent tools over the
 * registry, plus the prompt section that teaches the model how background
 * work behaves here.
 *
 * Deliberately simpler than the original where Atlas has no equivalent
 * machinery: no wake-up turns (Atlas has no idle-owner wake path — notices
 * are injected into the next turn instead), no per-preset scoping (one
 * registry serves the whole app), and no UI cards (results are plain text).
 */

/** Default wait used when `job_output` sets `wait: true` without a timeout. */
export const JOB_WAIT_DEFAULT_MS = 30_000;

/** Cap for model-supplied waits: a blocked model must not hang the turn. */
export const JOB_WAIT_MAX_MS = 120_000;

/**
 * Prompt section describing background-job etiquette. Prefix-stable text:
 * keep it constant so it never invalidates prompt caching.
 */
export const JOB_TOOL_SYSTEM_PROMPT = [
  'Track every background job id you start. You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job\'s work.',
  'Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering.'
].join(' ');

function statusLine(snapshot: JobSnapshot): string {
  return `[status: ${snapshot.status}${snapshot.detail ? ` — ${snapshot.detail}` : ''}]`;
}

function formatListEntry(snapshot: JobSnapshot): string {
  return `${snapshot.id} [${snapshot.kind}] ${snapshot.status} — ${snapshot.label}`;
}

/**
 * The one-shot user message carrying every completion notice drained for a
 * turn. Same `<system-reminder>` convention as the repeat-call guard's nudge:
 * model-visible for the one request that carries it, never persisted — the
 * transcript already records what the jobs did.
 */
export function buildJobCompletionNoticeMessage(notices: readonly JobSnapshot[]): ModelMessage {
  const lines = notices.map((snapshot) => formatCompletionNotice(snapshot));
  const body =
    notices.length === 1
      ? lines[0]
      : `Background jobs finished since your last turn:\n${lines.map((line) => `- ${line}`).join('\n')}`;

  return {
    role: 'user',
    content: [{ type: 'text', text: `<system-reminder>\n${body}\n</system-reminder>` }]
  };
}

/**
 * The three job-control tools, fenced to the calling conversation by the
 * registry. Only registered when a registry and a conversation id exist —
 * a turn with no background-work substrate never sees the tools.
 */
export function createJobTools(
  registry: BackgroundJobRegistry,
  conversationId: string
): ToolSet {
  return {
    job_output: tool({
      description:
        'Read output from a background job. Returns only new output since the last read while the job runs; ' +
        'after it finishes, returns its final output. Set wait: true to block until the job settles ' +
        '(bounded by timeout_ms). Every response ends with the job status.',
      inputSchema: z.object({
        job_id: z.string().trim().min(1).describe('The job id, e.g. bash-1'),
        wait: z.boolean().optional().describe('Wait for the job to finish before returning'),
        timeout_ms: z
          .number()
          .int()
          .min(1)
          .max(JOB_WAIT_MAX_MS)
          .optional()
          .describe('How long to wait when wait is true; defaults to 30000')
      }),
      execute: async (input) => {
        if (input.wait) {
          const snapshot = await registry.wait(
            input.job_id,
            input.timeout_ms ?? JOB_WAIT_DEFAULT_MS,
            conversationId
          );
          // After a wait the job may have produced output nobody read yet.
          const { text } = registry.read(input.job_id, conversationId);
          return {
            text: text || (snapshot.status === 'running' ? '(no new output)' : '(no output)'),
            status: statusLine(snapshot)
          };
        }

        const { text, snapshot } = registry.read(input.job_id, conversationId);
        return {
          text: text || '(no new output)',
          status: statusLine(snapshot)
        };
      }
    }),

    job_list: tool({
      description: 'List this conversation\'s background jobs with their status.',
      inputSchema: z.object({}),
      execute: async () => {
        const jobs = registry.list(conversationId);
        if (jobs.length === 0) {
          return { text: '(no background jobs)' };
        }
        return { text: jobs.map(formatListEntry).join('\n') };
      }
    }),

    job_kill: tool({
      description: 'Request cancellation of a background job. Returns its status.',
      inputSchema: z.object({
        job_id: z.string().trim().min(1).describe('The job id, e.g. bash-1'),
        reason: z.string().trim().optional().describe('Why the job is being cancelled')
      }),
      execute: async (input) => {
        const before = registry.get(input.job_id);
        const snapshot = registry.kill(input.job_id, conversationId, input.reason);
        const verb =
          before && before.status !== 'running' && before.status !== 'stopping'
            ? `job ${snapshot.id} already finished`
            : `requested cancellation of job ${snapshot.id}`;
        return { text: verb, status: statusLine(snapshot) };
      }
    })
  };
}
