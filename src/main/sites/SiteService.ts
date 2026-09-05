import { randomUUID } from 'node:crypto';

import {
  ATLAS_SITE_POLICY,
  SITE_ENTRY_FILE,
  isTextSiteFile,
  normalizeSitePath,
  slugifySiteTitle,
  validateSiteArtifact,
  type CreateSiteRequest,
  type SiteDetail,
  type SiteFileInput,
  type SiteFileMeta,
  type SiteReviewChecklist,
  type SiteSummary,
  type SiteValidationResult,
  type SiteVersionSummary,
  type SiteViolationCode,
} from '../../shared/sites';
import type { SitesRepo } from '../db/repositories/sitesRepo';
import type { SiteFileStore } from './SiteFileStore';

const DEFAULT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>New site</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>New site</h1>
      <p>Ask the assistant to build this page.</p>
    </main>
  </body>
</html>
`;

const DEFAULT_STYLES_CSS = `:root { color-scheme: light dark; }

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
`;

export class SiteServiceError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = 'SiteServiceError';
  }
}

/**
 * Orchestrates the site lifecycle across SQLite metadata and on-disk bytes.
 *
 * Lifecycle: every site has at most one mutable draft version. Publishing
 * promotes that draft in place (its directory is never written again) and
 * seeds a fresh draft from the published bytes. Published versions are
 * therefore immutable by construction, not by convention.
 */
export class SiteService {
  constructor(
    private readonly repo: SitesRepo,
    private readonly store: SiteFileStore
  ) {}

  /* ---------------------------------------------------------------- *
   * Sites
   * ---------------------------------------------------------------- */

  async createSite(request: CreateSiteRequest): Promise<SiteDetail> {
    const title = request.title.trim() || 'Untitled site';
    const siteId = randomUUID();

    this.repo.createSite({
      id: siteId,
      title,
      slug: slugifySiteTitle(title),
      sourceConversationId: request.sourceConversationId ?? null,
    });

    const seed: SiteFileInput[] = request.files?.length
      ? request.files
      : [
          { path: SITE_ENTRY_FILE, contents: DEFAULT_INDEX_HTML },
          { path: 'styles.css', contents: DEFAULT_STYLES_CSS },
        ];

    const draft = await this.createDraftVersion(siteId, null);
    for (const file of seed) {
      await this.writeDraftFile(siteId, file.path, file.contents, draft.id);
    }

    this.recordEvent(siteId, draft.id, 'site.created', { title, fileCount: seed.length });

    const detail = this.repo.getDetail(siteId);
    if (!detail) throw new SiteServiceError('Site vanished after creation', 'site_missing');
    return detail;
  }

  listSites(includeDeleted = false): SiteSummary[] {
    return this.repo.listSites({ includeDeleted });
  }

  getDetail(siteId: string): SiteDetail {
    const detail = this.repo.getDetail(siteId);
    if (!detail) throw new SiteServiceError(`Unknown site ${siteId}`, 'site_missing');
    return detail;
  }

  renameSite(siteId: string, title: string): SiteDetail {
    const trimmed = title.trim();
    if (!trimmed) throw new SiteServiceError('Site title cannot be empty', 'invalid_title');
    this.repo.renameSite(siteId, trimmed, slugifySiteTitle(trimmed));
    this.recordEvent(siteId, null, 'site.renamed', { title: trimmed });
    return this.getDetail(siteId);
  }

  deleteSite(siteId: string): void {
    this.repo.softDeleteSite(siteId);
    this.recordEvent(siteId, null, 'site.deleted', null);
  }

  restoreSite(siteId: string): SiteDetail {
    this.repo.restoreSite(siteId);
    this.recordEvent(siteId, null, 'site.restored', null);
    return this.getDetail(siteId);
  }

  async purgeSite(siteId: string): Promise<void> {
    await this.store.removeSite(siteId);
    this.repo.purgeSite(siteId);
  }

  /* ---------------------------------------------------------------- *
   * Draft editing
   * ---------------------------------------------------------------- */

  /** Return the site's draft version, creating one from the current version if needed. */
  async ensureDraft(siteId: string): Promise<SiteVersionSummary> {
    const site = this.requireSite(siteId);
    if (site.draftVersionId) {
      const draft = this.repo.getVersion(site.draftVersionId);
      if (draft) return draft;
    }
    return this.createDraftVersion(siteId, site.currentVersionId);
  }

  async writeFile(siteId: string, path: string, contents: string): Promise<SiteDetail> {
    const draft = await this.ensureDraft(siteId);
    await this.writeDraftFile(siteId, path, contents, draft.id);
    this.repo.touchSite(siteId);
    this.recordEvent(siteId, draft.id, 'file.written', { path: normalizeSitePath(path) });
    return this.getDetail(siteId);
  }

  async deleteFile(siteId: string, path: string): Promise<SiteDetail> {
    const draft = await this.ensureDraft(siteId);
    const normalized = normalizeSitePath(path);
    if (!normalized) throw new SiteServiceError(`Invalid path: ${path}`, 'invalid_path');

    await this.store.deleteSiteFile(siteId, draft.id, normalized);
    this.repo.deleteFile(draft.id, normalized);
    this.repo.updateVersionState(draft.id, 'draft', { validation: null });
    this.repo.touchSite(siteId);
    this.recordEvent(siteId, draft.id, 'file.deleted', { path: normalized });
    return this.getDetail(siteId);
  }

  async readFile(siteId: string, path: string, versionId?: string | null): Promise<string> {
    const targetId = versionId ?? (await this.ensureDraft(siteId)).id;
    const normalized = normalizeSitePath(path);
    if (!normalized) throw new SiteServiceError(`Invalid path: ${path}`, 'invalid_path');
    if (!isTextSiteFile(normalized)) {
      throw new SiteServiceError(`"${normalized}" is a binary asset and cannot be read as text`, 'binary_file');
    }
    return this.store.readSiteTextFile(siteId, targetId, normalized);
  }

  /* ---------------------------------------------------------------- *
   * Build & review
   * ---------------------------------------------------------------- */

  /**
   * Validate the draft against the runtime policy and record the outcome.
   * A draft only becomes previewable once it builds clean.
   */
  async buildDraft(siteId: string): Promise<SiteDetail> {
    const draft = await this.ensureDraft(siteId);
    this.repo.updateVersionState(draft.id, 'building');

    const validation = await this.validateVersion(siteId, draft.id);
    const buildLog = this.formatBuildLog(validation);

    this.repo.updateVersionState(draft.id, validation.ok ? 'preview_ready' : 'build_failed', {
      buildLog,
      validation,
    });
    this.repo.touchSite(siteId);
    this.recordEvent(siteId, draft.id, validation.ok ? 'build.succeeded' : 'build.failed', {
      errors: validation.errors.length,
      warnings: validation.warnings.length,
    });

    return this.getDetail(siteId);
  }

  async getReviewChecklist(siteId: string): Promise<SiteReviewChecklist> {
    const draft = await this.ensureDraft(siteId);
    const validation = await this.validateVersion(siteId, draft.id);
    const files = this.repo.listFiles(draft.id);

    const externalHosts = [
      ...new Set(
        validation.warnings
          .filter((warning) => warning.code === 'external_resource')
          .map((warning) => warning.message.replace(/^.*loads from ([^.]*\S+?)\..*$/, '$1'))
      ),
    ];

    const blockingReasons = validation.errors.map((error) =>
      error.path ? `${error.path}: ${error.message}` : error.message
    );
    if (validation.warnings.length > 0) {
      blockingReasons.push(
        `${validation.warnings.length} warning(s) require acknowledgement before publish.`
      );
    }

    return {
      siteId,
      versionId: draft.id,
      validation,
      hasEntryFile: files.some((file) => file.path === SITE_ENTRY_FILE),
      fileCount: validation.fileCount,
      totalBytes: validation.totalBytes,
      externalHosts,
      canPublish: validation.ok && validation.warnings.length === 0,
      blockingReasons,
    };
  }

  /* ---------------------------------------------------------------- *
   * Publish / rollback
   * ---------------------------------------------------------------- */

  async publish(
    siteId: string,
    options: { label?: string | null; acknowledgedWarnings?: SiteViolationCode[] } = {}
  ): Promise<SiteDetail> {
    const draft = await this.ensureDraft(siteId);
    const validation = await this.validateVersion(siteId, draft.id);

    if (!validation.ok) {
      this.repo.updateVersionState(draft.id, 'build_failed', {
        buildLog: this.formatBuildLog(validation),
        validation,
      });
      throw new SiteServiceError(
        `Cannot publish: ${validation.errors.length} blocking issue(s). Fix them and rebuild.`,
        'validation_failed'
      );
    }

    const acknowledged = new Set(options.acknowledgedWarnings ?? []);
    const unacknowledged = validation.warnings.filter((warning) => !acknowledged.has(warning.code));
    if (unacknowledged.length > 0) {
      throw new SiteServiceError(
        `Cannot publish: ${unacknowledged.length} warning(s) need review before sharing.`,
        'unacknowledged_warnings'
      );
    }

    // Promote the draft in place. Its directory is now frozen: the draft
    // pointer moves to a fresh copy, so nothing writes here again.
    this.repo.updateVersionState(draft.id, 'published', {
      buildLog: this.formatBuildLog(validation),
      validation,
    });
    this.repo.markVersionPublished(draft.id, options.label ?? null);
    this.repo.setCurrentVersion(siteId, draft.id);
    this.repo.setSiteStatus(siteId, 'published');

    const nextDraft = await this.createDraftVersion(siteId, draft.id);
    this.recordEvent(siteId, draft.id, 'site.published', {
      versionNo: draft.versionNo,
      label: options.label ?? null,
      nextDraftId: nextDraft.id,
    });

    return this.getDetail(siteId);
  }

  unpublish(siteId: string): SiteDetail {
    const site = this.requireSite(siteId);
    if (site.status !== 'published') {
      throw new SiteServiceError('Site is not published', 'not_published');
    }
    this.repo.setSiteStatus(siteId, 'unpublished');
    this.recordEvent(siteId, site.currentVersionId, 'site.unpublished', null);
    return this.getDetail(siteId);
  }

  /**
   * Roll back by publishing a new version whose bytes are copied from an
   * older one. Non-destructive: the existing draft is left untouched.
   */
  async rollback(siteId: string, versionId: string): Promise<SiteDetail> {
    const site = this.requireSite(siteId);
    const target = this.repo.getVersion(versionId);

    if (!target || target.siteId !== siteId) {
      throw new SiteServiceError(`Unknown version ${versionId}`, 'version_missing');
    }
    if (target.isDraft) {
      throw new SiteServiceError('Cannot roll back to the working draft', 'invalid_rollback_target');
    }
    if (target.id === site.currentVersionId) {
      throw new SiteServiceError('That version is already live', 'already_current');
    }

    const restoredId = randomUUID();
    const versionNo = this.repo.nextVersionNumber(siteId);
    await this.store.copyVersion(siteId, target.id, restoredId);

    this.repo.createVersion({
      id: restoredId,
      siteId,
      versionNo,
      label: `Rollback to v${target.versionNo}`,
      state: 'published',
      isDraft: false,
      filesRoot: this.store.versionDirectory(siteId, restoredId),
    });
    this.repo.replaceFiles(restoredId, await this.store.listSiteFiles(siteId, restoredId));
    this.repo.updateVersionState(restoredId, 'published', { validation: target.validation });
    this.repo.markVersionPublished(restoredId, `Rollback to v${target.versionNo}`);
    this.repo.setCurrentVersion(siteId, restoredId);
    this.repo.setSiteStatus(siteId, 'published');

    this.recordEvent(siteId, restoredId, 'site.rolled_back', {
      fromVersionNo: target.versionNo,
      newVersionNo: versionNo,
    });

    return this.getDetail(siteId);
  }

  /** Destructive: replace the working draft with the contents of a version. */
  async resetDraftTo(siteId: string, versionId: string): Promise<SiteDetail> {
    const target = this.repo.getVersion(versionId);
    if (!target || target.siteId !== siteId) {
      throw new SiteServiceError(`Unknown version ${versionId}`, 'version_missing');
    }

    const site = this.requireSite(siteId);
    const previousDraftId = site.draftVersionId;

    const draft = await this.createDraftVersion(siteId, versionId);

    if (previousDraftId && previousDraftId !== draft.id) {
      await this.store.removeVersion(siteId, previousDraftId);
      this.repo.updateVersionState(previousDraftId, 'archived');
    }

    this.recordEvent(siteId, draft.id, 'draft.reset', { fromVersionNo: target.versionNo });
    return this.getDetail(siteId);
  }

  /* ---------------------------------------------------------------- *
   * Preview / export support
   * ---------------------------------------------------------------- */

  /** Resolve which version a preview or export should serve. */
  resolveServableVersion(siteId: string, versionId?: string | null): SiteVersionSummary {
    const site = this.requireSite(siteId);
    const targetId = versionId ?? site.draftVersionId ?? site.currentVersionId;
    if (!targetId) {
      throw new SiteServiceError('Site has no version to serve', 'version_missing');
    }
    const version = this.repo.getVersion(targetId);
    if (!version || version.siteId !== siteId) {
      throw new SiteServiceError(`Unknown version ${targetId}`, 'version_missing');
    }
    return version;
  }

  async exportVersionTo(siteId: string, versionId: string, destination: string): Promise<void> {
    await this.store.exportVersionTo(siteId, versionId, destination);
    this.recordEvent(siteId, versionId, 'site.exported', { destination });
  }

  listFiles(versionId: string): SiteFileMeta[] {
    return this.repo.listFiles(versionId);
  }

  async readTextFile(siteId: string, versionId: string, path: string): Promise<string> {
    return this.store.readSiteTextFile(siteId, versionId, path);
  }

  recordEvent(
    siteId: string,
    versionId: string | null,
    eventType: string,
    detail: Record<string, unknown> | null
  ): void {
    this.repo.recordEvent({ id: randomUUID(), siteId, versionId, eventType, detail });
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private requireSite(siteId: string): SiteSummary {
    const site = this.repo.getSite(siteId);
    if (!site) throw new SiteServiceError(`Unknown site ${siteId}`, 'site_missing');
    return site;
  }

  private async createDraftVersion(
    siteId: string,
    seedVersionId: string | null
  ): Promise<SiteVersionSummary> {
    const draftId = randomUUID();
    const versionNo = this.repo.nextVersionNumber(siteId);

    if (seedVersionId) {
      await this.store.copyVersion(siteId, seedVersionId, draftId);
    } else {
      await this.store.ensureVersionDirectory(siteId, draftId);
    }

    const draft = this.repo.createVersion({
      id: draftId,
      siteId,
      versionNo,
      label: null,
      state: 'draft',
      isDraft: true,
      filesRoot: this.store.versionDirectory(siteId, draftId),
    });

    this.repo.replaceFiles(draftId, await this.store.listSiteFiles(siteId, draftId));
    this.repo.setDraftVersion(siteId, draftId);

    const refreshed = this.repo.getVersion(draftId);
    return refreshed ?? draft;
  }

  private async writeDraftFile(
    siteId: string,
    path: string,
    contents: string,
    draftId: string
  ): Promise<void> {
    const meta = await this.store.writeSiteFile(siteId, draftId, path, contents);
    this.repo.upsertFile(draftId, meta);
    // Any edit invalidates the previous build result.
    this.repo.updateVersionState(draftId, 'draft', { validation: null });
  }

  private async validateVersion(siteId: string, versionId: string): Promise<SiteValidationResult> {
    const files = await this.store.listSiteFiles(siteId, versionId);

    const inputs: SiteFileInput[] = [];
    for (const file of files) {
      if (isTextSiteFile(file.path)) {
        inputs.push({
          path: file.path,
          contents: await this.store.readSiteTextFile(siteId, versionId, file.path),
          byteSize: file.byteSize,
        });
      } else {
        inputs.push({ path: file.path, contents: '', byteSize: file.byteSize });
      }
    }

    // Keep metadata in step with what is actually on disk before validating.
    this.repo.replaceFiles(versionId, files);

    return validateSiteArtifact(inputs, ATLAS_SITE_POLICY);
  }

  private formatBuildLog(validation: SiteValidationResult): string {
    const lines: string[] = [
      `${validation.fileCount} file(s), ${validation.totalBytes} bytes`,
      `${validation.errors.length} error(s), ${validation.warnings.length} warning(s)`,
    ];
    for (const error of validation.errors) {
      lines.push(`ERROR ${error.path ?? '(site)'} — ${error.message}`);
    }
    for (const warning of validation.warnings) {
      lines.push(`WARN  ${warning.path ?? '(site)'} — ${warning.message}`);
    }
    return lines.join('\n');
  }
}
