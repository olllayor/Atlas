import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const stub = "window.atlasChat = { settings: { getSummary: async () => ({ providers: [{ providerId: 'openrouter', hasSecret: true, status: 'valid', validatedAt: new Date().toISOString(), label: 'OpenRouter' }], defaultProviderId: 'openrouter', appearance: { themeMode: 'dark', designTheme: 'xai', uiFontSize: 14, codeFontSize: 13, uiFontFamily: 'system', codeFontFamily: 'mono', borderRadius: 'theme-default' }, keyboard: { keybindings: [] }, showFreeOnlyByDefault: true, modelCatalogLastSyncedAt: new Date().toISOString(), modelCatalogCount: 1 }), saveProviderKey: async () => ({}), validateProviderKey: async () => ({}), updatePreferences: async () => ({}) }, models: { list: async () => [{ id: 'openrouter/llama-3.3-70b:free', providerId: 'openrouter', label: 'Llama 3.3 70B (Free)', contextWindow: 131072, isFree: true, supportsVision: false, supportsDocumentInput: false, supportsTools: true, archived: false, lastSyncedAt: new Date().toISOString(), lastSeenFreeAt: new Date().toISOString() }, { id: 'openrouter/gemini-2.0-flash:free', providerId: 'openrouter', label: 'Gemini 2.0 Flash (Free)', contextWindow: 1048576, isFree: true, supportsVision: true, supportsDocumentInput: true, supportsTools: true, archived: false, lastSyncedAt: new Date().toISOString(), lastSeenFreeAt: new Date().toISOString() }], refresh: async () => [] }, conversations: { list: async () => [{ id: 'c1', title: 'Refactor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), defaultProviderId: 'openrouter', defaultModelId: 'openrouter/llama-3.3-70b:free', lastMessagePreview: 'x', lastMessageAt: new Date().toISOString(), messageCount: 0 }], create: async () => ({}), get: async () => ({ conversation: { id: 'c1', title: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), defaultProviderId: 'openrouter', defaultModelId: null }, messages: [] }), getPage: async () => ({ conversation: { id: 'c1', title: 'a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), defaultProviderId: 'openrouter', defaultModelId: null }, messages: [], hasOlder: false, nextCursor: null, limit: 25 }), getStats: async () => ({}), delete: async () => {} }, chat: { start: async () => ({}), abort: async () => {}, respondToolApproval: async () => {}, getRuntimeState: async (req) => ({ conversationId: req.conversationId, conversation: null, lastSequence: 0, checkpointSequence: 0, messages: [], activities: [], pendingApprovals: [], providerSession: null, latestCheckpoint: null }), recoverEvents: async () => ({}), openVisualWindow: async () => {}, subscribe: () => () => {} }, visuals: { save: async () => ({}), list: async () => [], get: async () => null, search: async () => [], delete: async () => true }, diagnostics: { getSnapshot: async () => ({ collectedAt: new Date().toISOString(), build: { appVersion: '0', electronVersion: '0', chromeVersion: '0', nodeVersion: '0', platform: 'mac', arch: 'arm' }, mainProcess: { rssBytes: 1, heapTotalBytes: 1, heapUsedBytes: 1, externalBytes: 1, arrayBuffersBytes: 1 }, databaseSizeBytes: 1 }) }, updates: { getState: async () => ({ status: 'idle', currentVersion: '0', latestVersion: null, progressPercent: 0, releaseNotes: null }), check: async () => ({}), performPrimaryAction: async () => {}, subscribe: () => () => {} }, posthog: { getAnonymousId: async () => '', captureEvent: () => {}, isTelemetryEnabled: async () => false } };";
await page.addInitScript({ content: stub });
await page.goto("http://localhost:5181/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

// Find the model trigger and click it via aria-expanded
const target = await page.evaluateHandle(() => {
  return [...document.querySelectorAll('button[aria-haspopup="listbox"]')][0];
});
if (target) {
  await target.click();
  await page.waitForTimeout(1000);
}

const data = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"], [data-slot="dialog-overlay"]')];
  return all.map(el => {
    const cs = window.getComputedStyle(el);
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      slot: el.getAttribute('data-slot'),
      bg: cs.backgroundColor,
      border: cs.border,
      opacity: cs.opacity,
      className: el.className.toString().slice(0, 200),
      text: el.textContent?.slice(0, 60)
    };
  });
});
console.log(JSON.stringify(data, null, 2));
await page.screenshot({ path: '/tmp/atlas-dbg.png' });
await browser.close();
