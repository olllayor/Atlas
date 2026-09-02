/**
 * Tool-name namespacing, matching Codex's scheme.
 *
 * A third-party server naming its tool `read_file` must not be able to stand in
 * front of the built-in one, so every MCP tool is prefixed with its server. The
 * delimiter is two underscores because a single one is ordinary inside both
 * server and tool names.
 */
export const MCP_TOOL_NAME_PREFIX = 'mcp';
export const MCP_TOOL_NAME_DELIMITER = '__';

/** The provider tool-name ceiling. Longer names are truncated around a hash. */
export const MAX_TOOL_NAME_LENGTH = 64;
const NAME_HASH_LENGTH = 12;

/**
 * How a server is reached.
 *
 * `http` is Streamable HTTP, the current transport. `sse` is the legacy
 * HTTP+SSE binding, kept distinct rather than folded into `http` because the
 * Agent Plugins spec requires a client to "use declared transport for initial
 * connection attempt" — and it genuinely is a different handshake. Collapsing
 * the two meant every `"type": "sse"` server failed to connect while claiming
 * to be configured correctly.
 */
export type McpTransportKind = 'stdio' | 'http' | 'sse';

/**
 * How a server is reached, and how far it is trusted.
 *
 * `env` holds literal values the user typed; `envVars` names variables to
 * forward from Atlas's own environment. The split matters: a spawned server
 * gets a cleared environment plus a fixed allowlist, so anything else it needs
 * has to be declared here rather than inherited by accident.
 */
export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransportKind;
  /** stdio: the executable. Never passed through a shell. */
  command: string | null;
  args: string[];
  env: Record<string, string>;
  envVars: string[];
  cwd: string | null;
  /** http: the endpoint. */
  url: string | null;
  /**
   * Names an environment variable holding a bearer token for an HTTP server.
   *
   * Only the name travels in the configuration. A bundle that inlined a token
   * would be publishing a credential in a git repository, which is why the
   * format spells this as a variable name and why nothing here ever holds the
   * value.
   */
  bearerTokenEnvVar: string | null;
  /**
   * Literal HTTP headers, for `http` and `sse` servers.
   *
   * The Agent Plugins way to authenticate an endpoint, and the spec is explicit
   * that a plugin MUST NOT embed credentials here — a manifest is a file in a
   * git repository. Anything that looks like a secret is refused at parse time
   * rather than quietly forwarded.
   */
  headers: Record<string, string>;
  /**
   * The bundle root, for a plugin-carried server. `null` for anything else.
   *
   * Exists so the spawn path can set `PLUGIN_ROOT`/`PLUGIN_DATA`, which the
   * Agent Plugins spec requires every subprocess to receive.
   */
  pluginRoot: string | null;
  /** The client-managed writable directory for this plugin. See `pluginRoot`. */
  pluginDataDir: string | null;
  enabled: boolean;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  /** Default approval stance for this server's tools. */
  approvalMode: McpToolApprovalMode;
  createdAt: string;
  updatedAt: string;
};

/**
 * Codex's four stances, kept verbatim.
 *
 * `auto` is not "never ask" — it means "ask unless the tool itself declares it
 * only reads". A server that ships no annotations gets prompted, which is the
 * safe reading of silence.
 */
export type McpToolApprovalMode = 'auto' | 'prompt' | 'writes' | 'approve';

/**
 * The four hints the MCP spec lets a tool publish about its own effects.
 *
 * All four are advertising, not enforcement: they are written by the same
 * third party that wrote the tool, so an absent hint is read as "unknown" and a
 * present one only ever adds caution, never removes it. Only `readOnlyHint` can
 * lower friction, and only when nothing else contradicts it.
 *
 * Codex previously read `readOnlyHint` alone. The other three are published by
 * real servers and describe exactly the cases friction exists for — deleting
 * something, or reaching a system outside the conversation — so ignoring them
 * meant treating "posts to a public timeline" and "sorts a list" identically.
 */
export type McpToolAnnotations = {
  /** Presentational; never used to decide anything. */
  title?: string;
  /** The tool only retrieves data and changes nothing outside the conversation. */
  readOnlyHint?: boolean;
  /** The tool may remove or overwrite data. Meaningful only when not read-only. */
  destructiveHint?: boolean;
  /** Repeating the call with the same arguments has no additional effect. */
  idempotentHint?: boolean;
  /** The tool reaches an external system, account, or public surface. */
  openWorldHint?: boolean;
};

