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
import { LocalAgentSessionsRepo } from './repositories/localAgentSessionsRepo';
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
  localAgentSessions: LocalAgentSessionsRepo;
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

  // Connection-level performance pragmas. `journal_mode = WAL` lives in the
  // schema (it persists in the file); everything here is per-connection and
  // must be set on every open.
  //
  // `synchronous = NORMAL` is the deliberate durability tradeoff: under WAL it
  // keeps every committed transaction durable across an application crash
  // (the data is in the WAL file), while a power loss / OS crash may roll back
  // the most recent commits instead of waiting on an fsync per commit. The
  // event log is replayable from the provider and the transcript rebuilds from
  // it on reconnect, so that window is acceptable; the fsync-per-commit it
  // removes sat on the streaming hot path (one commit per coalesced flush).
  // See `RuntimeStateRepo.recordEvent` for the write cadence.
  raw.pragma('synchronous = NORMAL');
  // Contention is only ever against our own checkpoints, but a five-second
  // wait beats a spurious SQLITE_BUSY surfacing as a failed turn.
  raw.pragma('busy_timeout = 5000');
  // 16 MB page cache (default is 2 MB): the event-log and message UPDATEs
  // touch the same hot pages every flush, and 16 MB is nothing next to a
  // multi-GB transcript database.
  raw.pragma('cache_size = -16000');
  // 256 MB memory-mapped I/O: accelerates reads and index lookups by avoiding
  // repeated read() syscalls and buffer copies into user space.
  raw.pragma('mmap_size = 268435456');

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
    localAgentSessions: new LocalAgentSessionsRepo(raw),
    sites: new SitesRepo(raw),
  };
}
