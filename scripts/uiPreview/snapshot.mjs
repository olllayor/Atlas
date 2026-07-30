#!/usr/bin/env node
/**
 * Screenshot the renderer in a plain browser, with `window.atlasChat` stubbed.
 *
 * Usage:
 *   node scripts/uiPreview/snapshot.mjs                     # all scenes
 *   node scripts/uiPreview/snapshot.mjs chat settings       # named scenes
 *   OUT=docs/codex-parity/shots/after node scripts/uiPreview/snapshot.mjs
 *
 * Requires the preview server:
 *   node_modules/.bin/vite --config scripts/uiPreview/vite.preview.config.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appearanceDefaults,
  conversationMessages,
  conversations,
  models,
  projects,
  settingsSummary,
} from './fixtures.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = process.env.PREVIEW_URL ?? 'http://localhost:5181/';
const OUT_DIR = resolve(repoRoot, process.env.OUT ?? 'docs/codex-parity/shots/current');
const VIEWPORT = { width: 1512, height: 945 };
const CLIP = process.env.CLIP ? JSON.parse(process.env.CLIP) : null;
/** Override the fixture's UI font size, to prove the scale actually moves. */
const UI_FONT_SIZE = process.env.UI_FONT_SIZE ? Number(process.env.UI_FONT_SIZE) : null;
/**
 * Files the `composer-attachments` scene stages, as a colon-separated list of
 * paths. Left empty the scene still runs and simply shows an empty composer.
 */
const ATTACHMENT_SAMPLES = (process.env.ATTACHMENT_SAMPLES ?? '').split(':').filter(Boolean);

function buildBridgeSource() {
  if (UI_FONT_SIZE) appearanceDefaults.uiFontSize = UI_FONT_SIZE;
  const data = JSON.stringify({
    appearanceDefaults,
    conversationMessages,
    conversations,
    models,
    projects,
    settingsSummary: UI_FONT_SIZE
      ? { ...settingsSummary, appearance: { ...settingsSummary.appearance, uiFontSize: UI_FONT_SIZE } }
      : settingsSummary,
  });

  return `(() => {
  const F = ${data};
  const noop = () => {};
  const unsub = () => noop;
  const detail = (id) => ({
    conversation: {
      id,
      title: (F.conversations.find((c) => c.id === id) || {}).title || 'New conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      defaultProviderId: 'openrouter',
      defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
    },
    messages: F.conversationMessages[id] || [],
  });

  window.__atlasFixtures = F;
  window.atlasChat = {
    settings: {
      getSummary: async () => F.settingsSummary,
      saveProviderKey: async () => ({ ok: true }),
      validateProviderKey: async () => ({ ok: true, status: 'valid' }),
      updatePreferences: async (patch) => {
        Object.assign(F.settingsSummary.appearance, (patch && patch.appearance) || {});
        return F.settingsSummary;
      },
    },
    models: { list: async () => F.models, refresh: async () => F.models, subscribe: unsub },
    projects: {
      list: async () => F.projects,
      create: async () => F.projects[0],
      rename: async () => F.projects[0],
      delete: async () => {},
      reveal: async () => {},
    },
    providers: {
      list: async () => [],
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      setModels: async () => ({}),
      discoverModels: async () => ({ models: [] }),
      testConnection: async () => ({ ok: true }),
      listPresets: async () => [],
    },
    conversations: {
      list: async () => F.conversations,
      create: async () => detail('c-empty').conversation,
      get: async (id) => detail(id),
      getPage: async (id) => ({ ...detail(id), hasOlder: false, nextCursor: null, limit: 25 }),
      getStats: async () => ({ conversationCount: F.conversations.length, messageCount: 12 }),
      delete: async () => {},
    },
    chat: {
      start: async () => ({ requestId: 'r-preview' }),
      abort: async () => {},
      respondToolApproval: async () => {},
      // The store hydrates messages from the runtime snapshot, not from
      // conversations.getPage — see applyRuntimeSnapshotToStore.
      getRuntimeState: async (req) => ({
        conversationId: req.conversationId,
        conversation: detail(req.conversationId).conversation,
        lastSequence: 0,
        checkpointSequence: 0,
        messages: F.conversationMessages[req.conversationId] || [],
        activities: [],
        pendingApprovals: [],
        providerSession: null,
        latestCheckpoint: null,
      }),
      recoverEvents: async () => ({ events: [] }),
      getContextUsage: async () => null,
      openVisualWindow: async () => {},
      subscribe: unsub,
    },
    visuals: { save: async () => ({}), list: async () => [], get: async () => null, search: async () => [], delete: async () => true },
    sites: {
      list: async () => [], get: async () => null, create: async () => ({}), rename: async () => ({}),
      delete: async () => ({}), restore: async () => ({}), purge: async () => ({}),
      readFile: async () => ({ content: '' }), writeFile: async () => ({}), deleteFile: async () => ({}),
      build: async () => ({}), review: async () => ({}), publish: async () => ({}), unpublish: async () => ({}),
      rollback: async () => ({}), resetDraft: async () => ({}), previewTarget: async () => ({ url: '' }),
      openPreviewWindow: async () => {}, export: async () => ({}), openInBrowser: async () => {},
    },
    diagnostics: {
      getSnapshot: async () => ({
        collectedAt: new Date().toISOString(),
        build: { appVersion: '0.1.14', electronVersion: '33.0.0', chromeVersion: '130', nodeVersion: '22', platform: 'darwin', arch: 'arm64' },
        mainProcess: { rssBytes: 184000000, heapTotalBytes: 42000000, heapUsedBytes: 31000000, externalBytes: 2000000, arrayBuffersBytes: 500000 },
        databaseSizeBytes: 2400000,
      }),
    },
    updates: {
      getState: async () => ({ status: 'idle', currentVersion: '0.1.14', latestVersion: null, progressPercent: 0, releaseNotes: null }),
      check: async () => ({ status: 'not-available', currentVersion: '0.1.14', latestVersion: null, progressPercent: 0, releaseNotes: null }),
      performPrimaryAction: async () => {},
      subscribe: unsub,
    },
    posthog: {
      getAnonymousId: async () => 'preview',
      captureEvent: noop,
      isTelemetryEnabled: async () => false,
      setTelemetryEnabled: async () => {},
    },
  };
})();`;
}

