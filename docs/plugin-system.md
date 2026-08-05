# Plugin support — scope

**Status:** in progress. `src/shared/plugins.ts` and the MCP-surface removal have landed; everything from §3 onward is still design.
**Ground truth:** the format sections below were read off 43 installed plugins across 7 marketplaces in a real Codex install (`~/.codex/plugins/cache`), then checked against OpenAI's own [`openai/plugins`](https://github.com/openai/plugins) reference repo — 180 plugins, 8022 files, including the authoritative spec at `.agents/skills/plugin-creator/references/plugin-json-spec.md`. Where a claim comes only from third-party writing it is marked *(unverified)*.

---

## 0. Corrections since the first draft

Read this before trusting anything below it.

**Component paths supplement, they do not override.** The spec is explicit: *"`skills`, `hooks`, and `mcpServers` are supplemented on top of default component discovery; they do not replace defaults."* Treating a declared path as an override silently drops whatever a bundle keeps in the conventional directory. Implemented as `pluginComponentPaths()`.

**Marketplace lives at `.agents/plugins/marketplace.json`** — `~/.agents/` for personal, `<repo-root>/.agents/` for team. Vendor-neutral, and the primary location; `.claude-plugin/marketplace.json` is the Claude spelling that also works.

**`policy.authentication` is `ON_INSTALL` | `ON_USE`.** The blog-sourced `ON_FIRST_USE` in the original draft was wrong. `policy.installation` is `NOT_AVAILABLE` | `AVAILABLE` | `INSTALLED_BY_DEFAULT`. `source.source: "local"` with a `path` is the shape the official catalog uses throughout.

**A leading `./` is not enforceable.** The spec says paths "should" start with `./`; two of 45 real manifests don't. Containment is checked on `..`/absolute/drive-letter instead.

**Two things named `agents/` are different components.** `agents/openai.yaml` is a metadata sidecar (`interface`/`policy`/`dependencies`) and is what 36% of bundles ship. `agents/*.md` with `tools`/`model`/`permissionMode` frontmatter is a Claude sub-agent definition. Only the second is a sub-agent concept, and Atlas has none.

**Claude's `mcp__plugin_<plugin>_<server>__<tool>` is not a standard.** It appears only in Claude-marketplace bundles' sub-agent allowlists. Every OpenAI bundle uses plain `mcp__<server>__<tool>`. Atlas does not copy the `plugin_` infix.

### Adoption across the 180 official plugins — this reorders the phases

| Surface | Plugins | Share |
|---|---|---|
| `.app.json` (OAuth connectors) | 154 | **85%** |
| `skills/` | 72 | 40% |
| `agents/openai.yaml` | 66 | 36% |
| `.mcp.json` | 8 | **4%** |
| `commands/` | 7 | 3% |
| `hooks.json` | 2 | 1% |

MCP is 4% of the ecosystem. Skills are the shippable slice — 40% of the official set plus the whole Claude-marketplace catalogue on top, and they need no infrastructure Atlas lacks. `.app.json` is the actual centre of gravity and remains out of scope: it brokers OAuth to first-party SaaS, which Atlas cannot fake.

### Gaps this draft still has

- **No revocation.** Upstream fetches a `blocklist.json` keyed `<plugin>@<marketplace>` carrying `reason: "security"`. A system that installs third-party code needs one. *(agent-sourced, unverified)*
- **No rename handling.** A catalog-level `renames` map; without it an upstream rename orphans installs. *(unverified)*
- **GC is reference-counted upstream, not row-based.** The §4 store GC as written could delete a bundle out from under a live server. *(unverified)*
- **`plugin_installs UNIQUE (marketplace_id, plugin_name)` is wrong** — installs are per-scope and need `lastUpdated` beside `installedAt`.

---

## 1. What a plugin is, and why Atlas wants one

MCP standardised the wire: a server publishes tools over JSON-RPC. It standardised nothing else. It has no story for distribution, versioning, updates, lifecycle, or — most expensively — for telling the model *when* to use the tools it just dumped into the context.

