import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { SitesRepo } from '../src/main/db/repositories/sitesRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { SiteExporter } from '../src/main/sites/SiteExporter.js';
import { SiteFileStore } from '../src/main/sites/SiteFileStore.js';
import { SiteService } from '../src/main/sites/SiteService.js';
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
  const exporter = new SiteExporter(service);

  return {
    service,
    store,
    exporter,
    tempDir,
    cleanup: () => {
      raw.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('analyzeWorkspace accurately detects dependencies and lockfile package manager', async (t) => {
  const { cleanup, service, exporter, tempDir } = createHarness('atlas-export-analyze-');
  t.after(cleanup);

  // 1. Create a dummy project directory with package.json and pnpm lockfile
  const projectDir = join(tempDir, 'my-react-app');
  mkdirSync(join(projectDir, 'src', 'components'), { recursive: true });
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({
      name: 'my-react-app',
      dependencies: {
        tailwindcss: '^3.4.0',
        clsx: '^2.0.0',
      },
    })
  );
  writeFileSync(join(projectDir, 'pnpm-lock.yaml'), '');

  // 2. Create a site with files that import lucide-react, clsx, and tailwindcss
  const created = await service.createSite({
    title: 'Landing Hero',
    files: [
      {
        path: SITE_ENTRY_FILE,
        contents: `<!doctype html>
<html>
  <head>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div class="bg-blue-500" data-lucide="sparkles">Sparkles</div>
  </body>
</html>`,
      },
      {
        path: 'app.js',
        contents: `import { Sparkles } from "lucide-react";
import clsx from "clsx";
console.log(Sparkles, clsx);`,
      },
    ],
  });

  // 3. Analyze workspace
  const analysis = await exporter.analyzeWorkspace({
    siteId: created.site.id,
    projectRoot: projectDir,
  });

  assert.equal(analysis.projectTitle, 'my-react-app');
  assert.equal(analysis.packageJsonFound, true);
  assert.equal(analysis.packageManager, 'pnpm');
  assert.equal(analysis.defaultExportSubpath, 'src/components/design/landing-hero');

  // Verify installed vs missing
  const tailwindPkg = analysis.detectedPackages.find((p) => p.name === 'tailwindcss');
  const clsxPkg = analysis.detectedPackages.find((p) => p.name === 'clsx');
  const lucidePkg = analysis.detectedPackages.find((p) => p.name === 'lucide-react');

  assert.ok(tailwindPkg, 'tailwindcss should be detected');
  assert.equal(tailwindPkg.installed, true);

  assert.ok(clsxPkg, 'clsx should be detected');
  assert.equal(clsxPkg.installed, true);

  assert.ok(lucidePkg, 'lucide-react should be detected');
  assert.equal(lucidePkg.installed, false);

  // Missing packages list & pnpm install command
  assert.deepEqual(analysis.missingPackages, ['lucide-react']);
  assert.equal(analysis.installCommand, 'pnpm add lucide-react');
});

test('exportToWorkspace safely writes files into project subpath and prevents traversal', async (t) => {
  const { cleanup, service, exporter, tempDir } = createHarness('atlas-export-write-');
  t.after(cleanup);

  const projectDir = join(tempDir, 'target-project');
  mkdirSync(projectDir, { recursive: true });

  const created = await service.createSite({
    title: 'Dashboard Widget',
    files: [
      { path: SITE_ENTRY_FILE, contents: '<h1>Dashboard Widget</h1>' },
      { path: 'style.css', contents: 'body { margin: 0; }' },
    ],
  });

  // Export to valid subpath
  const result = await exporter.exportToWorkspace({
    siteId: created.site.id,
    projectRoot: projectDir,
    subpath: 'src/components/design/widget',
  });

  assert.equal(result.writtenFiles.length, 2);
  assert.ok(result.writtenFiles.includes('index.html'));
  assert.ok(result.writtenFiles.includes('style.css'));
  assert.ok(result.totalBytes > 0);

  // Verify written files on disk
  const indexHtml = await readFile(join(result.destination, 'index.html'), 'utf-8');
  assert.equal(indexHtml, '<h1>Dashboard Widget</h1>');

  // Traversal attack prevention: attempting to escape projectRoot must throw
  await assert.rejects(
    async () => {
      await exporter.exportToWorkspace({
        siteId: created.site.id,
        projectRoot: projectDir,
        subpath: '../../sneaky-folder',
      });
    },
    /inside the project root/
  );
});

test("analyzeWorkspace handles bun and yarn package managers correctly", async (t) => {
  const { cleanup, service, exporter, tempDir } = createHarness("atlas-export-pm-");
  t.after(cleanup);

  // Yarn app
  const yarnDir = join(tempDir, "yarn-app");
  mkdirSync(yarnDir, { recursive: true });
  writeFileSync(join(yarnDir, "package.json"), JSON.stringify({ name: "yarn-app" }));
  writeFileSync(join(yarnDir, "yarn.lock"), "");

  // Bun app
  const bunDir = join(tempDir, "bun-app");
  mkdirSync(bunDir, { recursive: true });
  writeFileSync(join(bunDir, "package.json"), JSON.stringify({ name: "bun-app" }));
  writeFileSync(join(bunDir, "bun.lockb"), "");

  const created = await service.createSite({
    title: "Cards",
    files: [
      {
        path: SITE_ENTRY_FILE,
        contents: "<script>import { motion } from 'framer-motion';</script>",
      },
    ],
  });

  const yarnAnalysis = await exporter.analyzeWorkspace({
    siteId: created.site.id,
    projectRoot: yarnDir,
  });
  assert.equal(yarnAnalysis.packageManager, "yarn");
  assert.equal(yarnAnalysis.installCommand, "yarn add framer-motion");

  const bunAnalysis = await exporter.analyzeWorkspace({
    siteId: created.site.id,
    projectRoot: bunDir,
  });
  assert.equal(bunAnalysis.packageManager, "bun");
  assert.equal(bunAnalysis.installCommand, "bun add framer-motion");
});
