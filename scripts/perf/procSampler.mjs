/**
 * Samples the memory of one Electron process tree on macOS.
 *
 * Processes are classified by the `--type=` switch on their command line, not
 * by their display name: the dev launcher renames the helper bundles, so
 * "Atlas Helper (Renderer)" and "Electron Helper (Renderer)" can both be the
 * same role depending on whether the branded launcher built that run.
 *
 * Two numbers per process, because they answer different questions:
 *   rssKb        - resident pages, what `ps` reports and Activity Monitor hides
 *   footprintKb  - phys_footprint, what macOS charges the app (rss + compressed
 *                  + IOKit/GPU), the number that turns into swap pressure
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * `--type=x` for an Electron helper, `main` for the browser process, and
 * `child:<name>` for anything Atlas spawned that is not Electron at all — the
 * opencode server, ptys, git. Those must not be folded into `main`: a provider
 * daemon's 90 MB inside the "main process" column is how a renderer leak gets
 * blamed on the wrong process.
 */
function roleOf(command) {
  const match = /--type=([a-zA-Z-]+)/.exec(command);
  if (match) return match[1];
  if (/Electron$|Electron\s/.test(command.split(' ')[0] ?? '')) return 'main';
  if (/\.app\/Contents\/MacOS\//.test(command)) return 'main';
  const binary = (command.split(' ')[0] ?? '').split('/').pop() || 'unknown';
  return `child:${binary}`;
}

/** Every descendant of `rootPid`, inclusive, as {pid, ppid, command, rssKb}. */
export async function processTree(rootPid) {
  const { stdout } = await exec('ps', ['-eo', 'pid=,ppid=,rss=,command=']);
  const rows = stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, pid, ppid, rss, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKb: Number(rss),
      command,
      role: roleOf(command),
    }));

  const byParent = new Map();
  for (const row of rows) {
    const siblings = byParent.get(row.ppid) ?? [];
    siblings.push(row);
    byParent.set(row.ppid, siblings);
  }

  const out = [];
  const queue = [rows.find((row) => row.pid === rootPid)].filter(Boolean);
  while (queue.length > 0) {
    const row = queue.shift();
    out.push(row);
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return out;
}

/** phys_footprint in KB, or null when the process died between calls. */
export async function footprintKb(pid) {
  try {
    const { stdout } = await exec('footprint', ['-p', String(pid)], { maxBuffer: 1 << 22 });
    const match = /phys_footprint:\s+([\d.]+)\s*(KB|MB|GB)/.exec(stdout);
    if (!match) return null;
    const scale = { KB: 1, MB: 1024, GB: 1024 * 1024 }[match[2]];
    return Math.round(Number(match[1]) * scale);
  } catch {
    return null;
  }
}

/**
 * One sample of the whole tree. Roles are aggregated because Electron can hold
 * several utility processes and their individual pids are noise.
 */
export async function sampleTree(rootPid) {
  const tree = await processTree(rootPid);
  const withFootprint = await Promise.all(
    tree.map(async (row) => ({ ...row, footprintKb: await footprintKb(row.pid) }))
  );

  const byRole = {};
  for (const row of withFootprint) {
    const bucket = (byRole[row.role] ??= { rssKb: 0, footprintKb: 0, pids: [] });
    bucket.rssKb += row.rssKb;
    bucket.footprintKb += row.footprintKb ?? 0;
    bucket.pids.push(row.pid);
  }

  return {
    at: new Date().toISOString(),
    processes: withFootprint,
    byRole,
    totalRssKb: withFootprint.reduce((sum, row) => sum + row.rssKb, 0),
    totalFootprintKb: withFootprint.reduce((sum, row) => sum + (row.footprintKb ?? 0), 0),
  };
}