A plugin is the packaging layer that grew on top. One versioned bundle, one manifest, carrying up to six component types of which an MCP server is only one.

Atlas already has the MCP half, and it is already Codex-shaped: `mcp__<server>__<tool>` namespacing, 30s/300s timeouts, env allowlist, four approval stances, per-server failure isolation. What Atlas does not have is the packaging half. This document scopes that.

The bundle format is turning into a cross-vendor standard. The same install directory contains manifests under `.codex-plugin/` (27), `.claude-plugin/` (10), `.cursor-plugin/` (3), `.kimi-plugin/` (1) and `.plugin/` (2), and Codex loads all of them. Third-party marketplaces ship a `.claude-plugin/marketplace.json` written for Claude Code and Codex installs them unmodified. Supporting the format means inheriting the whole existing ecosystem, not bootstrapping one.

### Non-goals for v1

- **App connectors** (`.app.json`). These reference first-party OAuth connectors by id (`connector_openai_default_templates`). Atlas has no connector broker and building one is a separate project.
- **Browser extensions.** The `chrome` plugin ships an `extension-host/`; out of scope.
- **Scheduled task templates.**
- **Authoring and publishing tools.** Atlas consumes plugins in v1; it does not help write them.
- **Hooks in phase 1.** Deferred deliberately — see §7.

---

## 2. Format spec (verified)

### Directory layout

```
<plugin-root>/
├── .codex-plugin/plugin.json   # manifest — the only required file
├── skills/<skill-name>/
│   ├── SKILL.md                # required: frontmatter + body
│   └── agents/openai.yaml       # optional: interface, policy, dependencies
├── .mcp.json                    # MCP servers
├── .app.json                    # app connectors (out of scope)
├── hooks/hooks.json             # lifecycle commands
├── bin/                         # executables the bundle ships
└── assets/                      # icons, logos, screenshots
```

Component files live at the plugin **root**, not inside the manifest directory. The manifest points at them with relative paths.

### Manifest

Union of every key observed across the 27 `.codex-plugin/plugin.json` files on disk:

| Key | Type | Notes |
|---|---|---|
| `name` | string | required, stable kebab-case identity |
| `version` | string | required, semver; a bump forces reinstall |
| `description` | string | required |
| `author` | object | `{name, email, url}` |
| `homepage`, `repository`, `license` | string | |
| `keywords` | string[] | |
| `interface` | object | store metadata — see below |
| `skills` | string | path, e.g. `"./skills/"` |
| `mcpServers` | string | path, e.g. `"./.mcp.json"` |
| `apps` | string | path, e.g. `"./.app.json"` |
| `hooks` | string \| object | path, or inline config |
| `strict` | bool | |
| `bundledContentVariant` | string | OpenAI-internal variant selector |

`skills` / `mcpServers` / `apps` / `hooks` are **path strings, not inline config**. All declared paths are relative to the plugin root, must start `./`, and must not escape the root.

`interface{}` is storefront metadata — `displayName`, `shortDescription`, `longDescription`, `category`, `brandColor`, `logo`, `privacyPolicyURL`, `termsOfServiceURL`, `defaultPrompt[]`. It exists because plugins have an install surface. MCP servers never needed one.

### `.mcp.json`

Exact field vocabulary observed, across both transports:

```jsonc
// stdio, shipping its own binary (openai-bundled/computer-use)
{ "mcpServers": { "computer-use": {
    "command": "./bin/computer-use-client-launcher",
    "args": ["mcp"], "cwd": ".", "env_vars": ["CODEX_HOME"] }}}

// stdio, third-party package (openai-curated/build-ios-apps)
{ "mcpServers": { "xcodebuildmcp": {
    "command": "npx", "args": ["-y", "xcodebuildmcp@latest", "mcp"],
    "env": { "XCODEBUILDMCP_ENABLED_WORKFLOWS": "simulator,ui-automation" } }}}

// http with OAuth (openai-curated/cloudflare)
{ "mcpServers": { "cloudflare-api": {
    "type": "http", "url": "https://mcp.cloudflare.com/mcp",
    "note": "human-readable, ignorable by the loader" }}}

// http with a token from the environment (openai-curated/github)
{ "mcpServers": { "github": {
    "type": "http", "url": "https://api.githubcopilot.com/mcp/",
    "bearer_token_env_var": "GITHUB_PAT_TOKEN" }}}
```

