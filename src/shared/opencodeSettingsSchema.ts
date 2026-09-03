import { z } from 'zod';

import {
  OPENCODE_INTEGRATION_MODES,
  type OpenCodeSettings,
  type ParseOpenCodeSettingsResult
} from './opencodeSettings';

/*
  The opencode settings validator, split out from `opencodeSettings.ts`.

  Only the main process parses these settings; the renderer imports that module
  for `OPENCODE_PROVIDER_ID` and the shared types alone. Zod is ~136 kB and a
  module-scope `z.object()` is not tree-shakeable, so keeping the schema beside
  the constants put the whole validator in the renderer's entry chunk.
*/

const HTTP_URL_PATTERN = /^https?:\/\//i;

function isParsableHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A composite opencode model slug `<providerID>/<modelID>` — the addressing
 * scheme the opencode SDK uses for models and sessions. Deliberately lenient
 * beyond the required slash structure: upstream provider/model ids are
 * third-party data (dots, plus signs, casing all appear in practice).
 */
const MODEL_SLUG_PATTERN = /^[^\s]+\/[^\s]+$/;

export const OpenCodeSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Which transport drives the agent — see OPENCODE_INTEGRATION_MODES (D7). */
  integrationMode: z.enum(OPENCODE_INTEGRATION_MODES).default('server'),
  binaryPath: z
    .string()
    .trim()
    .max(1024, 'Binary path is unreasonably long.')
    .default(''),
  serverUrl: z
    .string()
    .trim()
    .max(2048, 'Server URL is unreasonably long.')
    .default('')
    .refine(
      (value) => value === '' || (HTTP_URL_PATTERN.test(value) && isParsableHttpUrl(value)),
      { message: 'Server URL must be an http(s) URL, or empty to let Atlas spawn the server.' }
    ),
  customModels: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(256)
        .regex(MODEL_SLUG_PATTERN, 'Custom models must look like "<provider>/<model>".')
    )
    .max(64)
    .default([])
});

/**
 * Parse persisted settings into a fully-defaulted value.
 *
 * `null` / `undefined` mean "never configured" and fall back to defaults
 * (t3code's with-decoding-default semantics). Any other malformed blob fails
 * loudly so the caller can surface it instead of silently enabling things.
 */
export function parseOpenCodeSettings(input: unknown): ParseOpenCodeSettingsResult {
  const result = OpenCodeSettingsSchema.safeParse(input ?? {});
  if (result.success) {
    return { ok: true, settings: result.data };
  }

  const issue = result.error.issues[0];
  const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, error: `${path}${issue?.message ?? 'Invalid opencode settings.'}` };
}

export function defaultOpenCodeSettings(): OpenCodeSettings {
  return OpenCodeSettingsSchema.parse({});
}

