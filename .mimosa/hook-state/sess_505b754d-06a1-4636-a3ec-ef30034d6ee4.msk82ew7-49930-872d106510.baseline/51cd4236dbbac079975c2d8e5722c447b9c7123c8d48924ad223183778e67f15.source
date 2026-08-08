/**
 * Picking a model is per-conversation and has to survive a restart.
 *
 * The bug these cover: the conversation's own `default_model_id` column was
 * written only by the send path, so picking a model and not sending lost the
 * pick, and the chat then fell through to the global `chat.lastModelId` — that
 * is, to whatever had been picked last in some *other* chat. These pin both
 * halves: the resolution order that decides which model a chat opens on, and
 * the write that keeps provider and model together in the row.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { chooseDefaultModel, resolveSelectedModelId } from '../src/renderer/stores/useAppStore.js';
import type { ConversationPage, ModelSummary } from '../src/shared/contracts.js';

function model(id: string, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id,
    providerId: 'custom:one',
    label: id,
    contextWindow: 200_000,
    isFree: false,
    supportsVision: false,
    supportsDocumentInput: false,
    supportsTools: true,
    archived: false,
    lastSyncedAt: '2026-07-30T00:00:00.000Z',
    lastSeenFreeAt: null,
    ...overrides,
  };
}

/** Only the field the resolver reads; the rest of the page is irrelevant here. */
function pageWithSavedModel(modelId: string | null): ConversationPage {
  return { conversation: { defaultModelId: modelId } } as unknown as ConversationPage;
}

// ---------------------------------------------------------------------------
// Resolution order
// ---------------------------------------------------------------------------

test('a conversation with its own saved model ignores the global last-used model', () => {
  const models = [model('saved-one'), model('last-used')];

  const resolved =
    resolveSelectedModelId('chat1', {}, { chat1: pageWithSavedModel('saved-one') }, models) ??
    chooseDefaultModel(models, null, 'last-used');

  // The regression: this used to answer 'last-used', so opening an old chat
  // showed whatever had been picked most recently anywhere in the app.
  assert.equal(resolved, 'saved-one');
});

test('a conversation without a saved model falls through to the global last-used one', () => {
  const models = [model('some-other'), model('last-used')];

  const resolved =
    resolveSelectedModelId('chat1', {}, { chat1: pageWithSavedModel(null) }, models) ??
    chooseDefaultModel(models, null, 'last-used');

  // `lastModelId` still earns its place at the end of the order: a brand-new
  // chat opens on what the user was just using.
  assert.equal(resolved, 'last-used');
});

test('a saved model the catalog no longer offers is not returned', () => {
  // The provider was disabled: its models left the catalog, but the row still
  // names one. Persisting must not resurrect it — an id nothing can serve is a
  // send that fails in the main process.
  const models = [model('still-here')];

  assert.equal(resolveSelectedModelId('chat1', {}, { chat1: pageWithSavedModel('gone') }, models), null);

  // And the caller's fallback takes over rather than the dead id sticking.
  const resolved =
    resolveSelectedModelId('chat1', {}, { chat1: pageWithSavedModel('gone') }, models) ??
    chooseDefaultModel(models, null, null);
  assert.equal(resolved, 'still-here');
});

test('an in-memory pick outranks the saved one, but only while the catalog serves it', () => {
  const models = [model('saved-one'), model('picked-now')];
  const details = { chat1: pageWithSavedModel('saved-one') };

  assert.equal(resolveSelectedModelId('chat1', { chat1: 'picked-now' }, details, models), 'picked-now');

  // A pick whose provider has since gone falls back to the saved model rather
  // than to nothing.
  assert.equal(resolveSelectedModelId('chat1', { chat1: 'vanished' }, details, models), 'saved-one');
});

// ---------------------------------------------------------------------------
// The write: provider and model are one unit
// ---------------------------------------------------------------------------

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as SqliteDatabase;
}

function makeRepo(t: TestContext) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-model-defaults-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const db = wrap(raw);
  applySchema(db);
  return { raw, conversations: new ConversationsRepo(db) };
}

test('setDefaults records the provider alongside the model, not one without the other', (t) => {
  const { raw, conversations } = makeRepo(t);
  const conversation = conversations.create();

  conversations.setDefaults(conversation.id, 'openrouter', 'openrouter/test-model');

  const row = raw
    .prepare('SELECT default_provider_id, default_model_id FROM conversations WHERE id = ?')
    .get(conversation.id) as { default_provider_id: string; default_model_id: string };

  // The pair is the point: a model id stored against the wrong provider only
  // surfaces later, as a send the main process cannot route.
  assert.equal(row.default_provider_id, 'openrouter');
  assert.equal(row.default_model_id, 'openrouter/test-model');
});

test('re-picking moves the provider with the model', (t) => {
  const { raw, conversations } = makeRepo(t);
  const conversation = conversations.create();

  conversations.setDefaults(conversation.id, 'openrouter', 'openrouter/test-model');
  // Switching to a model from a different provider must not leave the old
  // provider behind next to the new model id.
  conversations.setDefaults(conversation.id, 'custom:one', 'custom-one/other-model');

  const row = raw
    .prepare('SELECT default_provider_id, default_model_id FROM conversations WHERE id = ?')
    .get(conversation.id) as { default_provider_id: string; default_model_id: string };

  assert.equal(row.default_provider_id, 'custom:one');
  assert.equal(row.default_model_id, 'custom-one/other-model');
});

test('a picked model is readable back as the conversation default without a send', (t) => {
  const { conversations } = makeRepo(t);
  const conversation = conversations.create();

  // No message is ever added: this is exactly the case that used to be lost,
  // because only the send path wrote these columns.
  conversations.setDefaults(conversation.id, 'openrouter', 'openrouter/test-model');

  const reloaded = conversations.get(conversation.id);
  assert.equal(reloaded.conversation.defaultModelId, 'openrouter/test-model');
  assert.equal(reloaded.conversation.defaultProviderId, 'openrouter');
});
