import assert from 'node:assert/strict';
import test from 'node:test';

import { applyStreamEventToParts } from '../src/shared/messageParts.js';

/**
 * The `plugin-invocation` part — attribution's single source of truth.
 *
 * The row is built from the resolution the main process already made, never by
 * re-parsing the message text, so these assert the event-to-part contract that
 * makes the two agree.
 */
test('a plugin invocation becomes a part above the work it scoped', () => {
  const parts = applyStreamEventToParts(
    [{ id: 't1', type: 'text', text: 'already streaming' }],
    {
      type: 'plugin-invocation',
      requestId: 'r1',
      messageId: null,
      plugin: 'github',
      skill: 'pr-review',
      mention: '@github pr-review',
      outcome: 'invoked',
      version: '1.2.0',
      detail: null
    }
  );

  // Prepended: the row states what the turn was scoped to *before* it ran.
  assert.equal(parts[0]?.type, 'plugin-invocation');
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts[0].type === 'plugin-invocation'
      ? { plugin: parts[0].plugin, skill: parts[0].skill, version: parts[0].version }
      : null,
    { plugin: 'github', skill: 'pr-review', version: '1.2.0' }
  );
});

test('re-announcing the same mention does not duplicate the row', () => {
  const event = {
    type: 'plugin-invocation' as const,
    requestId: 'r1',
    messageId: null,
    plugin: 'github',
    skill: null,
    mention: '@github',
    outcome: 'invoked' as const,
    version: '1.0.0',
    detail: null
  };

  // A retried turn re-announces its mentions; two identical rows would make
  // one `@github` look like two.
  const once = applyStreamEventToParts([], event);
  const twice = applyStreamEventToParts(once, event);

  assert.equal(twice.length, 1);
});

test('two skills of one plugin are two rows', () => {
  const base = {
    type: 'plugin-invocation' as const,
    requestId: 'r1',
    messageId: null,
    plugin: 'github',
    mention: '@github',
    outcome: 'invoked' as const,
    version: '1.0.0',
    detail: null
  };

  const parts = applyStreamEventToParts(
    applyStreamEventToParts([], { ...base, skill: 'triage' }),
    { ...base, skill: 'pr-review' }
  );

  assert.equal(parts.length, 2);
});

test('a failed invocation is still recorded, with its reason', () => {
  // The case a user most needs told about: silence is indistinguishable from
  // a typo, and they retype a name that was right all along.
  const [part] = applyStreamEventToParts([], {
    type: 'plugin-invocation',
    requestId: 'r1',
    messageId: null,
    plugin: 'archived',
    skill: null,
    mention: '@archived',
    outcome: 'plugin-disabled',
    version: '2.0.0',
    detail: 'Switched off. Enable it in Plugins.'
  });

  assert.equal(part.type === 'plugin-invocation' && part.outcome, 'plugin-disabled');
  assert.match(part.type === 'plugin-invocation' ? (part.detail ?? '') : '', /Switched off/);
});
