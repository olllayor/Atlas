/**
 * Managed Antigravity ACP runtime, ported from t3code PR #9348
 * (`apps/server/src/provider/AntigravityInstallation.ts`) to plain Node TS.
 *
 * Same method:
 * - owns downloads and the immutable `tools/antigravity-acp/<platform>-<arch>/versions`
 *   tree; `active.json` selects the release new processes use;
 * - running processes hold a lease so updates never replace a live binary;
 * - downloads the official archive from Google, checks SHA-256, extracts the
 *   executable pair, validates with an ACP `initialize` call.
 *
 * Simplifications for Atlas: no Effect, progress via callback, validation via
 * an injected handshake (defaults to spawning `--help`-style initialize
 * through `AcpClient` by the caller). Google gzips the archive, so the pinned
 * `archiveBytes` is advisory — the hash decides.
 */

import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

import {
  resolveAntigravityReleaseAsset,
  type AntigravityReleaseAsset
} from './antigravityRelease.js';

export interface AntigravityInstalledRuntime {
  readonly version: string;
  readonly executablePath: string;
  readonly harnessPath: string;
}

export interface AntigravityInstallProgress {
  readonly phase: 'download' | 'verify' | 'extract' | 'validate';
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
}

export interface AntigravityInstallationOptions {
  /** `tools/antigravity-acp` parent, e.g. `<userData>/tools`. */
  readonly baseDir: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly fetchImpl?: typeof fetch;
  /** Validate the extracted pair before activating; throw on failure. */
  readonly validate?: (runtime: AntigravityInstalledRuntime) => Promise<void>;
}

