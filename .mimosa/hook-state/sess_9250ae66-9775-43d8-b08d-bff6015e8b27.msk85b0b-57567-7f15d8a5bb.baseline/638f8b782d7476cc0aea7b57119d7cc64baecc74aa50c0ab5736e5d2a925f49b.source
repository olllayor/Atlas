import { tool } from 'ai';
import { z } from 'zod';

import type { MentionId } from '../../../shared/mentions';
import {
  ATLAS_SITE_POLICY,
  SITE_ENTRY_FILE,
  type SiteDetail,
  type SiteViolationCode,
} from '../../../shared/sites';
import type { SiteService } from '../../sites/SiteService';
import type { SitePreviewHost } from '../../sites/SitePreviewHost';

export const SITE_TOOL_SYSTEM_PROMPT = [
  'You can build multi-file static sites with the site_* tools.',
  `Every site needs an "${SITE_ENTRY_FILE}" entry file at its root.`,
  'Sites are static only: no server code, no Node builtins, no process.env, no build step.',
  'Prefer self-contained assets — inline styles and scripts, or local files. External CDN references are flagged for review before the site can be published.',
  `Allowed file types: ${ATLAS_SITE_POLICY.allowedExtensions.join(', ')}.`,
  'Write files with site_write_file, then run site_build to validate. Fix every reported error before publishing.',
  'Call site_publish only when the user asks to publish; it requires their approval.',
].join(' ');

/**
 * The Sites opt-in rule.
 *
 * An explicit `@Sites` mention loads the toolset. A conversation that already
 * owns a site keeps it loaded, so an in-progress build can be iterated on
 * without re-typing the mention every turn.
 */
export function shouldLoadSiteTools({
  mentions,
  hasExistingSite,
}: {
  mentions: readonly MentionId[];
  hasExistingSite: boolean;
}): boolean {
  return mentions.includes('sites') || hasExistingSite;
}

function summarize(detail: SiteDetail) {
  return {
    siteId: detail.site.id,
    title: detail.site.title,
    status: detail.site.status,
    draftVersionId: detail.draft?.id ?? null,
    draftState: detail.draft?.state ?? null,
    currentVersionNo: detail.current?.versionNo ?? null,
    fileCount: detail.files.length,
    totalBytes: detail.files.reduce((total, file) => total + file.byteSize, 0),
    files: detail.files.map((file) => file.path),
  };
}

export function createSiteTools(
  service: SiteService,
  previewHost: SitePreviewHost | null,
  /**
   * Bound from the turn, not from model input: a site must always link back to
   * the conversation that created it, or the next turn loses its Sites tools.
   */
  conversationId: string | null = null
) {
  return {
    site_create: tool({
      description:
        'Create a new site. Returns the site id to use with the other site tools. Seeds a starter index.html unless files are supplied.',
      inputSchema: z.object({
        title: z.string().trim().min(1).describe('Human-readable site title'),
        files: z
          .array(
            z.object({
              path: z.string().trim().min(1).describe(`Site-relative path, e.g. ${SITE_ENTRY_FILE}`),
              contents: z.string().describe('Full text contents of the file'),
            })
          )
          .optional()
          .describe('Optional initial files. Include an index.html at the root.'),
      }),
      execute: async ({ files, title }) => {
        const detail = await service.createSite({
          title,
          sourceConversationId: conversationId,
          files,
        });
        return summarize(detail);
      },
    }),

    site_list: tool({
      description: 'List the sites in this Atlas install, most recently updated first.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(20).describe('Maximum sites to return'),
      }),
      execute: async ({ limit }) => {
        const sites = service.listSites().slice(0, limit);
        return {
          totalSites: sites.length,
          sites: sites.map((site) => ({
            siteId: site.id,
            title: site.title,
            status: site.status,
            updatedAt: site.updatedAt,
          })),
        };
      },
    }),

    site_read_file: tool({
      description: 'Read one text file from a site draft. Use this before editing an existing file.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
        path: z.string().trim().min(1).describe('Site-relative path'),
      }),
      execute: async ({ path, site_id }) => {
        const contents = await service.readFile(site_id, path);
        return { path, contents };
      },
    }),

    site_write_file: tool({
      description:
        'Create or replace a file in the site draft. Writes the full file contents — there is no partial patch mode.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
        path: z.string().trim().min(1).describe('Site-relative path, e.g. index.html or assets/app.css'),
        contents: z.string().describe('Complete file contents'),
      }),
      execute: async ({ contents, path, site_id }) => {
        const detail = await service.writeFile(site_id, path, contents);
        return { written: path, ...summarize(detail) };
      },
    }),

    site_delete_file: tool({
      description: 'Delete a file from the site draft.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
        path: z.string().trim().min(1),
      }),
      execute: async ({ path, site_id }) => {
        const detail = await service.deleteFile(site_id, path);
        return { deleted: path, ...summarize(detail) };
      },
    }),

    site_build: tool({
      description:
        'Validate the site draft against the Atlas static-site policy. Returns errors that block publishing and warnings that need user review.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
      }),
      execute: async ({ site_id }) => {
        const detail = await service.buildDraft(site_id);
        const validation = detail.draft?.validation ?? null;
        return {
          state: detail.draft?.state ?? null,
          ok: validation?.ok ?? false,
          errors: validation?.errors ?? [],
          warnings: validation?.warnings ?? [],
          buildLog: detail.draft?.buildLog ?? null,
          ...summarize(detail),
        };
      },
    }),

    site_preview: tool({
      description:
        'Point the site preview at the current draft and return its preview URL. Build the site first.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
      }),
      execute: async ({ site_id }) => {
        const version = service.resolveServableVersion(site_id, null);
        const target = previewHost?.setServedVersion(site_id, version.id) ?? null;
        return {
          versionId: version.id,
          versionState: version.state,
          previewUrl: target?.url ?? null,
        };
      },
    }),

    site_publish: tool({
      description:
        'Publish the site draft as an immutable version. Blocked while the build reports errors, and every warning must be acknowledged first. Requires user approval.',
      inputSchema: z.object({
        site_id: z.string().trim().min(1),
        label: z.string().trim().optional().describe('Optional label for this version'),
        acknowledge_warnings: z
          .array(z.string())
          .optional()
          .describe('Warning codes the user has explicitly accepted, e.g. external_resource'),
      }),
      needsApproval: true,
      execute: async ({ acknowledge_warnings, label, site_id }) => {
        const detail = await service.publish(site_id, {
          label: label ?? null,
          acknowledgedWarnings: (acknowledge_warnings ?? []) as SiteViolationCode[],
        });
        return {
          publishedVersionNo: detail.current?.versionNo ?? null,
          publishedAt: detail.current?.publishedAt ?? null,
          ...summarize(detail),
        };
      },
    }),
  } as const;
}
