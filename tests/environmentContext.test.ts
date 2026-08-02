import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ProjectDetector } from '../src/main/workspace/ProjectDetector.js';
import { maskEnvValue } from '../src/main/workspace/EnvStore.js';

function makeTempDir() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-detector-test-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('ProjectDetector correctly identifies Node.js / React / Next.js project', () => {
  const { root, cleanup } = makeTempDir();
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'test-app',
        dependencies: { next: '^14.0.0', react: '^18.0.0' }
      })
    );
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');

    const detector = new ProjectDetector();
    const info = detector.detectProjectType(root);

    assert.equal(info.type, 'node');
    assert.equal(info.packageManager, 'pnpm');
    assert.equal(info.framework, 'Next.js');
  } finally {
    cleanup();
  }
});

test('ProjectDetector correctly identifies Python FastAPI project', () => {
  const { root, cleanup } = makeTempDir();
  try {
    writeFileSync(join(root, 'requirements.txt'), 'fastapi\nuvicorn\n');
    writeFileSync(join(root, 'poetry.lock'), '');

    const detector = new ProjectDetector();
    const info = detector.detectProjectType(root);

    assert.equal(info.type, 'python');
    assert.equal(info.packageManager, 'poetry');
    assert.equal(info.framework, 'FastAPI');
  } finally {
    cleanup();
  }
});

test('ProjectDetector detects .env variable keys without values', () => {
  const { root, cleanup } = makeTempDir();
  try {
    writeFileSync(join(root, '.env'), '# Comment\nPORT=3000\nDATABASE_URL=postgres://localhost:5432/db\n');
    writeFileSync(join(root, '.env.local'), 'SECRET_KEY=supersecret\nPORT=3001\n');

    const detector = new ProjectDetector();
    const keys = detector.detectEnvFile(root);

    assert.ok(keys.includes('PORT'));
    assert.ok(keys.includes('DATABASE_URL'));
    assert.ok(keys.includes('SECRET_KEY'));
    assert.equal(keys.includes('supersecret'), false);
  } finally {
    cleanup();
  }
});

test('maskEnvValue correctly masks values', () => {
  assert.equal(maskEnvValue('abc'), '••••');
  assert.equal(maskEnvValue('secret12345'), 'se••••45');
  assert.equal(maskEnvValue(''), '••••');
});
