import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  normalizeIcnsName,
  readAppIcon,
  resolveIcnsPath
} from '../src/main/workspace/AppIconReader.js';

const isMac = process.platform === 'darwin';

function makeBundle(name: string, resources: string[], iconFile?: string) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bundle-'));
  const bundle = join(root, `${name}.app`);
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true });

  for (const entry of resources) {
    writeFileSync(join(bundle, 'Contents', 'Resources', entry), '');
  }

  if (iconFile) {
    writeFileSync(
      join(bundle, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIconFile</key><string>${iconFile}</string></dict></plist>`
    );
  }

  return { bundle, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('CFBundleIconFile is accepted with or without its extension', () => {
  assert.equal(normalizeIcnsName('Code.icns'), 'Code.icns');
  // Finder, Terminal, Ghostty and Xcode all store it bare.
  assert.equal(normalizeIcnsName('Finder'), 'Finder.icns');
  assert.equal(normalizeIcnsName('  Xcode\n'), 'Xcode.icns');
  assert.equal(normalizeIcnsName(''), '');
});

test('Info.plist decides which icns is the app icon', { skip: !isMac }, async () => {
  // `bat.icns` sorts first and is a document icon: picking it is the bug this
  // guards against, since editors ship dozens of them beside the real mark.
  const { bundle, cleanup } = makeBundle('Whatever', ['bat.icns', 'Code.icns'], 'Code');

  try {
    assert.equal(await resolveIcnsPath(bundle), join(bundle, 'Contents', 'Resources', 'Code.icns'));
  } finally {
    cleanup();
  }
});

test('without a usable plist the bundle name wins over alphabetical order', async () => {
  const { bundle, cleanup } = makeBundle('Zed', ['Document.icns', 'Zed.icns']);

  try {
    assert.equal(await resolveIcnsPath(bundle), join(bundle, 'Contents', 'Resources', 'Zed.icns'));
  } finally {
    cleanup();
  }
});

test('a bundle with no icns at all resolves to nothing rather than throwing', async () => {
  const { bundle, cleanup } = makeBundle('Empty', ['strings.txt']);

  try {
    assert.equal(await resolveIcnsPath(bundle), null);
    assert.equal(await readAppIcon(bundle), null);
  } finally {
    cleanup();
  }
});

test('a missing bundle resolves to nothing rather than throwing', async () => {
  assert.equal(await resolveIcnsPath('/Applications/Nothing Here.app'), null);
  assert.equal(await readAppIcon('/Applications/Nothing Here.app'), null);
});

test('a real system bundle produces a PNG data URL', { skip: !isMac }, async () => {
  const dataUrl = await readAppIcon('/System/Library/CoreServices/Finder.app');

  assert.ok(dataUrl?.startsWith('data:image/png;base64,'));
  // Anything this small is an error page, not a 64px icon.
  assert.ok((dataUrl?.length ?? 0) > 1000);
});

test('two different applications do not produce the same icon', { skip: !isMac }, async () => {
  const finder = await readAppIcon('/System/Library/CoreServices/Finder.app');
  const terminal = await readAppIcon('/System/Applications/Utilities/Terminal.app');

  assert.ok(finder && terminal);
  // The whole reason this module exists: `app.getFileIcon` returned one generic
  // badge for every bundle, and seven identical squares looked like a working
  // menu until you tried to tell them apart.
  assert.notEqual(finder, terminal);
});
