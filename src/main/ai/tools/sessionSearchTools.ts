import { tool } from 'ai';
import { z } from 'zod';

import type { MessageSearchHit, SearchMessagesRequest } from '../../../shared/contracts';
import { MESSAGE_SEARCH_MATCH_CLOSE, MESSAGE_SEARCH_MATCH_OPEN } from '../../../shared/contracts';

/** The narrow search seam the tool needs; `ConversationsRepo` satisfies it. */
export type SessionSearchSource = {
  searchMessages: (request: SearchMessagesRequest) => MessageSearchHit[];
};

/**
 * Etiquette for recalling past sessions. Shipped exactly when the tool is
 * registered — the same principle as the job tools — because guidance for a
 * tool the model cannot call is noise.
 */
export const SESSION_SEARCH_SYSTEM_PROMPT = [
  'session_search recalls your past conversations with the user across all their chats.',
  'Use it when the user references earlier work, decisions, or context that is not in this conversation.',
  'Results are short snippets, not full transcripts — treat them as pointers and say which conversation a recalled fact came from.',
  'Set projectOnly to narrow the search to the current project when the user asks about work done here.'
].join(' ');

/**
 * The renderer splits on the PUA match markers; the model reads markdown, so
 * the same positions become bold spans instead.
 */
function translateSnippetMarkers(snippet: string): string {
  return snippet.replaceAll(MESSAGE_SEARCH_MATCH_OPEN, '**').replaceAll(MESSAGE_SEARCH_MATCH_CLOSE, '**');
}

export function createSessionSearchTools(
  source: SessionSearchSource,
  options: { projectId?: string | null } = {},
): Record<string, unknown> {
  return {
    session_search: tool({
      description:
        "Search the user's past conversations by keyword and recall what was discussed or decided. " +
        'Use this when the user references earlier work, a previous chat, or context that is not in the current conversation. ' +
        'Returns short snippets from matching messages across all chats; set projectOnly to restrict the search to the current project.',
      inputSchema: z.object({
        query: z.string().trim().min(1).describe('Keywords to search for in past conversations'),
        projectOnly: z
          .boolean()
          .default(false)
          .describe('Only search conversations attached to the current project'),
        limit: z.number().int().min(1).max(20).default(8).describe('Maximum number of matches to return')
      }),
      strict: true,
      execute: async ({ query, projectOnly, limit }) => {
        // A project filter only exists when this conversation has a project;
        // an unfiled chat asking for "project only" searches everything
        // rather than nothing.
        const projectId = projectOnly ? options.projectId ?? null : null;

        const hits = source.searchMessages({
          query,
          limit,
          includeArchived: false,
          projectId
        });

        return {
          totalMatches: hits.length,
          results: hits.map((hit) => ({
            conversationTitle: hit.conversationTitle,
            conversationId: hit.conversationId,
            role: hit.role,
            snippet: translateSnippetMarkers(hit.snippet),
            createdAt: hit.createdAt
          }))
        };
      }
    })
  };
}
