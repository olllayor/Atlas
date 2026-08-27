import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppliedSqliteTestDatabase } from './helpers/sqliteTestDb.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';

/**
 * The plugin beta switch: default off, live-readable, survives a restart.
 */
test('plugins are a beta feature and default to off', () => {
  const { database } = createAppliedSqliteTestDatabase();
  const settings = new SettingsRepo(database);

  assert.equal(settings.getPluginsBetaEnabled(), false, 'off until the user says otherwise');

  settings.setPluginsBetaEnabled(true);
  assert.equal(settings.getPluginsBetaEnabled(), true);

  // A fresh repo over the same database — what a restart is.
  const reopened = new SettingsRepo(database);
  assert.equal(reopened.getPluginsBetaEnabled(), true, 'the choice survives the process');
});
