/** Probe: diff palette settings + live override (t3code #10671 port). */
import { chromium } from 'playwright';
import {
  appearanceDefaults,
  conversationMessages,
  conversations,
  models,
  projects,
  settingsSummary,
} from './scripts/uiPreview/fixtures.mjs';

function buildBridgeSource() {
  const data = JSON.stringify({
    appearanceDefaults, conversationMessages, conversations, models, projects, settingsSummary,
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
      list: async () => F.projects, create: async () => F.projects[0],
      rename: async () => F.projects[0], delete: async () => {}, reveal: async () => {},
    },
    providers: {
      list: async () => [], create: async () => ({}), update: async () => ({}), delete: async () => ({}),
      setModels: async () => ({}), discoverModels: async () => ({ models: [] }), testConnection: async () => ({ ok: true }),
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
      start: async () => ({ requestId: 'r-preview' }), abort: async () => {}, respondToolApproval: async () => {},
      getRuntimeState: async (req) => ({
        conversationId: req.conversationId, conversation: detail(req.conversationId).conversation,
        lastSequence: 0, checkpointSequence: 0, messages: F.conversationMessages[req.conversationId] || [],
        activities: [], pendingApprovals: [], providerSession: null, latestCheckpoint: null,
      }),
      recoverEvents: async () => ({ events: [] }), getContextUsage: async () => null, openVisualWindow: async () => {}, subscribe: unsub,
    },
    visuals: { save: async () => ({}), list: async () => [], get: async () => null, search: async () => [], delete: async () => true },
    sites: {
      list: async () => [], get: async () => null, create: async () => ({}), rename: async () => ({}),
      delete: async () => ({}), restore: async () => ({}), purge: async () => ({}), readFile: async () => ({ content: '' }),
      writeFile: async () => ({}), deleteFile: async () => ({}), build: async () => ({}), review: async () => ({}),
      publish: async () => ({}), unpublish: async () => ({}), rollback: async () => ({}), resetDraft: async () => ({}),
      previewTarget: async () => ({ url: '' }), openPreviewWindow: async () => {}, export: async () => ({}), openInBrowser: async () => {},
    },
    diagnostics: { getSnapshot: async () => ({ collectedAt: '', build: {}, mainProcess: {}, databaseSizeBytes: 0 }) },
    jobs: { listAll: async () => [], list: async () => [], subscribe: unsub },
    workspace: { getContext: async () => ({ project: null, projectType: { type: 'unknown' }, envKeys: [], detectedEnvKeys: [], mode: 'work', agentInstructions: null }) },
    git: { getBranches: async () => [] },
    updates: { getState: async () => ({ status: 'idle' }), check: async () => ({ status: 'not-available' }), performPrimaryAction: async () => {}, subscribe: unsub },
    posthog: { getAnonymousId: async () => 'preview', captureEvent: noop, isTelemetryEnabled: async () => false, setTelemetryEnabled: async () => {} },
  };
  const anyFn = new Proxy(function () {}, { apply: (t, thisArg, args) => (typeof args[0] === 'function' && args.length === 1 ? () => {} : Promise.resolve([])) });
  window.atlasChat = new Proxy(window.atlasChat, { get: (t, p) => (p in t ? t[p] : new Proxy({}, { get: () => anyFn })) });
})();`;
}

const browser = await chromium.launch({ executablePath: '/Users/ollayor/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.stack || e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.addInitScript({ content: buildBridgeSource() });
await page.goto('http://localhost:5181/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const settingsBtn = page.getByRole('button', { name: /settings/i }).first();
if ((await settingsBtn.count()) === 0) { console.log('NO SETTINGS BUTTON'); process.exit(2); }
await settingsBtn.click();
await page.waitForTimeout(1200);

const section = page.getByText('Diff colors', { exact: true }).first();
console.log('SECTION_FOUND:', (await section.count()) > 0);
const preview = page.getByRole('img', { name: /diff color preview/i }).first();
console.log('PREVIEW_FOUND:', (await preview.count()) > 0);

const readVars = () => page.evaluate(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const probe = document.querySelector('[role="img"][aria-label="Diff color preview"]');
  const row = probe?.querySelector('tr');
  const rowBg = row ? getComputedStyle(row).backgroundColor : null;
  return {
    dataset: root.dataset.diffColorScheme ?? null,
    addFg: cs.getPropertyValue('--diff-add-fg').trim(),
    delFg: cs.getPropertyValue('--diff-del-fg').trim(),
    addBg: cs.getPropertyValue('--diff-add-bg').trim(),
    rowBg,
  };
});
console.log('BEFORE:', JSON.stringify(await readVars()));

await page.getByRole('radio', { name: /blue & orange/i }).first().click();
await page.waitForTimeout(800);
console.log('AFTER_BLUE:', JSON.stringify(await readVars()));

await page.getByRole('radio', { name: /red & green/i }).first().click();
await page.waitForTimeout(800);
console.log('AFTER_RED:', JSON.stringify(await readVars()));

console.log('ERRORS:', JSON.stringify([...new Set(errors)].slice(0, 10)));
await browser.close();
