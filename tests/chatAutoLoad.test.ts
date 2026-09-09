import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OLDER_LOAD_PX,
  OLDER_REARM_PX,
  decideAutoLoad,
  type AutoLoadInput,
} from '../src/renderer/lib/chatAutoLoad.js';

function input(overrides: Partial<AutoLoadInput> = {}): AutoLoadInput {
  return {
    scrollTop: 0,
    armed: false,
    needsUserGesture: false,
    folded: false,
    hasOlder: true,
    isLoadingOlder: false,
    cursor: 'c1',
    lastCursor: null,
    ...overrides,
  };
}

test('decideAutoLoad thresholds leave a clear gap between load and re-arm', () => {
  assert.ok(OLDER_REARM_PX > OLDER_LOAD_PX, 're-arm sits a screenful above the load zone');
});

test('a programmatic restore past the re-arm threshold does not arm paging', () => {
  // The post-prepend scrollToIndex lands at the estimated prepended height.
  const action = decideAutoLoad(input({ scrollTop: 4000, needsUserGesture: true, armed: false }));
  assert.deepEqual(action, { type: 'ignore' });
});

test('the open-at-bottom pin does not arm paging before the user scrolls', () => {
  const action = decideAutoLoad(input({ scrollTop: 9000, needsUserGesture: true }));
  assert.deepEqual(action, { type: 'ignore' });
});

test('a user gesture then leaving the top re-arms paging', () => {
  const action = decideAutoLoad(input({ scrollTop: OLDER_REARM_PX + 1, needsUserGesture: false, armed: false }));
  assert.deepEqual(action, { type: 'rearm' });
});

test('re-entering the load zone while armed fires exactly one load', () => {
  const action = decideAutoLoad(
    input({ scrollTop: OLDER_LOAD_PX, armed: true, needsUserGesture: false, cursor: 'c2', lastCursor: 'c1' })
  );
  assert.deepEqual(action, { type: 'load' });
});

test('a measurement undershoot to the top after a load does not re-fire', () => {
  // After load: armed=false, needsUserGesture=true. Virtualizer shrinks
  // scrollTop into the load zone without the user touching anything.
  const action = decideAutoLoad(
    input({ scrollTop: 0, armed: false, needsUserGesture: true, cursor: 'c2', lastCursor: 'c1' })
  );
  assert.deepEqual(action, { type: 'ignore' });
});

test('a programmatic re-arm followed by an undershoot still does not load', () => {
  // Simulates the infinite-loop sequence without the gesture gate:
  // restore past 800 (would re-arm if allowed), then undershoot to 0.
  // With needsUserGesture set, the re-arm step is a no-op, so the
  // undershoot sees armed=false.
  const restore = decideAutoLoad(input({ scrollTop: 4000, needsUserGesture: true, armed: false }));
  assert.deepEqual(restore, { type: 'ignore' });

  const undershoot = decideAutoLoad(
    input({ scrollTop: 0, needsUserGesture: true, armed: false, cursor: 'c2', lastCursor: 'c1' })
  );
  assert.deepEqual(undershoot, { type: 'ignore' });
});

test('the same cursor never loads twice in a row', () => {
  const action = decideAutoLoad(
    input({ scrollTop: 0, armed: true, needsUserGesture: false, cursor: 'c1', lastCursor: 'c1' })
  );
  assert.deepEqual(action, { type: 'ignore' });
});

test('folded threads never auto-load at the fold boundary', () => {
  const action = decideAutoLoad(
    input({ scrollTop: 0, armed: true, needsUserGesture: false, folded: true, cursor: 'c2', lastCursor: 'c1' })
  );
  assert.deepEqual(action, { type: 'ignore' });
});

test('in-flight loads and missing cursors are ignored', () => {
  assert.deepEqual(
    decideAutoLoad(input({ scrollTop: 0, armed: true, isLoadingOlder: true, cursor: 'c2', lastCursor: 'c1' })),
    { type: 'ignore' }
  );
  assert.deepEqual(
    decideAutoLoad(input({ scrollTop: 0, armed: true, cursor: null, lastCursor: 'c1' })),
    { type: 'ignore' }
  );
  assert.deepEqual(
    decideAutoLoad(input({ scrollTop: 0, armed: true, hasOlder: false, cursor: 'c2', lastCursor: 'c1' })),
    { type: 'ignore' }
  );
});

test('deliberate pagination still works: gesture, re-arm, load, repeat', () => {
  // Open disarmed.
  let armed = false;
  let needsUserGesture = true;
  let lastCursor: string | null = null;

  // Bottom pin (programmatic).
  let action = decideAutoLoad(input({ scrollTop: 9000, armed, needsUserGesture, lastCursor }));
  assert.deepEqual(action, { type: 'ignore' });

  // User scrolls into the thread.
  needsUserGesture = false;
  action = decideAutoLoad(input({ scrollTop: 2000, armed, needsUserGesture, lastCursor }));
  assert.deepEqual(action, { type: 'rearm' });
  armed = true;

  // User reaches the top.
  action = decideAutoLoad(input({ scrollTop: 40, armed, needsUserGesture, cursor: 'c1', lastCursor }));
  assert.deepEqual(action, { type: 'load' });
  armed = false;
  needsUserGesture = true;
  lastCursor = 'c1';

  // Restore lands deep on estimates — must not re-arm.
  action = decideAutoLoad(input({ scrollTop: 5000, armed, needsUserGesture, cursor: 'c2', lastCursor }));
  assert.deepEqual(action, { type: 'ignore' });

  // User scrolls again, leaves the top, comes back for the next page.
  needsUserGesture = false;
  action = decideAutoLoad(input({ scrollTop: 900, armed, needsUserGesture, cursor: 'c2', lastCursor }));
  assert.deepEqual(action, { type: 'rearm' });
  armed = true;

  action = decideAutoLoad(input({ scrollTop: 10, armed, needsUserGesture, cursor: 'c2', lastCursor }));
  assert.deepEqual(action, { type: 'load' });
  assert.equal(lastCursor, 'c1', 'caller would then record c2');
});
