/**
 * Renderer memory probe for Atlas.
 *
 * Launches a *built* Atlas under Playwright's Electron driver, samples the
 * whole process tree's RSS and phys_footprint while a scenario runs, reads the
 * renderer's JS heap over CDP, and can bracket the run with heap snapshots.
 *
 * The point of pairing `ps`/`footprint` with `Performance.getMetrics` is that
 * they answer different halves of one question: if footprint climbs while
 * `JSHeapUsedSize` stays flat, the growth is not in JavaScript at all and no
 * heap diff will ever find it.
 *
 * The app runs against a *copy* of the real user profile, so provider
 * credentials and conversations are present without touching the profile a
 * running Atlas may be using. Secrets live in the OS keychain, which the copy
 * shares, so nothing sensitive is duplicated onto disk beyond what the
 * original profile already held.
 *
 * Usage:
 *   node scripts/perf/memProbe.mjs --label A --scenario panel-closed --minutes 5
 *   node scripts/perf/memProbe.mjs --label B --scenario panel-files --minutes 5 --snapshots
 *   node scripts/perf/memProbe.mjs --label probe --scenario inspect      # DOM dump, no timing
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from 'playwright';

import { sampleTree } from './procSampler.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(repoRoot, '.tmp/perf');
const sourceProfile = join(homedir(), 'Library/Application Support/Atlas');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const label = arg('label', 'run');
const scenario = arg('scenario', 'inspect');
const minutes = Number(arg('minutes', '5'));
const intervalMs = Number(arg('interval', '10000'));
const wantSnapshots = flag('snapshots');
const prompt = arg('prompt', 'Explore the codebase and find our issues');
const providerLabel = arg('provider', 'BAI');
const modelLabel = arg('model', 'qwen3.8-flash');

mkdirSync(outDir, { recursive: true });

/**
 * A per-run copy of the real profile. Fresh every run: the brief's "fresh
 * launch for a clean heap" has to include a clean *disk* state too, or run B
 * inherits whatever run A persisted into localStorage and the panel store.
 */