/**
 * Whether a tool's own hints are self-contradictory.
 *
 * A tool cannot both change nothing and destroy something. When a server says
 * both, the claim that would reduce friction is the one discarded — a bundle
 * that mislabels itself must not be able to buy silence with the mistake.
 */
export function mcpAnnotationsConflict(annotations: McpToolAnnotations | undefined): boolean {
  return annotations?.readOnlyHint === true && annotations.destructiveHint === true;
}

/**
 * A one-line effect summary appended to what the model is told about a tool.
 *
 * The model picks between tools on descriptions alone, and a description is
 * author-controlled prose that can omit anything inconvenient. These four words
 * are derived from the annotations instead, so "this deletes things" reaches
 * the model even when the sentence above it says "tidies your workspace".
 */
export function describeMcpToolEffects(annotations: McpToolAnnotations | undefined): string {
  const labels: string[] = [];

  if (mcpAnnotationsConflict(annotations)) {
    labels.push('effects unclear (the server labels this both read-only and destructive)');
  } else if (annotations?.readOnlyHint === true) {
    labels.push('read-only');
  } else {
    labels.push('may change state');
  }

  if (annotations?.destructiveHint === true) {
    labels.push('may delete or overwrite data');
  }

  if (annotations?.openWorldHint === true) {
    labels.push('reaches systems outside this conversation');
  }

  if (annotations?.idempotentHint === false) {
    labels.push('repeating the call repeats the effect');
  }

  return labels.join('; ');
}

export const MCP_DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
export const MCP_DEFAULT_TOOL_TIMEOUT_MS = 300_000;

/**
 * Environment variables a spawned MCP server inherits.
 *
 * Everything else is cleared. Atlas's own process holds provider API keys, and
 * a third-party binary has no business reading them — so the environment is
 * rebuilt from this list rather than filtered down from `process.env`.
 */
export const MCP_DEFAULT_ENV_VARS_UNIX = [
  'HOME',
  'LOGNAME',
  'PATH',
  'SHELL',
  'USER',
  '__CF_USER_TEXT_ENCODING',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'TZ'
] as const;

export const MCP_DEFAULT_ENV_VARS_WINDOWS = [
  'PATH',
  'PATHEXT',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE'
] as const;

export function defaultMcpEnvVars(platform: NodeJS.Platform = process.platform): readonly string[] {
  return platform === 'win32' ? MCP_DEFAULT_ENV_VARS_WINDOWS : MCP_DEFAULT_ENV_VARS_UNIX;
}

/** Variables the client owns. A plugin may not set either; see `buildMcpServerEnv`. */
export const PLUGIN_ROOT_VAR = 'PLUGIN_ROOT';
export const PLUGIN_DATA_VAR = 'PLUGIN_DATA';
export const RESERVED_PLUGIN_ENV_VARS = [PLUGIN_ROOT_VAR, PLUGIN_DATA_VAR] as const;

/**
 * The environment a server is launched with: allowlist, then declared
 * forwards, then literal overrides, then the reserved variables.
 *
 * The order of the last two is normative, not incidental. The Agent Plugins
 * spec says to "overlay configured `env` on base environment, then set reserved
 * variables" — so `PLUGIN_ROOT` and `PLUGIN_DATA` are written *after* the
 * bundle's own `env`, and a bundle cannot redirect either by declaring it. The
 * parser refuses those keys as well; this is the layer that makes it true even
 * if one slips through.
 */
export function buildMcpServerEnv(
  config: Pick<McpServerConfig, 'env' | 'envVars'> &
    Partial<Pick<McpServerConfig, 'pluginRoot' | 'pluginDataDir'>>,
  source: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const name of [...defaultMcpEnvVars(platform), ...config.envVars]) {
    const value = source[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }

  const merged: Record<string, string> = { ...result, ...config.env };

  if (config.pluginRoot) {
    merged[PLUGIN_ROOT_VAR] = config.pluginRoot;
  }

  if (config.pluginDataDir) {
    merged[PLUGIN_DATA_VAR] = config.pluginDataDir;
  }

  return merged;
}

