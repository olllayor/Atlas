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
export function createSkillTools(
  skills: Pick<SkillsService, 'snapshot' | 'read' | 'find'>,
  /**
   * Called when a skill is opened, so its plugin's servers can come up.
   *
   * Absent on the context-measuring path: that runs to produce an estimate and
   * must not change what the next turn is allowed to do.
   */
  onLoaded?: (pluginName: string, requiredServers: string[]) => boolean,
  projectRoot?: string | null
): ToolSet {
  if (skills.snapshot(projectRoot).skills.length === 0) {
    return {};
  }

  return {
    load_skill: tool({
      description:
        'Read the full instructions for one of the skills listed in <available_skills>. Call this before acting on a skill, never infer its contents from the one-line description. Accepts either the qualified "plugin:skill" name or the bare skill name.',
      inputSchema: z.object({
        name: z.string().describe('The skill to load, e.g. "superpowers:brainstorming" or "apple-design".')
      }),
      // Never throws: a wrong name is a thing the model can recover from by
      // reading the list again, and turning it into a failed turn would be a
      // worse answer than saying so.
      execute: async ({ name }) => {
        const skill = skills.find(name, projectRoot);

        // Activation takes effect on the next turn, not this one. A turn's tool
        // set is resolved once before the stream starts — deliberately, so a
        // server coming up mid-stream cannot change what the turn was offered —
        // and that invariant is worth more than saving a round trip.
        const activated = skill && onLoaded ? onLoaded(skill.pluginName, skill.requiredServers) : false;

        const body = skills.read(name, projectRoot);

        // Said only when something actually came up, so an ordinary skill with
        // no tools behind it does not carry a sentence about tools.
        return activated
          ? `${body}\n\nThe tools this skill needs are connecting now and will be available on the next message.`
          : body;
      }
    })
  };
}
