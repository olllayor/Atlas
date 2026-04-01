import { BrowserWindow, app } from 'electron/main';
import { shell } from 'electron/common';

import packageJson from '../../../package.json';
import type { AppUpdateSnapshot } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import {
  parseVersion,
  selectLatestRelease,
  type GitHubReleaseSummary
} from './versioning';

type GitHubReleaseApiResponse = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  body?: unknown;
};

type RepositoryInfo = {
  owner: string;
  name: string;
};

const DEFAULT_REPOSITORY: RepositoryInfo = {
  owner: 'olllayor',
  name: 'cheapchat'
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
    releaseNotes: typeof release.body === 'string' && release.body.trim() ? release.body : null
  };
}

export class UpdateService {
  private state: AppUpdateSnapshot = { status: 'idle' };

  private checkInFlight: Promise<AppUpdateSnapshot> | null = null;

  private started = false;

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

  async performPrimaryAction() {
    if (this.state.status === 'available') {
      await shell.openExternal(this.state.releaseUrl);
      return;
    }

    if (this.state.status === 'downloaded') {
      throw new Error('In-app installation is not enabled for this release channel yet.');
    }

    throw new Error('No update action is available right now.');
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
      return {
        status: 'not-available',
        currentVersion,
        checkedAt
      };
    }

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
