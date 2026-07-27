import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  getSiteMimeType,
  normalizeSitePath,
  type SiteFileMeta,
} from '../../shared/sites';

/**
 * On-disk storage for site artifacts.
 *
 * Layout: <root>/<siteId>/<versionId>/<site-relative path>
 *
 * Blobs never go in SQLite — the database only holds metadata. Every path that
 * crosses this boundary is normalized and then re-checked against the version
 * root, so a crafted path from the model cannot escape.
 */
export class SiteFileStore {
  constructor(private readonly root: string) {}

  get rootPath(): string {
    return this.root;
  }

  versionDirectory(siteId: string, versionId: string): string {
    this.assertIdentifier(siteId);
    this.assertIdentifier(versionId);
    return join(this.root, siteId, versionId);
  }

  siteDirectory(siteId: string): string {
    this.assertIdentifier(siteId);
    return join(this.root, siteId);
  }

  /**
   * Resolve a site-relative path to an absolute path inside the version
   * directory, or throw. This is the only way callers should build paths.
   */
  resolveFilePath(siteId: string, versionId: string, path: string): string {
    const normalized = normalizeSitePath(path);
    if (!normalized) {
      throw new Error(`Invalid site file path: ${path}`);
    }

    const base = this.versionDirectory(siteId, versionId);
    const absolute = resolve(base, normalized);
    const rel = relative(base, absolute);

    if (rel.startsWith('..') || rel.startsWith(sep) || resolve(base, rel) !== absolute) {
      throw new Error(`Site file path escapes the site root: ${path}`);
    }

    return absolute;
  }

  async ensureVersionDirectory(siteId: string, versionId: string): Promise<string> {
    const directory = this.versionDirectory(siteId, versionId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  async writeSiteFile(
    siteId: string,
    versionId: string,
    path: string,
    contents: string | Buffer
  ): Promise<SiteFileMeta> {
    const normalized = normalizeSitePath(path);
    if (!normalized) throw new Error(`Invalid site file path: ${path}`);

    const absolute = this.resolveFilePath(siteId, versionId, normalized);
    await mkdir(dirname(absolute), { recursive: true });

    const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    await writeFile(absolute, buffer);

    return {
      path: normalized,
      byteSize: buffer.byteLength,
      mime: getSiteMimeType(normalized),
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async readSiteFile(siteId: string, versionId: string, path: string): Promise<Buffer> {
    const absolute = this.resolveFilePath(siteId, versionId, path);

    // Reject symlinks outright rather than following them out of the root.
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${path}`);
    }

    return readFile(absolute);
  }

  async readSiteTextFile(siteId: string, versionId: string, path: string): Promise<string> {
    const buffer = await this.readSiteFile(siteId, versionId, path);
    return buffer.toString('utf8');
  }

  async deleteSiteFile(siteId: string, versionId: string, path: string): Promise<boolean> {
    const absolute = this.resolveFilePath(siteId, versionId, path);
    try {
      await rm(absolute);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  /** Walk the version directory and return metadata for every regular file. */
  async listSiteFiles(siteId: string, versionId: string): Promise<SiteFileMeta[]> {
    const base = this.versionDirectory(siteId, versionId);
    const results: SiteFileMeta[] = [];

    const walk = async (directory: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }

      for (const entry of entries) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue; // skip symlinks, sockets, devices

        const relPath = relative(base, absolute).split(sep).join('/');
        const normalized = normalizeSitePath(relPath);
        if (!normalized) continue;

        const buffer = await readFile(absolute);
        results.push({
          path: normalized,
          byteSize: buffer.byteLength,
          mime: getSiteMimeType(normalized),
          sha256: createHash('sha256').update(buffer).digest('hex'),
        });
      }
    };

    await walk(base);
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
  }

  /** Read every text-ish file of a version, for validation. */
  async readAllTextFiles(
    siteId: string,
    versionId: string,
    paths: readonly string[]
  ): Promise<Array<{ path: string; contents: string }>> {
    const files: Array<{ path: string; contents: string }> = [];
    for (const path of paths) {
      files.push({ path, contents: await this.readSiteTextFile(siteId, versionId, path) });
    }
    return files;
  }

  /** Snapshot a version directory into a new one. Publishing freezes bytes here. */
  async copyVersion(siteId: string, fromVersionId: string, toVersionId: string): Promise<void> {
    const from = this.versionDirectory(siteId, fromVersionId);
    const to = this.versionDirectory(siteId, toVersionId);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, dereference: true, force: true });
  }

  async removeVersion(siteId: string, versionId: string): Promise<void> {
    await rm(this.versionDirectory(siteId, versionId), { recursive: true, force: true });
  }

  async removeSite(siteId: string): Promise<void> {
    await rm(this.siteDirectory(siteId), { recursive: true, force: true });
  }

  /** Copy a version's files into an arbitrary destination directory (export). */
  async exportVersionTo(siteId: string, versionId: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    await cp(this.versionDirectory(siteId, versionId), destination, {
      recursive: true,
      dereference: true,
      force: true,
    });
  }

  private assertIdentifier(value: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new Error(`Invalid site identifier: ${value}`);
    }
  }
}
