import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BrowserWindow, app } from 'electron/main';
import { shell } from 'electron/common';

import packageJson from '../../../package.json';
import type { AppUpdateProgress, AppUpdateSnapshot } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import {
  parseVersion,
  selectLatestRelease,
  selectMacInstallerAsset,
  type GitHubReleaseSummary,
  type ReleaseAsset
} from './versioning';

type GitHubReleaseApiResponse = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: unknown;
};

/**
 * How often download progress reaches the renderer, in milliseconds.
 *
 * The read loop ticks once per network chunk — hundreds of times a second on a
 * fast connection — and every tick would otherwise be an IPC broadcast to
 * every open window. The bar cannot render faster than the display anyway.
 */
const PROGRESS_THROTTLE_MS = 250;

type DownloadTarget = {
  asset: ReleaseAsset;
  latestVersion: string;
  releaseNotes: string | null;
  releaseUrl: string;
};

function toReleaseAssets(value: unknown): ReleaseAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const asset = item as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
      return [];
    }

    return [
      {
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        size: typeof asset.size === 'number' ? asset.size : 0
      }
    ];
  });
}

type RepositoryInfo = {
  owner: string;
  name: string;
};

const DEFAULT_REPOSITORY: RepositoryInfo = {
  owner: 'olllayor',
  name: 'Atlas'
};

function parseRepositoryInfo(): RepositoryInfo {
  const repositoryUrl =
    typeof packageJson.repository === 'object' && packageJson.repository
      ? packageJson.repository.url
      : null;

  if (typeof repositoryUrl !== 'string') {
    return DEFAULT_REPOSITORY;
  }

  const match = repositoryUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<name>[^/.]+)(?:\.git)?$/i);
  if (!match?.groups?.owner || !match.groups.name) {
    return DEFAULT_REPOSITORY;
  }

  return {
    owner: match.groups.owner,
    name: match.groups.name
  };
}

function toReleaseSummary(release: GitHubReleaseApiResponse): GitHubReleaseSummary | null {
  if (release.draft === true) {
    return null;
  }

  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    return null;
  }

  const version = parseVersion(release.tag_name);
  if (!version) {
    return null;
  }

  return {
    version,
    releaseUrl: release.html_url,
    releaseNotes: typeof release.body === 'string' && release.body.trim() ? release.body : null,
    assets: toReleaseAssets(release.assets)
  };
}

export class UpdateService {
  private state: AppUpdateSnapshot = { status: 'idle' };

  private checkInFlight: Promise<AppUpdateSnapshot> | null = null;

  private started = false;

  /** Installer for the running arch, resolved by the most recent check. */
  private downloadTarget: DownloadTarget | null = null;

  /** Where the finished `.dmg` landed, so the install action can open it. */
  private downloadedPath: string | null = null;

  private downloadAbort: AbortController | null = null;

  getState() {
    return this.state;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    setTimeout(() => {
      void this.checkForUpdates({ userInitiated: false });
    }, 3000);
  }

  async checkForUpdates({ userInitiated }: { userInitiated: boolean }) {
    if (this.checkInFlight) {
      return this.checkInFlight;
    }

    // A check mid-download would overwrite the progress state with its own
    // result and strand the transfer with no UI attached to it.
    if (this.state.status === 'downloading') {
      return this.state;
    }

    this.setState({ status: 'checking' });

    this.checkInFlight = this.fetchLatestRelease()
      .then((nextState) => {
        this.setState(nextState);
        return nextState;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unable to check for updates.';
        const errorState: AppUpdateSnapshot = {
          status: 'error',
          message,
          checkedAt: new Date().toISOString()
        };

        if (!userInitiated) {
          console.warn('[updates] automatic update check failed:', message);
        }

        this.setState(errorState);
        return errorState;
      })
      .finally(() => {
        this.checkInFlight = null;
      });

    return this.checkInFlight;
  }

  /**
   * The single button behind "App updates".
   *
   * Atlas ships unsigned, so there is no Squirrel.Mac path — an unsigned app
   * cannot swap itself out from under macOS. What this can do is remove the
   * browser round-trip: fetch the right disk image in the background, then
   * hand it to Finder mounted and ready. The drag to Applications stays
   * manual, because without a Developer ID it has to.
   */
  async performPrimaryAction() {
    if (this.state.status === 'available') {
      if (!this.downloadTarget) {
        // No installer matched this architecture — the release page is still
        // better than an error, since the user can pick a build by hand.
        await shell.openExternal(this.state.releaseUrl);
        return;
      }

      await this.downloadUpdate(this.downloadTarget);
      return;
    }

    if (this.state.status === 'downloading') {
      // Already working. Clicking again should not start a second transfer.
      return;
    }

    if (this.state.status === 'downloaded') {
      await this.revealDownloadedInstaller();
      return;
    }

    throw new Error('No update action is available right now.');
  }