Fields: `command`, `args`, `cwd`, `env`, `env_vars`, `type`, `url`, `bearer_token_env_var`, `note`.

**This maps almost one-to-one onto `McpServerInput`.** `env_vars` is exactly Atlas's `envVars`; `env` is exactly Atlas's `env`; `type: "http"` is Atlas's `transport: 'http'`. The only genuinely new work is (a) resolving a relative `command`/`cwd` against the bundle root, and (b) `bearer_token_env_var`.

### `SKILL.md`

```markdown
---
name: neon-postgres-egress-optimizer
description: "Diagnose and fix excessive Postgres data transfer costs. Use when…"
---

<body — the actual instructions>
```

`name` and `description` are the only frontmatter keys observed. The description is load-bearing: it is the entire basis on which the model decides whether to open the body.

### `agents/openai.yaml` (per skill, optional)

```yaml
interface:
  display_name: "Neon Postgres Egress Optimizer"
  short_description: "Diagnose and fix excessive Postgres data transfer costs"
  icon_small: "./assets/neon-small.svg"
  brand_color: "#37C38F"
  default_prompt: "Analyze my codebase for query patterns that cause…"
policy:
  allow_implicit_invocation: false
dependencies:
  tools:
    - type: "mcp"
      value: "neon"
      description: "Neon MCP server"
      transport: "streamable_http"
      url: "https://mcp.neon.tech/mcp"
```

Two keys here decide the whole efficiency design (§6):

- **`policy.allow_implicit_invocation`** — whether the model may pick this skill on its own, or only on explicit user request. Observed `false` on 20 skills, `true` on 2. Default when absent: treat as `true`.
- **`dependencies.tools`** — the skill declaring which MCP servers it needs. This is the hook that lets a server stay unstarted until something actually wants it.

### `hooks/hooks.json`

Claude-Code-shaped, verbatim:

```jsonc
{ "hooks": { "SessionStart": [ { "matcher": "startup|resume|clear|compact",
    "hooks": [ { "type": "command",
      "command": "node \"${CODEX_PLUGIN_ROOT}/hooks/session-start.mjs\"" } ] } ] } }
```

Events observed: `SessionStart`, `SessionEnd`, `PreToolUse`, `UserPromptSubmit`, `Stop`. `${CODEX_PLUGIN_ROOT}` is substituted with the bundle root.

### Marketplace catalog

```jsonc
{ "name": "superpowers-marketplace",
  "owner": { "name": "…", "email": "…" },
  "metadata": { "description": "…", "version": "1.0.13" },
  "plugins": [ { "name": "superpowers",
      "source": { "source": "url", "url": "https://github.com/obra/superpowers.git" },
      "description": "…", "version": "6.2.0", "strict": true } ] }
```

Installed state is recorded per plugin, keyed `<plugin>@<marketplace>`. Marketplace sources are git URLs, local directories, or binary-bundled. *(Third-party sources also describe a `policy.authentication` field of `ON_INSTALL` | `ON_FIRST_USE`; not observed on disk — unverified.)*

---

## 3. Architecture

### New modules