/**
 * Scenes are (name, driver) pairs. The driver receives the page after load and
 * navigates the UI into the state worth capturing.
 */
const SCENES = {
  chat: async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
  },
  'tool-timeline': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    await scrollTranscript(page, 0);
  },
  'tool-timeline-mid': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    await scrollTranscript(page, 0.42);
  },
  'tool-expanded': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    await scrollTranscript(page, 0);
    const toggles = page.locator('[data-slot="collapsible-trigger"], button[aria-expanded="false"]');
    const count = Math.min(await toggles.count(), 6);
    for (let index = 0; index < count; index += 1) {
      await toggles.nth(index).click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(600);
    await scrollTranscript(page, 0);
  },
  'chat-empty': async (page) => {
    await openConversation(page, 'New conversation');
  },
  composer: async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    const editor = page.locator('textarea, [contenteditable="true"]').first();
    if (await editor.count()) {
      await editor.click();
      await editor.type('Refactor the tool timeline so each call is its own unit');
    }
  },
  'model-selector': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    const trigger = page.locator('button[aria-haspopup="listbox"], button[aria-haspopup="dialog"]').first();
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(600);
    }
  },
  workbench: async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    // The workbench opens via the header's "Chat | Work" segmented control.
    const toggle = page.getByRole('tab', { name: /^work$/i }).first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(700);
    }
  },
  'workbench-terminal': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    const toggle = page.getByRole('tab', { name: /^work$/i }).first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(500);
    }
    const tab = page.getByRole('tab', { name: /terminal/i }).first();
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(400);
    }
  },
  'composer-attachments': async (page) => {
    await openConversation(page, 'Fresh session in Atlas');
    // Staged files live in the store, not the fixture bridge, so the only way
    // to reach this state is to actually put files through the file input.
    const input = page.locator('input[type="file"]').first();
    if ((await input.count()) && ATTACHMENT_SAMPLES.length) {
      await input.setInputFiles(ATTACHMENT_SAMPLES);
      await page.waitForTimeout(700);
    }
  },
  toasts: async (page) => {
    // Driven through the real UI, not by poking `notify` — this is also the
    // regression check for the duplicate update toast: one click, one toast.
    await openConversation(page, 'Fresh session in Atlas');
    await page.getByRole('button', { name: /more actions/i }).first().click();
    await page.waitForTimeout(300);
    await page.getByText(/check for updates/i).first().click();
    await page.waitForTimeout(1200);
  },
  'message-image': async (page) => {
    await openConversation(page, 'what is in image');
  },
  'composer-lightbox': async (page) => {
    await openConversation(page, 'Fresh session in Atlas');
    const input = page.locator('input[type="file"]').first();
    if ((await input.count()) && ATTACHMENT_SAMPLES.length) {
      await input.setInputFiles(ATTACHMENT_SAMPLES);
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: /Attachment .* — open/ }).first().click();
      await page.waitForTimeout(700);
    }
  },
  'workspace-strip': async (page) => {
    // Only an untouched session inside a project shows all three chips.
    await openConversation(page, 'Fresh session in Atlas');
  },
  'sidebar-recents': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    const recents = page.getByRole('button', { name: /^recents$/i }).first();
    if (await recents.count()) {
      await recents.click();
      await page.waitForTimeout(400);
    }
  },
  'sidebar-collapsed': async (page) => {
    await openConversation(page, 'Migrate the tool timeline');
    const toggle = page.getByRole('button', { name: /hide sidebar/i }).first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(700);
    }
  },
  'command-palette': async (page) => {
    await page.keyboard.press('Meta+KeyK');
    await page.waitForTimeout(600);
  },
  settings: async (page) => {
    const trigger = page.getByRole('button', { name: /settings/i }).first();
    if (await trigger.count()) {
      await trigger.click();
      await page.waitForTimeout(600);
    }
  },
};

