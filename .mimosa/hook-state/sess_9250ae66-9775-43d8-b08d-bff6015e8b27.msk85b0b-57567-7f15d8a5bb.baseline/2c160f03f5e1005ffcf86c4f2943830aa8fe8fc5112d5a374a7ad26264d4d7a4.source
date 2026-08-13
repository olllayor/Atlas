import type {
  SiteDetail,
  SiteEventRecord,
  SiteFileMeta,
  SiteStatus,
  SiteSummary,
  SiteValidationResult,
  SiteVersionState,
  SiteVersionSummary,
} from '../../../shared/sites';
import type { SqliteDatabase } from '../client';

type SiteRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  draft_version_id: string | null;
  current_version_id: string | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type SiteVersionRow = {
  id: string;
  site_id: string;
  version_no: number;
  label: string | null;
  state: string;
  is_draft: number;
  files_root: string;
  file_count: number;
  total_bytes: number;
  build_log: string | null;
  validation_json: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type SiteFileRow = {
  path: string;
  byte_size: number;
  mime: string;
  sha256: string;
};

type SiteEventRow = {
  id: string;
  site_id: string;
  version_id: string | null;
  event_type: string;
  detail_json: string | null;
  created_at: string;
};

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapSite(row: SiteRow): SiteSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status as SiteStatus,
    draftVersionId: row.draft_version_id,
    currentVersionId: row.current_version_id,
    sourceConversationId: row.source_conversation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapVersion(row: SiteVersionRow): SiteVersionSummary {
  return {
    id: row.id,
    siteId: row.site_id,
    versionNo: row.version_no,
    label: row.label,
    state: row.state as SiteVersionState,
    isDraft: row.is_draft === 1,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    buildLog: row.build_log,
    validation: parseJson<SiteValidationResult>(row.validation_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

function mapEvent(row: SiteEventRow): SiteEventRecord {
  return {
    id: row.id,
    siteId: row.site_id,
    versionId: row.version_id,
    eventType: row.event_type,
    detail: parseJson<Record<string, unknown>>(row.detail_json),
    createdAt: row.created_at,
  };
}

const SITE_COLUMNS = `
  id, title, slug, status, draft_version_id, current_version_id,
  source_conversation_id, created_at, updated_at, deleted_at
`;

const VERSION_COLUMNS = `
  id, site_id, version_no, label, state, is_draft, files_root,
  file_count, total_bytes, build_log, validation_json,
  created_at, updated_at, published_at
`;

export class SitesRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /* ---------------------------------------------------------------- *
   * Sites
   * ---------------------------------------------------------------- */

  createSite(input: {
    id: string;
    title: string;
    slug: string;
    sourceConversationId: string | null;
  }): SiteSummary {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO sites (
            id, title, slug, status, draft_version_id, current_version_id,
            source_conversation_id, created_at, updated_at, deleted_at
          ) VALUES (
            @id, @title, @slug, 'draft', NULL, NULL,
            @sourceConversationId, @createdAt, @updatedAt, NULL
          )
        `
      )
      .run({
        id: input.id,
        title: input.title,
        slug: input.slug,
        sourceConversationId: input.sourceConversationId,
        createdAt: now,
        updatedAt: now,
      });

    const site = this.getSite(input.id);
    if (!site) throw new Error(`Failed to create site ${input.id}`);
    return site;
  }

  getSite(id: string): SiteSummary | null {
    const row = this.db
      .prepare<{ id: string }, SiteRow>(`SELECT ${SITE_COLUMNS} FROM sites WHERE id = @id`)
      .get({ id });
    return row ? mapSite(row) : null;
  }

  /** True when a conversation already owns a site, so its tools stay loaded. */
  hasSiteForConversation(conversationId: string): boolean {
    const row = this.db
      .prepare<{ conversationId: string }, { total: number }>(
        `
          SELECT COUNT(*) AS total
          FROM sites
          WHERE source_conversation_id = @conversationId AND deleted_at IS NULL
        `
      )
      .get({ conversationId });
    return (row?.total ?? 0) > 0;
  }

  listSites(options: { includeDeleted?: boolean; limit?: number } = {}): SiteSummary[] {
    const { includeDeleted = false, limit = 200 } = options;
    const rows = this.db
      .prepare<{ limit: number }, SiteRow>(
        `
          SELECT ${SITE_COLUMNS}
          FROM sites
          ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
          ORDER BY updated_at DESC
          LIMIT @limit
        `
      )
      .all({ limit });
    return rows.map(mapSite);
  }

  renameSite(id: string, title: string, slug: string): SiteSummary | null {
    this.db
      .prepare(`UPDATE sites SET title = @title, slug = @slug, updated_at = @updatedAt WHERE id = @id`)
      .run({ id, title, slug, updatedAt: new Date().toISOString() });
    return this.getSite(id);
  }

  setSiteStatus(id: string, status: SiteStatus): void {
    this.db
      .prepare(`UPDATE sites SET status = @status, updated_at = @updatedAt WHERE id = @id`)
      .run({ id, status, updatedAt: new Date().toISOString() });
  }

  setDraftVersion(siteId: string, versionId: string | null): void {
    this.db
      .prepare(
        `UPDATE sites SET draft_version_id = @versionId, updated_at = @updatedAt WHERE id = @siteId`
      )
      .run({ siteId, versionId, updatedAt: new Date().toISOString() });
  }

  setCurrentVersion(siteId: string, versionId: string | null): void {
    this.db
      .prepare(
        `UPDATE sites SET current_version_id = @versionId, updated_at = @updatedAt WHERE id = @siteId`
      )
      .run({ siteId, versionId, updatedAt: new Date().toISOString() });
  }

  touchSite(siteId: string): void {
    this.db
      .prepare(`UPDATE sites SET updated_at = @updatedAt WHERE id = @siteId`)
      .run({ siteId, updatedAt: new Date().toISOString() });
  }

  /** Soft delete: the row and its files survive so the site can be restored. */
  softDeleteSite(id: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sites SET status = 'deleted', deleted_at = @now, updated_at = @now WHERE id = @id`
      )
      .run({ id, now });
  }

  restoreSite(id: string): SiteSummary | null {
    const site = this.getSite(id);
    if (!site) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE sites SET status = @status, deleted_at = NULL, updated_at = @now WHERE id = @id`
      )
      .run({ id, now, status: site.currentVersionId ? 'published' : 'draft' });
    return this.getSite(id);
  }

  /** Hard delete. Callers must remove the on-disk files separately. */
  purgeSite(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM sites WHERE id = @id`).run({ id });
    return result.changes > 0;
  }

  /* ---------------------------------------------------------------- *
   * Versions
   * ---------------------------------------------------------------- */

  nextVersionNumber(siteId: string): number {
    const row = this.db
      .prepare<{ siteId: string }, { next: number }>(
        `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM site_versions WHERE site_id = @siteId`
      )
      .get({ siteId });
    return row?.next ?? 1;
  }

  createVersion(input: {
    id: string;
    siteId: string;
    versionNo: number;
    label: string | null;
    state: SiteVersionState;
    isDraft: boolean;
    filesRoot: string;
  }): SiteVersionSummary {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT INTO site_versions (
            id, site_id, version_no, label, state, is_draft, files_root,
            file_count, total_bytes, build_log, validation_json,
            created_at, updated_at, published_at
          ) VALUES (
            @id, @siteId, @versionNo, @label, @state, @isDraft, @filesRoot,
            0, 0, NULL, NULL,
            @createdAt, @updatedAt, NULL
          )
        `
      )
      .run({
        id: input.id,
        siteId: input.siteId,
        versionNo: input.versionNo,
        label: input.label,
        state: input.state,
        isDraft: input.isDraft ? 1 : 0,
        filesRoot: input.filesRoot,
        createdAt: now,
        updatedAt: now,
      });

    const version = this.getVersion(input.id);
    if (!version) throw new Error(`Failed to create site version ${input.id}`);
    return version;
  }

  getVersion(id: string): SiteVersionSummary | null {
    const row = this.db
      .prepare<{ id: string }, SiteVersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM site_versions WHERE id = @id`
      )
      .get({ id });
    return row ? mapVersion(row) : null;
  }

  listVersions(siteId: string): SiteVersionSummary[] {
    const rows = this.db
      .prepare<{ siteId: string }, SiteVersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM site_versions WHERE site_id = @siteId ORDER BY version_no DESC`
      )
      .all({ siteId });
    return rows.map(mapVersion);
  }

  updateVersionState(
    id: string,
    state: SiteVersionState,
    options: { buildLog?: string | null; validation?: SiteValidationResult | null } = {}
  ): void {
    const assignments = ['state = @state', 'updated_at = @updatedAt'];
    const params: Record<string, unknown> = { id, state, updatedAt: new Date().toISOString() };

    if (options.buildLog !== undefined) {
      assignments.push('build_log = @buildLog');
      params.buildLog = options.buildLog;
    }
    if (options.validation !== undefined) {
      assignments.push('validation_json = @validationJson');
      params.validationJson = options.validation ? JSON.stringify(options.validation) : null;
    }

    this.db.prepare(`UPDATE site_versions SET ${assignments.join(', ')} WHERE id = @id`).run(params);
  }

  markVersionPublished(id: string, label: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE site_versions
          SET state = 'published', is_draft = 0, label = COALESCE(@label, label),
              published_at = @now, updated_at = @now
          WHERE id = @id
        `
      )
      .run({ id, label, now });
  }

  /** Version rows are immutable once published; this only refreshes derived counts. */
  refreshVersionStats(id: string): void {
    this.db
      .prepare(
        `
          UPDATE site_versions
          SET file_count = (SELECT COUNT(*) FROM site_files WHERE version_id = @id),
              total_bytes = (SELECT COALESCE(SUM(byte_size), 0) FROM site_files WHERE version_id = @id),
              updated_at = @updatedAt
          WHERE id = @id
        `
      )
      .run({ id, updatedAt: new Date().toISOString() });
  }

  /* ---------------------------------------------------------------- *
   * Files
   * ---------------------------------------------------------------- */

  upsertFile(versionId: string, file: SiteFileMeta): void {
    this.db
      .prepare(
        `
          INSERT INTO site_files (version_id, path, byte_size, mime, sha256, updated_at)
          VALUES (@versionId, @path, @byteSize, @mime, @sha256, @updatedAt)
          ON CONFLICT(version_id, path) DO UPDATE SET
            byte_size = excluded.byte_size,
            mime = excluded.mime,
            sha256 = excluded.sha256,
            updated_at = excluded.updated_at
        `
      )
      .run({
        versionId,
        path: file.path,
        byteSize: file.byteSize,
        mime: file.mime,
        sha256: file.sha256,
        updatedAt: new Date().toISOString(),
      });
    this.refreshVersionStats(versionId);
  }

  deleteFile(versionId: string, path: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM site_files WHERE version_id = @versionId AND path = @path`)
      .run({ versionId, path });
    if (result.changes > 0) this.refreshVersionStats(versionId);
    return result.changes > 0;
  }

  listFiles(versionId: string): SiteFileMeta[] {
    const rows = this.db
      .prepare<{ versionId: string }, SiteFileRow>(
        `SELECT path, byte_size, mime, sha256 FROM site_files WHERE version_id = @versionId ORDER BY path`
      )
      .all({ versionId });
    return rows.map((row) => ({
      path: row.path,
      byteSize: row.byte_size,
      mime: row.mime,
      sha256: row.sha256,
    }));
  }

  replaceFiles(versionId: string, files: SiteFileMeta[]): void {
    const run = this.db.transaction((entries: SiteFileMeta[]) => {
      this.db.prepare(`DELETE FROM site_files WHERE version_id = @versionId`).run({ versionId });
      const insert = this.db.prepare(
        `
          INSERT INTO site_files (version_id, path, byte_size, mime, sha256, updated_at)
          VALUES (@versionId, @path, @byteSize, @mime, @sha256, @updatedAt)
        `
      );
      const updatedAt = new Date().toISOString();
      for (const file of entries) {
        insert.run({
          versionId,
          path: file.path,
          byteSize: file.byteSize,
          mime: file.mime,
          sha256: file.sha256,
          updatedAt,
        });
      }
    });
    run(files);
    this.refreshVersionStats(versionId);
  }

  /* ---------------------------------------------------------------- *
   * Audit events
   * ---------------------------------------------------------------- */

  recordEvent(input: {
    id: string;
    siteId: string;
    versionId: string | null;
    eventType: string;
    detail?: Record<string, unknown> | null;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO site_events (id, site_id, version_id, event_type, detail_json, created_at)
          VALUES (@id, @siteId, @versionId, @eventType, @detailJson, @createdAt)
        `
      )
      .run({
        id: input.id,
        siteId: input.siteId,
        versionId: input.versionId,
        eventType: input.eventType,
        detailJson: input.detail ? JSON.stringify(input.detail) : null,
        createdAt: new Date().toISOString(),
      });
  }

  listEvents(siteId: string, limit = 50): SiteEventRecord[] {
    const rows = this.db
      .prepare<{ siteId: string; limit: number }, SiteEventRow>(
        `
          SELECT id, site_id, version_id, event_type, detail_json, created_at
          FROM site_events
          WHERE site_id = @siteId
          ORDER BY created_at DESC
          LIMIT @limit
        `
      )
      .all({ siteId, limit });
    return rows.map(mapEvent);
  }

  /* ---------------------------------------------------------------- *
   * Composites
   * ---------------------------------------------------------------- */

  getDetail(siteId: string): SiteDetail | null {
    const site = this.getSite(siteId);
    if (!site) return null;

    const versions = this.listVersions(siteId);
    const draft = versions.find((version) => version.id === site.draftVersionId) ?? null;
    const current = versions.find((version) => version.id === site.currentVersionId) ?? null;
    const filesVersionId = draft?.id ?? current?.id ?? null;

    return {
      site,
      draft,
      current,
      versions,
      files: filesVersionId ? this.listFiles(filesVersionId) : [],
      events: this.listEvents(siteId),
    };
  }
}