```
src/shared/
  plugins.ts                     # manifest types, validation, path containment,
                                 # .mcp.json → McpServerInput mapping
src/main/plugins/
  PluginStore.ts                 # content-addressed bundle store on disk
  PluginInstaller.ts             # fetch → stage → validate → atomically publish
  MarketplaceRegistry.ts         # catalog fetch, cache, source resolution
  PluginRegistry.ts              # the loaded set; the single read model
  PluginMcpSource.ts             # plugin servers → McpServerConfig[]
  SkillsService.ts               # discovery, metadata index, body loading
src/main/db/repositories/
  pluginsRepo.ts                 # installs, marketplaces, enablement, activation
src/main/ipc/
  plugins.ts                     # registerPluginsIpc
src/renderer/components/plugins/
  PluginsSettingsPage.tsx        # browse / install / inspect / toggle
```

### Seams into what already exists

Five, all of them existing extension points rather than new plumbing:

1. **`McpClientManager` server list.** The user-facing MCP surface has been deleted, so this is no longer a merge: `listPluginServers` in [`src/main/index.ts`](../src/main/index.ts) is the *only* source, and it currently returns `[]`. `PluginMcpSource` fills it. Everything downstream — connection dedupe, catalog TTL, `onclose` eviction, prewarm, health, approval stances — applies to plugin servers unchanged, for free.

   What was removed: `ConnectorsWorkspace` and its `CONNECTOR_CATALOG` (Atlas's own hand-rolled marketplace), `McpSettingsPage`, `McpServersRepo`, `McpServerService`, `registerMcpIpc` and all seven `mcp:*` channels, the preload bridge, the contract types, and the `mcp_servers` table. Existing configured servers were stranded by that drop, deliberately. What stayed: `McpClientManager`, `mcpTools`, `mcpToolsProvider`, `shared/mcp.ts`, `McpSecretStore`, and the transcript's `mcp` tool-cell label — plugin tools still render through it. MCP is now a loader internal with no user-facing existence, which is exactly how `openai/plugins` treats it.

2. **`McpToolsProvider`** ([`ChatSessionRuntime.ts:63`](../src/main/ai/core/ChatSessionRuntime.ts)). Already the seam through which a turn's dynamic tools arrive. Skills add one built-in tool (`load_skill`) rather than a second provider.

3. **`buildSystemPrompt`** ([`ChatSessionRuntime.ts:653`](../src/main/ai/core/ChatSessionRuntime.ts)). Where the skill metadata index is injected. Must also be reflected in `measureContextUsage` — that function is deliberately built from the same three pieces as the send path so the context ring cannot drift, and skills must not break that invariant.

4. **`AgentInstructionsService`** ([`src/main/workspace/AgentInstructions.ts`](../src/main/workspace/AgentInstructions.ts)). Not modified — **copied in shape**. It is already the house pattern for "synchronous, cached, fingerprint-revalidated, byte-budgeted file reading on the turn path", including the bounded `readSync` that refuses to slurp a symlink to a FIFO. `SkillsService` should be recognisably its sibling.

5. **`McpSecretStore`** ([`src/main/secrets/mcpSecrets.ts`](../src/main/secrets/mcpSecrets.ts)). Where `bearer_token_env_var` values go. The existing discipline — names in SQLite, values in the keychain, resolved at spawn time — extends to plugins without change.

### Data model

Three tables, following the `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` guard pattern already in [`schema.ts`](../src/main/db/schema.ts).

```sql
CREATE TABLE IF NOT EXISTS plugin_marketplaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL,          -- 'git' | 'path' | 'builtin'
  source TEXT NOT NULL,
  catalog_json TEXT,                  -- last good catalog, for offline browse
  fetched_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_installs (
  id TEXT PRIMARY KEY,
  marketplace_id TEXT REFERENCES plugin_marketplaces(id) ON DELETE CASCADE,
  plugin_name TEXT NOT NULL,
  version TEXT NOT NULL,
  -- Content address of the bundle in the store. Two marketplaces shipping the
  -- same commit share one directory.
  content_hash TEXT NOT NULL,
  -- Resolved commit, never a mutable tag: what was reviewed is what runs.
  source_ref TEXT,
  manifest_json TEXT NOT NULL,        -- validated manifest, parsed once
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  UNIQUE (marketplace_id, plugin_name)
);

-- Which plugin-declared MCP servers have been activated, and for what scope.
-- Absent row = not started, tools not in the schema. See §6.
CREATE TABLE IF NOT EXISTS plugin_server_activations (
  install_id TEXT NOT NULL REFERENCES plugin_installs(id) ON DELETE CASCADE,
  server_key TEXT NOT NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  activated_at TEXT NOT NULL,
  PRIMARY KEY (install_id, server_key, conversation_id)
);
```

Skills are **not** stored in SQLite. They are files, they change on disk, and the `AgentInstructions` precedent is right: fingerprint and re-read rather than shadow them in a database that can go stale.

### Naming and collisions

Plugin MCP servers get a synthetic `McpServerConfig.name` of `<plugin>/<server-key>` — for example `github/github`. Reasons:

- The user-server table has `name TEXT NOT NULL UNIQUE`; a plugin server named `github` must not be blocked by, or silently shadow, a user server named `github`.
- `namespaceMcpTool` sanitises `/` to `_`, so the model sees `mcp__github_github__search_issues`. Distinct, stable, and it survives the 64-char truncate-around-hash path.
- The existing duplicate-name skip in `createMcpTools` stays as a backstop but should never fire.

Skill names collide across plugins the same way. Resolution: qualify as `<plugin>:<skill>`, first install wins on the bare name, and **report the collision in the UI** rather than silently dropping one. Silent drops are how a user ends up debugging a skill that was never loaded.

---

## 4. Reliability

The install path executes third-party code later, so it gets treated like one.

- **Atomic publish.** Fetch into `~/.atlas/plugins/staging/<uuid>/`, validate the whole bundle, `fsync`, then `rename()` into `~/.atlas/plugins/store/<content-hash>/`. Rename is atomic within a filesystem, so a bundle is either absent or complete. A crash mid-install leaves garbage in staging, which is swept at next launch, and nothing in the store.
- **Content-addressed store, mutable install pointers.** `plugin_installs.content_hash` names a store directory. Two marketplaces listing the same commit share one copy. Uninstall drops the row; the store directory is GC'd when no row references it.
- **Pin to resolved commits.** `git clone --depth 1` then resolve to a SHA and record it. Never re-resolve a tag silently: what the user reviewed at install is what runs at turn time.
- **No submodules, no lifecycle scripts.** Nothing in the bundle is executed during install. Not a postinstall, not a build step. A plugin's code runs when its MCP server is started, in front of the existing approval ladder, and at no other time.
- **Path containment, checked by realpath.** Every manifest-declared path is resolved and must remain under the bundle root after symlink resolution. A `./bin/x` that is a symlink to `/usr/bin/env` is rejected at validation, not at spawn.
- **Strict manifest validation with typed errors.** An invalid manifest fails the install with a specific message. It never half-loads.
- **Per-plugin failure isolation.** A plugin that fails to load contributes nothing and produces one health record. This mirrors — and reuses — the `Promise.allSettled` discipline in `McpClientManager.listTools`, whose entire point is that one bad server must not decide whether the others' tools reach the model.
- **A `PluginHealth` read model** shaped like the existing `McpServerHealth`: `ready | failed | disabled`, a count, and an error string that says why. Ambiguity between "offers nothing" and "never answered" is exactly the bug that record already exists to prevent.

---

## 5. Security

A plugin is arbitrary code fetched from a URL. Three concrete positions:

**Skill bodies are untrusted input.** A skill is Markdown from a third party that lands directly in the model's context and is phrased as instructions. That is a prompt-injection surface, and it is the one most implementations get wrong. Skill bodies are fenced the same way `formatMcpResult` fences MCP output — labelled with their origin and marked as data. Frontmatter `description` strings, which go into the always-present index, get the same treatment plus a hard length cap.

**Install shows a capability summary, and it is derived, not authored.** Before confirming, the user sees: N skills; every MCP server with its literal resolved command and arguments; every network endpoint; every environment variable the bundle will receive; hook count. Read out of the validated manifest — never out of `description` or `interface`, which the plugin author controls and can lie in.

**Hooks ship last, not first.** A hook is an arbitrary shell command run on session lifecycle events with no model and no approval in the loop. It is the single largest privilege in the format and the one with the least user visibility. Phase 1 parses hooks, displays them, and refuses to run them. They are enabled later, per-hook, with explicit approval and the command shown verbatim.

Beyond that, plugin MCP servers inherit the protections that already exist: the environment allowlist in `buildMcpServerEnv` (Atlas's own provider API keys are never inherited by a spawned server), `isValidMcpCommand`'s shell-syntax rejection, `approvalMode: 'auto'` defaulting to ask-unless-`readOnlyHint`, and the 60k-char result cap. `bearer_token_env_var` values route through `McpSecretStore` to the keychain — they never reach SQLite.

No auto-install. No auto-update. No auto-enable of a newly discovered marketplace entry.

---

## 6. Efficiency — where Atlas beats the field

This is the part that is not just parity.

### The problem

Codex ships 90+ plugins. Claude Code has the same shape. In both, an installed MCP server's tool schemas are in the request on every turn whether or not the conversation has anything to do with them. Twenty plugins is tens of thousands of tokens of JSON schema paid on every single message, plus the accuracy cost of a model choosing between 200 tools.

### Two levers, both already present in the format

**1. Two-phase skills.** Only `name` + `description` go in the system prompt — roughly 25–40 tokens per skill. The body loads through a `load_skill` tool when the model decides it matches. Fifty skills cost ~1.5k tokens standing, instead of the ~100k+ their bodies would.

This is what Codex does *(mechanism verified from the format; the loader's internal two-phase implementation is third-party-sourced)*. Atlas should match it, and honour `policy.allow_implicit_invocation: false` by excluding those skills from the index entirely — they are reachable only when the user names them.

**2. Dependency-gated MCP servers.** This is the lever nobody is pulling hard.

`agents/openai.yaml` lets a skill declare `dependencies.tools: [{type: mcp, value: "neon"}]`. That declaration is a precise statement of *when a server becomes relevant*. So:

> A plugin-declared MCP server is not connected, and its tool schemas are not in the request, until something activates it. Activation happens when a skill that declares it is loaded, when the user names the plugin, or when the user pins it on.

Consequence: twenty installed plugins cost approximately **zero** tool-schema tokens until the conversation is actually about one of them. Atlas's existing `peekTools`/`loadTools` split already keeps the context meter honest across a changing tool set, and `McpClientManager`'s lazy connect already means an unactivated server is never spawned. The mechanism is mostly there; what is missing is the gate.

User-configured servers are unaffected — they stay eager and always-listed, because a user who hand-added a server is expressing exactly the intent that a gate would second-guess. The gate applies only to servers that arrived inside a bundle.

### The real constraint, stated honestly

A turn's tool set is resolved **once**, before the stream starts — `ChatSessionRuntime` computes `tools` ahead of its retry loop precisely so that a server coming up mid-stream cannot change what the turn was offered. That invariant is deliberate and worth keeping.

So `load_skill` activating a server cannot make its tools appear inside the same turn. Two options:

- **(a) Next-turn availability.** `load_skill` returns the body plus "the *neon* tools are now available"; connection warms in the background; tools appear on the following turn. Costs one round trip. Keeps the invariant intact. Zero risk.
- **(b) Stop-and-continue.** Activation ends the current step and immediately re-enters with a rebuilt tool set. No user-visible round trip, but it needs the turn loop to support a mid-turn tool-set rebuild, which today it deliberately does not.

**Recommendation: ship (a).** Measure how often the extra round trip actually costs anything. Only build (b) if the data says it matters — it trades a genuine correctness invariant for latency that may not be there.

### Other wins

- **Manifest index in SQLite.** `plugin_installs.manifest_json` holds the validated manifest, so startup does not stat and parse hundreds of files to know what is installed. Skills still fingerprint from disk — they are the thing that changes.
- **Content-addressed dedupe** across marketplaces shipping the same commit.
- **Prewarm applies only to activated servers**, so the existing background prewarm never spawns a plugin server the conversation has no use for.

---

## 7. Phases

Each phase is independently shippable and independently useful.

**Phase 1 — local plugins, skills + MCP.** `src/shared/plugins.ts` (types, validation, containment, `.mcp.json` → `McpServerInput`); `PluginStore`, `PluginRegistry`, `PluginMcpSource`; `SkillsService` with the two-phase index and the `load_skill` tool; `pluginsRepo` and schema; `registerPluginsIpc`; a settings page that installs from a local directory, lists components, and toggles. Reads all five manifest conventions. Hooks parsed and displayed, never run. *No marketplace, no network.*

**Phase 2 — marketplaces.** `MarketplaceRegistry`, `PluginInstaller` with git fetch, SHA pinning, atomic publish, content-addressed store, catalog cache for offline browse, update-with-diff. The install confirmation surface from §5.

**Phase 3 — dependency gating.** `plugin_server_activations`, the gate in `PluginMcpSource`, `dependencies.tools` parsing, activation via `load_skill`, per-conversation pin/unpin UI. The §6 efficiency win lands here.

**Phase 4 — hooks, if wanted.** Per-hook approval, verbatim command display, revocable. Only worth doing if real plugins the user cares about need it.

**Deferred indefinitely:** app connectors, browser extensions, scheduled tasks, authoring tools.

---

## 8. Test plan

Follows the existing `node:test` + real-filesystem-fixture style in `tests/mcp*.test.ts`.

- **Manifest validation:** every observed key shape accepted; all five convention directories resolved; `../` escapes rejected; symlink escapes rejected after realpath; malformed JSON produces a typed error and no partial load.
- **`.mcp.json` mapping:** all four observed server shapes (relative-command stdio, npx stdio, http, http + `bearer_token_env_var`) map to correct `McpServerInput`; relative `command`/`cwd` resolve against bundle root; `env_vars` lands in `envVars`.
- **Install atomicity:** a fetch that fails partway leaves nothing in the store; staging is swept; a crash between validate and publish is not observable.
- **Isolation:** one invalid plugin among five valid ones contributes nothing, produces one health record, and does not affect the other four — the same property `mcpManagerHealth.test.ts` already asserts for servers.
- **Skills:** metadata index contains descriptions and not bodies; `allow_implicit_invocation: false` excludes from the index; body load is fenced as untrusted; frontmatter descriptions are length-capped; the `AgentInstructions`-style byte budget holds against a pathological file.
- **Gating (phase 3):** an unactivated plugin server contributes zero tools and is never spawned; activation makes it available on the next turn; user-configured servers are never gated.
- **Context accounting:** `measureContextUsage` and the send path agree on skill-index and plugin-tool token cost. This invariant is explicitly load-bearing in `ChatSessionRuntime` and a plugin regression to it would be silent.

---

## 9. Open decisions

1. **Global vs per-project enablement.** Codex has both (`[plugins."x@y"]` global, plus project scoping). Atlas has a project model already. Proposal: global install, per-project enable, defaulting to on.
2. **Whether to write `~/.atlas/plugins/` or reuse `~/.codex/plugins/`.** `AgentInstructionsService` sets the precedent and the reasoning is explicit in its comments: reading another tool's directory silently imports configuration written for a different agent with different capabilities. Same argument applies. Proposal: `~/.atlas/plugins/`, with an explicit opt-in import from a Codex or Claude install.
3. **Skill invocation syntax.** Codex uses `$skill-name` in `default_prompt`. Atlas has a mention system in the composer. Proposal: reuse mentions rather than introduce a second sigil.
4. **Option (a) vs (b) in §6.** Recommend (a); revisit with data.
