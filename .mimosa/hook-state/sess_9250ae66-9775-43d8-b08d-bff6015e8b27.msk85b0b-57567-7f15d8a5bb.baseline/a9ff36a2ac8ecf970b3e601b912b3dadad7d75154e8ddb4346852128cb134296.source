import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ATLAS_SITE_POLICY,
  SITE_ENTRY_FILE,
  buildSitePreviewCsp,
  getSiteMimeType,
  isTextSiteFile,
  normalizeSitePath,
  slugifySiteTitle,
  validateSiteArtifact,
} from '../src/shared/sites.js';

const INDEX = { path: SITE_ENTRY_FILE, contents: '<!doctype html><title>ok</title>' };

test('normalizeSitePath strips redundant prefixes and keeps nested paths', () => {
  assert.equal(normalizeSitePath('index.html'), 'index.html');
  assert.equal(normalizeSitePath('./assets/app.css'), 'assets/app.css');
  assert.equal(normalizeSitePath('/assets//app.css'), 'assets/app.css');
  assert.equal(normalizeSitePath('  assets/app.css  '), 'assets/app.css');
});

test('normalizeSitePath rejects every path that could escape the site root', () => {
  const hostile = [
    '../secrets.txt',
    'assets/../../secrets.txt',
    '..',
    '/',
    '',
    'C:/Windows/system.ini',
    'assets\\app.css',
    '//evil.example/app.js',
    'assets/app.css\0.png',
    'bad /file.html',
    'bad./file.html',
  ];

  for (const path of hostile) {
    assert.equal(normalizeSitePath(path), null, `expected ${JSON.stringify(path)} to be rejected`);
  }
});

test('normalizeSitePath treats a leading slash as site-root-relative, not absolute', () => {
  // Generated pages routinely use root-relative URLs. These resolve inside the
  // version directory; they never reach the real filesystem root.
  assert.equal(normalizeSitePath('/etc/passwd'), 'etc/passwd');
  assert.equal(normalizeSitePath('/index.html'), 'index.html');
});

test('normalizeSitePath rejects paths beyond the policy length limit', () => {
  const long = `${'a'.repeat(ATLAS_SITE_POLICY.maxPathLength + 1)}.html`;
  assert.equal(normalizeSitePath(long), null);
});

test('validateSiteArtifact accepts a minimal static site', () => {
  const result = validateSiteArtifact([INDEX, { path: 'styles.css', contents: 'body{margin:0}' }]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.fileCount, 2);
  assert.ok(result.totalBytes > 0);
});

test('validateSiteArtifact requires the entry file', () => {
  const result = validateSiteArtifact([{ path: 'about.html', contents: '<p>hi</p>' }]);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'missing_entry'));
});

test('validateSiteArtifact rejects an empty artifact', () => {
  const result = validateSiteArtifact([]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'empty_artifact');
});

test('validateSiteArtifact rejects unsupported file types', () => {
  const result = validateSiteArtifact([INDEX, { path: 'server.php', contents: '<?php ?>' }]);

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.code === 'unsupported_extension' && error.path === 'server.php')
  );
});

test('validateSiteArtifact rejects server-side code because Atlas has no server runtime', () => {
  const cases = [
    "const fs = require('node:fs');",
    "import { readFile } from 'node:fs/promises';",
    'const key = process.env.SECRET_KEY;',
    'export default async function handler(req, res) {}',
    'module.exports = { x: 1 };',
    'console.log(__dirname);',
  ];

  for (const contents of cases) {
    const result = validateSiteArtifact([INDEX, { path: 'app.js', contents }]);
    assert.equal(result.ok, false, `expected ${contents} to be rejected`);
    assert.ok(result.errors.some((error) => error.code === 'server_code'));
  }
});

test('validateSiteArtifact flags external hosts as warnings, not blockers', () => {
  const result = validateSiteArtifact([
    {
      path: SITE_ENTRY_FILE,
      contents: '<script src="https://cdn.example.com/x.js"></script><link href="https://fonts.example/a.css">',
    },
  ]);

  assert.equal(result.ok, true, 'external references must not block preview');
  assert.equal(result.errors.length, 0);

  const hosts = result.warnings.map((warning) => warning.message);
  assert.ok(hosts.some((message) => message.includes('cdn.example.com')));
  assert.ok(hosts.some((message) => message.includes('fonts.example')));
  assert.ok(result.warnings.every((warning) => warning.code === 'external_resource'));
});

test('validateSiteArtifact honours an allowlisted network host', () => {
  const result = validateSiteArtifact(
    [{ path: SITE_ENTRY_FILE, contents: '<script src="https://cdn.example.com/x.js"></script>' }],
    { ...ATLAS_SITE_POLICY, allowedNetworkHosts: ['cdn.example.com'] }
  );

  assert.equal(result.warnings.length, 0);
});

test('validateSiteArtifact enforces size and count limits', () => {
  const tooMany = Array.from({ length: 4 }, (_, index) => ({
    path: index === 0 ? SITE_ENTRY_FILE : `page-${index}.html`,
    contents: 'x',
  }));

  const countResult = validateSiteArtifact(tooMany, { ...ATLAS_SITE_POLICY, maxFileCount: 2 });
  assert.ok(countResult.errors.some((error) => error.code === 'too_many_files'));

  const sizeResult = validateSiteArtifact([{ ...INDEX, byteSize: 50_000 }], {
    ...ATLAS_SITE_POLICY,
    maxArtifactBytes: 1_000,
    maxFileBytes: 1_000,
  });
  assert.ok(sizeResult.errors.some((error) => error.code === 'file_too_large'));
  assert.ok(sizeResult.errors.some((error) => error.code === 'artifact_too_large'));
});

test('validateSiteArtifact trusts byteSize for binary assets', () => {
  const result = validateSiteArtifact([INDEX, { path: 'logo.png', contents: '', byteSize: 2048 }]);

  assert.equal(result.ok, true);
  assert.equal(result.totalBytes, 2048 + Buffer.byteLength(INDEX.contents, 'utf8'));
});

test('validateSiteArtifact rejects duplicate paths', () => {
  const result = validateSiteArtifact([INDEX, { path: './index.html', contents: 'other' }]);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_path'));
});

test('buildSitePreviewCsp locks the preview origin down by default', () => {
  const csp = buildSitePreviewCsp();

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'none'/);
});

test('mime and text detection follow the extension', () => {
  assert.equal(getSiteMimeType('index.html'), 'text/html; charset=utf-8');
  assert.equal(getSiteMimeType('a/b/logo.png'), 'image/png');
  assert.equal(getSiteMimeType('unknown.bin'), 'application/octet-stream');
  assert.equal(isTextSiteFile('styles.css'), true);
  assert.equal(isTextSiteFile('logo.webp'), false);
});

test('slugifySiteTitle produces a filesystem-safe name', () => {
  assert.equal(slugifySiteTitle('My Launch Page!'), 'my-launch-page');
  assert.equal(slugifySiteTitle('   '), 'untitled-site');
});
