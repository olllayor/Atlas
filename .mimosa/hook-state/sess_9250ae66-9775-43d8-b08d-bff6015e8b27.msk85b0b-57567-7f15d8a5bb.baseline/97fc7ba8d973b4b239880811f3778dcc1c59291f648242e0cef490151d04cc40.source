import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { SitesRepo } from '../src/main/db/repositories/sitesRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { SiteFileStore } from '../src/main/sites/SiteFileStore.js';
import { SiteService, SiteServiceError } from '../src/main/sites/SiteService.js';
import { SITE_ENTRY_FILE } from '../src/shared/sites.js';

function createHarness(prefix: string) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as SqliteDatabase;

  applySchema(database);

  const store = new SiteFileStore(join(tempDir, 'sites'));
  const service = new SiteService(new SitesRepo(database), store);

  return {
    service,
    store,
    cleanup: () => {
      raw.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const PAGE = '<!doctype html><html><head><title>Hi</title></head><body><h1>Hi</h1></body></html>';

test('createSite seeds a draft with an entry file', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-create-');
  t.after(cleanup);

  const detail = await service.createSite({ title: 'Launch page' });

  assert.equal(detail.site.title, 'Launch page');
  assert.equal(detail.site.slug, 'launch-page');
  assert.equal(detail.site.status, 'draft');
  assert.ok(detail.draft);
  assert.equal(detail.draft?.isDraft, true);
  assert.ok(detail.files.some((file) => file.path === SITE_ENTRY_FILE));
  assert.equal(detail.site.currentVersionId, null);
});

test('writeFile updates draft metadata and invalidates the previous build', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-write-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });
  const built = await service.buildDraft(created.site.id);
  assert.equal(built.draft?.state, 'preview_ready');

  const afterWrite = await service.writeFile(created.site.id, 'assets/app.css', 'body{color:red}');

  assert.equal(afterWrite.draft?.state, 'draft', 'an edit must invalidate the previous build result');
  assert.equal(afterWrite.draft?.validation, null);
  assert.ok(afterWrite.files.some((file) => file.path === 'assets/app.css'));
  assert.equal(await service.readFile(created.site.id, 'assets/app.css'), 'body{color:red}');
});

test('writeFile refuses to escape the site root', async (t) => {
  const { cleanup, service, store } = createHarness('atlas-site-escape-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site' });
  const siteId = created.site.id;

  await assert.rejects(() => service.writeFile(siteId, '../escaped.html', 'nope'));
  await assert.rejects(() => service.writeFile(siteId, 'assets/../../escaped.html', 'nope'));
  await assert.rejects(() => service.writeFile(siteId, 'assets\\escaped.html', 'nope'));

  // A leading slash is root-relative, so it lands inside the version directory.
  const detail = await service.writeFile(siteId, '/nested/page.html', '<p>ok</p>');
  assert.ok(detail.files.some((file) => file.path === 'nested/page.html'));

  const absolute = store.resolveFilePath(siteId, detail.draft!.id, 'nested/page.html');
  assert.ok(absolute.startsWith(store.versionDirectory(siteId, detail.draft!.id)));
});

test('buildDraft reports blocking errors without throwing', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-build-fail-');
  t.after(cleanup);

  const created = await service.createSite({
    title: 'Broken',
    files: [
      { path: SITE_ENTRY_FILE, contents: PAGE },
      { path: 'app.js', contents: 'const key = process.env.SECRET;' },
    ],
  });

  const detail = await service.buildDraft(created.site.id);

  assert.equal(detail.draft?.state, 'build_failed');
  assert.equal(detail.draft?.validation?.ok, false);
  assert.ok(detail.draft?.validation?.errors.some((error) => error.code === 'server_code'));
  assert.match(detail.draft?.buildLog ?? '', /ERROR app\.js/);
});

test('publish is blocked by validation errors', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-publish-block-');
  t.after(cleanup);

  const created = await service.createSite({
    title: 'Broken',
    files: [{ path: 'about.html', contents: PAGE }],
  });

  await assert.rejects(
    () => service.publish(created.site.id),
    (error: SiteServiceError) => error.code === 'validation_failed'
  );
});

test('publish is blocked until warnings are acknowledged', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-publish-warn-');
  t.after(cleanup);

  const created = await service.createSite({
    title: 'CDN site',
    files: [
      {
        path: SITE_ENTRY_FILE,
        contents: '<!doctype html><script src="https://cdn.example.com/a.js"></script>',
      },
    ],
  });

  await assert.rejects(
    () => service.publish(created.site.id),
    (error: SiteServiceError) => error.code === 'unacknowledged_warnings'
  );

  const published = await service.publish(created.site.id, {
    acknowledgedWarnings: ['external_resource'],
  });
  assert.equal(published.site.status, 'published');
});

