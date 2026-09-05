import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppliedSqliteTestDatabase } from './helpers/sqliteTestDb.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';

/**
 * The Atlas Design (Sites) beta switch: default off, live-readable, survives a restart.
 */
test('sites (Atlas Design) is a beta feature and defaults to off', () => {
  const { database } = createAppliedSqliteTestDatabase();
  const settings = new SettingsRepo(database);

  assert.equal(settings.getSitesBetaEnabled(), false, 'off until the user says otherwise');

  settings.setSitesBetaEnabled(true);
  assert.equal(settings.getSitesBetaEnabled(), true);

  // A fresh repo over the same database — what a restart is.
  const reopened = new SettingsRepo(database);
  assert.equal(reopened.getSitesBetaEnabled(), true, 'the choice survives the process');
});
