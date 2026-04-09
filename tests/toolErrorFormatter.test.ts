import assert from 'node:assert/strict';
import test from 'node:test';

import { formatToolError } from '../src/main/ai/tools/ToolErrorFormatter.js';

test('ToolErrorFormatter categorizes common failure types for user-facing errors', () => {
  assert.equal(formatToolError('ENOENT missing file').code, 'not_found');
  assert.equal(formatToolError('permission denied').code, 'permission');
  assert.equal(formatToolError('request timeout reached').code, 'timeout');
  assert.equal(formatToolError('network fetch failed').code, 'network');
  assert.equal(formatToolError('provider returned malformed output').code, 'provider');
  assert.equal(formatToolError('completely unknown').code, 'unknown');
});

test('ToolErrorFormatter includes plain-language summary with optional technical details', () => {
  const notFound = formatToolError('ENOENT: /tmp/file.txt');
  assert.equal(notFound.summary, "Couldn't find the requested file or resource.");
  assert.equal(notFound.technicalDetails, 'ENOENT: /tmp/file.txt');
  assert.equal(notFound.nextStep, 'Verify the path or identifier and try again.');

  const unknown = formatToolError('');
  assert.equal(unknown.summary, "Couldn't complete the tool request.");
  assert.equal(unknown.technicalDetails, undefined);
  assert.equal(unknown.nextStep, 'Try again.');
});
