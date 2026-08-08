import { randomUUID } from 'node:crypto';
import keytar from 'keytar';

import type { SqliteDatabase } from '../db/client';

const SERVICE_NAME = 'atlas-project-env';

export type EnvVarRecord = {
  id: string;
  projectId: string;
  key: string;
  createdAt: string;
};

export function maskEnvValue(val: string): string {
  if (!val) return '••••';
  if (val.length <= 4) return '••••';
  return `${val.slice(0, 2)}••••${val.slice(-2)}`;
}

export class EnvStore {
  /**
   * Decrypted values, kept in memory so the tool workspace — which is resolved
   * synchronously on the security-critical path — can read them without an
   * await. Keytar is the source of truth; this is only a read-through view,
   * refreshed on every write and primed at startup.
   */
  private readonly cache = new Map<string, Record<string, string>>();

  constructor(private readonly db: SqliteDatabase) {}

  /** Sync snapshot for `resolveConversationWorkspace`. Empty until primed. */
  getCachedEnv(projectId: string): Record<string, string> {
    return this.cache.get(projectId) ?? {};
  }

  /** Re-reads one project's secrets from the keychain into the cache. */
  async refresh(projectId: string): Promise<Record<string, string>> {
    const env = await this.getEnvForProject(projectId);
    this.cache.set(projectId, env);
    return env;
  }

  /**
   * Loads every project's env vars once at boot. Projects with no configured
   * vars never appear in the table, so this stays proportional to what the
   * user actually set rather than to the project count.
   */
  async primeAll(): Promise<void> {
    const rows = this.db
      .prepare<[], { project_id: string }>('SELECT DISTINCT project_id FROM project_env_vars')
      .all();

    for (const row of rows) {
      await this.refresh(row.project_id).catch((err) => {
        console.warn('[EnvStore] prime failed for', row.project_id, err);
      });
    }
  }

  listEnvKeys(projectId: string): string[] {
    const rows = this.db
      .prepare<{ projectId: string }, { key: string }>(
        `SELECT key FROM project_env_vars WHERE project_id = @projectId ORDER BY key ASC`
      )
      .all({ projectId });

    return rows.map((r) => r.key);
  }

  async getEnvForProject(projectId: string): Promise<Record<string, string>> {
    const keys = this.listEnvKeys(projectId);
    const env: Record<string, string> = {};

    for (const key of keys) {
      const accountName = `${projectId}:${key}`;
      const val = await keytar.getPassword(SERVICE_NAME, accountName);
      if (val != null) {
        env[key] = val;
      }
    }

    return env;
  }

  async listMaskedEnv(projectId: string): Promise<Array<{ key: string; maskedValue: string }>> {
    const keys = this.listEnvKeys(projectId);
    const result: Array<{ key: string; maskedValue: string }> = [];

    for (const key of keys) {
      const accountName = `${projectId}:${key}`;
      const val = await keytar.getPassword(SERVICE_NAME, accountName);
      result.push({
        key,
        maskedValue: val != null ? maskEnvValue(val) : '••••'
      });
    }

    return result;
  }

  async setEnvVar(projectId: string, key: string, value: string): Promise<void> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error('Environment variable key cannot be empty.');
    }

    const accountName = `${projectId}:${normalizedKey}`;
    await keytar.setPassword(SERVICE_NAME, accountName, value);

    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO project_env_vars (id, project_id, key, created_at)
         VALUES (@id, @projectId, @key, @createdAt)`
      )
      .run({ id: randomUUID(), projectId, key: normalizedKey, createdAt: now });

    this.cache.set(projectId, { ...this.getCachedEnv(projectId), [normalizedKey]: value });
  }

  async deleteEnvVar(projectId: string, key: string): Promise<void> {
    const accountName = `${projectId}:${key}`;
    await keytar.deletePassword(SERVICE_NAME, accountName).catch((err) => { console.warn('keytar delete failed:', err); });

    this.db
      .prepare(`DELETE FROM project_env_vars WHERE project_id = @projectId AND key = @key`)
      .run({ projectId, key });

    const next = { ...this.getCachedEnv(projectId) };
    delete next[key];
    this.cache.set(projectId, next);
  }

  async deleteAllForProject(projectId: string): Promise<void> {
    const keys = this.listEnvKeys(projectId);
    for (const key of keys) {
      const accountName = `${projectId}:${key}`;
      await keytar.deletePassword(SERVICE_NAME, accountName).catch((err) => { console.warn('keytar delete failed:', err); });
    }
    this.db.prepare(`DELETE FROM project_env_vars WHERE project_id = @projectId`).run({ projectId });
    this.cache.delete(projectId);
  }
}
