import { z } from 'zod';

import {
  LOCAL_AGENT_COLORS,
  type LocalAgentSettings,
  type ParseLocalAgentSettingsResult
} from './localAgents';

/*
  Validator for a single local agent's settings, split from `localAgents.ts`
  for the same reason `opencodeSettingsSchema.ts` is split: zod is ~136 kB and
  a module-scope `z.object()` is not tree-shakeable, so keeping it beside the
  catalog would drag the whole validator into the renderer's entry chunk. Only
  the main process parses; the renderer imports the types and the catalog.
*/

export const LocalAgentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Empty means "use the catalog label". */
  displayName: z.string().trim().max(120, 'Display name is unreasonably long.').default(''),
  /** Empty means "no accent"; anything else must be a known swatch. */
  color: z
    .union([z.literal(''), z.enum(LOCAL_AGENT_COLORS)])
    .default(''),
  /** Empty resolves the catalog binary from PATH. */
  binaryPath: z.string().trim().max(1024, 'Binary path is unreasonably long.').default(''),
  /** Custom config/home directory for Claude Code (CLAUDE_CONFIG_DIR). */
  homePath: z.string().trim().max(1024, 'Home path is unreasonably long.').default(''),
  /** Empty uses the catalog's ACP bridge command, when the agent needs one. */
  acpCommand: z.string().trim().max(1024, 'ACP command is unreasonably long.').default(''),
  launchArgs: z.string().trim().max(2048, 'Launch arguments are unreasonably long.').default(''),
  env: z
    .record(z.string().trim().min(1).max(256), z.string().max(4096))
    .refine((value) => Object.keys(value).length <= 50, 'Too many environment variables.')
    .default({}),
  /** Extra model ids to offer beyond what the agent advertises over ACP. */
  customModels: z
    .array(z.string().trim().min(1).max(256))
    .max(64)
    .default([])
});

/**
 * Parse one agent's persisted settings into a fully-defaulted value.
 *
 * `null` / `undefined` mean "never configured" and fall back to defaults;
 * anything else malformed fails loudly so the caller can surface it instead of
 * silently enabling a spawn with settings nobody chose.
 */
export function parseLocalAgentSettings(input: unknown): ParseLocalAgentSettingsResult {
  const result = LocalAgentSettingsSchema.safeParse(input ?? {});
  if (result.success) {
    return { ok: true, settings: result.data };
  }

  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, error: `${path}${issue?.message ?? 'Invalid local agent settings.'}` };
}

export function defaultLocalAgentSettings(): LocalAgentSettings {
  return LocalAgentSettingsSchema.parse({});
}
