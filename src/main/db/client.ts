import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

import Database from 'better-sqlite3';

import type { AttachmentStore } from '../attachments/AttachmentStore';
import { ConversationsRepo } from './repositories/conversationsRepo';
import { ConversationGoalsRepo } from './repositories/conversationGoalsRepo';
import { ConversationSummariesRepo } from './repositories/conversationSummariesRepo';
import { CustomProvidersRepo } from './repositories/customProvidersRepo';
import { ModelsRepo, type SelfManagedProviders } from './repositories/modelsRepo';
import { ProjectsRepo } from './repositories/projectsRepo';
import { RuntimeStateRepo } from './repositories/runtimeStateRepo';
import { SettingsRepo } from './repositories/settingsRepo';
import { SitesRepo } from './repositories/sitesRepo';
import { ToolExecutionsRepo } from './repositories/toolExecutionsRepo';
import { VisualsRepo } from './repositories/visualsRepo';
import { FileChangesRepo } from './repositories/fileChangesRepo';
import { WorkspaceCheckpointsRepo } from './repositories/workspaceCheckpointsRepo';
import { TerminalHistoryRepo } from './repositories/terminalHistoryRepo';
import { PluginAuditRepo } from './repositories/pluginAuditRepo';
import { OpenCodeSessionsRepo } from './repositories/opencodeSessionsRepo';
import { applySchema } from './schema';

export type SqliteDatabase = InstanceType<typeof Database>;

export type AppDatabase = {
  raw: SqliteDatabase;
  conversations: ConversationsRepo;
  conversationGoals: ConversationGoalsRepo;
  conversationSummaries: ConversationSummariesRepo;
  runtimeState: RuntimeStateRepo;
  toolExecutions: ToolExecutionsRepo;
  fileChanges: FileChangesRepo;
  workspaceCheckpoints: WorkspaceCheckpointsRepo;
  terminalHistory: TerminalHistoryRepo;
  models: ModelsRepo;
  projects: ProjectsRepo;
  customProviders: CustomProvidersRepo;
  settings: SettingsRepo;
  visuals: VisualsRepo;
  sites: SitesRepo;
  pluginAudit: PluginAuditRepo;
  opencodeSessions: OpenCodeSessionsRepo;
};

/**
 * `selfManagedProviders` names the providers that are servable without a
 * `custom_providers` row — see `ModelsRepo`. The app passes the live set from
 * the provider registry; tests and tools can leave it out.
 */
export function createAppDatabase(
  databasePath: string,
  attachmentStore: AttachmentStore,
  selfManagedProviders: SelfManagedProviders = () => []
): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true });

  const raw = new Database(databasePath);
  applySchema(raw);
  const toolExecutions = new ToolExecutionsRepo(raw);
  const runtimeState = new RuntimeStateRepo(raw);
  const conversations = new ConversationsRepo(raw, attachmentStore, toolExecutions, runtimeState);

  return {
    raw,
    conversations,
    conversationGoals: new ConversationGoalsRepo(raw),
    conversationSummaries: new ConversationSummariesRepo(raw),
    runtimeState,
    toolExecutions,
    fileChanges: new FileChangesRepo(raw),
    workspaceCheckpoints: new WorkspaceCheckpointsRepo(raw),
    terminalHistory: new TerminalHistoryRepo(raw),
    models: new ModelsRepo(raw, selfManagedProviders),
    projects: new ProjectsRepo(raw),
    customProviders: new CustomProvidersRepo(raw),
    settings: new SettingsRepo(raw),
    visuals: new VisualsRepo(raw),
    pluginAudit: new PluginAuditRepo(raw),
    opencodeSessions: new OpenCodeSessionsRepo(raw),
    sites: new SitesRepo(raw),
  };
}
