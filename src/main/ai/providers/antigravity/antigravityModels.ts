/**
 * Antigravity model manifest, mirroring t3code PR #9348's
 * `model-manifest.json` entry for `antigravity`.
 *
 * Google returns every Gemini generation the account can use (11 today).
 * Only the Gemini 3.8 Flash trio is current; the rest fold under Legacy in
 * the picker via `archived`. New threads start on 3.8 Flash (High).
 */

export const ANTIGRAVITY_CURRENT_MODELS: readonly string[] = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low'
];

export const ANTIGRAVITY_CHAT_DEFAULT_MODEL = 'gemini-3.8-flash-high';

/** Human labels for the known Gemini ids; unknown ids fall back to the id. */
const MODEL_LABELS: Record<string, string> = {
  'gemini-3.8-flash-high': 'Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium': 'Gemini 3.8 Flash',
  'gemini-3.8-flash-low': 'Gemini 3.8 Flash (Low)'
};

export function antigravityModelLabel(id: string): string {
  return MODEL_LABELS[id] ?? id;
}

export function isAntigravityCurrentModel(id: string): boolean {
  return (ANTIGRAVITY_CURRENT_MODELS as readonly string[]).includes(id);
}

/** Resolve the chat default: manifest default when offered, else agent's pick. */
export function resolveAntigravityDefaultModel(
  offered: readonly string[],
  agentDefault: string | null
): string {
  if (offered.includes(ANTIGRAVITY_CHAT_DEFAULT_MODEL)) {
    return ANTIGRAVITY_CHAT_DEFAULT_MODEL;
  }
  if (agentDefault && offered.includes(agentDefault)) {
    return agentDefault;
  }
  return offered[0] ?? ANTIGRAVITY_CHAT_DEFAULT_MODEL;
}
