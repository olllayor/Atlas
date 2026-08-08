import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron/main';
import { nativeImage } from 'electron/common';

export function getDockIcon(): Electron.NativeImage | undefined {
  const iconPath = getDockIconPath();
  if (!iconPath) return undefined;
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

export function getAppIconPath(): string | undefined {
  const candidates = getIconCandidates('png');

  return candidates.find((candidate) => existsSync(candidate));
}

export function getDockIconPath(): string | undefined {
  const preferredCandidates = process.platform === 'darwin' ? getIconCandidates('icns') : getIconCandidates('png');
  const fallbackCandidates = process.platform === 'darwin' ? getIconCandidates('png') : [];

  return [...preferredCandidates, ...fallbackCandidates].find((candidate) => existsSync(candidate));
}

function getIconCandidates(extension: 'icns' | 'png') {
  const filename = `icon.${extension}`;
  return app.isPackaged
    ? [join(process.resourcesPath, 'assets', filename)]
    : [join(app.getAppPath(), 'build', filename), join(process.cwd(), 'build', filename)];
}
