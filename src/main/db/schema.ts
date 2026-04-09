import type { SqliteDatabase } from './client';

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
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_document_input INTEGER NOT NULL DEFAULT 0,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT NOT NULL,
  last_seen_free_at TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  default_provider_id TEXT,
  default_model_id TEXT
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

  // Migration: Add border_radius to app_settings
  const settingsKeys = database
    .prepare<[], { key: string }>('SELECT key FROM app_settings')
    .all()
    .map((row) => row.key);

  if (!settingsKeys.includes('appearance.borderRadius')) {
    database
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
      .run('appearance.borderRadius', 'theme-default');
  }
}
