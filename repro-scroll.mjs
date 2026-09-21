/** TEMP repro: infinite auto-load-older in the main chat window. Run from repo root. */
import { chromium } from 'playwright';

const TOTAL = 240;
const now = Date.now();
const messages = Array.from({ length: TOTAL }, (_, i) => {
  const isUser = i % 2 === 0;
  const text = (isUser ? 'User message ' : 'Assistant reply ') + i + ' — lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud.';
  // Vary content length hard so row heights span ~60px..~2000px — the
  // estimate-scale calibration path only activates when estimates miss.
  const wave = isUser
    ? (i % 9 === 0 ? 2600 : i % 3 === 0 ? 480 : 60)
    : (i % 7 === 0 ? 4200 : i % 3 === 0 ? 900 : 180);
  const content = text + (wave > 120 ? ' ' + 'detailed explanation paragraph. '.repeat(Math.ceil(wave / 33)) : '');
  return {
    id: 'm-' + i, conversationId: 'c-long', role: isUser ? 'user' : 'assistant',
    content, reasoning: null,
    parts: [{ id: "m-" + i + "-text", type: "text", text: content, state: "done" }],
    status: 'complete', providerId: 'openrouter', modelId: 'openrouter/anthropic/claude-sonnet-4.5',
    inputTokens: null, outputTokens: null, reasoningTokens: null, latencyMs: null, errorCode: null,
    createdAt: new Date(now - (TOTAL - i) * 60000).toISOString(),
  };
});

