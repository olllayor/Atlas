import type { ToolSet } from 'ai';
import { tool } from 'ai';
import { z } from 'zod';

import type { SkillsService } from './SkillsService';

/**
 * The second half of two-phase skill loading.
 *
 * The system prompt lists what exists; this is how the model reads one. Kept as
 * a tool rather than a prompt section because that is the whole efficiency
 * argument — a bundle's instructions cost nothing until the turn that needs
 * them, and 35 installed bundles cost one line each instead of two megabytes.
 *
 * Contributes nothing when no skills are installed, so a user with an empty
 * plugins directory is not paying for a tool definition describing a feature
 * they have not used.
 */
export function createSkillTools(skills: Pick<SkillsService, 'snapshot' | 'read'>): ToolSet {
  if (skills.snapshot().skills.length === 0) {
    return {};
  }

  return {
    load_skill: tool({
      description:
        'Read the full instructions for one of the skills listed in <available_skills>. Call this before acting on a skill, never infer its contents from the one-line description. Accepts either the qualified "plugin:skill" name or the bare skill name.',
      inputSchema: z.object({
        name: z.string().describe('The skill to load, e.g. "superpowers:brainstorming" or "brainstorming".')
      }),
      // Never throws: a wrong name is a thing the model can recover from by
      // reading the list again, and turning it into a failed turn would be a
      // worse answer than saying so.
      execute: async ({ name }) => skills.read(name)
    })
  };
}
