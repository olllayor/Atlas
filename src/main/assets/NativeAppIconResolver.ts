import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { ToolActivityNativeAppReference } from '../../shared/contracts';

const execFileAsync = promisify(execFile);

const ICON_SIZE = 64;
const COMMAND_TIMEOUT_MS = 5000;
const RESOLUTION_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESOLUTION_CACHE_MAX_ENTRIES = 256;

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<string>;

export interface NativeAppIconResolverOptions {
  cacheDir: string;
  platform?: string;
  commandRunner?: CommandRunner;
}

interface CacheEntry {
  path: string | null;
  timestamp: number;
}

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function escapeSpotlightString(value: string): string {
  return value.replace(/([\\'*?])/gu, '\\$1');
}

function appCacheKey(app: ToolActivityNativeAppReference): string {
  return JSON.stringify(app);
}

export class NativeAppIconResolver {
  private readonly cacheDir: string;
  private readonly platform: string;
  private readonly commandRunner: CommandRunner;
  private readonly memoryCache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(options: NativeAppIconResolverOptions) {
    this.cacheDir = path.join(options.cacheDir, 'native-app-icons');
    this.platform = options.platform ?? process.platform;
    this.commandRunner =
      options.commandRunner ??
      (async (cmd, args, opts) => {
        const { stdout } = await execFileAsync(cmd, args as string[], {
          timeout: opts?.timeout ?? COMMAND_TIMEOUT_MS,
          encoding: 'utf8',
          windowsHide: true,
        });
        return stdout;
      });
  }

  private async runCommand(command: string, args: readonly string[]): Promise<string> {
    try {
      return await this.commandRunner(command, args, { timeout: COMMAND_TIMEOUT_MS });
    } catch {
      return '';
    }
  }

  private async getPlistValue(infoPlistPath: string, key: string): Promise<string> {
    const raw = await this.runCommand('/usr/bin/plutil', [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      infoPlistPath,
    ]);
    return raw.trim();
  }

  private async resolveApplicationPath(
    app: ToolActivityNativeAppReference,
  ): Promise<string | null> {
    const query =
      app._tag === 'app-id'
        ? `kMDItemCFBundleIdentifier == '${escapeSpotlightString(app.appId)}'`
        : `kMDItemContentType == 'com.apple.application-bundle' && kMDItemDisplayName == '${escapeSpotlightString(app.displayName)}'`;

    const spotlightOutput = await this.runCommand('/usr/bin/mdfind', [query]);
    const candidates = spotlightOutput
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.endsWith('.app'));

    if (candidates.length === 0) return null;

    const matchingCandidates =
      app._tag === 'app-id'
        ? candidates
        : candidates.filter(
            (val) =>
              path.basename(val, '.app').toLowerCase() === app.displayName.toLowerCase(),
          );

    const rankedCandidates = matchingCandidates.length > 0 ? matchingCandidates : candidates;

    let mostRecentlyUsed: { path: string; lastUsed: string } | null = null;
    for (const candidate of rankedCandidates) {
      const lastUsed = (
        await this.runCommand('/usr/bin/mdls', ['-raw', '-name', 'kMDItemLastUsedDate', candidate])
      ).trim();
      if (!mostRecentlyUsed || lastUsed > mostRecentlyUsed.lastUsed) {
        mostRecentlyUsed = { path: candidate, lastUsed };
      }
    }

    return mostRecentlyUsed?.path ?? null;
  }

  private async resolveUncached(app: ToolActivityNativeAppReference): Promise<string | null> {
    const appPath = await this.resolveApplicationPath(app);
    if (!appPath) return null;

    let canonicalAppPath: string;
    try {
      canonicalAppPath = await fs.promises.realpath(appPath);
    } catch {
      return null;
    }

    const infoPlistPath = path.join(canonicalAppPath, 'Contents', 'Info.plist');
    const resourcesDirectory = path.join(canonicalAppPath, 'Contents', 'Resources');

    const iconName =
      (await this.getPlistValue(infoPlistPath, 'CFBundleIconFile')) ||
      (await this.getPlistValue(infoPlistPath, 'CFBundleIconName'));

    if (iconName && path.basename(iconName) !== iconName) return null;

    const iconFileName = iconName ? (path.extname(iconName) ? iconName : `${iconName}.icns`) : null;

    let resourceEntries: string[] = [];
    try {
      resourceEntries = await fs.promises.readdir(resourcesDirectory);
    } catch {
      resourceEntries = [];
    }

    let sourceIconCandidate: string | null = null;
    if (iconFileName) {
      const candidate = path.join(resourcesDirectory, iconFileName);
      if (fs.existsSync(candidate)) sourceIconCandidate = candidate;
    }
    if (!sourceIconCandidate) {
      const appIcon = path.join(resourcesDirectory, 'AppIcon.icns');
      if (fs.existsSync(appIcon)) sourceIconCandidate = appIcon;
    }
    if (!sourceIconCandidate) {
      const anyIcns = resourceEntries.find((entry) => entry.toLowerCase().endsWith('.icns'));
      if (anyIcns) {
        const candidate = path.join(resourcesDirectory, anyIcns);
        if (fs.existsSync(candidate)) sourceIconCandidate = candidate;
      }
    }

    if (!sourceIconCandidate) return null;

    let sourceIconPath: string;
    try {
      sourceIconPath = await fs.promises.realpath(sourceIconCandidate);
    } catch {
      return null;
    }

    const relativeSource = path.relative(resourcesDirectory, sourceIconPath);
    if (
      relativeSource === '..' ||
      relativeSource.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeSource)
    ) {
      return null;
    }

    const appVersion =
      (await this.getPlistValue(infoPlistPath, 'CFBundleVersion')) ||
      (await this.getPlistValue(infoPlistPath, 'CFBundleShortVersionString'));

    const cacheKey = crypto
      .createHash('sha256')
      .update(`${canonicalAppPath}\0${appVersion}\0${sourceIconPath}`)
      .digest('hex');

    const cachePath = path.join(this.cacheDir, `${cacheKey}.png`);
    if (fs.existsSync(cachePath)) return cachePath;

    await fs.promises.mkdir(this.cacheDir, { recursive: true });

    const temporaryPath = path.join(
      this.cacheDir,
      `.${cacheKey}-${process.pid}-${Date.now().toString(36)}-${crypto.randomUUID()}.png`,
    );

    try {
      await this.runCommand('/usr/bin/sips', [
        '-z',
        String(ICON_SIZE),
        String(ICON_SIZE),
        '-s',
        'format',
        'png',
        sourceIconPath,
        '--out',
        temporaryPath,
      ]);

      if (fs.existsSync(temporaryPath)) {
        await fs.promises.rename(temporaryPath, cachePath);
        return cachePath;
      }
      return null;
    } catch {
      return null;
    } finally {
      if (fs.existsSync(temporaryPath)) {
        await fs.promises.unlink(temporaryPath).catch(() => {});
      }
    }
  }

  private setMemoryCache(key: string, filePath: string | null): void {
    if (this.memoryCache.size >= RESOLUTION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) this.memoryCache.delete(oldestKey);
    }
    this.memoryCache.set(key, { path: filePath, timestamp: Date.now() });
  }

  public async resolve(app: ToolActivityNativeAppReference): Promise<string | null> {
    if (this.platform !== 'darwin') return null;
    if (app._tag === 'display-name' && containsControlCharacter(app.displayName)) {
      return null;
    }
    if (app._tag === 'app-id' && (!app.appId || app.appId.length > 512 || !/^[A-Za-z0-9._-]+$/u.test(app.appId))) {
      return null;
    }

    const key = appCacheKey(app);
    const cached = this.memoryCache.get(key);
    if (cached && Date.now() - cached.timestamp < RESOLUTION_CACHE_TTL_MS) {
      if (cached.path === null) return null;
      if (fs.existsSync(cached.path)) return cached.path;
      // Cached file was removed on disk: invalidate
      this.memoryCache.delete(key);
    }

    const running = this.inflight.get(key);
    if (running) return running;

    const promise = (async () => {
      try {
        const result = await this.resolveUncached(app);
        this.setMemoryCache(key, result);
        return result;
      } catch {
        this.setMemoryCache(key, null);
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}
