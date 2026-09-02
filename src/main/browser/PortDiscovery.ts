/**
 * Which local servers are worth offering when a browser surface opens empty.
 *
 * "Open a local app or URL" is only a useful thing to say if the app can name
 * the local apps. `lsof` knows what is listening; a bounded HTTP probe then
 * decides which of those listeners actually serve a page, because a Postgres
 * socket and a Vite dev server look identical from the port table.
 *
 * Same shape as t3code's `apps/server/src/preview/PortScanner.ts`, minus the
 * subscription machinery: this is asked a question when a panel opens, not
 * polled forever.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { DiscoveredServer } from '../../shared/browser';

export type Listener = {
  port: number;
  command: string | null;
};

/**
 * Ports Atlas will not offer even when something is listening: its own dev
 * server is already the window you are looking at, and the low ones are
 * system services nobody wants a preview of.
 */
const MIN_PORT = 1_024;

/** Bounds on the probe, so a machine with 200 listeners cannot stall a panel. */
const MAX_CANDIDATES = 24;
/**
 * How many make it to the panel. A dev machine can easily have a dozen tools
 * holding a port; a list that long is not a shortcut, it is a haystack. The
 * address bar covers whatever ranking leaves out.
 */
const MAX_OFFERED = 8;
/**
 * Ports a person means when they say "the dev server". A listener on one of
 * these is offered before anything else, whatever else is running.
 */
const WELL_KNOWN_DEV_PORTS = new Set([
  3000, 3001, 4000, 4173, 4200, 5000, 5173, 5174, 8000, 8080, 8081, 8787, 9000,
]);
/**
 * The OS hands these out to whatever asks. A tool that landed on one did not
 * choose it, and neither did the user, so it sorts last.
 */
const EPHEMERAL_PORT_FLOOR = 49_152;
const PROBE_CONCURRENCY = 6;
const PROBE_TIMEOUT_MS = 1_200;
const LSOF_TIMEOUT_MS = 3_000;
/**
 * Long enough to cover the burst of calls when a panel opens, short enough
 * that starting a dev server and clicking back shows it.
 */
const CACHE_TTL_MS = 5_000;

const LSOF_CANDIDATES = ['/usr/sbin/lsof', '/usr/bin/lsof', '/bin/lsof'] as const;

/**
 * Tried when `lsof` is missing (Windows, a trimmed container). A curated list
 * is a worse answer than the port table, but it is a much better answer than
 * an empty panel.
 */
const COMMON_DEV_PORTS = [
  3000, 3001, 3333, 4000, 4173, 4200, 5000, 5173, 5174, 5273, 8000, 8080, 8081, 8787, 9000,
] as const;

/**
 * Parses `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`.
 *
 * The `-F` format is one field per line, prefixed by its letter: `p` starts a
 * process record and `c` names it, then each `n` is one of that process's
 * listening addresses. Records are stateful — an `n` belongs to the most
 * recent `p` — which is exactly the part that is easy to get wrong and
 * invisible when it is, so it is parsed here and tested.
 */
export function parseLsofListeners(stdout: string): Listener[] {
  const byPort = new Map<number, string | null>();
  let command: string | null = null;

  for (const line of stdout.split('\n')) {
    const tag = line[0];
    const value = line.slice(1).trim();

    if (tag === 'p') {
      command = null;
      continue;
    }
    if (tag === 'c') {
      command = value || null;
      continue;
    }
    if (tag !== 'n') continue;

    const port = listeningPort(value);
    if (port === null) continue;
    // First writer wins: the same port listed for IPv4 and IPv6 is one server.
    if (!byPort.has(port)) byPort.set(port, command);
  }

  return [...byPort.entries()]
    .map(([port, name]) => ({ port, command: name }))
    .sort((left, right) => left.port - right.port);
}

/**
 * The port from an lsof address, when it is one a browser could reach on this
 * machine. `*:3000` and `127.0.0.1:3000` qualify; a LAN-only bind on another
 * interface does not, and neither does anything without a numeric port.
 */
function listeningPort(address: string): number | null {
  const separator = address.lastIndexOf(':');
  if (separator < 0) return null;

  const host = address.slice(0, separator);
  const port = Number(address.slice(separator + 1));
  if (!Number.isInteger(port) || port < MIN_PORT || port > 65_535) return null;

  const normalizedHost = host.replace(/^\[|\]$/g, '');
  const reachable =
    normalizedHost === '*' ||
    normalizedHost === '' ||
    normalizedHost === '0.0.0.0' ||
    normalizedHost === '::' ||
    normalizedHost === '::1' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost === 'localhost';

  return reachable ? port : null;
}