const bridgeSource = `(() => {
  const MESSAGES = ${JSON.stringify(messages)};
  const noop = () => {};
  const unsub = () => noop;
  window.__getPageCalls = [];
  const sorted = [...MESSAGES].reverse();
  const findPage = (cursor, limit) => {
    let rows = sorted;
    if (cursor) {
      const c = JSON.parse(atob(cursor));
      rows = sorted.filter((m) => m.createdAt < c.createdAt || (m.createdAt === c.createdAt && m.id < c.id));
    }
    const hasOlder = rows.length > limit;
    const pageRows = rows.slice(0, limit).reverse();
    return { messages: pageRows, hasOlder, nextCursor: hasOlder && pageRows[0] ? btoa(JSON.stringify({ createdAt: pageRows[0].createdAt, id: pageRows[0].id })) : null, limit };
  };
  const conversation = { id: 'c-long', title: 'Long scroll thread', createdAt: MESSAGES[0].createdAt, updatedAt: MESSAGES[MESSAGES.length-1].createdAt, lastMessagePreview: 'Assistant reply ' + (MESSAGES.length-1), lastUserMessagePreview: 'User message ' + (MESSAGES.length-2), lastAssistantMessagePreview: 'Assistant reply ' + (MESSAGES.length-1), lastMessageAt: MESSAGES[MESSAGES.length-1].createdAt, defaultProviderId: 'openrouter', defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5', workspaceMode: 'work', projectId: null, toolPermissionMode: 'ask', changeStats: { fileCount: 0, linesAdded: 0, linesRemoved: 0 }, pinnedAt: null, archivedAt: null, settledAt: null, unsettledAt: MESSAGES[MESSAGES.length-1].createdAt, snoozedUntil: null, snoozedAt: null, forkOfConversationId: null, forkPointSequence: null, sideOfConversationId: null };
  window.__conversations = [conversation];
  window.atlasChat = {
    settings: { getSummary: async () => ({ providers: [{ providerId: 'openrouter', hasSecret: true, status: 'valid', validatedAt: null }], customProviders: [], defaultProviderId: 'openrouter', appearance: {}, keyboard: { keybindings: [] }, chat: { reasoningEffort: 'medium', toolPermissionMode: 'ask' }, showFreeOnlyByDefault: false, modelCatalogLastSyncedAt: null, modelCatalogStale: false, modelCatalogCount: 0 }), saveProviderKey: async () => ({ ok: true }), validateProviderKey: async () => ({ ok: true, status: 'valid' }), updatePreferences: async () => ({}) },
    models: { list: async () => [], refresh: async () => [], subscribe: unsub },
    projects: { list: async () => [], create: async () => ({}), rename: async () => ({}), delete: async () => {}, reveal: async () => {} },
    providers: { list: async () => [{ providerId: 'openrouter', hasSecret: true, status: 'valid' }], create: async () => ({}), update: async () => ({}), delete: async () => ({}), setModels: async () => ({}), discoverModels: async () => ({ models: [] }), testConnection: async () => ({ ok: true }), listPresets: async () => [] },
    conversations: {
      list: async () => window.__conversations,
      create: async () => conversation,
      get: async () => ({ conversation, messages: MESSAGES.slice(-100) }),
      getPage: async (id, req = {}) => {
        const limit = Math.max(1, Math.min(Math.floor(req.limit ?? 100), 250));
        const page = findPage(req.cursor ?? null, limit);
        window.__getPageCalls.push({ t: performance.now(), cursor: req.cursor ?? null, hasOlder: page.hasOlder, n: page.messages.length });
        return { conversation, messages: page.messages, hasOlder: page.hasOlder, nextCursor: page.nextCursor, limit };
      },
      getStats: async () => ({ conversationCount: 1, messageCount: MESSAGES.length }),
      delete: async () => {},
    },
    chat: {
      start: async () => ({ requestId: 'r-x' }), abort: async () => {}, respondToolApproval: async () => {},
      getRuntimeState: async (req) => ({ conversationId: req.conversationId, conversation, lastSequence: 0, checkpointSequence: 0, messages: MESSAGES.slice(-100), activities: [], pendingApprovals: [], providerSession: null, latestCheckpoint: null, pendingFollowups: [] }),
      recoverEvents: async () => ({ events: [] }), getContextUsage: async () => null, openVisualWindow: async () => {}, subscribe: unsub,
    },
    visuals: { save: async () => ({}), list: async () => [], get: async () => null, search: async () => [], delete: async () => true },
    sites: { list: async () => [], get: async () => null, create: async () => ({}), rename: async () => ({}), delete: async () => true, restore: async () => ({}), purge: async () => ({}), readFile: async () => ({ content: '' }), writeFile: async () => ({}), build: async () => ({}), review: async () => ({}), publish: async () => ({}), unpublish: async () => ({}), rollback: async () => ({}), resetDraft: async () => ({}), previewTarget: async () => ({ url: '' }), openPreviewWindow: async () => {}, export: async () => ({}), openInBrowser: async () => {} },
    diagnostics: { getSnapshot: async () => ({ collectedAt: '', build: {}, mainProcess: {}, databaseSizeBytes: 0 }) },
    updates: { getState: async () => ({ status: 'idle' }), check: async () => ({ status: 'not-available' }), performPrimaryAction: async () => {}, subscribe: unsub },
    posthog: { getAnonymousId: async () => 'x', captureEvent: noop, isTelemetryEnabled: async () => false, setTelemetryEnabled: async () => {} },
  };
  const anyFn = new Proxy(function () {}, { apply: (t, thisArg, args) => (typeof args[0] === 'function' && args.length === 1 ? () => {} : Promise.resolve([])) });
  window.atlasChat = new Proxy(window.atlasChat, { get: (t, p) => (p in t ? t[p] : new Proxy({}, { get: () => anyFn })) });
})();`;

const findScroller = `(() => {
  const scrollers = [...document.querySelectorAll('*')].filter((el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 300;
  });
  return scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null;
})`;

