import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

import { ConversationsRepo } from './repositories/conversationsRepo';
import { ModelsRepo } from './repositories/modelsRepo';
import { SettingsRepo } from './repositories/settingsRepo';
import { applySchema } from './schema';

export type SqliteDatabase = InstanceType<typeof Database>;

export type AppDatabase = {
  raw: SqliteDatabase;
  conversations: ConversationsRepo;
  models: ModelsRepo;
  settings: SettingsRepo;
};

export function createAppDatabase(databasePath: string): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const raw = new Database(databasePath);
  applySchema(raw);

  return {
    raw,
    conversations: new ConversationsRepo(raw),
    models: new ModelsRepo(raw),
    settings: new SettingsRepo(raw)
  };
}