  /** Mount the finished image, or fall back to showing it in Finder. */
  private async revealDownloadedInstaller() {
    const path = this.downloadedPath;
    if (!path) {
      throw new Error('The downloaded installer is no longer available.');
    }

    const failure = await shell.openPath(path);
    if (failure) {
      shell.showItemInFolder(path);
    }
  }

  private async downloadUpdate(target: DownloadTarget) {
    const currentVersion = app.getVersion();
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    this.downloadAbort = controller;

    const base: Omit<Extract<AppUpdateSnapshot, { status: 'downloading' }>, 'progress'> = {
      status: 'downloading',
      currentVersion,
      latestVersion: target.latestVersion,
      releaseNotes: target.releaseNotes,
      checkedAt
    };

    this.setState({ ...base, progress: null });

    // `.part` until the bytes are all there: a truncated image left behind by
    // a quit mid-download would otherwise look like a finished one next time.
    const destination = join(app.getPath('downloads'), target.asset.name);
    const partial = `${destination}.part`;

    try {
      const response = await fetch(target.asset.downloadUrl, {
        headers: { 'User-Agent': `${app.getName()}/${currentVersion}` },
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        throw new Error(`GitHub returned ${response.status} while downloading the update.`);
      }

      const declared = Number(response.headers.get('content-length'));
      const total = Number.isFinite(declared) && declared > 0 ? declared : target.asset.size;

      let transferred = 0;
      let lastEmit = 0;
      const startedAt = Date.now();
      const onProgress = (progress: AppUpdateProgress) => this.setState({ ...base, progress });

      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);

      // Counting inside the pipeline rather than from a `data` listener: the
      // listener form flips the stream into flowing mode before `pipeline`
      // attaches its own consumer, which is a chunk-loss hazard.
      const count = async function* (chunks: AsyncIterable<Buffer>) {
        for await (const chunk of chunks) {
          transferred += chunk.length;

          const now = Date.now();
          if (now - lastEmit >= PROGRESS_THROTTLE_MS) {
            lastEmit = now;
            const elapsedSeconds = Math.max((now - startedAt) / 1000, 0.001);
            onProgress({
              percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
              bytesPerSecond: transferred / elapsedSeconds,
              transferred,
              total
            });
          }

          yield chunk;
        }
      };

      await pipeline(source, count, createWriteStream(partial));
      await rename(partial, destination);

      this.downloadedPath = destination;
      this.setState({
        status: 'downloaded',
        currentVersion,
        latestVersion: target.latestVersion,
        releaseNotes: target.releaseNotes,
        checkedAt
      });
    } catch (error) {
      await rm(partial, { force: true }).catch(() => {});
      this.downloadedPath = null;

      const message =
        error instanceof Error ? error.message : 'Unable to download the update.';
      this.setState({
        status: 'error',
        message,
        checkedAt: new Date().toISOString()
      });
    } finally {
      this.downloadAbort = null;
    }
  }

  /** Stop an in-flight transfer, e.g. on quit. */
  cancelDownload() {
    this.downloadAbort?.abort();
    this.downloadAbort = null;
  }

  private async fetchLatestRelease(): Promise<AppUpdateSnapshot> {
    const repository = parseRepositoryInfo();
    const currentVersion = app.getVersion();
    const response = await fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.name}/releases`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `${app.getName()}/${currentVersion}`
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while checking for updates.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error('GitHub returned an unexpected release payload.');
    }

    const releases = payload
      .map((item) => toReleaseSummary(item as GitHubReleaseApiResponse))
      .filter((item): item is GitHubReleaseSummary => item !== null);

    const latestRelease = selectLatestRelease(releases, currentVersion);
    const checkedAt = new Date().toISOString();

    if (!latestRelease) {
      this.downloadTarget = null;
      return {
        status: 'not-available',
        currentVersion,
        checkedAt
      };
    }

    const asset = selectMacInstallerAsset(latestRelease.assets, process.arch);
    this.downloadTarget = asset
      ? {
          asset,
          latestVersion: latestRelease.version.normalized,
          releaseNotes: latestRelease.releaseNotes,
          releaseUrl: latestRelease.releaseUrl
        }
      : null;

    return {
      status: 'available',
      currentVersion,
      latestVersion: latestRelease.version.normalized,
      releaseUrl: latestRelease.releaseUrl,
      releaseNotes: latestRelease.releaseNotes,
      checkedAt
    };
  }

  private setState(nextState: AppUpdateSnapshot) {
    this.state = nextState;
    this.broadcast(nextState);
  }

  private broadcast(snapshot: AppUpdateSnapshot) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.updatesEvent, snapshot);
      }
    }
  }
}
