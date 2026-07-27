import { tool } from 'ai';
import { z } from 'zod';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import {
  APPROVAL_GATED_TOOL_NAMES,
  DEFAULT_TOOL_PERMISSION_MODE,
  SIDE_EFFECTING_TOOL_NAMES
} from '../../../shared/chatParameters';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import {
  bashToolExecute,
  globToolExecute,
  grepToolExecute,
  readToolExecute,
  webFetchToolExecute,
  webSearchToolExecute
} from './toolRuntime';

export const TOOL_USE_SYSTEM_PROMPT = [
  'You have access to local filesystem, search, web, and utility tools.',
  'Use tools whenever they materially improve accuracy or require current app data.',
  'Prefer dedicated tools over shell commands for reading files, searching code, and finding files.',
  'Use web_search for current information and web_fetch to inspect specific pages.',
  'When answering from web results, cite the relevant source URLs in your response.',
  'Never invent tool results.',
  'After a tool finishes, explain the result clearly and concisely.'
].join(' ');

/**
 * Prompt fragment describing the active permission mode, so the model does not
 * plan around a tool it will never be offered.
 */
export function describeToolPermissionsForPrompt(mode: ToolPermissionMode) {
  if (mode === 'read-only') {
    return 'Read-only mode is active: shell and web tools are unavailable this turn. Do not claim to have run them.';
  }

  if (mode === 'full-access') {
    return 'Full-access mode is active: every tool runs immediately without asking the user first.';
  }

  return 'Shell commands and web fetches pause for the user to approve before they run.';
}

/**
 * `extraTools` lets optional subsystems (currently Sites) contribute tools
 * without every caller having to know they exist.
 *
 * `mode` decides which tools are offered at all and which pause for approval.
 * Withholding a tool is stronger than refusing it in a prompt: the model cannot
 * call something that was never in its tool set.
 */