test('publishing freezes the version and seeds a fresh draft', async (t) => {
  const { cleanup, service, store } = createHarness('atlas-site-publish-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });
  const published = await service.publish(created.site.id, { label: 'v1 launch' });

  const publishedVersion = published.current;
  assert.ok(publishedVersion);
  assert.equal(publishedVersion?.state, 'published');
  assert.equal(publishedVersion?.isDraft, false);
  assert.equal(publishedVersion?.label, 'v1 launch');
  assert.ok(publishedVersion?.publishedAt);

  // The new draft is a distinct directory seeded from the published bytes.
  assert.ok(published.draft);
  assert.notEqual(published.draft?.id, publishedVersion?.id);
  assert.equal(
    await store.readSiteTextFile(created.site.id, published.draft!.id, SITE_ENTRY_FILE),
    PAGE
  );

  // Editing the draft must not touch the published bytes.
  await service.writeFile(created.site.id, SITE_ENTRY_FILE, '<!doctype html><p>changed</p>');
  assert.equal(
    await store.readSiteTextFile(created.site.id, publishedVersion!.id, SITE_ENTRY_FILE),
    PAGE,
    'published versions must be immutable'
  );
});

test('rollback publishes a copy of an older version and leaves the draft alone', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-rollback-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });
  const siteId = created.site.id;

  const firstPublish = await service.publish(siteId, { label: 'one' });
  const firstVersionId = firstPublish.current!.id;

  await service.writeFile(siteId, SITE_ENTRY_FILE, '<!doctype html><p>second</p>');
  const secondPublish = await service.publish(siteId, { label: 'two' });
  assert.notEqual(secondPublish.current!.id, firstVersionId);

  await service.writeFile(siteId, 'draft-only.html', '<!doctype html><p>wip</p>');

  const rolledBack = await service.rollback(siteId, firstVersionId);

  assert.equal(rolledBack.site.status, 'published');
  assert.notEqual(rolledBack.current!.id, firstVersionId, 'rollback creates a new version');
  assert.match(rolledBack.current!.label ?? '', /Rollback to v/);
  assert.equal(await service.readFile(siteId, SITE_ENTRY_FILE, rolledBack.current!.id), PAGE);
  assert.ok(
    rolledBack.files.some((file) => file.path === 'draft-only.html'),
    'the working draft survives a rollback'
  );
});

test('rollback rejects the working draft as a target', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-rollback-guard-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });

  await assert.rejects(
    () => service.rollback(created.site.id, created.draft!.id),
    (error: SiteServiceError) => error.code === 'invalid_rollback_target'
  );
});

test('deleteFile removes bytes and metadata together', async (t) => {
  const { cleanup, service, store } = createHarness('atlas-site-delete-file-');
  t.after(cleanup);

  const created = await service.createSite({
    title: 'Site',
    files: [
      { path: SITE_ENTRY_FILE, contents: PAGE },
      { path: 'extra.css', contents: 'body{}' },
    ],
  });

  const detail = await service.deleteFile(created.site.id, 'extra.css');

  assert.ok(!detail.files.some((file) => file.path === 'extra.css'));
  await assert.rejects(() => store.readSiteTextFile(created.site.id, detail.draft!.id, 'extra.css'));
});

test('export copies the served version to a destination directory', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-export-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });
  const published = await service.publish(created.site.id);

  const destination = mkdtempSync(join(tmpdir(), 'atlas-site-export-out-'));
  t.after(() => rmSync(destination, { recursive: true, force: true }));

  await service.exportVersionTo(created.site.id, published.current!.id, destination);

  assert.equal(await readFile(join(destination, SITE_ENTRY_FILE), 'utf8'), PAGE);
});

test('deleted sites drop out of the default listing and can be restored', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-delete-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site' });
  service.deleteSite(created.site.id);

  assert.equal(service.listSites().length, 0);
  assert.equal(service.listSites(true).length, 1);

  const restored = service.restoreSite(created.site.id);
  assert.equal(restored.site.status, 'draft');
  assert.equal(restored.site.deletedAt, null);
  assert.equal(service.listSites().length, 1);
});

test('audit events record the lifecycle', async (t) => {
  const { cleanup, service } = createHarness('atlas-site-events-');
  t.after(cleanup);

  const created = await service.createSite({ title: 'Site', files: [{ path: SITE_ENTRY_FILE, contents: PAGE }] });
  await service.buildDraft(created.site.id);
  const published = await service.publish(created.site.id);

  const types = published.events.map((event) => event.eventType);
  assert.ok(types.includes('site.created'));
  assert.ok(types.includes('build.succeeded'));
  assert.ok(types.includes('site.published'));
});