/** Anything a provider will not accept in a tool name becomes an underscore. */
export function sanitizeToolNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * A short, stable hash used only to keep truncated tool names distinct.
 *
 * Deliberately not a crypto hash: this module is imported by the renderer,
 * where `node:crypto` does not exist, and nothing here is a security boundary —
 * the worst a collision could do is make two tool names equal, which the caller
 * already handles by skipping the duplicate.
 */
function hashFor(value: string): string {
  // FNV-1a, twice with different offsets, for enough hex to fill the suffix.
  const digest = (seed: number) => {
    let hash = seed;

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
  };

  return `${digest(0x811c9dc5)}${digest(0x7fffffff)}`.slice(0, NAME_HASH_LENGTH);
}

/**
 * `mcp__<server>__<tool>`, shortened around a hash when it will not fit.
 *
 * Truncation keeps a hash of the full identity so two long names that share a
 * prefix stay distinguishable — cutting at the limit alone would collide them.
 */
export function namespaceMcpTool(serverName: string, toolName: string): string {
  const server = sanitizeToolNamePart(serverName);
  const tool = sanitizeToolNamePart(toolName);
  const full = `${MCP_TOOL_NAME_PREFIX}${MCP_TOOL_NAME_DELIMITER}${server}${MCP_TOOL_NAME_DELIMITER}${tool}`;

  if (full.length <= MAX_TOOL_NAME_LENGTH) {
    return full;
  }

  const suffix = `_${hashFor(`${serverName}\x00${toolName}`)}`;
  return `${full.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith(`${MCP_TOOL_NAME_PREFIX}${MCP_TOOL_NAME_DELIMITER}`);
}

export function isAllowedMcpEndpointUrl(urlString: string): { ok: true; url: URL } | { ok: false; error: string } {
  try {
    const url = new URL(urlString);

    if (url.username || url.password) {
      return {
        ok: false,
        error: `Endpoint URL "${urlString}" contains embedded credentials. Authentication credentials must not be passed in the URL.`
      };
    }

    if (url.protocol === 'https:') {
      return { ok: true, url };
    }

    if (url.protocol === 'http:') {
      const hostname = url.hostname.toLowerCase();
      const isLoopback =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||
        hostname === '::1';

      if (isLoopback) {
        return { ok: true, url };
      }

      return {
        ok: false,
        error: `Insecure HTTP endpoint "${urlString}" is rejected. Remote MCP servers must use HTTPS (plain HTTP is only permitted on localhost/loopback).`
      };
    }

    return {
      ok: false,
      error: `Unsupported protocol "${url.protocol}". MCP endpoints must use https:// (or http://localhost).`
    };
  } catch {
    return { ok: false, error: `Invalid endpoint URL: "${urlString}".` };
  }
}

/**
 * The identity a person's spawn consent is recorded against.
 *
 * Consent covers exactly one concrete command line, so the key changes when
 * anything the user signed off on changes: the server identity (`id`), the
 * resolved executable (`command`), or the arguments and launch context
 * (`args`, `cwd`). Anything left out of the key would be re-consented silently
 * when it changed.
 *
 * Pure, because the writer (on consent) and the checker (before every spawn)
 * both call it and must not drift.
 *
 * Only reachable on the stdio path: `command` is null for HTTP/SSE servers, so
 * a null here is a programming error rather than a consent case, and throws.
 */
export function spawnConsentKey(input: {
  id: string;
  command: string | null;
  args: string[];
  cwd: string | null;
}): string {
  if (!input.command) {
    throw new Error('spawnConsentKey: command is required');
  }
  const payload = [
    input.id,
    input.command,
    input.args.join('\0'),
    input.cwd ?? ''
  ].join('\0');
  return `${input.id}|${hashFor(payload)}`;
}

/** A namespaced tool name, read back into the parts a person recognises. */
export type McpToolDisplay = {
  /** The plugin the call belongs to, when the name still carries it. */
  plugin: string;
  /** The tool as the server named it. */
  tool: string;
  /** `plugin.tool` — what the transcript shows. */
  label: string;
};

