import { z } from 'zod';

import {
  KEYBINDING_COMMANDS,
  getDefaultKeybindingRules,
  parseKeybindingWhenExpression
} from './keybindings';

/*
  Validation for keybindings arriving from outside the app — a hand-edited
  `keybindings.json`, or a settings payload crossing IPC.

  Kept apart from `keybindings.ts` on purpose: that module holds the command
  list, the `when` evaluator and the default rules, and the renderer pulls it in
  on the boot path. Zod is ~136 kB and a module-scope `z.object()` is not
  tree-shakeable, so co-locating the schemas put the whole validator in the
  entry chunk to serve callers that only wanted a constant.
*/
export const KeybindingShortcutSchema = z.object({
  key: z.string().trim().min(1).max(64),
  metaKey: z.boolean().default(false),
  ctrlKey: z.boolean().default(false),
  shiftKey: z.boolean().default(false),
  altKey: z.boolean().default(false),
  modKey: z.boolean().default(false),
});

export const KeybindingRuleSchema = z.object({
  command: z.enum(KEYBINDING_COMMANDS),
  shortcut: KeybindingShortcutSchema,
  when: z.string().trim().min(1).max(256).optional(),
});

export const KeybindingRulesSchema = z.array(KeybindingRuleSchema).max(256);

/**
 * Validate rules arriving from outside the app, `when` expressions included.
 * Throws on anything malformed — callers that want a safe fallback should use
 * `decodeKeybindingRules`.
 */
export function parseKeybindingRules(value: unknown) {
  const rules = KeybindingRulesSchema.parse(value);
  for (const rule of rules) {
    if (rule.when) {
      parseKeybindingWhenExpression(rule.when);
    }
  }

  return rules;
}

/** `parseKeybindingRules`, falling back to the shipped defaults on bad input. */
export function decodeKeybindingRules(value: unknown) {
  try {
    return parseKeybindingRules(value);
  } catch {
    return getDefaultKeybindingRules();
  }
}
