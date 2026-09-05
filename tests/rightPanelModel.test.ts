import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_PANEL_STATE,
  type ConversationPanelState,
  activateSurface,
  closeAllSurfaces,
  closeOtherSurfaces,
  closeSurface,
  closeSurfacesToRight,
  makeSurface,
  migratePersistedRightPanelState,
  openSurface,
  reconcileSurfaces,
  serializeRightPanelState,
  togglePanel,
  updateConversation,
} from '../src/renderer/components/workbench/rightPanelModel.js';

function panelWith(...kinds: Array<'diff' | 'git' | 'tasks' | 'agents'>): ConversationPanelState {
  return kinds.reduce<ConversationPanelState>(
    (state, kind) => openSurface(state, makeSurface(kind)),
    EMPTY_PANEL_STATE
  );
}

test('opening a surface twice activates it rather than duplicating the tab', () => {
  const opened = panelWith('diff', 'git');
  const reopened = openSurface(opened, makeSurface('diff'));

  assert.deepEqual(
    reopened.surfaces.map((surface) => surface.id),
    ['diff', 'git']
  );
  assert.equal(reopened.activeSurfaceId, 'diff');
});

test('opening an already active surface is a no-op, so subscribers can skip', () => {
  const opened = panelWith('diff');
  assert.equal(openSurface(opened, makeSurface('diff')), opened);
});

test('multi-instance kinds are separate surfaces, one per resource', () => {
  const opened = openSurface(
    openSurface(EMPTY_PANEL_STATE, makeSurface('tasks', 'term-1')),
    makeSurface('tasks', 'term-2')
  );

  assert.deepEqual(
    opened.surfaces.map((surface) => surface.id),
    ['tasks:term-1', 'tasks:term-2']
  );
});

test('activating a surface the panel does not hold does nothing', () => {
  const opened = panelWith('diff');
  assert.equal(activateSurface(opened, 'agents'), opened);
});

test('closing the active surface activates the one that took its place', () => {
  const opened = activateSurface(panelWith('diff', 'git', 'tasks'), 'git');
  const closed = closeSurface(opened, 'git');

  assert.deepEqual(
    closed.surfaces.map((surface) => surface.id),
    ['diff', 'tasks']
  );
  assert.equal(closed.activeSurfaceId, 'tasks');
});

test('closing the last surface in the strip falls back to the new last one', () => {
  const opened = panelWith('diff', 'git');
  const closed = closeSurface(opened, 'git');

  assert.equal(closed.activeSurfaceId, 'diff');
});

test('closing an inactive surface leaves the active one alone', () => {
  const opened = activateSurface(panelWith('diff', 'git'), 'diff');
  const closed = closeSurface(opened, 'git');

  assert.equal(closed.activeSurfaceId, 'diff');
});

test('closing the only surface closes the panel', () => {
  const closed = closeSurface(panelWith('diff'), 'diff');

  assert.equal(closed.isOpen, false);
  assert.equal(closed.activeSurfaceId, null);
  assert.deepEqual(closed.surfaces, []);
});

test('close others keeps one surface and makes it active', () => {
  const opened = activateSurface(panelWith('diff', 'git', 'tasks'), 'tasks');
  const closed = closeOtherSurfaces(opened, 'git');

  assert.deepEqual(
    closed.surfaces.map((surface) => surface.id),
    ['git']
  );
  assert.equal(closed.activeSurfaceId, 'git');
});

test('close to the right keeps the active surface when it survives', () => {
  const opened = activateSurface(panelWith('diff', 'git', 'tasks'), 'diff');
  const closed = closeSurfacesToRight(opened, 'git');

  assert.deepEqual(
    closed.surfaces.map((surface) => surface.id),
    ['diff', 'git']
  );
  assert.equal(closed.activeSurfaceId, 'diff');
});

test('close to the right adopts the anchor when the active surface was cut', () => {
  const opened = activateSurface(panelWith('diff', 'git', 'tasks'), 'tasks');
  const closed = closeSurfacesToRight(opened, 'diff');

  assert.equal(closed.activeSurfaceId, 'diff');
});

test('close to the right on the rightmost surface changes nothing', () => {
  const opened = panelWith('diff', 'git');
  assert.equal(closeSurfacesToRight(opened, 'git'), opened);
});

test('close all empties the panel and hides it', () => {
  const closed = closeAllSurfaces(panelWith('diff', 'git'));

  assert.deepEqual(closed, { isOpen: false, surfaces: [], activeSurfaceId: null });
});

test('toggling an empty panel opens it, which is what shows the picker', () => {
  const shown = togglePanel(EMPTY_PANEL_STATE);

  assert.equal(shown.isOpen, true);
  assert.deepEqual(shown.surfaces, []);
  assert.equal(togglePanel(shown).isOpen, false);
});

test('reconcile drops dead surfaces and re-homes the active one', () => {
  const opened = activateSurface(panelWith('diff', 'git', 'tasks'), 'git');
  const alive = reconcileSurfaces(opened, (surface) => surface.kind !== 'git');

  assert.deepEqual(
    alive.surfaces.map((surface) => surface.id),
    ['diff', 'tasks']
  );
  assert.equal(alive.activeSurfaceId, 'diff');
});

test('reconcile is identity when everything is still alive', () => {
  const opened = panelWith('diff', 'git');
  assert.equal(
    reconcileSurfaces(opened, () => true),
    opened
  );
});

test('a conversation whose panel empties out is dropped from the map', () => {
  const withPanel = updateConversation({}, 'c1', () => panelWith('diff'));
  assert.ok('c1' in withPanel);

  const emptied = updateConversation(withPanel, 'c1', closeAllSurfaces);
  assert.deepEqual(emptied, {});
});

test('persisted state survives a round trip', () => {
  const state = { byConversationId: updateConversation({}, 'c1', () => panelWith('diff', 'git')) };
  const restored = migratePersistedRightPanelState(JSON.parse(serializeRightPanelState(state)));

  assert.deepEqual(restored, state);
});

test('migration drops surfaces whose kind is no longer known', () => {
  const restored = migratePersistedRightPanelState({
    version: 1,
    byConversationId: {
      c1: {
        isOpen: true,
        activeSurfaceId: 'plan',
        surfaces: [
          { id: 'plan', kind: 'plan' },
          { id: 'diff', kind: 'diff' },
        ],
      },
    },
  });

  assert.deepEqual(restored.byConversationId.c1.surfaces, [{ id: 'diff', kind: 'diff' }]);
  // The active id pointed at the dropped surface, so it falls back rather than
  // leaving the panel showing nothing with a tab selected.
  assert.equal(restored.byConversationId.c1.activeSurfaceId, 'diff');
});

test('migration rejects a surface whose id no longer names its kind', () => {
  const restored = migratePersistedRightPanelState({
    version: 1,
    byConversationId: {
      c1: { isOpen: true, activeSurfaceId: 'git', surfaces: [{ id: 'git', kind: 'diff' }] },
    },
  });

  assert.deepEqual(restored.byConversationId, {});
});

test('migration tolerates junk instead of throwing it back at the user', () => {
  assert.deepEqual(migratePersistedRightPanelState(null), { byConversationId: {} });
  assert.deepEqual(migratePersistedRightPanelState('{}'), { byConversationId: {} });
  assert.deepEqual(migratePersistedRightPanelState({ byConversationId: 7 }), {
    byConversationId: {},
  });
});
