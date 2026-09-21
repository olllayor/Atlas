import assert from 'node:assert/strict';
import test from 'node:test';

import { selectMacInstallerAsset, type ReleaseAsset } from '../src/main/updates/versioning.js';

/** The asset list electron-builder + release.yml actually produce for a tag. */
function releaseAssets(version = '0.1.19'): ReleaseAsset[] {
  return [
    { name: `Atlas-${version}-arm64.dmg`, downloadUrl: 'https://example.test/arm64.dmg', size: 120_000_000 },
    { name: `Atlas-${version}-arm64.dmg.blockmap`, downloadUrl: 'https://example.test/arm64.map', size: 130_000 },
    { name: `Atlas-${version}.dmg`, downloadUrl: 'https://example.test/x64.dmg', size: 125_000_000 },
    { name: `Atlas-${version}.dmg.blockmap`, downloadUrl: 'https://example.test/x64.map', size: 135_000 },
    { name: `Atlas-${version}-arm64-mac.zip`, downloadUrl: 'https://example.test/arm64.zip', size: 118_000_000 },
    { name: `Atlas-${version}-mac.zip`, downloadUrl: 'https://example.test/x64.zip', size: 123_000_000 },
    { name: 'latest-mac.yml', downloadUrl: 'https://example.test/latest-mac.yml', size: 400 },
  ];
}

test('picks the arm64 image on Apple Silicon', () => {
  const asset = selectMacInstallerAsset(releaseAssets(), 'arm64');
  assert.equal(asset?.name, 'Atlas-0.1.19-arm64.dmg');
});

test('picks the unsuffixed image on Intel', () => {
  // electron-builder only suffixes the non-default arch, so x64 is identified
  // by the *absence* of an arm64 marker. Getting this backwards hands an
  // Intel user the Apple Silicon image.
  const asset = selectMacInstallerAsset(releaseAssets(), 'x64');
  assert.equal(asset?.name, 'Atlas-0.1.19.dmg');
});

test('never returns a blockmap or a zip', () => {
  for (const arch of ['arm64', 'x64']) {
    const asset = selectMacInstallerAsset(releaseAssets(), arch);
    assert.ok(asset, `expected an installer for ${arch}`);
    assert.ok(asset.name.endsWith('.dmg'), `${asset.name} is not a disk image`);
  }
});

test('honours an explicit x64 marker when the publisher uses one', () => {
  const assets: ReleaseAsset[] = [
    { name: 'Atlas-1.0.0-arm64.dmg', downloadUrl: 'https://example.test/a.dmg', size: 10 },
    { name: 'Atlas-1.0.0-x64.dmg', downloadUrl: 'https://example.test/b.dmg', size: 10 },
  ];
  assert.equal(selectMacInstallerAsset(assets, 'x64')?.name, 'Atlas-1.0.0-x64.dmg');
});

test('returns null rather than the wrong architecture', () => {
  // An arm64-only release must not resolve to an Intel image, and vice versa:
  // the caller falls back to opening the release page.
  const armOnly: ReleaseAsset[] = [
    { name: 'Atlas-1.0.0-arm64.dmg', downloadUrl: 'https://example.test/a.dmg', size: 10 },
  ];
  assert.equal(selectMacInstallerAsset(armOnly, 'x64'), null);

  const intelOnly: ReleaseAsset[] = [
    { name: 'Atlas-1.0.0-x64.dmg', downloadUrl: 'https://example.test/b.dmg', size: 10 },
  ];
  assert.equal(selectMacInstallerAsset(intelOnly, 'arm64'), null);
});

test('ignores zero-byte assets from a failed upload', () => {
  const assets: ReleaseAsset[] = [
    { name: 'Atlas-1.0.0-arm64.dmg', downloadUrl: 'https://example.test/a.dmg', size: 0 },
  ];
  assert.equal(selectMacInstallerAsset(assets, 'arm64'), null);
});

test('handles a release with no assets at all', () => {
  assert.equal(selectMacInstallerAsset([], 'arm64'), null);
});