function prepareProfile() {
  const profile = join(outDir, `profile-${label}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  for (const entry of ['atlas-chat.db', 'atlas-chat.db-wal', 'atlas-chat.db-shm', 'anonymous_id']) {
    const from = join(sourceProfile, entry);
    if (existsSync(from)) cpSync(from, join(profile, entry));
  }
  return profile;
}

const csvPath = join(outDir, `${label}-samples.csv`);
const logPath = join(outDir, `${label}-probe.log`);
const logStream = createWriteStream(logPath, { flags: 'a' });
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  logStream.write(line + '\n');
}

const ROLES = ['main', 'renderer', 'gpu-process', 'utility'];
writeFileSync(
  csvPath,
  'at,elapsedS,' +
    ROLES.flatMap((role) => [`${role}RssKb`, `${role}FootprintKb`]).join(',') +
    ',childrenFootprintKb,totalRssKb,totalFootprintKb,jsHeapUsedKb,jsHeapTotalKb,domNodes,jsListeners,documents,frames,note\n'
);

/** Set by the scenario so a row can say what the app was doing when it was taken. */
let note = 'start';

/** CDP `Performance.getMetrics` as a plain object. */
async function metrics(cdp) {
  const { metrics: rows } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
}

/**
 * A snapshot written straight to disk in chunks. Buffering a multi-hundred-MB
 * snapshot in the probe's own heap to `JSON.stringify` it later is how a
 * memory tool becomes a memory bug.
 */
async function takeHeapSnapshot(cdp, name) {
  const path = join(outDir, `${name}.heapsnapshot`);
  const stream = createWriteStream(path);
  const onChunk = ({ chunk }) => stream.write(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: true });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await new Promise((done) => stream.end(done));
  log(`heap snapshot -> ${path}`);
  return path;
}

const profile = prepareProfile();
log(`launching: label=${label} scenario=${scenario} minutes=${minutes} profile=${profile}`);

const app = await electron.launch({
  executablePath: join(repoRoot, '.electron-runtime/Atlas.app/Contents/MacOS/Electron'),
  args: ['.', `--user-data-dir=${profile}`],
  cwd: repoRoot,
  env: { ...process.env, ATLAS_PERF_TRACE: '1' },
  timeout: 120_000,
});

app.process().stdout?.on('data', (chunk) => logStream.write(`[main] ${chunk}`));
app.process().stderr?.on('data', (chunk) => logStream.write(`[main!] ${chunk}`));

const win = await app.firstWindow({ timeout: 120_000 });
await win.waitForLoadState('domcontentloaded');
const rootPid = app.process().pid;
log(`window up, electron pid ${rootPid}`);

const cdp = await win.context().newCDPSession(win);
await cdp.send('Performance.enable');
await cdp.send('HeapProfiler.enable');

const startedAt = Date.now();
let last = null;

async function sample() {
  const [tree, perf] = await Promise.all([sampleTree(rootPid), metrics(cdp)]);
  const cells = ROLES.flatMap((role) => {
    const bucket = tree.byRole[role];
    return [bucket?.rssKb ?? 0, bucket?.footprintKb ?? 0];
  });
  const childrenFootprintKb = Object.entries(tree.byRole)
    .filter(([role]) => role.startsWith('child:'))
    .reduce((sum, [, bucket]) => sum + bucket.footprintKb, 0);
  const row = {
    elapsedS: Math.round((Date.now() - startedAt) / 1000),
    rendererFootprintKb: tree.byRole.renderer?.footprintKb ?? 0,
    rendererRssKb: tree.byRole.renderer?.rssKb ?? 0,
    totalFootprintKb: tree.totalFootprintKb,
    jsHeapUsedKb: Math.round((perf.JSHeapUsedSize ?? 0) / 1024),
    jsHeapTotalKb: Math.round((perf.JSHeapTotalSize ?? 0) / 1024),
    domNodes: perf.Nodes ?? 0,
    jsListeners: perf.JSEventListeners ?? 0,
    documents: perf.Documents ?? 0,
    frames: perf.Frames ?? 0,
  };
  appendFileSync(
    csvPath,
    [
      tree.at,
      row.elapsedS,
      ...cells,
      childrenFootprintKb,
      tree.totalRssKb,
      tree.totalFootprintKb,
      row.jsHeapUsedKb,
      row.jsHeapTotalKb,
      row.domNodes,
      row.jsListeners,
      row.documents,
      row.frames,
      note,
    ].join(',') + '\n'
  );
  last = row;
  return row;
}

const timer = setInterval(() => void sample().catch((error) => log('sample failed', error.message)), intervalMs);

/** Everything the scenarios need to poke the UI, in one place. */
const ui = {
  win,
  async dumpDom(name) {
    const path = join(outDir, `${label}-${name}.txt`);
    const text = await win.evaluate(() => {
      const describe = (element, depth) => {
        const attrs = ['data-slot', 'aria-label', 'title', 'placeholder', 'role', 'id']
          .map((key) => (element.getAttribute(key) ? `${key}="${element.getAttribute(key)}"` : null))
          .filter(Boolean)
          .join(' ');
        const own = Array.from(element.childNodes)
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent.trim())
          .join(' ')
          .slice(0, 80);
        return `${'  '.repeat(depth)}<${element.tagName.toLowerCase()} ${attrs}> ${own}`;
      };
      const lines = [];
      const walk = (element, depth) => {
        if (depth > 22) return;
        lines.push(describe(element, depth));
        for (const child of element.children) walk(child, depth + 1);
      };
      walk(document.body, 0);
      return lines.join('\n');
    });
    writeFileSync(path, text);
    log(`dom dump -> ${path} (${text.split('\n').length} lines)`);
  },
  async shot(name) {
    const path = join(outDir, `${label}-${name}.png`);
    await win.screenshot({ path });
    log(`screenshot -> ${path}`);
    return path;
  },
};

/** A settle + forced GC, so a baseline is not just "whatever GC had not run yet". */
async function settle(seconds) {
  await win.waitForTimeout(seconds * 1000);
  await cdp.send('HeapProfiler.collectGarbage');
  await win.waitForTimeout(1500);
}

/**
 * Opens a fresh thread in the Atlas project and waits for the composer.
 *
 * The row's actions only take pointer events while the row is hovered, so the
 * hover is part of the interaction, not a flake workaround.
 */
async function newAtlasThread() {
  await win.hover('button[title="/Users/ollayor/Code/Projects/Atlas"]');
  await win.waitForTimeout(400);
  // `force` because the row's label is painted over the action; the hover
  // above is what makes the button live, and Playwright's own hit test only
  // sees the label on top of it.
  await win.click('button[aria-label="New chat in Atlas"]', { force: true });
  await win.waitForSelector('textarea[aria-label="Message"]', { timeout: 30_000 });
  await win.waitForTimeout(2_000);
}

/** True when the right panel is mounted (the picker or a surface is on screen). */
async function panelOpen() {
  return win.evaluate(() =>
    Boolean(document.querySelector('[aria-label="Toggle workbench panel"][aria-pressed="true"], [data-workbench-panel]')) ||
    document.body.innerText.includes('Open a surface')
  );
}

/**
 * Pins the conversation to one provider/model.
 *
 * Both runs have to stream from the same model or their deltas are not
 * comparable, and the profile's default is an OpenCode agent model whose
 * server start is one more moving part inside a memory measurement.
 */
async function selectModel() {
  await win.click('button[aria-label^="Model:"]');
  await win.waitForTimeout(1_000);
  await win.locator('[data-slot="dropdown-menu-sub-trigger"]', { hasText: providerLabel }).first().hover();
  await win.waitForTimeout(1_200);
  await win
    .locator('[data-slot="dropdown-menu-sub-content"] [data-slot="dropdown-menu-item"]')
    .filter({ hasText: modelLabel })
    .first()
    .click();
  await win.waitForTimeout(1_500);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  log(`model pinned: ${providerLabel} / ${modelLabel}`);
}

/** Transcript size, as a rough stand-in for how much this run actually streamed. */
async function transcriptChars() {
  return win.evaluate(
    () => document.querySelector('[aria-label="Conversation transcript"]')?.innerText.length ?? 0
  );
}

async function sendPrompt(text) {
  const composer = win.locator('textarea[aria-label="Message"]');
  await composer.click();
  await composer.fill(text);
  await win.waitForTimeout(500);
  await win.click('button[aria-label="Send message"]');
}

/** Samples for `minutes`, tagging rows so the CSV shows what phase they are in. */
async function streamFor(tag) {
  note = tag;
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    await win.waitForTimeout(5_000);
  }
}

const scenarios = {
  /** No timing, no prompt: launch, dump the DOM, screenshot, leave it open briefly. */
  async inspect() {
    await win.waitForTimeout(8_000);
    await ui.dumpDom('dom');
    await ui.shot('shot');
    await sample();
    await win.waitForTimeout(5_000);
  },

  /** Open the model picker and dump it, so its selectors are known. */
  async inspectModels() {
    await newAtlasThread();
    await win.click('button[aria-label^="Model:"]');
    await win.waitForTimeout(2_500);
    await ui.dumpDom('models');
    await ui.shot('models');
  },

  /** Open a file surface and dump the tab strip, so its close control is known. */
  async inspectSurfaceTabs() {
    await newAtlasThread();
    await win.click('button[aria-label="Toggle workbench panel"]');
    await win.waitForTimeout(2_000);
    await win.keyboard.press('f');
    await win.waitForTimeout(3_000);
    await openFileBySearch('src/renderer/components/CodeBlock.tsx');
    await ui.dumpDom('tabs');
    await ui.shot('tabs');
  },

  /** Walks every provider submenu in the model picker and lists what is in it. */
  async listModels() {
    await newAtlasThread();
    await win.click('button[aria-label^="Model:"]');
    await win.waitForTimeout(1_500);
    const providers = await win
      .locator('[data-slot="dropdown-menu-sub-trigger"]')
      .allTextContents();
    const found = {};
    for (const provider of providers) {
      const trigger = win.locator('[data-slot="dropdown-menu-sub-trigger"]', { hasText: provider }).first();
      await trigger.hover();
      await win.waitForTimeout(1_200);
      found[provider] = await win
        .locator('[data-slot="dropdown-menu-sub-content"] [data-slot="dropdown-menu-item"]')
        .allTextContents();
    }
    writeFileSync(join(outDir, `${label}-models.json`), JSON.stringify(found, null, 2));
    log('models -> ' + join(outDir, `${label}-models.json`));
  },

  /** Open the panel on Files and dump its DOM, so the tree's selectors are known. */
  async inspectFiles() {
    await newAtlasThread();
    await win.click('button[aria-label="Toggle workbench panel"]');
    await win.waitForTimeout(2_500);
    await ui.dumpDom('panel-open');
    await ui.shot('panel-open');
    await win.keyboard.press('f');
    await win.waitForTimeout(3_000);
    await ui.dumpDom('files');
    await ui.shot('files');
    await sample();
  },

  /** Sixty seconds against the chosen model, to prove it actually streams. */
  async smoke() {
    await newAtlasThread();
    await selectModel();
    await sendPrompt(prompt);
    for (let i = 0; i < 12; i += 1) {
      await win.waitForTimeout(5_000);
      log(`smoke t+${(i + 1) * 5}s chars=${await transcriptChars()}`);
    }
    await ui.shot('smoke');
  },

  /**
   * Opens a list of files one at a time, closing each surface before the next.
   *
   * The point is retention, not throughput: every file's tokens are dropped
   * from the DOM before the next one is read, so a JS heap that keeps climbing
   * across iterations is being held by something outside the component tree.
   */
  async fileChurn() {
    const files = (arg('files', '') || [
      'src/renderer/components/SettingsWorkspace.tsx',
      'src/renderer/components/ChatWindow.tsx',
      'src/renderer/components/Sidebar.tsx',
      'src/renderer/components/Composer.tsx',
      'src/renderer/components/ModelSelector.tsx',
      'src/renderer/components/CodeBlock.tsx',
      'src/renderer/components/CommandPalette.tsx',
      'src/renderer/components/SidebarHoverCard.tsx',
      'src/renderer/components/SidebarSettingsMenu.tsx',
      'src/renderer/components/CommandAutocomplete.tsx',
      'src/renderer/components/PluginMentionAutocomplete.tsx',
      'src/renderer/components/MentionAutocomplete.tsx',
    ].join(',')).split(',');

    await newAtlasThread();
    await win.click('button[aria-label="Toggle workbench panel"]');
    await win.waitForTimeout(2_000);
    await win.keyboard.press('f');
    await win.waitForTimeout(3_000);

    note = 'churn-baseline';
    await settle(4);
    log('churn baseline', JSON.stringify(await sample()));

    for (const [index, path] of files.entries()) {
      note = `churn-${index + 1}`;
      await openFileBySearch(path);
      await win.waitForTimeout(2_500);
      await closeFileSurface(path);
      await settle(3);
      const row = await sample();
      log(`after ${index + 1} file(s) (${path}) jsHeapUsedMB=${(row.jsHeapUsedKb / 1024).toFixed(1)} rendererFootprintMB=${(row.rendererFootprintKb / 1024).toFixed(1)} dom=${row.domNodes}`);
    }

    note = 'churn-end';
    await settle(5);
    log('churn end', JSON.stringify(await sample()));
    await ui.shot('churn-end');
  },

  /**
   * Two terminal panes, each fed 100 MB, then closed.
   *
   * xterm's scrollback and its WebGL texture atlases are the one suspect that
   * shows up as process footprint without ever touching the JS heap, so this
   * run is judged on footprint before/during/after, not on `JSHeapUsedSize`.
   */
  async terminalSplit() {
    await newAtlasThread();
    note = 'terminal-baseline';
    await settle(4);
    log('baseline', JSON.stringify(await sample()));

    await win.click('button[aria-label="Toggle terminal"]');
    await win.waitForTimeout(4_000);
    note = 'terminal-open';
    log('terminal open', JSON.stringify(await sample()));

    // The dock focuses the pane it just created, so typing goes to it.
    for (let pane = 0; pane < 2; pane += 1) {
      if (pane > 0) {
        await win.keyboard.press('Meta+d');
        await win.waitForTimeout(2_500);
      }
      await win.keyboard.type('yes | head -c 100000000 | cat\n');
      await win.waitForTimeout(1_500);
    }

    note = 'terminal-flooding';
    for (let tick = 0; tick < 12; tick += 1) {
      await win.waitForTimeout(10_000);
      const row = await sample();
      log(`flood t+${(tick + 1) * 10}s rendererFootprintMB=${(row.rendererFootprintKb / 1024).toFixed(0)} jsHeapMB=${(row.jsHeapUsedKb / 1024).toFixed(1)}`);
    }

    await ui.shot('terminal-flooded');
    note = 'terminal-closed';
    await win.click('button[aria-label="Toggle terminal"]');
    await settle(8);
    log('after closing the dock', JSON.stringify(await sample()));
  },

  /**
   * Step 9's isolation check: what a Browser surface's guest can reach.
   *
   * Evaluated inside the guest via its own `executeJavaScript`, not from the
   * host page, because the host's `require`/`process` say nothing about the
   * guest's context.
   */
  async isolationCheck() {
    await newAtlasThread();
    await win.click('button[aria-label="Toggle workbench panel"]');
    await win.waitForTimeout(2_000);
    await win.keyboard.press('b');
    await win.waitForTimeout(2_500);
    await ui.dumpDom('browser-empty');
    const address = win.locator('#workbench-panel input').first();
    await address.click();
    await address.fill('https://example.com');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(12_000);
    await ui.shot('browser');

    const results = await win.evaluate(async () => {
      const guest = document.querySelector('webview');
      if (!guest) return { error: 'no <webview> in the document' };
      const ask = async (expression) => {
        try {
          return await guest.executeJavaScript(expression);
        } catch (error) {
          return `threw: ${error.message}`;
        }
      };
      return {
        href: await ask('location.href'),
        require: await ask('typeof require'),
        process: await ask('typeof process'),
        atlasChat: await ask('typeof window.atlasChat'),
        module: await ask('typeof module'),
        electron: await ask('typeof window.electron'),
        openerSameOrigin: await ask('String(window.opener)'),
      };
    });
    writeFileSync(join(outDir, `${label}-isolation.json`), JSON.stringify(results, null, 2));
    log('isolation', JSON.stringify(results));
  },

  /**
   * Floods one terminal three times, settling and forcing GC between rounds.
   *
   * The question is whether the footprint a flood leaves behind is a one-time
   * high-water mark or something that stacks: a mark can be lived with, a
   * staircase is how a renderer reaches gigabytes.
   */
  async terminalRepeat() {
    await newAtlasThread();
    await settle(4);
    log('baseline', JSON.stringify(await sample()));
    await win.click('button[aria-label="Toggle terminal"]');
    await win.waitForTimeout(4_000);

    for (let round = 1; round <= 3; round += 1) {
      note = `flood-${round}`;
      await win.keyboard.type('yes | head -c 100000000 | cat\n');
      await win.waitForTimeout(45_000);
      await settle(10);
      const row = await sample();
      log(`round ${round}: rendererFootprintMB=${(row.rendererFootprintKb / 1024).toFixed(0)} rendererRssMB=${(row.rendererRssKb / 1024).toFixed(0)} jsHeapMB=${(row.jsHeapUsedKb / 1024).toFixed(1)}`);
    }

    note = 'flood-cleared';
    await win.keyboard.type('clear\n');
    await win.waitForTimeout(3_000);
    await settle(15);
    log('after clear + GC', JSON.stringify(await sample()));
  },

  /** Run A: right panel closed for the whole stream. */
  async panelClosed() {
    await newAtlasThread();
    await selectModel();
    await settle(5);
    note = 'baseline';
    log('baseline', JSON.stringify(await sample()));
    if (wantSnapshots) await takeHeapSnapshot(cdp, `${label}-before`);
    await sendPrompt(prompt);
    await streamFor('streaming-panel-closed');
    note = 'end';
    await settle(3);
    log('end', JSON.stringify(await sample()), 'transcriptChars=' + (await transcriptChars()));
    await ui.shot('end');
  },

  /** Run B: right panel open on Files, with src/renderer/App.tsx open in the viewer. */
  async panelFiles() {
    await newAtlasThread();
    await win.click('button[aria-label="Toggle workbench panel"]');
    await win.waitForTimeout(2_000);
    await win.keyboard.press('f');
    await win.waitForTimeout(3_000);
    await openFile('src/renderer/App.tsx');
    await selectModel();
    await settle(5);
    note = 'baseline';
    log('baseline', JSON.stringify(await sample()));
    if (wantSnapshots) await takeHeapSnapshot(cdp, `${label}-before`);
    await sendPrompt(prompt);
    await streamFor('streaming-panel-files');
    note = 'end';
    await settle(3);
    log('end', JSON.stringify(await sample()), 'transcriptChars=' + (await transcriptChars()));
    await ui.shot('end');
  },
};

/**
 * Walks the Files tree to a workspace-relative path and opens it.
 *
 * Rows are `button[title="<workspace-relative path>"]`, and the tree is lazy:
 * each directory has to be expanded and its children awaited before the next
 * segment exists.
 */
/**
 * Opens a file through the panel's search box rather than the tree.
 *
 * Tree walking needs one expand per directory and leaves those directories
 * expanded, which changes the row count between iterations; the search box
 * lands on any path in one step and resets cleanly.
 */
async function openFileBySearch(path) {
  const search = win.locator('#workbench-panel input[aria-label="Search files"]');
  await search.click();
  await search.fill(path);
  await win.waitForTimeout(1_200);
  await win.locator(`#workbench-panel button[title="${path}"]`).first().click({ timeout: 20_000 });
  await win.waitForTimeout(2_500);
}

/**
 * Closes one file's surface tab, leaving the Files tree tab in place.
 *
 * Tabs are labelled by basename, so the caller passes the path it opened and
 * the Files tab (whose close button is right next to it) is never hit.
 */
async function closeFileSurface(path) {
  const basename = path.split('/').pop();
  await win.locator(`button[aria-label="Close ${basename}"]`).first().click({ timeout: 15_000 });
  await win.waitForTimeout(1_500);
}

async function openFile(path) {
  const segments = path.split('/');
  const steps = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
  for (const step of steps) {
    const row = win.locator(`#workbench-panel button[title="${step}"]`).first();
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    await row.click();
    await win.waitForTimeout(1_500);
  }
  await win.waitForTimeout(3_000);
  await ui.shot('file-open');
}

const chosen = scenarios[scenario];
if (!chosen) {
  log(`unknown scenario "${scenario}"; known: ${Object.keys(scenarios).join(', ')}`);
} else {
  try {
    if (wantSnapshots) await takeHeapSnapshot(cdp, `${label}-before`);
    await chosen();
    if (wantSnapshots) await takeHeapSnapshot(cdp, `${label}-after`);
  } catch (error) {
    log('scenario failed:', error.stack ?? String(error));
    await ui.shot('failure');
  }
}

clearInterval(timer);
await sample();
log(`final: ${JSON.stringify(last)}`);
log(`samples -> ${csvPath}`);
await app.close().catch(() => {});
logStream.end();
