import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  AttachmentStore,
  STAGED_ATTACHMENT_MAX_AGE_MS,
  sweepStaleStagedAttachments,
} from '../src/main/attachments/AttachmentStore';

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('pixels').toString('base64')}`;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function withDir(prefix: string, run: (dir: string) => void): void {
  const dir = tempDir(prefix);
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('AttachmentStore staging', () => {
  it('stages bytes under the staged prefix and adopts them by reference', () => {
    withDir('atlas-stage-', (dir) => {
      const store = new AttachmentStore(dir);
      const staged = store.stageAttachment('conv-1', {
        filename: 'shot.png',
        mediaType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
      assert.match(staged.storageKey, /^conv-1\/staged-[a-f0-9-]{36}\.png$/);
      assert.equal(staged.mediaType, 'image/png');
      assert.equal(staged.sizeBytes, 6);

      const adopted = store.adoptStagedAttachment('conv-1', staged.storageKey, {
        filename: 'shot.png',
        mediaType: 'image/png',
      });
      assert.equal(adopted.storageKey, staged.storageKey);
      assert.equal(adopted.sizeBytes, 6);
    });
  });

  it('rejects bad input at stage time with user copy', () => {
    withDir('atlas-stage-bad-', (dir) => {
      const store = new AttachmentStore(dir);
      assert.throws(
        () => store.stageAttachment('conv-1', { filename: 'run.exe', mediaType: 'application/x-msdownload', dataUrl: PNG_DATA_URL }),
        /not a supported attachment type/
      );
      assert.throws(
        () => store.stageAttachment('conv-1', { filename: 'shot.png', mediaType: 'image/png', dataUrl: 'blob:dead' }),
        /data URLs/
      );
      assert.throws(
        () => store.stageAttachment('../escape', { filename: 'shot.png', mediaType: 'image/png', dataUrl: PNG_DATA_URL }),
        /cannot hold attachments/
      );
    });
  });

  it('refuses oversized bytes at stage time', () => {
    withDir('atlas-stage-big-', (dir) => {
      const store = new AttachmentStore(dir);
      const big = Buffer.alloc(16 * 1024 * 1024, 1).toString('base64');
      assert.throws(
        () => store.stageAttachment('conv-1', { filename: 'big.png', mediaType: 'image/png', dataUrl: `data:image/png;base64,${big}` }),
        /exceeds the attachment size limit/
      );
    });
  });

  it('adopt refuses foreign, missing and message-owned keys', () => {
    withDir('atlas-adopt-', (dir) => {
      const store = new AttachmentStore(dir);
      const staged = store.stageAttachment('conv-1', {
        filename: 'shot.png',
        mediaType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
      // Another conversation cannot claim it.
      assert.throws(
        () => store.adoptStagedAttachment('conv-2', staged.storageKey, { mediaType: 'image/png' }),
        /outside its staged scope/
      );
      // Gone from disk reads as a re-attach request, not a crash.
      assert.throws(
        () => store.adoptStagedAttachment('conv-1', 'conv-1/staged-00000000-0000-4000-8000-000000000000.png', { mediaType: 'image/png' }),
        /no longer available/
      );
      // Message-owned files are not staged files.
      const owned = store.persistAttachment('conv-1', {
        type: 'file',
        mediaType: 'image/png',
        url: PNG_DATA_URL,
        filename: 'shot.png',
      });
      assert.throws(
        () => store.adoptStagedAttachment('conv-1', owned.storageKey!, { mediaType: 'image/png' }),
        /outside its staged scope/
      );
    });
  });

  it('deleteStaged removes one file and refuses escapes', () => {
    withDir('atlas-delete-staged-', (dir) => {
      const store = new AttachmentStore(dir);
      const staged = store.stageAttachment('conv-1', {
        filename: 'shot.png',
        mediaType: 'image/png',
        dataUrl: PNG_DATA_URL,
      });
      const owned = store.persistAttachment('conv-1', {
        type: 'file',
        mediaType: 'image/png',
        url: PNG_DATA_URL,
        filename: 'shot.png',
      });
      // Escape and cross-scope keys are refused, never deleted.
      assert.throws(() => store.deleteStagedAttachment('conv-1', '../other/x.png'), /outside its staged scope/);
      assert.throws(() => store.deleteStagedAttachment('conv-1', owned.storageKey!), /outside its staged scope/);
      assert.throws(() => store.deleteStagedAttachment('conv-2', staged.storageKey), /outside its staged scope/);

      store.deleteStagedAttachment('conv-1', staged.storageKey);
      assert.throws(
        () => store.adoptStagedAttachment('conv-1', staged.storageKey, { mediaType: 'image/png' }),
        /no longer available/
      );
      // Deleting twice is fine.
      store.deleteStagedAttachment('conv-1', staged.storageKey);
    });
  });

  it('sweep removes only old staged files', () => {
    withDir('atlas-sweep-', (dir) => {
      const store = new AttachmentStore(dir);
      const old = join(dir, 'conv-1', 'staged-old.png');
      const fresh = join(dir, 'conv-1', 'staged-fresh.png');
      const ownedPath = (() => {
        const owned = store.persistAttachment('conv-1', {
          type: 'file',
          mediaType: 'image/png',
          url: PNG_DATA_URL,
          filename: 'shot.png',
        });
        return join(dir, owned.storageKey!);
      })();
      writeFileSync(old, Buffer.from('pixels'));
      writeFileSync(fresh, Buffer.from('pixels'));
      const ancient = (Date.now() - STAGED_ATTACHMENT_MAX_AGE_MS - 1000) / 1000;
      utimesSync(old, ancient, ancient);

      const deleted = sweepStaleStagedAttachments(dir, Date.now());
      assert.equal(deleted, 1);
      const remaining = readdirSync(join(dir, 'conv-1')).sort();
      assert.ok(remaining.includes('staged-fresh.png'));
      assert.ok(!remaining.includes('staged-old.png'));
      assert.ok(remaining.some((entry) => !entry.startsWith('staged-')));
      assert.ok(remaining.includes(ownedPath.split('/').pop()!));
    });
  });

  it('sweep tolerates a missing directory', () => {
    assert.equal(sweepStaleStagedAttachments(join(tmpdir(), 'atlas-never-there'), Date.now()), 0);
  });
});