function platformArchDir(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`;
}

export class AntigravityInstallation {
  private readonly baseDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetchImpl: typeof fetch;
  private readonly validate?: (runtime: AntigravityInstalledRuntime) => Promise<void>;
  private leases = 0;
  private installing: Promise<AntigravityInstalledRuntime> | null = null;

  constructor(options: AntigravityInstallationOptions) {
    this.baseDir = options.baseDir;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.validate = options.validate;
  }

  private versionsDir(): string {
    return join(this.baseDir, 'antigravity-acp', platformArchDir(this.platform, this.arch), 'versions');
  }

  private activeFile(): string {
    return join(this.baseDir, 'antigravity-acp', platformArchDir(this.platform, this.arch), 'active.json');
  }

  /** Resolve an explicit binary override first, then managed, then PATH. */
  async acquire(overridePath?: string): Promise<AntigravityInstalledRuntime | null> {
    const override = overridePath?.trim();
    if (override) {
      // Override is taken at its word; the harness sits beside it when managed.
      const active = await this.readActive().catch(() => null);
      return {
        version: active?.version ?? 'override',
        executablePath: override,
        harnessPath: active?.harnessPath ?? ''
      };
    }
    return this.readActive().catch(() => null);
  }

  async readActive(): Promise<AntigravityInstalledRuntime | null> {
    let raw: string;
    try {
      raw = await readFile(this.activeFile(), 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as AntigravityInstalledRuntime;
      if (!parsed.executablePath) return null;
      await stat(parsed.executablePath);
      return parsed;
    } catch {
      return null;
    }
  }

  /** Hold a lease while a process runs; call the returned release on exit. */
  holdLease(): () => void {
    this.leases += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases = Math.max(0, this.leases - 1);
    };
  }

  get activeLeases(): number {
    return this.leases;
  }

  get installingNow(): boolean {
    return this.installing !== null;
  }

  /** Download, verify, extract, validate, activate. Serialized; concurrent callers share. */
  install(onProgress?: (progress: AntigravityInstallProgress) => void): Promise<AntigravityInstalledRuntime> {
    if (!this.installing) {
      this.installing = this.doInstall(onProgress).finally(() => {
        this.installing = null;
      });
    }
    return this.installing;
  }

  private async doInstall(
    onProgress?: (progress: AntigravityInstallProgress) => void
  ): Promise<AntigravityInstalledRuntime> {
    const asset: AntigravityReleaseAsset | null = resolveAntigravityReleaseAsset(
      this.platform,
      this.arch
    );
    if (!asset) {
      if (this.platform === 'darwin' && this.arch === 'x64') {
        throw new Error('Google publishes no Intel Mac build of the Antigravity ACP agent.');
      }
      throw new Error(`No Antigravity ACP build for ${this.platform}-${this.arch}.`);
    }
    const scratch = await mkdtemp(join(tmpdir(), 'atlas-antigravity-'));
    try {
      const archivePath = join(scratch, 'antigravity.zip');
      await this.download(asset, archivePath, onProgress);
      onProgress?.({ phase: 'verify', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes });
      await this.verifyHash(archivePath, asset.sha256);
      onProgress?.({ phase: 'extract', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes });
      const versionDir = join(this.versionsDir(), asset.version);
      await this.extract(archivePath, versionDir, asset);
      const runtime: AntigravityInstalledRuntime = {
        version: asset.version,
        executablePath: join(versionDir, asset.executable.name),
        harnessPath: join(versionDir, asset.harness.name)
      };
      onProgress?.({ phase: 'validate', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes });
      await this.validate?.(runtime);
      await this.activate(runtime);
      return runtime;
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async download(
    asset: AntigravityReleaseAsset,
    destPath: string,
    onProgress?: (progress: AntigravityInstallProgress) => void
  ): Promise<void> {
    const response = await this.fetchImpl(asset.url);
    if (!response.ok) {
      throw new Error(`Antigravity download failed (HTTP ${response.status}).`);
    }
    if (!response.body) {
      throw new Error('Antigravity download produced no body.');
    }
    const { createWriteStream } = await import('node:fs');
    const out = createWriteStream(destPath);
    let downloaded = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        downloaded += chunk.length;
        await new Promise<void>((resolve, reject) => {
          out.write(chunk, (error: Error | null | undefined) =>
            error ? reject(error) : resolve()
          );
        });
        onProgress?.({ phase: 'download', downloadedBytes: downloaded, totalBytes: asset.archiveBytes });
      }
    } finally {
      await new Promise<void>((resolve) => out.close(() => resolve()));
    }
    // Size is advisory because Google gzips; the SHA-256 check decides.
  }

  private async verifyHash(archivePath: string, expectedSha256: string): Promise<void> {
    const { createReadStream } = await import('node:fs');
    const digest: string = await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(archivePath);
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
    if (digest.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error('Antigravity download failed integrity check (SHA-256 mismatch).');
    }
  }

  private async extract(
    archivePath: string,
    versionDir: string,
    asset: AntigravityReleaseAsset
  ): Promise<void> {
    const completeFile = join(versionDir, '.install-complete.json');
    try {
      const complete = JSON.parse(await readFile(completeFile, 'utf8')) as { releaseId?: string };
      if (complete.releaseId === asset.sha256) {
        return;
      }
    } catch {
      // Fresh install.
    }
    const data = await readFile(archivePath);
    const zip = await JSZip.loadAsync(data);
    const wanted = new Map<string, string>([
      [asset.executable.name, join(versionDir, asset.executable.name)],
      [asset.harness.name, join(versionDir, asset.harness.name)]
    ]);
    // Archives nest the pair under a top-level folder; match by basename.
    const entries: Array<[string, string]> = [];
    zip.forEach((relativePath, file) => {
      if (file.dir) return;
      const base = relativePath.split('/').pop() ?? relativePath;
      const dest = wanted.get(base);
      if (dest) entries.push([relativePath, dest]);
    });
    if (entries.length < wanted.size) {
      const names: string[] = [];
      zip.forEach((relativePath) => names.push(relativePath));
      throw new Error(
        `Antigravity archive is missing the agent binaries (saw ${names.length} entries).`
      );
    }
    await mkdir(versionDir, { recursive: true });
    for (const [relativePath, dest] of entries) {
      const file = zip.file(relativePath);
      if (!file) continue;
      const bytes = await file.async('nodebuffer');
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, bytes);
    }
    if (this.platform !== 'win32') {
      await chmod(join(versionDir, asset.executable.name), 0o755).catch(() => undefined);
      await chmod(join(versionDir, asset.harness.name), 0o755).catch(() => undefined);
    }
    await writeFile(completeFile, JSON.stringify({ releaseId: asset.sha256 }));
  }

  private async activate(runtime: AntigravityInstalledRuntime): Promise<void> {
    if (this.leases > 0) {
      // Never replace a live binary: stage the new version and point fresh
      // processes at it only when nothing holds a lease. Atlas keeps one
      // active slot, so activation waits for quiescence by refusing while
      // leased — the caller retries after processes exit.
      throw new Error(
        'Antigravity runtime is in use. New downloads activate once running sessions exit.'
      );
    }
    await mkdir(dirname(this.activeFile()), { recursive: true });
    const tmp = `${this.activeFile()}.tmp`;
    await writeFile(tmp, JSON.stringify(runtime, null, 2));
    await rename(tmp, this.activeFile());
  }

  /** Remove the downloaded runtime; refuses while processes hold leases. */
  async remove(): Promise<void> {
    if (this.leases > 0) {
      throw new Error('Cannot remove the Antigravity runtime while sessions are running.');
    }
    await rm(join(this.baseDir, 'antigravity-acp'), { recursive: true, force: true });
  }
}