export class PortDiscovery {
  private cached: { servers: DiscoveredServer[]; expiresAt: number } | null = null;
  private inflight: Promise<DiscoveredServer[]> | null = null;
  private lsofPath: string | null | undefined;

  /**
   * The two sides are injectable so the pipeline — batching, the cache, the
   * mapping to a URL — can be tested without a port table or a network.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly probe: (url: string) => Promise<boolean> = probeServesHtml,
    private readonly listListeners?: () => Promise<Listener[]>
  ) {}

  async scan(): Promise<DiscoveredServer[]> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.servers;
    if (this.inflight) return this.inflight;

    this.inflight = this.run()
      .then((servers) => {
        this.cached = { servers, expiresAt: this.now() + CACHE_TTL_MS };
        return servers;
      })
      .catch(() => [])
      .finally(() => {
        this.inflight = null;
      });

    return this.inflight;
  }

  private async run(): Promise<DiscoveredServer[]> {
    const listeners = await this.listeners();
    const candidates = listeners.slice(0, MAX_CANDIDATES);
    const serving: DiscoveredServer[] = [];

    for (let index = 0; index < candidates.length; index += PROBE_CONCURRENCY) {
      const batch = candidates.slice(index, index + PROBE_CONCURRENCY);
      const answers = await Promise.all(
        batch.map(async (listener) => ({
          listener,
          // Probed on the loopback address rather than `localhost`, so a
          // machine where that name resolves to IPv6-only cannot make every
          // IPv4 server look dead.
          serves: await this.probe(`http://127.0.0.1:${listener.port}/`),
        }))
      );

      for (const answer of answers) {
        if (!answer.serves) continue;
        serving.push({
          url: `http://localhost:${answer.listener.port}`,
          port: answer.listener.port,
          command: answer.listener.command,
        });
      }
    }

    return rankServers(serving);
  }

  private async listeners(): Promise<Listener[]> {
    if (this.listListeners) return this.listListeners();

    const lsof = this.resolveLsof();
    if (!lsof) {
      return COMMON_DEV_PORTS.map((port) => ({ port, command: null }));
    }

    const stdout = await new Promise<string>((resolve) => {
      execFile(
        lsof,
        ['-iTCP', '-sTCP:LISTEN', '-P', '-n', '-F', 'pcn'],
        { maxBuffer: 4 * 1024 * 1024, timeout: LSOF_TIMEOUT_MS },
        // lsof exits non-zero when *some* handles were unreadable, which is
        // the normal case for an unprivileged process, and it still prints
        // everything it could see — so the output is used either way.
        (_error, out) => resolve(out ?? '')
      );
    });

    return parseLsofListeners(stdout);
  }

  private resolveLsof(): string | null {
    if (this.lsofPath !== undefined) return this.lsofPath;
    this.lsofPath = LSOF_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
    return this.lsofPath;
  }
}

/**
 * The order the panel offers them in, trimmed to what a person will read.
 *
 * Three tiers: the ports people actually name, then everything a tool chose
 * for itself, then the ephemeral range the OS handed out. Within a tier, the
 * lower port first — on a machine running eleven of the same background tool,
 * that at least keeps the list stable between scans.
 */
export function rankServers(servers: readonly DiscoveredServer[]): DiscoveredServer[] {
  return [...servers]
    .sort((left, right) => tier(left.port) - tier(right.port) || left.port - right.port)
    .slice(0, MAX_OFFERED);
}

function tier(port: number): number {
  if (WELL_KNOWN_DEV_PORTS.has(port)) return 0;
  return port >= EPHEMERAL_PORT_FLOOR ? 2 : 1;
}

/**
 * Whether something at this URL serves a page. A redirect counts: dev servers
 * routinely bounce `/` somewhere else, and following it here would double the
 * probe cost to learn nothing more.
 */
async function probeServesHtml(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'text/html' },
    });

    if (response.status >= 300 && response.status < 400) return true;
    if (!response.ok) return false;

    const type = response.headers.get('content-type') ?? '';
    return type.includes('text/html') || type.includes('application/xhtml');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