/** Scroll the transcript pane to `ratio` (0 = top, 1 = bottom). */
async function scrollTranscript(page, ratio) {
  await page.evaluate((value) => {
    const scrollers = [...document.querySelectorAll('*')].filter((element) => {
      const style = window.getComputedStyle(element);
      return (
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 80 &&
        element.clientHeight > 300
      );
    });
    const target = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (target) {
      target.scrollTop = (target.scrollHeight - target.clientHeight) * value;
    }
  }, ratio);
  await page.waitForTimeout(500);
}

async function openConversation(page, titleFragment) {
  const find = () => page.getByText(new RegExp(titleFragment, 'i')).first();

  // Unfiled chats live behind the collapsed "Recents" disclosure, so a row
  // that is simply not rendered is not the same as a row that is missing.
  if ((await find().count()) === 0) {
    const recents = page.getByRole('button', { name: /^recents$/i }).first();
    if (await recents.count()) {
      await recents.click();
      await page.waitForTimeout(300);
    }
  }

  const row = find();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(900);
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const scenes = requested.length ? requested : Object.keys(SCENES);
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript({ content: buildBridgeSource() });

  const errors = [];
  const results = [];

  for (const scene of scenes) {
    const driver = SCENES[scene];
    if (!driver) {
      errors.push(`unknown scene: ${scene}`);
      continue;
    }

    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`[${scene}] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`[${scene}] console: ${message.text().slice(0, 300)}`);
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await driver(page);
    await page.waitForTimeout(500);

    const file = join(OUT_DIR, `${scene}.png`);
    await page.screenshot({ path: file, fullPage: false, ...(CLIP ? { clip: CLIP } : {}) });
    results.push(file);
    await page.close();
  }

  await browser.close();

  for (const file of results) {
    console.log(`wrote ${file}`);
  }
  if (errors.length) {
    console.log('\n--- page errors ---');
    for (const error of [...new Set(errors)].slice(0, 40)) {
      console.log(error);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
