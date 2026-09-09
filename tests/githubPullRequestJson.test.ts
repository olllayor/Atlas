import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PR_DETAIL_FIELDS,
  PR_LIST_FIELDS,
  decodeCheck,
  decodePullRequestActivity,
  decodePullRequestDetail,
  decodePullRequestList,
  rollupChecksState
} from '../src/main/workspace/githubPullRequestJson.js';

const ROW = {
  number: 12,
  title: 'Add worktrees',
  url: 'https://github.com/o/r/pull/12',
  author: { login: 'olllayor', name: 'Olloyor' },
  headRefName: 'feature',
  baseRefName: 'dev',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'APPROVED',
  additions: 10,
  deletions: 2,
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
  mergedAt: null,
  reviewRequests: [{ __typename: 'User', login: 'reviewer' }, { __typename: 'Team', name: 'core' }],
  labels: [{ name: 'bug', color: 'd73a4a' }],
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }
  ]
};

test('the detail field set extends the list one, so a row decodes the same either way', () => {
  assert.ok(PR_DETAIL_FIELDS.startsWith(PR_LIST_FIELDS));
});

test('a list row decodes into the contract shape', () => {
  const [entry] = decodePullRequestList(JSON.stringify([ROW]));

  assert.equal(entry?.number, 12);
  assert.equal(entry?.state, 'open');
  assert.equal(entry?.mergeability, 'mergeable');
  assert.equal(entry?.reviewDecision, 'approved');
  assert.equal(entry?.author?.login, 'olllayor');
  assert.equal(entry?.checksState, 'passing');
  assert.deepEqual(entry?.labels, [{ name: 'bug', color: 'd73a4a' }]);
});

test('team review requests are dropped, since a row has nowhere to name a team', () => {
  const [entry] = decodePullRequestList(JSON.stringify([ROW]));
  assert.deepEqual(entry?.reviewRequests, ['reviewer']);
});

test('a malformed row is dropped rather than failing the whole page', () => {
  const entries = decodePullRequestList(
    JSON.stringify([ROW, { title: 'no number or url' }, { ...ROW, number: 13 }])
  );

  assert.deepEqual(
    entries.map((entry) => entry.number),
    [12, 13]
  );
});

test('output that is not JSON at all is an error, not an empty list', () => {
  // `gh` printing something else means the command did not do what was asked,
  // which the caller must not read as "this repository has no pull requests".
  assert.throws(() => decodePullRequestList('gh: command failed'), /Could not read/);
});

test('empty output is an empty list', () => {
  assert.deepEqual(decodePullRequestList('   '), []);
});

test('a running check outranks the conclusion it still carries', () => {
  const check = decodeCheck({ name: 'test', status: 'IN_PROGRESS', conclusion: 'FAILURE' });
  assert.equal(check?.status, 'pending');
});

test('a StatusContext decodes from its state alone', () => {
  assert.equal(decodeCheck({ context: 'ci/legacy', state: 'SUCCESS' })?.status, 'success');
  assert.equal(decodeCheck({ context: 'ci/legacy', state: 'ERROR' })?.status, 'failure');
});

test('failing outranks pending in the rollup', () => {
  const state = rollupChecksState([
    { name: 'a', status: 'pending', url: null },
    { name: 'b', status: 'failure', url: null }
  ]);

  assert.equal(state, 'failing');
});

test('a rollup of only skipped runs reports nothing rather than passing', () => {
  const state = rollupChecksState([
    { name: 'a', status: 'skipped', url: null },
    { name: 'b', status: 'cancelled', url: null }
  ]);

  assert.equal(state, null);
});

test('no checks at all is an absent state, which matches neither filter', () => {
  assert.equal(rollupChecksState([]), null);
});

test('a detail carries the body and file count the list row has no room for', () => {
  const detail = decodePullRequestDetail(
    JSON.stringify({ ...ROW, body: '## Why', changedFiles: 4, headRefOid: 'abc123', closedAt: null })
  );

  assert.equal(detail?.body, '## Why');
  assert.equal(detail?.changedFiles, 4);
  assert.equal(detail?.headRefOid, 'abc123');
  assert.equal(detail?.checks.length, 1);
});

test('comments and reviews read as one thread, oldest first', () => {
  const activity = decodePullRequestActivity(
    JSON.stringify({
      comments: [
        { id: 'c1', author: { login: 'a' }, body: 'first', createdAt: '2026-09-01T00:00:00Z' },
        { id: 'c2', author: { login: 'b' }, body: 'third', createdAt: '2026-09-03T00:00:00Z' }
      ],
      reviews: [
        {
          id: 'r1',
          author: { login: 'c' },
          body: 'second',
          submittedAt: '2026-09-02T00:00:00Z',
          state: 'APPROVED'
        }
      ],
      commits: [{ oid: 'deadbeef', messageHeadline: 'fix', authors: [{ login: 'a' }] }]
    })
  );

  assert.deepEqual(
    activity.comments.map((comment) => comment.body),
    ['first', 'second', 'third']
  );
  assert.equal(activity.comments[1]?.verdict, 'approved');
  assert.equal(activity.commits[0]?.author?.login, 'a');
});

test('a bare COMMENTED review with no body is dropped, since it would render blank', () => {
  const activity = decodePullRequestActivity(
    JSON.stringify({
      comments: [],
      reviews: [
        { id: 'r1', author: { login: 'c' }, body: '', submittedAt: '2026-09-02T00:00:00Z', state: 'COMMENTED' }
      ],
      commits: []
    })
  );

  assert.deepEqual(activity.comments, []);
});

test('an approval with no body is kept, because the verdict is the content', () => {
  const activity = decodePullRequestActivity(
    JSON.stringify({
      comments: [],
      reviews: [
        { id: 'r1', author: { login: 'c' }, body: '', submittedAt: '2026-09-02T00:00:00Z', state: 'APPROVED' }
      ],
      commits: []
    })
  );

  assert.equal(activity.comments.length, 1);
  assert.equal(activity.comments[0]?.verdict, 'approved');
});

test('an unparseable timestamp sorts last rather than claiming to be the oldest', () => {
  const activity = decodePullRequestActivity(
    JSON.stringify({
      comments: [
        { id: 'c1', author: { login: 'a' }, body: 'undated', createdAt: '' },
        { id: 'c2', author: { login: 'b' }, body: 'dated', createdAt: '2026-09-01T00:00:00Z' }
      ],
      reviews: [],
      commits: []
    })
  );

  assert.deepEqual(
    activity.comments.map((comment) => comment.body),
    ['dated', 'undated']
  );
});