export function createBuiltInTools(
  modelsRepo: ModelsRepo,
  extraTools: Record<string, unknown> | null = null,
  mode: ToolPermissionMode = DEFAULT_TOOL_PERMISSION_MODE
) {
  const all = {
    ...(extraTools ?? {}),
    read_file: tool({
      description:
        'Read a local file from an absolute path. Supports text files, notebooks, images, and PDFs. Use offset and limit for large text files.',
      inputSchema: z.object({
        file_path: z.string().trim().min(1).describe('Absolute path to the file to read'),
        offset: z.number().int().min(1).optional().describe('1-indexed starting line for text files'),
        limit: z.number().int().min(1).max(4000).optional().describe('Maximum number of lines to read'),
        pages: z.string().trim().optional().describe('Optional PDF page selection like "1-5" or "3"')
      }),
      strict: true,
      execute: readToolExecute
    }),
    grep_search: tool({
      description:
        'Search file contents with ripgrep. Use this for regex or text search instead of shell grep/rg.',
      inputSchema: z.object({
        pattern: z.string().trim().min(1).describe('Regex pattern to search for'),
        path: z.string().trim().optional().describe('Directory or file to search. Defaults to the current working directory'),
        glob: z.string().trim().optional().describe('Optional glob filter like **/*.ts or *.{ts,tsx}'),
        output_mode: z
          .enum(['content', 'files_with_matches', 'count'])
          .optional()
          .describe('Search result mode'),
        '-B': z.number().int().min(0).optional().describe('Lines of context before each match'),
        '-A': z.number().int().min(0).optional().describe('Lines of context after each match'),
        '-C': z.number().int().min(0).optional().describe('Lines of context before and after each match'),
        context: z.number().int().min(0).optional().describe('Alias for -C'),
        '-n': z.boolean().optional().describe('Show line numbers in content mode'),
        '-i': z.boolean().optional().describe('Case-insensitive search'),
        type: z.string().trim().optional().describe('ripgrep file type filter like ts, js, py, go, or rust'),
        head_limit: z.number().int().min(0).max(2000).optional().describe('Maximum number of result rows to return'),
        offset: z.number().int().min(0).optional().describe('Skip the first N result rows'),
        multiline: z.boolean().optional().describe('Enable multiline regex search')
      }),
      strict: true,
      execute: grepToolExecute
    }),
    glob_search: tool({
      description:
        'Find files by glob pattern. Use this when you know the filename shape or want to discover matching files quickly.',
      inputSchema: z.object({
        pattern: z.string().trim().min(1).describe('Glob pattern like **/*.ts or src/**/*.tsx'),
        path: z.string().trim().optional().describe('Directory to search. Defaults to the current working directory')
      }),
      strict: true,
      execute: globToolExecute
    }),
    web_search: tool({
      description:
        'Search the web for current information. Use this when the answer depends on recent documentation, current events, or live web pages.',
      inputSchema: z.object({
        query: z.string().trim().min(2).describe('Search query'),
        allowed_domains: z.array(z.string().trim().min(1)).max(20).optional().describe('Only include results from these domains'),
        blocked_domains: z.array(z.string().trim().min(1)).max(20).optional().describe('Exclude results from these domains')
      }),
      strict: true,
      execute: webSearchToolExecute
    }),
    web_fetch: tool({
      description:
        'Fetch a URL and extract text content relevant to the provided prompt. Use this after web search when you need page content, not just links.',
      needsApproval: true,
      inputSchema: z.object({
        url: z.string().trim().url().describe('Fully qualified URL to fetch'),
        prompt: z.string().trim().min(1).describe('What information should be extracted from the page')
      }),
      strict: true,
      execute: webFetchToolExecute
    }),
    bash: tool({
      description:
        'Run a shell command in the local working directory. This integration currently enforces a read-only safety policy and should not be used for file edits.',
      needsApproval: true,
      inputSchema: z.object({
        command: z.string().trim().min(1).describe('Shell command to execute'),
        timeout: z.number().int().min(100).max(120_000).optional().describe('Execution timeout in milliseconds'),
        description: z.string().trim().optional().describe('Brief description of what the command does'),
        run_in_background: z.boolean().optional().describe('Run the command in the background'),
        dangerouslyDisableSandbox: z.boolean().optional().describe('Reserved for compatibility')
      }),
      strict: true,
      execute: bashToolExecute
    }),
    get_current_time: tool({
      description: 'Get the current local date, time, and timezone.',
      inputSchema: z.object({}),
      strict: true,
      execute: async () => ({
        iso: new Date().toISOString(),
        locale: new Intl.DateTimeFormat('en', {
          dateStyle: 'full',
          timeStyle: 'long'
        }).format(new Date()),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    }),
    search_model_catalog: tool({
      description:
        "Search Atlas's local model catalog by name or capability. Use this when the user asks about free models, providers, tool support, vision support, or context window size.",
      inputSchema: z.object({
        query: z.string().trim().optional().describe('Optional search term for model id, label, or provider'),
        freeOnly: z.boolean().default(false).describe('Only return free models'),
        supportsTools: z.boolean().optional().describe('Filter for tool-calling support'),
        supportsVision: z.boolean().optional().describe('Filter for vision support'),
        limit: z.number().int().min(1).max(12).default(6).describe('Maximum models to return')
      }),
      strict: true,
      execute: async ({ freeOnly, limit, query, supportsTools, supportsVision }) => {
        const normalizedQuery = query?.toLowerCase();
        // Same scope as the model picker: never describe a model the user has
        // no configured provider for.
        const models = modelsRepo.list({ freeOnly, includeArchived: false, configuredOnly: true });

        const matches = models.filter((model) => {
          if (supportsTools != null && model.supportsTools !== supportsTools) {
            return false;
          }

          if (supportsVision != null && model.supportsVision !== supportsVision) {
            return false;
          }

          if (!normalizedQuery) {
            return true;
          }

          const haystack = [model.id, model.label, model.providerId].join(' ').toLowerCase();
          return haystack.includes(normalizedQuery);
        });

        return {
          totalMatches: matches.length,
          models: matches.slice(0, limit).map((model) => ({
            id: model.id,
            label: model.label,
            providerId: model.providerId,
            isFree: model.isFree,
            supportsTools: model.supportsTools,
            supportsVision: model.supportsVision,
            contextWindow: model.contextWindow
          }))
        };
      }
    })
  };

  return applyToolPermissionMode(all, mode);
}

/**
 * Read-only drops the side-effecting tools; full-access clears the approval
 * flags so nothing pauses. `ask` is the shape the tools are declared in.
 */
function applyToolPermissionMode<T extends Record<string, unknown>>(tools: T, mode: ToolPermissionMode): T {
  if (mode === 'ask') {
    return tools;
  }

  const withheld: readonly string[] = mode === 'read-only' ? SIDE_EFFECTING_TOOL_NAMES : [];
  const result: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(tools)) {
    if (withheld.includes(name)) {
      continue;
    }

    if (mode === 'full-access' && (APPROVAL_GATED_TOOL_NAMES as readonly string[]).includes(name)) {
      // Same tool, approval flag cleared, so it executes without pausing.
      result[name] = { ...(definition as Record<string, unknown>), needsApproval: false };
      continue;
    }

    result[name] = definition;
  }

  return result as T;
}
