#!/usr/bin/env node

import { config } from 'dotenv';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

config({ path: join(repoRoot, '.env') });

const APP_DISPLAY_NAME = 'Atlas';
const DEV_BUNDLE_ID = 'com.olllayor.atlaschat.dev';
const LAUNCHER_VERSION = 2;

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync('plutil', ['-replace', key, '-string', value, plistPath], {
    encoding: 'utf8',
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync('plutil', ['-insert', key, '-string', value, plistPath], {
    encoding: 'utf8',
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join('\n');
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, 'Contents', 'Info.plist');
  setPlistString(infoPlistPath, 'CFBundleDisplayName', APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, 'CFBundleName', APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, 'CFBundleIdentifier', DEV_BUNDLE_ID);
  setPlistString(infoPlistPath, 'CFBundleIconFile', 'icon.icns');

  const resourcesDir = join(appBundlePath, 'Contents', 'Resources');
  copyFileSync(iconPath, join(resourcesDir, 'icon.icns'));
  copyFileSync(iconPath, join(resourcesDir, 'electron.icns'));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const frameworksDir = join(appBundlePath, 'Contents', 'Frameworks');
  if (!existsSync(frameworksDir)) {
    return;
  }

  for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('Electron Helper') || !entry.name.endsWith('.app')) {
      continue;
    }

    const helperPlistPath = join(frameworksDir, entry.name, 'Contents', 'Info.plist');
    if (!existsSync(helperPlistPath)) {
      continue;
    }

    const suffix = entry.name.replace('Electron Helper', '').replace('.app', '').trim();
    const helperName = suffix ? `${APP_DISPLAY_NAME} Helper ${suffix}` : `${APP_DISPLAY_NAME} Helper`;
    const helperIdSuffix = suffix.replace(/[()]/g, '').trim().toLowerCase().replace(/\s+/g, '-');
    const helperBundleId = helperIdSuffix
      ? `${DEV_BUNDLE_ID}.helper.${helperIdSuffix}`
      : `${DEV_BUNDLE_ID}.helper`;

    setPlistString(helperPlistPath, 'CFBundleDisplayName', helperName);
    setPlistString(helperPlistPath, 'CFBundleName', helperName);
    setPlistString(helperPlistPath, 'CFBundleIdentifier', helperBundleId);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureGeneratedIcons() {
  const sourceIconPath = join(repoRoot, 'icon.png');
  const generatedIconPaths = [join(repoRoot, 'build', 'icon.png'), join(repoRoot, 'build', 'icon.icns')];

  const sourceStat = statSync(sourceIconPath);
  const shouldRegenerate = generatedIconPaths.some((iconPath) => {
    if (!existsSync(iconPath)) {
      return true;
    }

    return statSync(iconPath).mtimeMs < sourceStat.mtimeMs;
  });

  if (shouldRegenerate) {
    runCommand(process.execPath, ['generate-icon.cjs']);
  }
}

function buildMacLauncher() {
  ensureGeneratedIcons();

  const electronBinaryPath = require('electron');
  const sourceAppBundlePath = resolve(electronBinaryPath, '../../..');
  const runtimeDir = join(repoRoot, '.electron-runtime');
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, 'Contents', 'MacOS', 'Electron');
  const iconPath = join(repoRoot, 'build', 'icon.icns');
  const metadataPath = join(runtimeDir, 'metadata.json');

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  runCommand('ditto', [sourceAppBundlePath, targetAppBundlePath]);
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  patchHelperBundleInfoPlists(targetAppBundlePath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

function resolveElectronExecPath() {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  return buildMacLauncher();
}

const electronViteDir = dirname(require.resolve('electron-vite/package.json'));
const electronViteBin = join(electronViteDir, 'bin', 'electron-vite.js');
const electronExecPath = resolveElectronExecPath();

const child = spawn(
  process.execPath,
  [electronViteBin, 'dev', ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...(electronExecPath ? { ELECTRON_EXEC_PATH: electronExecPath } : {}),
    },
  }
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
