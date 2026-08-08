import assert from 'node:assert/strict';
import test from 'node:test';

import { describePluginUrl, parsePluginUrl } from '../src/shared/pluginUrl.js';

function target(input: string) {
  const result = parsePluginUrl(input);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  if (!result.ok) throw new Error('unreachable');
  return result.target;
}

function refused(input: string): string {
  const result = parsePluginUrl(input);
  assert.equal(result.ok, false, `expected "${input}" to be refused`);
  return result.ok ? '' : result.error;
}

test('a plain repository URL names the repository', () => {
  assert.deepEqual(target('https://github.com/acme/tools'), {
    url: 'https://github.com/acme/tools',
    ref: null,
    subdir: null
  });
});

test('the .git suffix is dropped', () => {
  assert.equal(target('https://github.com/acme/tools.git').url, 'https://github.com/acme/tools');
});

test('a browse URL is the case that matters — ref and subdirectory come out of the path', () => {
  // This is what is actually in someone's address bar when they find a plugin.
  assert.deepEqual(target('https://github.com/acme/tools/tree/main/plugins/kanban'), {
    url: 'https://github.com/acme/tools',
    ref: 'main',
    subdir: 'plugins/kanban'
  });
});

test('the same shape covers GitLab, Bitbucket and Gitea', () => {
  assert.deepEqual(target('https://gitlab.com/acme/tools/-/tree/v2/plugins/kanban'), {
    url: 'https://gitlab.com/acme/tools',
    ref: 'v2',
    subdir: 'plugins/kanban'
  });

  assert.deepEqual(target('https://bitbucket.org/acme/tools/src/main/plugins/kanban'), {
    url: 'https://bitbucket.org/acme/tools',
    ref: 'main',
    subdir: 'plugins/kanban'
  });

  assert.deepEqual(target('https://gitea.example.com/acme/tools/tree/main/p'), {
    url: 'https://gitea.example.com/acme/tools',
    ref: 'main',
    subdir: 'p'
  });
});

test('a blob URL — the link you get from clicking a file — still resolves', () => {
  assert.deepEqual(target('https://github.com/acme/tools/blob/main/plugins/kanban'), {
    url: 'https://github.com/acme/tools',
    ref: 'main',
    subdir: 'plugins/kanban'
  });
});

test('a ref with slashes in it survives', () => {
  const parsed = target('https://github.com/acme/tools/tree/release/2.0/plugins/kanban');

  // Ambiguous by construction — a forge URL cannot distinguish `release/2.0`
  // plus `plugins/kanban` from `release` plus `2.0/plugins/kanban`. Taking the
  // first segment as the ref is the reading that matches every real branch
  // name, and a wrong guess fails loudly at fetch time rather than installing
  // something unexpected.
  assert.equal(parsed.url, 'https://github.com/acme/tools');
  assert.equal(parsed.ref, 'release');
});

test('an issue or pull-request link resolves to the repository rather than erroring', () => {
  // The user meant that repository. Saying "no" to a link that unambiguously
  // names one would be pedantry.
  for (const url of [
    'https://github.com/acme/tools/issues/42',
    'https://github.com/acme/tools/pull/7',
    'https://github.com/acme/tools/releases/tag/v1'
  ]) {
    assert.deepEqual(target(url), { url: 'https://github.com/acme/tools', ref: null, subdir: null });
  }
});

test('an SSH clone address is rewritten rather than rejected', () => {
  // What a forge's "clone with SSH" button hands you. Pasting it is not a
  // mistake worth an error message.
  assert.deepEqual(target('git@github.com:acme/tools.git'), {
    url: 'https://github.com/acme/tools',
    ref: null,
    subdir: null
  });
});

test('plaintext, credentials and non-HTTP schemes are refused', () => {
  // Not just about this fetch: the URL is recorded as provenance and re-cloned
  // on every update, so a plaintext endpoint is a standing downgrade.
  assert.match(refused('http://github.com/acme/tools'), /https/);
  assert.match(refused('https://user:pw@github.com/acme/tools'), /credentials/);
  assert.match(refused('file:///etc/passwd'), /will not fetch/);
  assert.match(refused('ftp://example.com/x'), /will not fetch/);
  assert.match(refused('javascript:alert(1)'), /will not fetch/);
});

test('plain traversal is normalised away before it is ever a subdirectory', () => {
  // `new URL` resolves `..` segments (and their `%2e%2e` spelling) against the
  // path, so these never reach the subdirectory logic as traversal at all —
  // they simply name a different, still-contained path. Asserted rather than
  // assumed, because the containment guard below would otherwise look like the
  // thing standing between this input and an escape when it is not.
  for (const url of [
    'https://github.com/acme/tools/tree/main/../../etc',
    'https://github.com/acme/tools/tree/main/%2e%2e/%2e%2e/etc'
  ]) {
    assert.deepEqual(target(url), { url: 'https://github.com/acme/tools', ref: null, subdir: null });
  }
});

test('an encoded separator cannot smuggle traversal past URL normalisation', () => {
  // `%2F` survives normalisation as one segment and only becomes a separator
  // when the segment is decoded — after `new URL` has stopped looking. This is
  // the input the containment guard exists for.
  assert.match(
    refused('https://github.com/acme/tools/tree/main/a%2F..%2F..%2Fetc'),
    /outside the repository/
  );
});

test('garbage in is an error, not a guess', () => {
  assert.match(refused(''), /Enter a repository URL/);
  assert.match(refused('   '), /Enter a repository URL/);
  assert.match(refused('not a url'), /not a URL/);
  assert.match(refused('https://github.com'), /does not name a repository/);
  assert.match(refused('https://github.com/acme'), /does not name a repository/);
});

test('the description states what will be fetched, not what was typed', () => {
  // Built from the parsed pieces so the user confirms Atlas's reading of the
  // link rather than their own string, which may have carried a fragment, a
  // query, or a `.git` that was dropped.
  assert.equal(
    describePluginUrl(target('https://github.com/acme/tools/tree/main/plugins/kanban')),
    'https://github.com/acme/tools at main in plugins/kanban'
  );
  assert.equal(describePluginUrl(target('https://github.com/acme/tools')), 'https://github.com/acme/tools');
});
