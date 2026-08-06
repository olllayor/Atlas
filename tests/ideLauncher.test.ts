import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IdeLauncher,
  detectIdes,
  defaultPathDirs,
  ideLaunchCommand,
  pickPreferredIde,
  type IdeDefinition,
  type ResolvedIde
} from '../src/main/workspace/IdeLauncher.js';

const CATALOG: IdeDefinition[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    macApps: ['Cursor'],
    bins: ['cursor'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe']
  },
  {
    id: 'vscode',
    name: 'VS Code',
    macApps: ['Visual Studio Code'],
    bins: ['code'],
    winPaths: ['%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe']
  }
];

function detect(present: string[], options: Parameters<typeof detectIdes>[0] = {}) {
  const found = new Set(present);

  return detectIdes({
    catalog: CATALOG,
    exists: (path) => found.has(path),
    ...options
  });
}

test('a PATH launcher is preferred over the app bundle that ships it', () => {
  const ides = detect(['/opt/homebrew/bin/cursor', '/Applications/Cursor.app'], {
    platform: 'darwin',
    pathDirs: ['/opt/homebrew/bin'],
    appDirs: ['/Applications']
  });

  assert.deepEqual(ides, [
    {
      id: 'cursor',
      name: 'Cursor',
      target: '/opt/homebrew/bin/cursor',
      kind: 'cli',
      // The shim launches it; the bundle beside it is what the icon comes from.
      iconPath: '/Applications/Cursor.app'
    }
  ]);
});

test('an app bundle counts as installed when no launcher is on PATH', () => {
  const ides = detect(['/Applications/Visual Studio Code.app'], {
    platform: 'darwin',
    pathDirs: ['/usr/bin'],
    appDirs: ['/Applications']
  });

  assert.deepEqual(ides, [
    {
      id: 'vscode',
      name: 'VS Code',
      target: '/Applications/Visual Studio Code.app',
      kind: 'macApp',
      iconPath: '/Applications/Visual Studio Code.app'
    }
  ]);
});

test('app bundles are ignored off macOS', () => {
  const ides = detect(['/Applications/Cursor.app'], {
    platform: 'linux',
    pathDirs: ['/usr/bin'],
    appDirs: ['/Applications']
  });

  assert.deepEqual(ides, []);
});

test('windows install paths expand from the environment, and unset vars find nothing', () => {
  const winPath = 'C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe';

  const found = detect([winPath], {
    platform: 'win32',
    pathDirs: [],
    env: { LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local', PATHEXT: '.EXE' }
  });

  assert.deepEqual(found, [
    { id: 'cursor', name: 'Cursor', target: winPath, kind: 'exe', iconPath: winPath }
  ]);

  const withoutVar = detect([winPath], {
    platform: 'win32',
    pathDirs: [],
    env: { PATHEXT: '.EXE' }
  });

  assert.deepEqual(withoutVar, []);
});

test('detection keeps catalog order, which is what an unset preference falls back to', () => {
  const ides = detect(['/usr/bin/code', '/usr/bin/cursor'], {
    platform: 'linux',
    pathDirs: ['/usr/bin']
  });

  assert.deepEqual(
    ides.map((ide) => ide.id),
    ['cursor', 'vscode']
  );
  assert.equal(pickPreferredIde(ides, null)?.id, 'cursor');
  // A shim with no bundle beside it has no icon to offer, and says so.
  assert.equal(ides[0]?.iconPath, null);
});

test('a preference for an uninstalled editor falls back instead of failing', () => {
  const ides = detect(['/usr/bin/code'], { platform: 'linux', pathDirs: ['/usr/bin'] });

  assert.equal(pickPreferredIde(ides, 'zed')?.id, 'vscode');
  assert.equal(pickPreferredIde([], 'vscode'), null);
});

test('the launch command is an argv, and a folder with spaces stays one argument', () => {
  const cli: ResolvedIde = {
    id: 'vscode',
    name: 'VS Code',
    target: '/usr/bin/code',
    kind: 'cli',
    iconPath: null
  };
  const bundle: ResolvedIde = {
    id: 'vscode',
    name: 'VS Code',
    target: '/Applications/Visual Studio Code.app',
    kind: 'macApp',
    iconPath: '/Applications/Visual Studio Code.app'
  };

  assert.deepEqual(ideLaunchCommand(cli, '/Users/dev/My Project'), {
    command: '/usr/bin/code',
    args: ['/Users/dev/My Project']
  });

  assert.deepEqual(ideLaunchCommand(bundle, '/Users/dev/My Project'), {
    command: 'open',
    args: ['-a', '/Applications/Visual Studio Code.app', '/Users/dev/My Project']
  });
});

test('the PATH search covers the shim directories a Finder-launched app never inherits', () => {
  const dirs = defaultPathDirs('darwin', { PATH: '/usr/bin:/bin' }, '/Users/dev');

  assert.ok(dirs.includes('/usr/local/bin'));
  assert.ok(dirs.includes('/opt/homebrew/bin'));
  assert.ok(dirs.includes('/Users/dev/.local/bin'));
});

test('list() caches the scan and refresh() drops it', () => {
  let scans = 0;
  const launcher = new IdeLauncher(() => {
    scans += 1;
    return [
      { id: 'vscode', name: 'VS Code', target: '/usr/bin/code', kind: 'cli', iconPath: null }
    ];
  });

  launcher.list();
  launcher.list();
  assert.equal(scans, 1);

  launcher.refresh();
  launcher.list();
  assert.equal(scans, 2);
});
