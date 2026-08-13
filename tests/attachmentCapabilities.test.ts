/**
 * Input-modality rules: what needs a capability, what needs none, and what an
 * unknown capability is allowed to attempt.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAttachmentCapabilityError,
  getAttachmentKind,
  isInlinableTextMediaType,
} from '../src/shared/attachments';
import { detectRejectedCapability } from '../src/main/ai/core/ErrorNormalizer';

const image = { filename: 'shot.png', mediaType: 'image/png' };
const pdf = { filename: 'report.pdf', mediaType: 'application/pdf' };
const markdown = { filename: 'notes.md', mediaType: 'text/markdown' };

test('text formats are their own kind, not documents', () => {
  assert.equal(getAttachmentKind('text/markdown'), 'text');
  assert.equal(getAttachmentKind('application/json'), 'text');
  assert.equal(getAttachmentKind('text/csv'), 'text');
  assert.equal(getAttachmentKind('application/pdf'), 'document');
  assert.equal(getAttachmentKind('image/png'), 'image');
  assert.equal(getAttachmentKind('application/zip'), 'unsupported');

  assert.equal(isInlinableTextMediaType('text/plain'), true);
  assert.equal(isInlinableTextMediaType('application/pdf'), false);
});

test('text attachments ask nothing of the model', () => {
  const textOnly = { supportsVision: false, supportsDocumentInput: false };
  assert.equal(getAttachmentCapabilityError(textOnly, [markdown]), null);
});

test('a known-false modality blocks', () => {
  const textOnly = { supportsVision: false, supportsDocumentInput: false };
  assert.match(getAttachmentCapabilityError(textOnly, [image]) ?? '', /image/i);
  assert.match(getAttachmentCapabilityError(textOnly, [pdf]) ?? '', /document/i);
});

test('an unknown modality is allowed to be attempted', () => {
  const unknown = { supportsVision: null, supportsDocumentInput: null };
  assert.equal(getAttachmentCapabilityError(unknown, [image]), null);
  assert.equal(getAttachmentCapabilityError(unknown, [pdf]), null);
});

test('a known-true modality passes', () => {
  const capable = { supportsVision: true, supportsDocumentInput: true };
  assert.equal(getAttachmentCapabilityError(capable, [image, pdf, markdown]), null);
});

test('provider refusals are classified by capability', () => {
  assert.equal(
    detectRejectedCapability(new Error('This model does not support image input')),
    'image',
  );
  assert.equal(
    detectRejectedCapability(new Error('400 invalid_type: unsupported content image_url')),
    'image',
  );
  assert.equal(
    detectRejectedCapability(new Error('pdf input is not supported for this model')),
    'document',
  );
  assert.equal(
    detectRejectedCapability(new Error('This model does not support tool use')),
    'tools',
  );
  assert.equal(
    detectRejectedCapability(new Error("400: Unsupported parameter: 'tools' for this model")),
    'tools',
  );
  assert.equal(
    detectRejectedCapability(new Error('function calling is not supported')),
    'tools',
  );
});

test('unrelated failures are not read as capability refusals', () => {
  // Recording a false positive would take images away from a model that reads
  // them, so silence is the required answer for anything ambiguous.
  assert.equal(detectRejectedCapability(new Error('rate limit exceeded')), null);
  assert.equal(detectRejectedCapability(new Error('context length exceeded')), null);
  assert.equal(detectRejectedCapability(new Error('The image you generated was blocked')), null);
  assert.equal(detectRejectedCapability(null), null);
});
