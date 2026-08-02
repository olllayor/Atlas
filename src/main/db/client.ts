import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

import type { AttachmentStore } from '../attachments/AttachmentStore';
import { ConversationsRepo } from './repositories/conversationsRepo';
import { CustomProvidersRepo } from './repositories/customProvidersRepo';
import { ModelsRepo } from './repositories/modelsRepo';
import { ProjectsRepo } from './repositories/projectsRepo';
import { RuntimeStateRepo } from './repositories/runtimeStateRepo';
import { SettingsRepo } from './repositories/settingsRepo';
import { SitesRepo } from './repositories/sitesRepo';
import { ToolExecutionsRepo } from './repositories/toolExecutionsRepo';
import { VisualsRepo } from './repositories/visualsRepo';
import { FileChangesRepo } from './repositories/fileChangesRepo';
import { TerminalHistoryRepo } from './repositories/terminalHistoryRepo';
import { applySchema } from './schema';

export type SqliteDatabase = InstanceType<typeof Database>;

export type AppDatabase = {
  raw: SqliteDatabase;
  conversations: ConversationsRepo;
  runtimeState: RuntimeStateRepo;
  toolExecutions: ToolExecutionsRepo;
  fileChanges: FileChangesRepo;
  terminalHistory: TerminalHistoryRepo;
  models: ModelsRepo;
  projects: ProjectsRepo;
  customProviders: CustomProvidersRepo;
  settings: SettingsRepo;
  visuals: VisualsRepo;
  sites: SitesRepo;
};

export function createAppDatabase(databasePath: string, attachmentStore: AttachmentStore): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const raw = new Database(databasePath);
  applySchema(raw);
  const toolExecutions = new ToolExecutionsRepo(raw);
  const runtimeState = new RuntimeStateRepo(raw);
  const conversations = new ConversationsRepo(raw, attachmentStore, toolExecutions, runtimeState);

  return {
    raw,
    conversations,
    runtimeState,
    toolExecutions,
    fileChanges: new FileChangesRepo(raw),
    terminalHistory: new TerminalHistoryRepo(raw),
    models: new ModelsRepo(raw),
    projects: new ProjectsRepo(raw),
    customProviders: new CustomProvidersRepo(raw),
    settings: new SettingsRepo(raw),
    visuals: new VisualsRepo(raw),
    sites: new SitesRepo(raw),
  };
}