const browser = await chromium.launch({ executablePath: '/Users/ollayor/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1512, height: 945 } });
page.on('console', (m) => { const t = m.text(); if (t.includes('[dbg]') || m.type() === 'error' || m.type() === 'pageerror') console.log('[' + m.type() + ']', t.slice(0, 260)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
await page.addInitScript(bridgeSource);
await page.goto('http://localhost:5181/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const recents = page.getByRole('button', { name: /^recents$/i }).first();
if (await recents.count()) { await recents.click(); await page.waitForTimeout(400); }
const row = page.getByText('Long scroll thread', { exact: true }).first();
if ((await row.count()) === 0) {
  console.log('ROW NOT FOUND. body text:\\n' + (await page.evaluate(() => document.body.innerText.slice(0, 1500))));
  await page.screenshot({ path: '/tmp/repro-debug.png' });
  process.exit(2);
}
await row.click();
await page.waitForTimeout(1500);

// Expand the history fold so the full 100-row list is virtualized
await page.getByRole('button', { name: /previous messages/ }).first().click();
await page.waitForTimeout(1200);

const baseline = await page.evaluate(`(${findScroller})() && (() => {
  const el = (${findScroller})();
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, rows: document.querySelectorAll('[data-index]').length, calls: window.__getPageCalls.length };
})()`);
console.log('BASELINE', JSON.stringify(baseline));

for (let i = 0; i < 200; i++) {
  const pos = await page.evaluate(`(() => {
    const el = (${findScroller})();
    if (!el) return -1;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true }));
    el.scrollTop = Math.max(0, el.scrollTop - 600);
    return el.scrollTop;
  })()`);
  if (pos === 0) break;
  await page.waitForTimeout(25);
}
await page.waitForTimeout(1000);

const atTop = await page.evaluate(`(() => { const el = (${findScroller})(); return { scrollTop: el.scrollTop, calls: window.__getPageCalls.length }; })()`);
console.log('AT_TOP', JSON.stringify(atTop));

const probe = `(() => {
  const list = document.querySelector('[data-index]')?.parentElement;
  const rows = [...document.querySelectorAll('[data-index]')].slice(0, 12).map((r) => ({ i: r.getAttribute('data-index'), top: r.style.top, h: Math.round(r.getBoundingClientRect().height) }));
  const scrollers = [...document.querySelectorAll('*')].map((el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 80 ? { sh: el.scrollHeight, ch: el.clientHeight, st: Math.round(el.scrollTop), cls: (el.className || '').toString().slice(0, 60) } : null;
  }).filter(Boolean).sort((a, b) => b.sh - a.sh).slice(0, 4);
  return { listHeight: list ? list.style.height : null, rows, scrollers, calls: window.__getPageCalls.length };
})()`;
console.log('PROBE@TOP', JSON.stringify(await page.evaluate(probe)));
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(`(() => {
    const el = (${findScroller})();
    const first = document.querySelector('[data-index=\"0\"]')?.textContent?.slice(0, 40) ?? null;
    return { t: Math.round(performance.now()), st: el ? Math.round(el.scrollTop) : -1, sh: el ? el.scrollHeight : -1, first, calls: window.__getPageCalls.length };
  })()`);
  console.log('S', JSON.stringify(s));
  await page.waitForTimeout(100);
}
await page.waitForTimeout(1500);
console.log('PROBE+2.5s', JSON.stringify(await page.evaluate(probe), null, 1));

const samples = [];
for (let i = 0; i < 40; i++) {
  const s = await page.evaluate(`(() => {
    const el = (${findScroller})();
    return { t: Math.round(performance.now()), scrollTop: el ? Math.round(el.scrollTop) : -1, scrollHeight: el ? el.scrollHeight : -1, rows: document.querySelectorAll('[data-index]').length, calls: window.__getPageCalls.map((c) => ({ t: Math.round(c.t), cursorTail: (c.cursor ?? 'none').slice(-16), hasOlder: c.hasOlder, n: c.n })) };
  })()`);
  samples.push(s);
  await page.waitForTimeout(i < 8 ? 150 : 500);
}

const calls = samples[samples.length - 1].calls;
console.log('PAGE_CALLS (' + calls.length + '):');
for (const c of calls) console.log('  t=' + c.t + ' cursor=…' + c.cursorTail + ' hasOlder=' + c.hasOlder + ' n=' + c.n);
console.log('SCROLL pos/height:', samples.map((s) => s.scrollTop + '/' + s.scrollHeight).join('  '));
console.log('FETCHES DURING IDLE:', calls.length - atTop.calls);
await browser.close();
