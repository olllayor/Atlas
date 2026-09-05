import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_ICON_NAMES,
  projectIconColorClassName,
  selectProjectIcon,
} from '../src/renderer/lib/projectIcons';

test('classifies project names to semantic icons', () => {
  assert.equal(selectProjectIcon('analytics-db', '/workspace/analytics-db').icon, 'database');
  assert.equal(selectProjectIcon('', 'C:\\work\\mobile-app').icon, 'mobile');
});

test('uses Lucide icons for automatic project icons', () => {
  assert.deepEqual(selectProjectIcon('agent-runtime', '/workspace/agent-runtime'), {
    kind: 'lucide',
    icon: 'ai',
  });
});

test('gives unknown names a stable generic icon', () => {
  const icon = selectProjectIcon('mercury', '/workspace/mercury');

  assert.equal(icon.kind, 'lucide');
  assert.ok(PROJECT_ICON_NAMES.includes(icon.icon));
  assert.deepEqual(selectProjectIcon('mercury', '/elsewhere/mercury'), icon);
});

test('maps icons to stable color classes', () => {
  assert.equal(projectIconColorClassName('database'), 'text-cyan-600');
  assert.equal(projectIconColorClassName('ai'), 'text-violet-600');
});