/**
 * Turns `mcp__github_github__search_issues` into `github.search_issues`.
 *
 * The transcript used to print the wire name, which is an implementation
 * detail: `mcp__`, the sanitised `/`, and the server key a bundle happened to
 * choose are all noise to someone reading what their agent just did. What they
 * need is which plugin acted and what it did.
 *
 * Two lossy cases, both handled by not pretending otherwise. A plugin server is
 * named `<plugin>/<server-key>` and sanitised to `<plugin>_<key>`, so the
 * separator is unrecoverable — but the overwhelmingly common shape is
 * `github/github`, and a doubled name collapses cleanly. A name long enough to
 * have been truncated around a hash cannot be parsed at all, and returns null
 * rather than a confident half-answer.
 */
export function describeMcpToolName(name: string): McpToolDisplay | null {
  const split = splitMcpToolName(name);

  if (!split) {
    return null;
  }

  // `github_github` is one plugin whose single server shares its name. Showing
  // it twice reads as a mistake in the app rather than a fact about the bundle.
  const halves = split.serverSegment.split('_');
  const plugin =
    halves.length === 2 && halves[0] && halves[0] === halves[1] ? halves[0] : split.serverSegment;

  return { plugin, tool: split.tool, label: `${plugin}.${split.tool}` };
}

/**
 * The exact, non-lossy split of a namespaced tool name: the sanitised server
 * segment, and the tool as the server named it.
 *
 * `describeMcpToolName` above builds a *display* label from this and is
 * intentionally lossy — it collapses `github_github` to `github` for
 * readability, which throws away the distinction between the plugin name and
 * the server key. Provenance lookups cannot afford that: they need to compare
 * `serverSegment` against `sanitizeToolNamePart(pluginServerName(plugin, key))`
 * for an *exact* match, so this is exported separately rather than parsed a
 * second time by every caller that needs the precise value.
 */
export function splitMcpToolName(name: string): { serverSegment: string; tool: string } | null {
  if (!isMcpToolName(name)) {
    return null;
  }

  const rest = name.slice(`${MCP_TOOL_NAME_PREFIX}${MCP_TOOL_NAME_DELIMITER}`.length);
  const split = rest.indexOf(MCP_TOOL_NAME_DELIMITER);

  if (split <= 0) {
    return null;
  }

  const serverSegment = rest.slice(0, split);
  const tool = rest.slice(split + MCP_TOOL_NAME_DELIMITER.length);

  return tool ? { serverSegment, tool } : null;
}

/**
 * Whether a tool call must pause for approval.
 *
 * `readOnlyHint` is only believed when a server actually sends it, and only
 * when nothing else the tool says contradicts it; an absent annotation is
 * treated as "unknown", not as "safe".
 *
 * `approve` — the stance that means "stop asking me about this server" — still
 * stops for a tool the server itself has labelled destructive. Blanket approval
 * is a statement about a server's ordinary traffic, and the one class of call
 * where a wrong guess cannot be taken back is the one class it should not
 * silently cover. A server that ships no `destructiveHint` is unaffected, so
 * this changes nothing for the servers that annotate nothing.
 */
export function mcpToolNeedsApproval(
  mode: McpToolApprovalMode,
  annotations: McpToolAnnotations | undefined
): boolean {
  const readOnly = annotations?.readOnlyHint === true && !mcpAnnotationsConflict(annotations);
  const destructive = annotations?.destructiveHint === true;

  switch (mode) {
    case 'approve':
      return destructive;
    case 'prompt':
      return true;
    case 'writes':
    case 'auto':
      return !readOnly;
    default:
      return true;
  }
}

/**
 * Splits a typed argument string into an argv list.
 *
 * Quoting is honoured so a path with a space stays one argument. This is a
 * display convenience only — the result is passed as a list, so nothing here
 * can introduce a shell.
 */
export function parseMcpArgs(text: string): string[] {
  const matches = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  return matches.map((token) => {
    const quoted =
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"));

    return quoted ? token.slice(1, -1) : token;
  });
}

/**
 * Rejects a command that only makes sense to a shell.
 *
 * Servers are spawned with an argv array and no shell, so a value carrying
 * metacharacters is either a mistake or an attempt to smuggle one in.
 */
export function isValidMcpCommand(command: string): boolean {
  const trimmed = command.trim();

  if (!trimmed) {
    return false;
  }

  return !/[;&|><`$(){}\n\r]/.test(trimmed);
}
