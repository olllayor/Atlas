import type { SqliteDatabase } from './client';
import { countDiffLines } from './repositories/fileChangesRepo';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  provider_id TEXT PRIMARY KEY,
  has_secret INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'missing',
  validated_at TEXT
);

CREATE TABLE IF NOT EXISTS model_cache (
  model_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  context_window INTEGER,
  is_free INTEGER NOT NULL DEFAULT 0,
  -- Nullable on purpose: NULL is "no source has described this modality",
  -- which is different from "the model cannot take it".
  supports_vision INTEGER,
  supports_document_input INTEGER,
  supports_tools INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT NOT NULL,
  last_seen_free_at TEXT,
  max_output_tokens INTEGER,
  supports_temperature INTEGER NOT NULL DEFAULT 1,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  reasoning_efforts TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  default_provider_id TEXT,
  default_model_id TEXT,
  -- 1 while the title is machine-generated and may still be improved on;
  -- a user rename clears it and the app never overwrites the title again.
  title_auto INTEGER NOT NULL DEFAULT 0,
  -- Timestamps, not flags: the pinned section is ordered by when each chat was
  -- pinned, and archiving is reversible, so the moment it happened is the fact
  -- worth keeping. NULL means "not pinned" / "not archived".
  pinned_at TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning TEXT,
  parts_json TEXT,
  response_messages_json TEXT,
  status TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  latency_ms INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_preview TEXT,
  input_json TEXT,
  state TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  partial_output_preview TEXT,
  final_output_preview TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approval_id TEXT,
  approved_at TEXT,
  denied_at TEXT,
  approval_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
ON conversations (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
ON messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at_id
ON messages (conversation_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation
ON tool_executions (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_executions_message
ON tool_executions (message_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_executions_request
ON tool_executions (request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_executions_state
ON tool_executions (state);

CREATE TABLE IF NOT EXISTS conversation_events (
  event_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  tone TEXT NOT NULL,
  tool_type TEXT,
  message_id TEXT,
  tool_call_id TEXT,
  approval_id TEXT,
  provider_id TEXT NOT NULL,
  provider_event_type TEXT,
  payload_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_events_sequence
ON conversation_events (conversation_id, sequence);

CREATE INDEX IF NOT EXISTS idx_conversation_events_request
ON conversation_events (request_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_activities (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  message_id TEXT,
  activity_type TEXT NOT NULL,
  tone TEXT NOT NULL,
  tool_type TEXT,
  tool_call_id TEXT,
  approval_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  is_final INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_activities_message
ON conversation_activities (message_id, sequence);

CREATE INDEX IF NOT EXISTS idx_conversation_activities_conversation
ON conversation_activities (conversation_id, sequence);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_sequence INTEGER NOT NULL,
  completed_sequence INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_conversation
ON conversation_turns (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  message_id TEXT,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT,
  tool_type TEXT,
  reason TEXT,
  status TEXT NOT NULL,
  decision TEXT,
  session_scope_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_pending
ON approval_requests (conversation_id, status, created_at);

CREATE TABLE IF NOT EXISTS conversation_checkpoints (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  message_sequence INTEGER NOT NULL,
  activity_sequence INTEGER NOT NULL,
  pending_approvals_json TEXT NOT NULL,
  file_change_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_conversation
ON conversation_checkpoints (conversation_id, sequence DESC);

CREATE TABLE IF NOT EXISTS provider_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_sessions_request
ON provider_sessions (request_id);

CREATE TABLE IF NOT EXISTS saved_visuals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  visual_type TEXT NOT NULL DEFAULT 'iframe',
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  source_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_visuals_updated_at
ON saved_visuals (updated_at DESC);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  draft_version_id TEXT,
  current_version_id TEXT,
  source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sites_updated_at
ON sites (deleted_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS site_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  label TEXT,
  state TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 0,
  files_root TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER NOT NULL DEFAULT 0,
  build_log TEXT,
  validation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (site_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_site_versions_site
ON site_versions (site_id, version_no DESC);

CREATE TABLE IF NOT EXISTS site_files (
  version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  mime TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (version_id, path)
);

CREATE TABLE IF NOT EXISTS site_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id TEXT,
  event_type TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_events_site
ON site_events (site_id, created_at DESC);

-- User-configured model endpoints. The API key itself lives in the OS
-- keychain, keyed by the provider id; only its presence is tracked here.
CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_format TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_provider_models (
  provider_id TEXT NOT NULL REFERENCES custom_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  label TEXT NOT NULL,
  is_free INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  max_output_tokens INTEGER,
  supports_tools INTEGER,
  -- NULL means unknown; see model_cache above.
  supports_vision INTEGER,
  supports_document_input INTEGER,
  supports_reasoning INTEGER NOT NULL DEFAULT 1,
  supports_temperature INTEGER NOT NULL DEFAULT 1,
  reasoning_efforts TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_provider_models_provider
ON custom_provider_models (provider_id, sort_order);

-- A folder the user attached. The root column is the writable boundary in Code
-- mode and the shell working directory in both modes, so it is stored once and
-- resolved in the main process — never sent up from the renderer.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  root TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  -- Same reasoning as conversations.pinned_at above: a timestamp, so the pinned
  -- section keeps a stable order of its own, independent of recency.
  pinned_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_last_used
ON projects (last_used_at DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_env_vars (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_project_env_vars_project
ON project_env_vars (project_id);

CREATE TABLE IF NOT EXISTS file_changes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  before_content TEXT,
  after_content TEXT,
  diff_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tool_call_id TEXT,
  -- Counted from diff_text when the row is written. The sidebar wants
  -- "+240 −18" for every conversation at once, and parsing every stored diff to
  -- answer that would make an aggregate over text the price of drawing a list.
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_changes_conversation
ON file_changes (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS terminal_history (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  exit_code INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_terminal_history_conversation
ON terminal_history (conversation_id, started_at);
`;

export function applySchema(database: SqliteDatabase) {
  database.exec(SCHEMA);

  const columns = database
    .prepare<
      [],
      {
        name: string;
      }
    >('PRAGMA table_info(messages)')
    .all()
    .map((column) => column.name);

  if (!columns.includes('reasoning')) {
    database.exec('ALTER TABLE messages ADD COLUMN reasoning TEXT');
  }

  if (!columns.includes('parts_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN parts_json TEXT');
  }

  if (!columns.includes('reasoning_tokens')) {
    database.exec('ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER');
  }

  if (!columns.includes('response_messages_json')) {
    database.exec('ALTER TABLE messages ADD COLUMN response_messages_json TEXT');
  }

  const toolExecutionColumns = database
    .prepare<
      [],
      {
        name: string;
      }
    >('PRAGMA table_info(tool_executions)')
    .all()
    .map((column) => column.name);

  if (toolExecutionColumns.length > 0) {
    if (!toolExecutionColumns.includes('input_json')) {
      database.exec('ALTER TABLE tool_executions ADD COLUMN input_json TEXT');
    }

    if (!toolExecutionColumns.includes('output_json')) {
      database.exec('ALTER TABLE tool_executions ADD COLUMN output_json TEXT');
    }
  }

  const modelColumns = database
    .prepare<
      [],
      {
        name: string;
      }
    >('PRAGMA table_info(model_cache)')
    .all()
    .map((column) => column.name);

  if (!modelColumns.includes('supports_document_input')) {
    database.exec('ALTER TABLE model_cache ADD COLUMN supports_document_input INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: per-model request limits so adapters stop hardcoding one ceiling
  // for every model on a provider.
  if (!modelColumns.includes('max_output_tokens')) {
    database.exec('ALTER TABLE model_cache ADD COLUMN max_output_tokens INTEGER');
  }

  if (!modelColumns.includes('supports_temperature')) {
    database.exec('ALTER TABLE model_cache ADD COLUMN supports_temperature INTEGER NOT NULL DEFAULT 1');
  }

  if (!modelColumns.includes('supports_reasoning')) {
    database.exec('ALTER TABLE model_cache ADD COLUMN supports_reasoning INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: per-model reasoning-effort vocabulary from models.dev, stored as
  // a JSON array. NULL means the catalog never said which levels the model takes.
  if (!modelColumns.includes('reasoning_efforts')) {
    database.exec('ALTER TABLE model_cache ADD COLUMN reasoning_efforts TEXT');
  }

  const customModelColumns = database
    .prepare<[], { name: string }>('PRAGMA table_info(custom_provider_models)')
    .all()
    .map((column) => column.name);

  if (customModelColumns.length > 0 && !customModelColumns.includes('is_free')) {
    database.exec('ALTER TABLE custom_provider_models ADD COLUMN is_free INTEGER NOT NULL DEFAULT 0');
  }

  if (customModelColumns.length > 0 && !customModelColumns.includes('reasoning_efforts')) {
    database.exec('ALTER TABLE custom_provider_models ADD COLUMN reasoning_efforts TEXT');
  }

  // Migration: track whether a conversation title was machine-generated, so
  // an auto-name can be improved on later while a user rename is final.
  const conversationColumns = database
    .prepare<[], { name: string }>('PRAGMA table_info(conversations)')
    .all()
    .map((column) => column.name);

  if (!conversationColumns.includes('title_auto')) {
    database.exec('ALTER TABLE conversations ADD COLUMN title_auto INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: per-conversation workspace mode and project. Existing threads
  // land in 'work' with no project, which is exactly what they had access to
  // before the split — no conversation gains capability by upgrading.
  if (!conversationColumns.includes('workspace_mode')) {
    database.exec("ALTER TABLE conversations ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'work'");
  }

  if (!conversationColumns.includes('project_id')) {
    database.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL');
  }

  if (!conversationColumns.includes('status')) {
    database.exec("ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'");
  }

  if (!conversationColumns.includes('last_error')) {
    database.exec('ALTER TABLE conversations ADD COLUMN last_error TEXT');
  }

  if (!conversationColumns.includes('started_at')) {
    database.exec('ALTER TABLE conversations ADD COLUMN started_at TEXT');
  }

  if (!conversationColumns.includes('completed_at')) {
    database.exec('ALTER TABLE conversations ADD COLUMN completed_at TEXT');
  }

  if (!conversationColumns.includes('tool_permission_mode')) {
    database.exec("ALTER TABLE conversations ADD COLUMN tool_permission_mode TEXT NOT NULL DEFAULT 'ask'");
  }

  // Migration: pin and archive. Both default to NULL, so every existing
  // conversation reads back as unpinned and unarchived — nothing disappears
  // from the sidebar on upgrade.
  if (!conversationColumns.includes('pinned_at')) {
    database.exec('ALTER TABLE conversations ADD COLUMN pinned_at TEXT');
  }

  if (!conversationColumns.includes('archived_at')) {
    database.exec('ALTER TABLE conversations ADD COLUMN archived_at TEXT');
  }

  // Migration: pinned projects. `projects` is younger than the migration block
  // and had never been probed, so it gets its own column read.
  const projectColumns = database
    .prepare<[], { name: string }>('PRAGMA table_info(projects)')
    .all()
    .map((column) => column.name);

  if (projectColumns.length > 0 && !projectColumns.includes('pinned_at')) {
    database.exec('ALTER TABLE projects ADD COLUMN pinned_at TEXT');
  }

  // Migration: precomputed diff line counts. Both default to 0, so rows written
  // before this lands read as "changed nothing" until the backfill below runs —
  // which is why the backfill is not optional.
  const fileChangeColumns = database
    .prepare<[], { name: string }>('PRAGMA table_info(file_changes)')
    .all()
    .map((column) => column.name);

  if (!fileChangeColumns.includes('lines_added')) {
    database.exec('ALTER TABLE file_changes ADD COLUMN lines_added INTEGER NOT NULL DEFAULT 0');
  }

  if (!fileChangeColumns.includes('lines_removed')) {
    database.exec('ALTER TABLE file_changes ADD COLUMN lines_removed INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: Add border_radius to app_settings
  const settingsKeys = database
    .prepare<[], { key: string }>('SELECT key FROM app_settings')
    .all()
    .map((row) => row.key);

  if (!settingsKeys.includes('appearance.borderRadius')) {
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('appearance.borderRadius', 'theme-default');
  }

  // Migration: capabilities are no longer asked for when adding a model — a
  // bare endpoint can't describe them, so every custom model is assumed fully
  // capable and the provider rejects what it can't do. Rows saved before that
  // change carry explicit false flags; flip them once.
  if (!settingsKeys.includes('migrations.customModelFullCapabilities')) {
    database.exec(
      `UPDATE custom_provider_models SET
        supports_tools = 1,
        supports_vision = 1,
        supports_document_input = 1,
        supports_reasoning = 1,
        supports_temperature = 1`
    );
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('migrations.customModelFullCapabilities', 'done');
  }

  // Migration: an early build stored models.dev's empty reasoning_options as
  // "no levels" ('[]'), but empty only means the entry was not catalogued yet.
  // Reset those rows to unknown so the startup backfill resolves them again.
  if (!settingsKeys.includes('migrations.reasoningEffortsEmptyReset')) {
    database.exec(`UPDATE custom_provider_models SET reasoning_efforts = NULL WHERE reasoning_efforts = '[]'`);
    database.exec(`UPDATE model_cache SET reasoning_efforts = NULL WHERE reasoning_efforts = '[]'`);
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('migrations.reasoningEffortsEmptyReset', 'done');
  }

  // Migration: image and document support become three-valued.
  //
  // Both columns were NOT NULL, so the two sources of truth had to lie in
  // opposite directions — discovery wrote 0 ("cannot see") for every
  // OpenAI-compatible model, and the migration above wrote 1 ("can see") for
  // every hand-added one. Neither was knowledge. SQLite cannot drop a NOT NULL
  // constraint in place, hence the rebuild; every existing value is discarded
  // as an assumption, and the models.dev backfill re-fills what is actually
  // known on the next launch.
  if (!settingsKeys.includes('migrations.modalitySupportTriState')) {
    database.exec(`
      ALTER TABLE model_cache RENAME TO model_cache_pre_tristate;

      CREATE TABLE model_cache (
        model_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        context_window INTEGER,
        is_free INTEGER NOT NULL DEFAULT 0,
        supports_vision INTEGER,
        supports_document_input INTEGER,
        supports_tools INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT NOT NULL,
        last_seen_free_at TEXT,
        max_output_tokens INTEGER,
        supports_temperature INTEGER NOT NULL DEFAULT 1,
        supports_reasoning INTEGER NOT NULL DEFAULT 0,
        reasoning_efforts TEXT
      );

      INSERT INTO model_cache (
        model_id, provider_id, label, context_window, is_free,
        supports_vision, supports_document_input, supports_tools, archived,
        last_synced_at, last_seen_free_at, max_output_tokens,
        supports_temperature, supports_reasoning, reasoning_efforts
      )
      SELECT
        model_id, provider_id, label, context_window, is_free,
        NULL, NULL, supports_tools, archived,
        last_synced_at, last_seen_free_at, max_output_tokens,
        supports_temperature, supports_reasoning, reasoning_efforts
      FROM model_cache_pre_tristate;

      DROP TABLE model_cache_pre_tristate;

      ALTER TABLE custom_provider_models RENAME TO custom_provider_models_pre_tristate;

      CREATE TABLE custom_provider_models (
        provider_id TEXT NOT NULL REFERENCES custom_providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        label TEXT NOT NULL,
        is_free INTEGER NOT NULL DEFAULT 0,
        context_window INTEGER,
        max_output_tokens INTEGER,
        supports_tools INTEGER NOT NULL DEFAULT 1,
        supports_vision INTEGER,
        supports_document_input INTEGER,
        supports_reasoning INTEGER NOT NULL DEFAULT 1,
        supports_temperature INTEGER NOT NULL DEFAULT 1,
        reasoning_efforts TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_id, model_id)
      );

      INSERT INTO custom_provider_models (
        provider_id, model_id, label, is_free, context_window, max_output_tokens,
        supports_tools, supports_vision, supports_document_input,
        supports_reasoning, supports_temperature, reasoning_efforts, sort_order
      )
      SELECT
        provider_id, model_id, label, is_free, context_window, max_output_tokens,
        supports_tools, NULL, NULL,
        supports_reasoning, supports_temperature, reasoning_efforts, sort_order
      FROM custom_provider_models_pre_tristate;

      DROP TABLE custom_provider_models_pre_tristate;

      CREATE INDEX IF NOT EXISTS idx_custom_provider_models_provider
      ON custom_provider_models (provider_id, sort_order);
    `);
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('migrations.modalitySupportTriState', 'done');
  }

  // Migration: tool-calling support joins the modalities in being three-valued.
  //
  // Same argument, same shape as `modalitySupportTriState` above: `1` here was
  // an assumption written by the add-model path, not a fact, and a model that
  // cannot take tools has no way to say so except by refusing a turn — which is
  // now recorded. Values are reset to unknown and re-filled from models.dev by
  // the startup backfill.
  if (!settingsKeys.includes('migrations.toolSupportTriState')) {
    database.exec(`
      ALTER TABLE model_cache RENAME TO model_cache_pre_tools_tristate;

      CREATE TABLE model_cache (
        model_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        context_window INTEGER,
        is_free INTEGER NOT NULL DEFAULT 0,
        supports_vision INTEGER,
        supports_document_input INTEGER,
        supports_tools INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT NOT NULL,
        last_seen_free_at TEXT,
        max_output_tokens INTEGER,
        supports_temperature INTEGER NOT NULL DEFAULT 1,
        supports_reasoning INTEGER NOT NULL DEFAULT 0,
        reasoning_efforts TEXT
      );

      INSERT INTO model_cache (
        model_id, provider_id, label, context_window, is_free,
        supports_vision, supports_document_input, supports_tools, archived,
        last_synced_at, last_seen_free_at, max_output_tokens,
        supports_temperature, supports_reasoning, reasoning_efforts
      )
      SELECT
        model_id, provider_id, label, context_window, is_free,
        supports_vision, supports_document_input, NULL, archived,
        last_synced_at, last_seen_free_at, max_output_tokens,
        supports_temperature, supports_reasoning, reasoning_efforts
      FROM model_cache_pre_tools_tristate;

      DROP TABLE model_cache_pre_tools_tristate;

      ALTER TABLE custom_provider_models RENAME TO custom_provider_models_pre_tools_tristate;

      CREATE TABLE custom_provider_models (
        provider_id TEXT NOT NULL REFERENCES custom_providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        label TEXT NOT NULL,
        is_free INTEGER NOT NULL DEFAULT 0,
        context_window INTEGER,
        max_output_tokens INTEGER,
        supports_tools INTEGER,
        supports_vision INTEGER,
        supports_document_input INTEGER,
        supports_reasoning INTEGER NOT NULL DEFAULT 1,
        supports_temperature INTEGER NOT NULL DEFAULT 1,
        reasoning_efforts TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider_id, model_id)
      );

      INSERT INTO custom_provider_models (
        provider_id, model_id, label, is_free, context_window, max_output_tokens,
        supports_tools, supports_vision, supports_document_input,
        supports_reasoning, supports_temperature, reasoning_efforts, sort_order
      )
      SELECT
        provider_id, model_id, label, is_free, context_window, max_output_tokens,
        NULL, supports_vision, supports_document_input,
        supports_reasoning, supports_temperature, reasoning_efforts, sort_order
      FROM custom_provider_models_pre_tools_tristate;

      DROP TABLE custom_provider_models_pre_tools_tristate;

      CREATE INDEX IF NOT EXISTS idx_custom_provider_models_provider
      ON custom_provider_models (provider_id, sort_order);
    `);
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('migrations.toolSupportTriState', 'done');
  }

  // Migration: backfill the diff line counts for rows written before the two
  // columns existed. Recomputing from diff_text is deterministic, so running
  // this against an already-backfilled database changes nothing; the settings
  // key exists only so a launch does not re-parse every diff ever stored.
  if (!settingsKeys.includes('migrations.fileChangeLineCounts')) {
    const rows = database
      .prepare<[], { id: string; diff_text: string }>('SELECT id, diff_text FROM file_changes')
      .all();

    const update = database.prepare(
      'UPDATE file_changes SET lines_added = @linesAdded, lines_removed = @linesRemoved WHERE id = @id'
    );

    for (const row of rows) {
      const { linesAdded, linesRemoved } = countDiffLines(row.diff_text);
      update.run({ id: row.id, linesAdded, linesRemoved });
    }

    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run('migrations.fileChangeLineCounts', 'done');
  }

  applyMessageSearchIndex(database, settingsKeys.includes(MESSAGE_SEARCH_BACKFILL_KEY));
}

/** The FTS5 index over `messages.content`, and the name search probes for. */
export const MESSAGE_SEARCH_TABLE = 'messages_fts';

const MESSAGE_SEARCH_BACKFILL_KEY = 'migrations.messageSearchBackfill';

/**
 * External-content FTS5: the index stores postings, `messages` stays the only
 * copy of the text. A contentless table would have been smaller still, but it
 * cannot serve `snippet()` — and a search result without the matching line in
 * it is just a list of chat titles again, which is what this replaces.
 *
 * The triggers are the documented external-content pattern. The update trigger
 * is deliberately unconditional on *which* columns moved and only skips when
 * the text is unchanged: the delete side has to be handed exactly the text that
 * was indexed, so skipping a content write (during streaming, say) and catching
 * up later would delete tokens that were never inserted and quietly corrupt the
 * index. Status-only updates — the common case — still cost nothing.
 */
const MESSAGE_SEARCH_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS ${MESSAGE_SEARCH_TABLE} USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO ${MESSAGE_SEARCH_TABLE}(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO ${MESSAGE_SEARCH_TABLE}(${MESSAGE_SEARCH_TABLE}, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages
WHEN old.content IS NOT new.content BEGIN
  INSERT INTO ${MESSAGE_SEARCH_TABLE}(${MESSAGE_SEARCH_TABLE}, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO ${MESSAGE_SEARCH_TABLE}(rowid, content) VALUES (new.rowid, new.content);
END;
`;

/**
 * Build the message search index, or decide the app lives without one.
 *
 * FTS5 is a compile-time option. It is present in the better-sqlite3 build this
 * app ships and in node:sqlite, but a rebuild against a system SQLite that
 * lacks it would make every statement here fail — and a schema step that throws
 * on boot is an app that will not start, to add a search box. So the failure is
 * swallowed and `MessageSearchRepo` falls back to a LIKE scan when it finds no
 * index. The virtual table is created first on purpose: its failure aborts the
 * script before any trigger can be left pointing at a table that is not there.
 */
function applyMessageSearchIndex(database: SqliteDatabase, alreadyBackfilled: boolean) {
  const hadIndex = Boolean(
    database
      .prepare<[string], { present: number }>(
        `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`
      )
      .get(MESSAGE_SEARCH_TABLE)
  );

  try {
    database.exec(MESSAGE_SEARCH_SCHEMA);
  } catch {
    return;
  }

  // 'rebuild' re-derives the whole index from `messages`, which is both the
  // one-time backfill for existing rows and a repair. It reads every message,
  // so it is done once and remembered rather than on every launch — except when
  // the table was not there a moment ago, in which case it was just created
  // empty and the remembered "already backfilled" would be a promise about an
  // index that no longer exists.
  if (!hadIndex || !alreadyBackfilled) {
    database.exec(`INSERT INTO ${MESSAGE_SEARCH_TABLE}(${MESSAGE_SEARCH_TABLE}) VALUES('rebuild')`);
    database
      .prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)')
      .run(MESSAGE_SEARCH_BACKFILL_KEY, 'done');
  }
}
