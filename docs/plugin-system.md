# Plugin support

**Status:** shipped, and this document describes what is in the tree rather than what was once planned. Skills, commands, plugin-carried MCP servers, marketplaces, dependency gating, updates and revocation are implemented, along with a sandboxed plugin-UI host, explicit `@plugin` invocation, and a durable, provenance-aware audit trail. Hooks are parsed and refused. App connectors are parsed and *shown*, but not executable — Atlas has no OAuth broker, so a connector-only bundle still cannot be installed. Sub-agents are not built. See §13 for what has actually been validated versus merely implemented.
**Ground truth:** the format sections below were read off 43 installed plugins across 7 marketplaces in a real Codex install (`~/.codex/plugins/cache`), then checked against OpenAI's own [`openai/plugins`](https://github.com/openai/plugins) reference repo — 180 plugins, 8022 files, including the authoritative spec at `.agents/skills/plugin-creator/references/plugin-json-spec.md`. Where a claim comes only from third-party writing it is marked *(unverified)*.

**Where the design and the code disagree, the code wins.** Two things in the original draft were designed and then deliberately not built, and §3 says so rather than leaving the reader with a map of a system that does not exist: there is no SQLite schema for the *installed plugin set itself* — a bundle's identity is still the directory it lives in, not a row — and there is no content-addressed store. One SQLite table does exist now, `plugin_audit_records` (§13), and it is a narrower, later, and unrelated addition: an audit trail of what plugins *did*, not a record of what is installed. The two claims do not contradict.

---

## 0. Corrections since the first draft

Read this before trusting anything below it.

**Component paths supplement, they do not override.** The spec is explicit: *"`skills`, `hooks`, and `mcpServers` are supplemented on top of default component discovery; they do not replace defaults."* Treating a declared path as an override silently drops whatever a bundle keeps in the conventional directory. Implemented as `pluginComponentPaths()`.

**Atlas has a manifest convention of its own, and it leads.** `.atlas-plugin/plugin.json` is probed before `.plugin`, `.codex-plugin`, `.claude-plugin`, `.cursor-plugin` and `.kimi-plugin`. A bundle shipping one is saying it targets Atlas specifically, and that intent outranks a manifest written for something else in the same directory. The same reasoning gives catalogues `.atlas/plugins/marketplace.json` ahead of `.agents/` and `.claude-plugin/`. Nothing *requires* the Atlas spelling; it is how a bundle tailors what it offers here without changing what it offers elsewhere.

**A manifest may carry an `atlas` block.** `workspaceModes`, `requiresProject` and `minAppVersion` — declarations the shared format has no vocabulary for, kept in a namespace of Atlas's own rather than bent into keys that mean something else elsewhere. A bundle carrying none of it behaves exactly as before.

**Atlas ships a marketplace.** `resources/plugins` is synthesised into a built-in, non-removable record named `atlas-bundled`, and its `INSTALLED_BY_DEFAULT` entries install themselves on first launch. Only a built-in catalogue is honoured for that: `INSTALLED_BY_DEFAULT` in a third-party catalogue is a stranger asking to run their code unasked.

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

### Gaps, and which of them are now closed

- **~~No revocation.~~ Built.** `blocklist.json` beside the catalogue, keyed `<plugin>@<marketplace>`, carrying `reason: "security"`. See §5.
- **~~No update flow.~~ Built.** Provenance is recorded at install and the catalogue is re-read on request. See §4.
- **~~Checkouts are never collected.~~ Built.** `sweepCheckouts()` runs at startup and after a marketplace is removed.
- **~~Installing meant cloning first.~~ Fixed.** Paste a repository link — including a `tree/<ref>/<subdir>` browse URL — and Atlas fetches, shows a derived capability summary, and installs. See §12.
- **~~A moved tag was invisible.~~ Fixed.** Same version at a different commit now reports as `republished` instead of `up-to-date`. See §12.
- **No rename handling.** A catalog-level `renames` map; without it an upstream rename orphans installs. *(unverified)* Partly mitigated: an update whose bundle has been renamed is refused with the new name in the message, rather than silently installing a second plugin.
- **~~No `commands/`.~~ Built.** User-invoked prompt templates, invoked with `/` in the composer. See §2 and §5.
- **~~Skill folders were files.~~ Fixed.** `load_skill` returns the skill's directory alongside the body, so `references/`, `templates/`, `scripts/` and `assets/` are reachable. See §2.
- **~~Tool annotations were read one field deep.~~ Fixed.** `destructiveHint`, `openWorldHint` and `idempotentHint` join `readOnlyHint`. See §2 and §5.
- **~~`structuredContent` was dropped, binaries were inlined.~~ Fixed.** See §2.
- **~~No plugin UI.~~ Built.** `ui://` components render in a sandboxed frame served over its own scheme. See §10.
- **~~Not the Agent Plugins format.~~ Built.** The open standard at [agent-plugins.org](https://agent-plugins.org/) (Amazon, Cursor, Microsoft, OpenAI, Vercel) is read as a seventh convention: root `plugin.json`, root `mcp.json`, `extensions` namespaces, `${PLUGIN_ROOT}`/`${PLUGIN_DATA}`, all three transports. See §11.
- **No `agents/*.md`.** Sub-agent definitions. Atlas has no sub-agent mechanism at all, so this is a product feature before it is a plugin feature.
- **~~Connectors were entirely out of scope.~~ Half built.** `.app.json` is parsed, classified, shown, and recorded in provenance. *Execution* is still out of scope — no OAuth broker exists. See §5's non-goals correction above and §13.

---

## 1. What a plugin is, and why Atlas wants one

MCP standardised the wire: a server publishes tools over JSON-RPC. It standardised nothing else. It has no story for distribution, versioning, updates, lifecycle, or — most expensively — for telling the model *when* to use the tools it just dumped into the context.

A plugin is the packaging layer that grew on top. One versioned bundle, one manifest, carrying up to six component types of which an MCP server is only one.

Atlas already had the MCP half, and it was already Codex-shaped: `mcp__<server>__<tool>` namespacing, 30s/300s timeouts, env allowlist, four approval stances, per-server failure isolation. What it lacked was the packaging half, which is what this document describes. MCP is now a loader internal with no user-facing surface of its own: servers arrive only inside installed bundles.

The bundle format is turning into a cross-vendor standard. The same install directory contains manifests under `.codex-plugin/` (27), `.claude-plugin/` (10), `.cursor-plugin/` (3), `.kimi-plugin/` (1) and `.plugin/` (2), and Codex loads all of them. Third-party marketplaces ship a `.claude-plugin/marketplace.json` written for Claude Code and Codex installs them unmodified. Supporting the format means inheriting the whole existing ecosystem, not bootstrapping one.

### Non-goals, and still non-goals

- **App connectors** (`.app.json`), *execution* of. These reference first-party OAuth connectors by id (`connector_openai_default_templates`) or Apps SDK apps (`asdk_app_*`). Atlas has no connector broker and building one is a separate project. What Atlas *does* do: parse every declared connector, classify its id family, and show it in the plugin browser marked "Requires account linking — Atlas cannot perform this yet." (`shared/pluginConnectors.ts`, `ConnectorList.tsx`). A connector-only bundle is still refused at install — `readPluginCapability` only counts skills and MCP servers as usable — so surfacing changed what the browser *says*, not what a connector-only bundle can *do*.
- **Widget-initiated tool calls.** A widget's `submit` reaches the host as a short string and stops there. Wiring it to `callTool` means the host choosing the tool and validating every argument — never a message body deciding what runs. See §10.
- **Browser extensions.** The `chrome` plugin ships an `extension-host/`; out of scope.
- **Scheduled task templates.**
- **Authoring and publishing tools.** Atlas consumes plugins; it does not help write them.
- **Hooks.** Parsed and shown, never run — see §5 and §7.

---

## 2. Format spec (verified)

### Directory layout

```
<plugin-root>/
├── .atlas-plugin/plugin.json   # manifest — the only required file. Probed
│                               # first; .plugin, .codex-plugin, .claude-plugin,
│                               # .cursor-plugin and .kimi-plugin follow.
├── skills/<skill-name>/
│   ├── SKILL.md                # required: frontmatter + body
│   └── agents/openai.yaml       # optional: interface, policy, dependencies
├── .mcp.json                    # MCP servers
├── .app.json                    # app connectors (out of scope)
├── hooks/hooks.json             # lifecycle commands (parsed, never run)
├── commands/<name>.md           # user-invoked prompt templates
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

### Tool annotations, and what a result may contain

A server's `tools/list` carries more than a name and an input schema, and the
published plugin guidelines make three of those fields load-bearing: a
read-only tool "should" be labelled `readOnlyHint`; a write or destructive one
"must" be labelled `destructiveHint`; anything reaching an external system,
account or public surface "must" be labelled `openWorldHint`. The guidelines
call incorrect or missing labels a common cause of rejection — which means the
labels are the vocabulary a client is expected to enforce with, not decoration.

All four hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
`openWorldHint`) are parsed into `McpToolAnnotations`. They are advertising
written by the same third party that wrote the tool, so they are read
asymmetrically: only `readOnlyHint` can lower friction, and only when nothing
contradicts it. A tool declaring itself both read-only and destructive is
self-contradictory, and the claim that would buy it silence is the one
discarded.

A result may be more than `content[]`. `structuredContent` is the half a
`content[]`-only reader drops — a server publishing an `outputSchema` is saying
its real answer lives there, and several send `content[]` as a one-line human
summary beside it. Both are rendered. Binary parts (`image`, `audio`, blob
resources) are described rather than inlined: one screenshot is hundreds of
kilobytes of base64 that would spend the whole result budget on bytes the model
cannot read. `isError` is stated rather than left to be inferred from prose.

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

A skill is a **folder**, not a file — `SKILL.md` plus whatever references,
templates, scripts and assets it needs, which is how the published architecture
describes it. `load_skill` therefore returns the body with the skill's own
directory named above it. Returning the body alone made every "see
`references/api.md`" sentence point at nothing: a relative path with no anchor
and no way to guess one. The anchor is Atlas's line rather than the bundle's,
and it sits ahead of the body, so a skill cannot write a different root into its
own Markdown and have it believed.

### `commands/<name>.md`

```markdown
---
description: Review the working diff and be blunt about it.
argument-hint: <paths>
---

Review $ARGUMENTS. Point out what is actually wrong; skip the praise.
```

Everything in the frontmatter is optional, including the frontmatter. A file that is nothing but the prompt is a valid command and the filename names it — the opposite of a skill, where a missing description means the model can never choose it and loading it would only cost tokens. `$ARGUMENTS` takes everything typed after the name; `$1`…`$9` take words. A placeholder with nothing to fill it collapses to empty rather than reaching the model as literal `$2`.

Commands are **flat `.md` files**; nested directories are skipped rather than walked. The namespaced `commands/sub/name.md` spelling exists elsewhere, but flattening it would let two files collide on one name and walking it would turn discovery into a tree scan for a shape no surveyed bundle uses.

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

### The modules, as built

```
src/shared/
  plugins.ts                     # manifest + SKILL.md + sidecar parsing, path
                                 # containment, version ordering. Pure: the
                                 # renderer imports it and has no filesystem.
  marketplace.ts                 # catalogue parsing, entry blockers
  blocklist.ts                   # revocation parsing and matching
src/main/plugins/
  PluginLoader.ts                # what is actually on disk: realpath containment,
                                 # bounded reads, skills indexed by frontmatter
  PluginRegistry.ts              # the loaded set; the single read model
  PluginInstaller.ts             # validate → stage → link-check → atomic publish
  PluginOrigins.ts               # where each installed bundle came from
  MarketplaceRegistry.ts         # checkout, catalogue + blocklist read, GC
  PluginMarketplaceService.ts    # the write side: add/remove/install/view
  PluginUpdateService.ts         # version comparison, re-fetch, replace
  PluginBlocklistService.ts      # whose revocations bind what
  PluginActivation.ts            # per-conversation server gating
  PluginMcpSource.ts             # plugin servers → McpServerConfig[]
  SkillsService.ts               # discovery, metadata index, body loading
  skillTools.ts                  # the load_skill tool
  pluginViews.ts                 # the renderer's read model
  bundledMarketplace.ts          # ~/.atlas layout, the shipped catalogue
  pluginIconProtocol.ts          # artwork served from two roots and nowhere else
src/main/ipc/
  plugins.ts                     # registerPluginsIpc
src/renderer/components/plugins/
  PluginsWorkspace.tsx           # the destination: browse, install, update
  PluginDetailPanel.tsx          # one plugin and what it may do
  MarketplaceManager.tsx         # add and remove marketplaces
  PluginsSettingsPage.tsx        # the settings-pane view of the same data
```

**There is no `PluginStore.ts` and no content-addressed store.** A bundle installs to `~/.atlas/plugins/<manifest-name>/`, one directory per plugin, and the name is the identity everything else keys off. Content addressing was designed to dedupe two marketplaces shipping the same commit; that saving is small, and it would have made the directory layout unreadable to the user whose folder it is. `~/.atlas` is deliberately somewhere a person can open, edit and copy from.

### Seams into what already exists

Five, all of them existing extension points rather than new plumbing:

1. **`McpClientManager` server list.** The user-facing MCP surface has been deleted, so this is no longer a merge: `listPluginServers` in [`src/main/index.ts`](../src/main/index.ts) is the *only* source, and it currently returns `[]`. `PluginMcpSource` fills it. Everything downstream — connection dedupe, catalog TTL, `onclose` eviction, prewarm, health, approval stances — applies to plugin servers unchanged, for free.

   What was removed: `ConnectorsWorkspace` and its `CONNECTOR_CATALOG` (Atlas's own hand-rolled marketplace), `McpSettingsPage`, `McpServersRepo`, `McpServerService`, `registerMcpIpc` and all seven `mcp:*` channels, the preload bridge, the contract types, and the `mcp_servers` table. Existing configured servers were stranded by that drop, deliberately. What stayed: `McpClientManager`, `mcpTools`, `mcpToolsProvider`, `shared/mcp.ts`, `McpSecretStore`, and the transcript's `mcp` tool-cell label — plugin tools still render through it. MCP is now a loader internal with no user-facing existence, which is exactly how `openai/plugins` treats it.

2. **`McpToolsProvider`** ([`ChatSessionRuntime.ts:63`](../src/main/ai/core/ChatSessionRuntime.ts)). Already the seam through which a turn's dynamic tools arrive. Skills add one built-in tool (`load_skill`) rather than a second provider.

3. **`buildSystemPrompt`** ([`ChatSessionRuntime.ts:653`](../src/main/ai/core/ChatSessionRuntime.ts)). Where the skill metadata index is injected. Must also be reflected in `measureContextUsage` — that function is deliberately built from the same three pieces as the send path so the context ring cannot drift, and skills must not break that invariant.

4. **`AgentInstructionsService`** ([`src/main/workspace/AgentInstructions.ts`](../src/main/workspace/AgentInstructions.ts)). Not modified — **copied in shape**. It is already the house pattern for "synchronous, cached, fingerprint-revalidated, byte-budgeted file reading on the turn path", including the bounded `readSync` that refuses to slurp a symlink to a FIFO. `SkillsService` should be recognisably its sibling.

5. **`McpSecretStore`** ([`src/main/secrets/mcpSecrets.ts`](../src/main/secrets/mcpSecrets.ts)). Where `bearer_token_env_var` values go. The existing discipline — names in SQLite, values in the keychain, resolved at spawn time — extends to plugins without change.

### Where state actually lives

**No plugin tables were added.** The three-table schema in the original draft would have been a second source of truth about what is installed, kept in sync with a directory that changes underneath it. The directory *is* the truth: `PluginRegistry` rescans it on a 5-second TTL, one bounded manifest read per bundle and an 8 KiB frontmatter prefix per skill, with no skill body read at all. Everything that is genuinely a *decision* — and therefore not derivable from the directory — is a JSON row in `app_settings`:

| Key | Holds | Read by |
|---|---|---|
| `plugins.disabled` | names the user switched off | `PluginRegistry.isEnabled` |
| `plugins.alwaysOn` | names exempt from gating | `PluginActivationStore` |
| `plugins.activations` | which plugins each conversation woke | `PluginActivationStore` |
| `plugins.marketplaces` | marketplaces the user added | `MarketplaceRegistry` |
| `plugins.origins` | where each install came from | updates, revocation |
| `plugins.blocklist` | last revocations read from marketplaces | `PluginRegistry.blockedReason` |

`plugins.disabled` stores the *disabled* set rather than the enabled one, so a newly installed plugin is on by default: a user who just chose to install something has already said yes.

`plugins.origins` is the one that had to be added for §4 and §5 to be possible at all. A bundle on disk is just a directory — it carries a name and a version and no trace of the catalogue that handed it over. Provenance is kept beside the plugins rather than inside them, because a bundle must not be able to describe its own origin, and writing into a validated bundle after the fact would undo the point of validating what landed.

Skills are **not** stored in SQLite either. They are files, they change on disk, and the `AgentInstructions` precedent is right: re-read them rather than shadow them in a database that can go stale.

### Naming and collisions

Plugin MCP servers get a synthetic `McpServerConfig.name` of `<plugin>/<server-key>` — for example `github/github`. Reasons:

- The user-server table has `name TEXT NOT NULL UNIQUE`; a plugin server named `github` must not be blocked by, or silently shadow, a user server named `github`.
- `namespaceMcpTool` sanitises `/` to `_`, so the model sees `mcp__github_github__search_issues`. Distinct, stable, and it survives the 64-char truncate-around-hash path.
- The existing duplicate-name skip in `createMcpTools` stays as a backstop but should never fire.

Skill names collide across plugins the same way. Resolution: qualify as `<plugin>:<skill>`, first install wins on the bare name, and **report the collision in the UI** rather than silently dropping one. Silent drops are how a user ends up debugging a skill that was never loaded.

---

## 4. Reliability

The install path executes third-party code later, so it gets treated like one.

- **Atomic publish.** Copy into `~/.atlas/plugins/.staging-<uuid>/`, validate what actually landed, then `rename()` to `~/.atlas/plugins/<name>/`. Rename is atomic within a filesystem, and staging is a sibling of the destination so it always is one. A crash mid-install leaves a staging directory, which `sweepStaging()` collects at next launch — upstream documents that sweep and does not do it, which is why a machine surveyed for this work had three abandoned staging directories a month old.
- **Validated twice, at the source and at the copy.** The thing validated first is not the thing that will be loaded: a source directory can change under a copy, and symlinks resolve differently once relocated.
- **Links out of the bundle are refused; links inside it are kept.** An npm-installed bundle carries `node_modules/.bin` symlinks and flattening them breaks it. A link that leaves the bundle is a file the review never covered and whose contents can change afterwards, so the walk fails closed — an entry that cannot be resolved, and a tree too large to walk, are both reported as escapes.
- **Update is a replace, not a reinstall.** `install()` refuses an existing name unless the caller opts into `replaceExisting`, which only the update path does. The swap is two renames — the old bundle moves aside under the staging prefix, the new one takes its place, the old one is deleted — so every intermediate state is one the startup sweep already knows how to survive, and a failure restores the original. The worst case is the plugin being briefly absent rather than briefly half-written.
- **An update may not change the plugin's name.** The name is what the enabled switch, the activations and every qualified skill name are keyed by. A catalogue entry that now ships a differently-named bundle is refused with that name in the message, rather than quietly installing a second plugin beside the first.
- **Pin to resolved commits.** A catalogue's `sha` is fetched directly — `git init`, `fetch --depth 1 <sha>`, `checkout FETCH_HEAD` — rather than cloning a branch. `ref` is only a fallback for catalogues that publish no sha, and an entry like that is not reproducible: whatever the branch points at when the clone happens is what the user gets. The UI says `pinned` or `unpinned` on the row for exactly this reason.
- **Checkouts are collected.** Marketplace clones live under `~/.atlas/marketplaces/`, outside the plugins directory so the registry scan can never mistake one for an install. `sweepCheckouts()` removes any directory no current git marketplace names — a clone for a marketplace the user removed, a `fetch-` temporary from an interrupted install — at startup and after a removal.
- **No submodules, no lifecycle scripts.** Nothing in the bundle is executed during install. Not a postinstall, not a build step. A plugin's code runs when its MCP server is started, in front of the existing approval ladder, and at no other time.
- **Path containment, checked by realpath.** Every manifest-declared path is resolved and must remain under the bundle root after symlink resolution. A `./bin/x` that is a symlink to `/usr/bin/env` is rejected at validation, not at spawn.
- **Strict manifest validation with typed errors.** An invalid manifest fails the install with a specific message. It never half-loads.
- **Per-plugin failure isolation.** A plugin that fails to load contributes nothing and produces one failure record. This mirrors the `Promise.allSettled` discipline in `McpClientManager.listTools`, whose entire point is that one bad server must not decide whether the others' tools reach the model. Two bundles claiming one name is the same shape: first wins, and the loser is reported rather than dropped silently, because a component that never loads is the hardest kind to debug.
- **Four buckets, not a status enum.** The snapshot separates `plugins`, `disabled`, `blocked` and `failures` rather than carrying a `ready | failed | disabled` field, and non-fatal problems ride along as per-plugin `warnings`. The distinction that matters is the one a single status would flatten: "offers nothing", "was switched off", "was withdrawn" and "would not load" are four different things to tell a user, and only one of them is theirs to undo.

---

## 5. Security

A plugin is arbitrary code fetched from a URL. Five concrete positions:

**Skill bodies are untrusted input.** A skill is Markdown from a third party that lands directly in the model's context and is phrased as instructions. That is a prompt-injection surface, and it is the one most implementations get wrong. Skill bodies are fenced the same way `formatMcpResult` fences MCP output — labelled with their origin and marked as data. Frontmatter `description` strings, which go into the always-present index, get the same treatment plus a hard length cap.

**A command expands into the composer, not into the send path.** A command is a third-party prompt template, and picking one replaces the invocation with its expanded text where the user reads it and presses send. This is the whole reason a command body needs none of the fencing a skill body gets: the honest place to review third-party text is the box before it is sent, not a transcript afterwards. It also keeps the composer a plain textarea — the token never has to survive as something the main process quietly rewrites later. The picker triggers only on a `/` in the first column of a message, which removes paths, URLs, dates and `and/or` as a class rather than filtering them one at a time.

**Install shows a capability summary, and it is derived, not authored.** Before confirming, the user sees: N skills; every MCP server with its literal resolved command and arguments; every network endpoint; every environment variable the bundle will receive; hook count. Read out of the validated manifest — never out of `description` or `interface`, which the plugin author controls and can lie in.

**Hooks ship last, not first.** A hook is an arbitrary shell command run on session lifecycle events with no model and no approval in the loop. It is the single largest privilege in the format and the one with the least user visibility. Phase 1 parses hooks, displays them, and refuses to run them. They are enabled later, per-hook, with explicit approval and the command shown verbatim.

**A tool's description is author-controlled, and its declared effects are not.** The guidelines forbid descriptions that "manipulate how the model selects or uses other plugins or their tools" — which is a rule for publishers, and a client that simply forwards the string is trusting the rule to enforce itself. Two things happen instead. A description is capped at 4k characters, because it reaches the model on every turn the tool is offered and the format sets no ceiling: a page of prose per tool is either careless or crowding out its neighbours. And Atlas appends its own effects clause, derived from the annotations rather than from prose, so a tool cannot describe itself as tidying a workspace while declaring itself destructive — the two statements arrive together.

**Destructive keeps its friction even under blanket approval.** `approve` is the stance that means "stop asking me about this server", and it is a statement about a server's ordinary traffic. The guidelines are explicit that destructive actions need "clear labels and friction (for example, confirmation) so clients can enforce guardrails" — so the one class of call that cannot be taken back is the one class blanket approval does not silently cover. A server shipping no `destructiveHint` is unaffected, which is most of them; this costs nothing except where a publisher has said out loud that a tool deletes things.

**Installed code can be un-trusted after the fact.** A marketplace may publish a `blocklist.json` beside its catalogue — `.atlas/plugins/`, `.agents/plugins/` or `.claude-plugin/` — in either the upstream keyed shape or a plain array:

```jsonc
{ "plugins": { "some-plugin@some-market": { "reason": "security", "detail": "…" } } }
{ "blocked": [ { "plugin": "some-plugin", "reason": "broken", "maxVersion": "1.4.2" } ] }
```

Four rules make this safe to build out of files fetched from strangers:

- **A marketplace may only revoke what it published.** An entry from a third-party catalogue naming someone else's marketplace is dropped and logged; an unscoped entry from one is narrowed to that marketplace. Only the catalogue Atlas ships with may revoke anything at all, because that one is the app speaking about its own users.
- **A copy of unknown origin is covered, not excused.** Scoping only ever excuses a bundle *known* to have come from somewhere else. Everything installed before provenance existed has no origin record, and treating those as "not from this marketplace" would have made revocation arrive unable to reach a single already-installed plugin.
- **The answer is cached and persisted.** The plugin scan runs on the turn-setup path and must never reach the network, and a revocation that only applies while a remote is reachable is one an attacker defeats by unplugging a cable. Revocations are re-read whenever marketplaces are resolved anyway — startup, the plugins page, an update check — and stored.
- **Enforced at the registry, not at each consumer.** A blocked bundle lands in `snapshot().blocked` and never in `snapshot().plugins`, so its skills, its MCP servers and its activations are all unreachable by construction. Install and update both refuse it too, or a revoked plugin would be one click from running again.

A `maxVersion` ceiling exempts the release that carries the fix — a publisher revoking a vulnerable version is not revoking their own remedy. The publisher's own text is shown appended to Atlas's sentence, never in place of it, so a blocklist cannot phrase a security revocation as something reassuring. The switch on a revoked plugin is disabled rather than merely off: it is not a preference the user can undo, and offering a control that would do nothing is worse than offering none.

Beyond that, plugin MCP servers inherit the protections that already exist: the environment allowlist in `buildMcpServerEnv` (Atlas's own provider API keys are never inherited by a spawned server), `isValidMcpCommand`'s shell-syntax rejection, `approvalMode: 'auto'` defaulting to ask-unless-`readOnlyHint`, and the 60k-char result cap. `bearer_token_env_var` values route through `McpSecretStore` to the keychain — they never reach SQLite.

No auto-update: the check costs a fetch per git marketplace, so it is a button rather than a timer. A background poll would be network the user did not ask for and a heartbeat to every remote they have added. No auto-enable of a newly discovered marketplace entry. The one thing that installs itself is an `INSTALLED_BY_DEFAULT` entry in the catalogue Atlas ships, and that is idempotent — a plugin the user removed on purpose stays removed rather than returning every launch.

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

**Shipped (a).** The invariant stayed intact and the extra round trip has not been worth revisiting.

### Other wins

- **One scan feeds every consumer.** The prompt, the tool set, the settings page and the context meter all read the same 5-second-TTL snapshot, so they cannot disagree about what is installed. The scan is cheap by construction: one bounded manifest read per bundle and one 8 KiB frontmatter prefix per skill, with no skill body read at all. This is why there is no manifest index in SQLite — the thing an index would avoid does not cost enough to be worth a second source of truth.
- **Catalogue rows are probed, not loaded.** Drawing a grid of several hundred entries reads one manifest each for artwork and usability, rather than scanning every candidate's skills.
- **Prewarm applies only to activated servers**, so the existing background prewarm never spawns a plugin server the conversation has no use for.
- **A connector-only bundle is refused before it is installed.** 108 of the 180 plugins in one public catalogue ship nothing but an `.app.json`; installing one is a no-op the user pays for, so the row says so instead.

---

## 7. Phases

**Phase 1 — local plugins, skills + MCP. Shipped.** `shared/plugins.ts`, `PluginLoader`, `PluginRegistry`, `PluginMcpSource`; `SkillsService` with the two-phase index and the `load_skill` tool; `registerPluginsIpc`; installing from a local directory, listing components, toggling. Reads all six manifest conventions. Hooks parsed and displayed, never run.

**Phase 2 — marketplaces. Shipped.** `MarketplaceRegistry` and `PluginMarketplaceService`: git fetch, SHA pinning, atomic publish, the bundled catalogue, the capability summary from §5. Without the content-addressed store — see §3.

**Phase 3 — dependency gating. Shipped.** `PluginActivationStore`, the gate in `PluginMcpSource`, `dependencies.tools` parsing from the sidecar, activation via `load_skill`, and an always-on escape hatch. The §6 efficiency win landed here.

**Phase 4 — updates and revocation. Shipped.** `plugins.origins` provenance, `PluginUpdateService`, `PluginBlocklistService`, checkout GC.

**Phase 5 — `commands/`. Shipped.** Discovery beside skills, `/name` completion in the composer, argument substitution, and expansion into the textarea rather than into the send path.

**Phase 6 — hooks, if wanted. Not built.** Per-hook approval, verbatim command display, revocable. Still the right thing to defer: arbitrary shell on session events with no model and no approval in the loop is the largest privilege in the format and the one with the least visibility. Only worth doing if a plugin the user actually wants needs them.

**Deferred indefinitely:** connector *execution*, browser extensions, scheduled tasks, authoring tools. `.app.json` is 85% of the ecosystem and the single biggest unlock, and running one needs an OAuth broker Atlas does not have — a quarter, not a sprint. *Reading* `.app.json` — parsing, classifying, showing, refusing — is built; see the corrected non-goals in §1 and §13. Sub-agent definitions (`agents/*.md`) need a sub-agent mechanism that does not exist either.

---

## 8. Test plan

Follows the existing `node:test` + real-filesystem-fixture style in `tests/mcp*.test.ts`.

- **Manifest validation:** every observed key shape accepted; all five convention directories resolved; `../` escapes rejected; symlink escapes rejected after realpath; malformed JSON produces a typed error and no partial load.
- **`.mcp.json` mapping:** all four observed server shapes (relative-command stdio, npx stdio, http, http + `bearer_token_env_var`) map to correct `McpServerInput`; relative `command`/`cwd` resolve against bundle root; `env_vars` lands in `envVars`.
- **Install atomicity:** a fetch that fails partway leaves nothing in the store; staging is swept; a crash between validate and publish is not observable.
- **Isolation:** one invalid plugin among five valid ones contributes nothing, produces one health record, and does not affect the other four — the same property `mcpManagerHealth.test.ts` already asserts for servers.
- **Skills:** metadata index contains descriptions and not bodies; `allow_implicit_invocation: false` excludes from the index; body load is fenced as untrusted; frontmatter descriptions are length-capped; the `AgentInstructions`-style byte budget holds against a pathological file; a loaded skill names its own folder, ahead of the body rather than after it.
- **Tool annotations and results** (`mcpTools.test.ts`, `mcpNaming.test.ts`): all four hints parse; a tool claiming both read-only and destructive is not trusted as read-only; blanket approval still stops for a declared-destructive tool and still passes unannotated traffic; declared effects reach the model's description; a 50k-character description is capped. `structuredContent` renders with or without `content[]`; a 400 KB base64 image becomes a one-line summary; `isError` is stated; an embedded text resource inlines with its URI; a `ui://` component is named and its markup is not spent.
- **Gating:** an unactivated plugin server contributes zero tools and is never spawned; activation makes it available on the next turn; user-configured servers are never gated.
- **Context accounting:** `measureContextUsage` and the send path agree on skill-index and plugin-tool token cost. This invariant is explicitly load-bearing in `ChatSessionRuntime` and a plugin regression to it would be silent.
- **Updates** (`pluginUpdates.test.ts`): provenance is recorded on install and forgotten on uninstall; a newer catalogue version is offered and an older one is not; applying an update replaces the bundle's files rather than merging them; a failed update leaves the working copy intact; an entry that has been renamed is refused rather than installed beside the original; a folder install reports that it cannot be checked.
- **Revocation** (`pluginBlocklist.test.ts`): both file shapes parse and one malformed entry does not disarm the rest; a `maxVersion` ceiling exempts the fixed release; a revoked plugin contributes nothing, cannot be switched back on, and cannot be reinstalled; a marketplace cannot revoke a plugin it did not publish, and its unscoped entries stay confined to it; the bundled catalogue can revoke anything; a copy whose origin was never recorded is still covered; a revocation survives the marketplace becoming unreachable.
- **Checkout GC** (`pluginMarketplaceService.test.ts`): a checkout no current record names is collected, one still in use is kept, and sweeping an empty root is a no-op.
- **Commands** (`pluginCommands.test.ts`): frontmatter and description are both optional and the filename names the file; a body-less command is refused; arguments substitute and unfilled placeholders collapse; the picker fires on a leading `/` and not on `src/app.ts`, `and/or` or `12/03`; a linked command file is skipped; a disabled or revoked plugin contributes none.

---

## 9. Decisions, settled and open

**Settled:**

1. **`~/.atlas/plugins/`, not `~/.codex/plugins/`.** As proposed. Reading another tool's directory silently imports configuration — here, executable bundles — the user authorised for a different agent. No import path from a Codex or Claude install was built; installing from a folder covers it, deliberately and one bundle at a time.
2. **Enablement is global, not per-project.** The `atlas.workspaceModes` and `atlas.requiresProject` declarations turned out to answer the question the per-project switch was for: a plugin says where it applies, and its skills are withheld where they cannot, at no token cost. A per-project toggle on top would be a second answer to the same question.
3. **Next-turn availability (option (a) in §6).** Shipped. The turn's tool set is still resolved once, before the stream starts.

**Open:**

4. **Skill invocation syntax.** Commands took `/`; mentions keep `@`. A skill still has no explicit invocation of its own — the model chooses it, or the user describes what they want. Whether naming a skill directly is worth a third spelling is open, and the answer is probably that `/` should eventually list both.
5. **Whether the update check should ever run unprompted.** It is a button today. The argument for a check on launch is that a security fix reaches users who never press it; the argument against is a fetch to every remote the user has added, every launch. A middle position — check only the built-in marketplace, which is already read at startup — is probably right and is not built.
6. **Rename handling.** An upstream rename orphans an install. The update path refuses it loudly rather than guessing, which is correct but leaves the user to reinstall by hand.

---

## 10. Plugin UI

Shipped. A tool result may carry a `ui://` embedded resource — markup the server
wants the user to see. Atlas renders it, in a box it cannot get out of.

**Three properties, enforced in three different places**, because any one of
them alone is defeatable:

1. **Opaque origin.** `sandbox="allow-scripts"` and deliberately not
   `allow-same-origin`. No renderer DOM, no storage, no cookies, no `'self'`.
2. **A policy the widget cannot edit.** `default-src 'none'`, delivered as a
   response header on the `atlas-widget:` scheme.
3. **A closed message vocabulary.** `ready`, `resize`, `submit`. Nothing else
   is read, and none of the three names anything executable.

**Why a scheme and not `srcdoc`.** A `srcdoc` document *inherits the embedding
page's CSP*. Atlas's renderer policy has to allow `http://localhost:*`, `blob:`
and the analytics host for the app's own sake. The obvious design — inline the
markup with `srcdoc` and have the widget declare `default-src 'none'` in its own
`<meta>` — puts the restriction in the file the attacker writes: a hostile
widget omits the tag and inherits all three destinations. A header written by
the main process cannot be omitted by its own content. The scheme also gives the
frame a real origin distinct from the app's, which is what makes the renderer's
`event.source` check mean something.

**Markup never enters the model's context or the database.** A `ui://` resource
is captured into `McpUiStore` keyed by `toolCallId`, and the tool's result
string keeps one line saying a component is displayed. Putting HTML in
`ChatToolPart.output` would spend the context budget on every subsequent turn
for bytes the model cannot act on — the same argument as §6 — and would persist
third-party markup into conversation history. The store is memory-only for the
same reason: a widget is a view of one moment, and reviving last week's card
means re-running third-party markup to show state the server has since changed.

**IPC carries a descriptor, never the bytes.** The renderer asks
`mcpUi:describe(toolCallId)` and gets back the call id, the `ui://` name and the
server name. It then points a frame at a URL. The only process that ever holds
widget markup as a string is the one that refuses to run it.

**`submit` is inert on purpose.** It logs. Connecting it to `callTool` is real
work — the host must pick the tool and validate every argument — and a message
body that decides what runs is the exact thing the sandbox exists to prevent.

**Bounds, all of them because the number is attacker-chosen.** Height clamped to
80–600px; markup capped at 512 KiB; `submit` capped at 200 characters; 64
components retained, oldest evicted; a frame that has not said `ready` in five
seconds is reported as failed rather than waited on.

**Verifying it.** `examples/mcp-ui-demo/` is a dependency-free stdio MCP server
whose one tool returns a card that *attempts* every escape and prints what it
managed — Node `require`, `process`, `window.atlasChat`, `parent.document`,
`fetch`, `localStorage`. Every row must read `blocked`. Install the folder from
the plugins page and ask for the demo card. A fixture that only shows the happy
path proves nothing; the interesting property is what fails.

Tests: `mcpUi.test.ts` (message vocabulary, token, clamping, policy shape, store
bounds) and the capture cases in `mcpTools.test.ts`.

---
## 11. Agent Plugins

Implemented. [agent-plugins.org](https://agent-plugins.org/) v1.0.0 — TSC from
Amazon, Cursor, Microsoft, OpenAI and Vercel — is the format the six vendor
conventions in §2 were converging on, published. Atlas reads it as a **seventh
convention beside the others**, not as a replacement: the standard is
deliberately narrower (no commands, no hooks, no app connectors), and dropping
the vendor conventions would strand the whole existing ecosystem to gain a
format almost nothing ships yet.

### The discriminator is location, not content

A `plugin.json` at the bundle **root** is an Agent Plugins manifest. That is the
one spelling no vendor convention uses, so finding one settles the format before
any dot-directory is probed. A bundle carrying both a root manifest and a
`.claude-plugin/plugin.json` is saying "read me as the standard, and here is a
fallback for older clients" — and the root wins.

The format is then load-bearing in exactly four places, and nowhere else:

| Rule | Agent Plugins | Vendor conventions |
|---|---|---|
| `name` | 1–64, lowercase alnum + `-`/`.`, no leading/trailing separator, no `--`/`..` | permissive: underscores and capitals exist in real bundles |
| `version`, `description` | optional | required |
| MCP config | `./mcp.json` **only** | `./mcp.json`, `./.mcp.json`, plus any declared path |
| Components | fixed locations; no declared-path vocabulary | declared paths *supplement* the defaults |

Applying the strict name rule globally would reject bundles that are valid in
their own format and never claimed to follow this one. That asymmetry is the
whole reason `PluginManifestFormat` exists.

The `mcp.json`-only rule matters more than it looks: an author who moved to the
standard and left the old `.mcp.json` behind must not have servers started that
they believe they stopped declaring.

### `extensions`, and not validating other people's

Client-specific manifest data lives under `extensions`, keyed by reverse-domain
namespace. Atlas reads `com.olllayor.atlaschat` — the bundle identifier from
`package.json`, because the point of a namespace is that two clients cannot
collide and `atlas` is a word several projects would reach for. The legacy
top-level `atlas` block still works and loses to the namespaced one.

Namespaces Atlas does not implement are carried and **never inspected**. The
spec requires ignoring them "without validating their contents", and that phrase
is doing real work: validating another client's block would let its schema
decide whether this bundle loads here.

### `${PLUGIN_ROOT}` and `${PLUGIN_DATA}`

Expanded in MCP `args`, `env` *values*, and `cwd` — never in `command`, never in
`env` keys, never in header values. One pass, non-recursive, which is what stops
a bundle smuggling a placeholder through a variable it also controls.

Both are set on every plugin subprocess, and written **after** the bundle's own
`env` overlay, so a plugin cannot redirect either. The parser refuses a manifest
that names them; `buildMcpServerEnv` makes it true regardless.

`PLUGIN_DATA` is `~/.atlas/plugin-data/<plugin>/`, deliberately outside
`~/.atlas/plugins/`. The spec requires it to survive updates, and an update is a
directory swap — the old bundle is renamed aside and deleted. Anything inside
the bundle would be destroyed by exactly the operation it must survive. A
sibling root also keeps the registry scan from mistaking a plugin's cache for an
installed plugin. Created at spawn time, not load time: a directory per
installed bundle on every five-second rescan is filesystem work for plugins that
never run.

### Transports

`stdio`, `streamable-http` and `sse`, by their standard spellings, with the
vendor `http` and `streamable_http` still accepted. `sse` is no longer folded
into `http` — they are different handshakes, and the spec requires the declared
transport to be the one attempted first. Collapsing them meant every
`"type": "sse"` server failed to connect while reporting as correctly
configured.

Plaintext HTTP is loopback-only. A plugin config is fetched from a git remote,
and a plaintext endpoint in one is a downgrade every user of that bundle
inherits.

`headers` is the standard's way to authenticate an endpoint, and the spec says a
plugin MUST NOT embed credentials in one. That is a rule on the party who writes
the file, so it is enforced here instead: `Authorization`, `Cookie` and
`Proxy-Authorization` are refused, as is a URL with embedded credentials. A
token committed to a public repository is a token that needs rotating, and
forwarding it silently would be Atlas helping.

### Failure isolation, which is most of the spec

The spec's containment rules are graduated, and Atlas now matches them exactly:

- manifest escapes the root → **reject the plugin**
- a component location escapes → that component type is invalid, keep loading
- a skill escapes or is malformed → skip that skill, keep loading
- an MCP `command`/`cwd` escapes, or an entry is invalid → skip that server, keep loading
- an unsupported `mcp.json` `$schema` → **disable MCP**, keep the skills
- unknown manifest fields → report, ignore, still load

The one behavioural regression this fixed: `parsePluginMcpServers` used to fail
the *whole file* on a single bad entry, so a bundle shipping four servers and
one typo contributed nothing at all. A one-character mistake looked exactly like
a plugin that had stopped working.

### Skills

`skills/<name>/SKILL.md`, immediate children only — no recursive search, so a
`SKILL.md` two levels down is not a skill. Full Agent Skills frontmatter is now
read: `license`, `compatibility` and `allowed-tools` join `name` and
`description`.

`allowed-tools` is parsed, displayed, and **not honoured**. It is marked
experimental upstream, and it is a third-party file asking to skip the approval
prompt — the one control between a skill's instructions and the user's
filesystem. Atlas records what was asked and still asks.

A skill whose frontmatter `name` disagrees with its directory is reported rather
than dropped: the directory is what the loader keys on, so a mismatch is a
confusing bundle, not a broken one.

### Not adopted, deliberately

- **Client extension directories** (`com.example.client/`). Read by no one but
  their owner; Atlas has no use for another client's files and does not scan for
  its own.
- **Dropping the vendor conventions.** See the top of this section.

Fixture: `examples/mcp-ui-demo/` is a conformant Agent Plugins bundle — root
`plugin.json` with `$schema` and an `extensions` block, root `mcp.json` using
`${PLUGIN_ROOT}` in both `args` and `cwd`. Tests: `agentPlugins.test.ts`.


---

## 12. Getting a plugin, and knowing what you got

Two changes, and they are the same change seen from either end: making install
easy is only defensible if what you are installing is legible.

### Install by pasting a link

An Agent Plugins bundle is a directory in somebody's repository, and people find
them by browsing a forge. Before this the only ways in were the native folder
picker — which means clone it yourself first — or adding an entire marketplace
for one plugin. Neither is what someone means by "install this".

`parsePluginUrl` takes what is actually in the address bar. The interesting form
is the browse URL, because it carries a ref and a subdirectory in its path:

```
https://github.com/acme/tools/tree/main/plugins/kanban
  → url: https://github.com/acme/tools, ref: main, subdir: plugins/kanban
```

GitHub, GitLab (`/-/tree/`), Bitbucket (`/src/`) and Gitea all reduce to one
shape. An `ssh` clone address is rewritten rather than rejected — it is what the
"clone with SSH" button hands you. An issue or release link resolves to its
repository rather than erroring, because that is the repository the user meant.

Refused: plaintext HTTP, embedded credentials, and non-HTTP schemes. Plaintext
is not just about the first fetch — the URL is recorded as provenance and
re-cloned on every update, so it is a standing downgrade.

**Two presses, and the split is the security design.** *Check* fetches and reads
the bundle; *Install* is a separate press against what was read. Everything
between them is derived from the resolved manifest — literal commands, literal
endpoints, the environment variables it will receive, the commit that was
actually fetched — and never from the `description` or `interface` its author
wrote. A summary built from author-controlled strings is one the author can lie
in, which would make the confirmation worse than none. Editing the URL clears
the summary, or someone installs one thing having read another's capabilities.

The install re-fetches rather than reusing the preview's checkout. Holding a
temp directory open across two IPC calls would make "the bytes reviewed" and
"the bytes installed" the same only by assumption, and would leak a directory on
a path the user simply abandons.

A URL install records `url`, `ref`, `subdir` and the resolved commit in
`plugins.origins`, so it stays updatable. It records **no marketplace**, because
nobody vouched for it — the user did. That distinction is load-bearing for
scoped revocation, which may only bind what its own catalogue published.

### Republished versions

`PluginUpdateService.checkOne` used to answer one case wrong. Same version,
different commit — a moved tag, a force-pushed release, a publisher who shipped
without bumping — reported as `up-to-date`. A git URL over HTTPS with no
signature makes the host the trust anchor, so this is precisely the shape a
repository compromise takes, and it reached users through the update button with
nothing said.

It is now its own status. Not an error and not blocked: Atlas cannot tell a
forgetful publisher from a moved tag, and pretending otherwise would either cry
wolf or wave through the case that matters. It is the one update whose diff is
worth reading first, and it says so.

Both commits are shown on the row — `a1b2c3d → e4f5g6h` — for the reason the
whole section exists: a version string is chosen by the publisher, and nothing
stops one naming two different trees. The commit is the only identifier in the
chain they do not pick.

### One bug found on the way

`containedPath` compared a realpath-resolved candidate against an *unresolved*
root. Every checkout lives under a temporary directory, and on macOS `/var` is a
symlink to `/private/var` — so a catalogue entry with a `subdir` refused to
install with "points outside its marketplace" for a path that had never left it.
Pre-existing, and it affected every subdir entry on that platform. Regression
test in `pluginMarketplaceService.test.ts`.

Tests: `pluginUrl.test.ts`, and the republish cases in `pluginUpdates.test.ts`.

---

## 13. Release validation

Everything below is a claim with a test file next to it, run on 2026-08-07. Where
something is still unverified, it says so in the same voice as everything else
— this section exists specifically so "implemented" and "validated" cannot be
mistaken for each other.

### 1. Install, end to end

| Claim | Evidence |
|---|---|
| Folder install works, and is refused on a re-install of the same name | `pluginInstaller.test.ts` |
| URL install (`installFromUrl`) works against a real git fetch | `pluginMarketplaceService.test.ts` |
| The install is SHA-pinned and the pin is recorded in provenance | `pluginMarketplaceService.test.ts`'s `fetchRepository` cases (a real git clone reports its resolved commit); `PluginOrigins` records `sha` |
| Preview (`previewUrl`) and install fetch independently — a commit pushed between the two is what gets installed, not what was previewed | `pluginMarketplaceService.test.ts`: *"a commit landing between preview and install…"*, *"two independent fetches of a moving repository each see their own HEAD"* |
| Uninstall removes the bundle and its provenance | `pluginInstaller.test.ts` |
| An oversized bundle (>512MB) is refused before any bytes are copied | `pluginInstaller.test.ts`: *"a bundle over the size ceiling…"* |
| A bundle with an unreasonable entry count (>50,000) is refused before copying | `pluginInstaller.test.ts`: *"an archive bomb of entry count…"* — deliberately the slowest test in the suite, because that cost is exactly what the ceiling exists to bound |
| Two entries differing only by case are refused rather than silently colliding on copy | `pluginInstaller.test.ts`: *"two entries differing only by case…"* — **conditionally verified**: the check only fires on a case-sensitive source filesystem, and this development machine's is case-insensitive (macOS default APFS), so the test detects that and calls `t.skip()` with the reason rather than passing vacuously. Confirmed on Linux CI or a case-sensitive volume, not here. |
| A malformed manifest is refused, not half-installed | `pluginInstaller.test.ts`: *"an invalid bundle is refused and nothing is written"* |
| Installing the same name twice concurrently: one wins, the other fails clean, nothing corrupts | `pluginInstaller.test.ts`: *"installing the same bundle twice concurrently…"* |

There is no archive *format* (`.zip`/`.tar`) anywhere in the install path — every
source is a directory, whether from the folder picker, a git clone, or a
marketplace checkout — so "oversized/malformed archive" above is validated as
"oversized/malformed bundle directory", which is the actual attack surface that
exists.

### 2. Durable audit evidence

| Claim | Evidence |
|---|---|
| A written record is readable back with every field intact | `pluginAuditRepo.test.ts` |
| A record survives the process that wrote it exiting | `pluginAuditRepo.test.ts`: *"a record survives the process that wrote it exiting"* — closes the real SQLite handle and opens a fresh one at the same path, which is what a restart is, not a simulation of one |
| Truncation metadata survives a restart alongside the record | `pluginAuditRepo.test.ts` |
| The same idempotency key lands once; a retried write is silently absorbed, keeping the *first* write's content | `pluginAuditRepo.test.ts`, `mcpAuditLog.test.ts` (both the durable and in-memory paths) |
| Different idempotency keys are different rows even with identical content | `pluginAuditRepo.test.ts` |
| A deleted conversation does not delete its audit trail | `pluginAuditRepo.test.ts`: *"a deleted conversation does not take its audit trail with it"* — a real row inserted into the real `conversations` table, deleted with a real `DELETE`, under `PRAGMA foreign_keys = ON`. `plugin_audit_records` carries no FK to `conversations` by design (see the table comment in `schema.ts`), so there is nothing for SQLite to cascade. |
| The full pipeline — real subprocess call → redaction → capping → durable write → restart → read-back — holds together, not just each piece in isolation | `pluginIntegration.test.ts` |

### 3. Provenance

| Claim | Evidence |
|---|---|
| The common case: server key equals plugin name | `mcpToolProvenance.test.ts` |
| Plugin name and server key differ — resolved exactly, not by the lossy display-label heuristic | `mcpToolProvenance.test.ts`: *"a plugin and server key that differ resolve exactly, not by guessing"* |
| The right plugin is picked out of several installed | `mcpToolProvenance.test.ts` |
| An unknown plugin (never installed) resolves to `null`, never a guess | `mcpToolProvenance.test.ts` |
| An approval for a call made before an update resolves to the version now installed — read from a fresh snapshot at approval time, not cached at call time | `mcpToolProvenance.test.ts`: *"an approval for a call made before an update resolves to the version now installed"* |
| A renamed plugin: the old wire name resolves to nothing, never silently to the new name | `mcpToolProvenance.test.ts`: *"a renamed plugin…"* |
| A removed plugin: an approval already in flight resolves to nothing, not the wrong plugin | `mcpToolProvenance.test.ts`: *"a removed plugin…"* |
| The real end-to-end path — a live subprocess's wire tool name resolved against a live registry snapshot — not just the pure function in isolation | `pluginIntegration.test.ts` |

Atlas has no rename *tracking* (§9's open item, still open): the "renamed
plugin" case above is not Atlas detecting a rename, it is Atlas correctly
treating a rename as what it structurally is — one plugin gone, a different one
installed — and provenance not papering over that seam with a guess.

### 4. Failure isolation

| Claim | Evidence |
|---|---|
| One invalid `.mcp.json` server entry does not block the others in the same file | `pluginManifest.test.ts`: *"one bad server entry costs that entry, not the whole configuration"* |
| One invalid catalogue entry does not block the rest of a marketplace | `pluginMarketplaceService.test.ts`: *"an entry Atlas refuses is listed with its reason rather than hidden"* |
| One malformed skill does not cost the bundle its other skills | `pluginLoader.test.ts` |
| A duplicate skill name keeps the first and reports the second, rather than silently overwriting | `pluginLoader.test.ts` |
| Case-duplicate file entries are refused at install (see §1) | `pluginInstaller.test.ts` |
| An entry-count archive bomb is refused at install (see §1) | `pluginInstaller.test.ts` |
| A tool call that never responds is rejected at the configured `toolTimeoutMs`, against a real subprocess, not left hanging | `mcpManagerHealth.test.ts`: *"a tool call that never responds is rejected at the configured timeout, not left hanging"* — the timeout is the MCP SDK's own `setTimeout`, not Atlas's code, and this proves passing the option is honoured rather than trusting the library's word for it |
| An oversized tool result is truncated rather than flooding the context | `mcpTools.test.ts` |
| A revoked plugin is refused at install and at load | `pluginBlocklist.test.ts`, `pluginMarketplaceService.test.ts` |
| A cancelled call (turn's Stop) reaches the real MCP request via `AbortSignal`, and audits as `cancelled`, not `error` | `mcpTools.test.ts` |

### 5. UX smoke test

| Claim | Evidence |
|---|---|
| A command opens the plugin browser from the palette | `plugins.open` in `keybindingCommands.ts` + `App.tsx`'s `runCommand` switch. **Not independently tested** — no renderer test harness exists for the command palette in this repository; wired the same way every other palette command is, and none of those have dedicated tests either. |
| Enable / disable | `pluginActivation.test.ts` |
| Update, including the `republished` (same version, different commit) case | `pluginUpdates.test.ts` |
| Uninstall | `pluginInstaller.test.ts` |
| Warnings surface per-plugin rather than being swallowed | `pluginLoader.test.ts`, `pluginInstaller.test.ts` (the "author prose must not reach the summary" case) |
| Trust/blocked state is shown, not hidden | `pluginMarketplaceService.test.ts`: *"an entry Atlas refuses is listed with its reason rather than hidden"* |

### 6. The honest boundary

**Connectors are declarative only.** `.app.json` is parsed (`parsePluginConnectors`),
its id classified as a first-party connector or an Apps SDK app, and shown in
the plugin browser and the install preview marked *"Requires account linking —
Atlas cannot perform this yet."* (`CONNECTOR_UNAVAILABLE_NOTICE`). Nothing in
`shared/pluginConnectors.ts` creates OAuth state, resolves an id, or contacts
anything — verified by a test that feeds it a fake `access_token` field and
confirms it never appears in the parsed output. A connector-only bundle is
still refused at install: `readPluginCapability` only counts skills and MCP
servers as making a bundle usable.

**The plugin-UI sandbox is real, and its limits are documented in §10, not
here.** `sandbox="allow-scripts"` with no `allow-same-origin`, a CSP delivered
as a response header on the `atlas-widget:` scheme rather than via `srcdoc`
(§10 explains why that distinction is load-bearing), and a three-message
`postMessage` vocabulary that grants a widget nothing beyond `resize` and
`submit`. `examples/mcp-ui-demo`'s widget actively attempts six escapes
(`require`, `process`, `window.atlasChat`, `parent.document`, `fetch`,
`localStorage`) and reports which were blocked — every row must read `blocked`
for the isolation model to be holding. That card has been read by eye during
this work; it has not been re-verified in this validation pass because doing so
needs the running app (see below).

**No real install has been clicked through, and that is still true.**
Everything in this document is validated at the level `node --test` can reach:
real subprocesses, real SQLite files with real restarts, real git fetches
against real local repositories. None of it is a `BrowserWindow`, and
`better-sqlite3`'s native binding in this repository is compiled against
Electron's Node ABI — verified directly while building `pluginIntegration.test.ts`,
where requiring it under plain Node fails with `ERR_DLOPEN_FAILED` — which is
the concrete reason `index.ts` cannot be exercised outside a real Electron
process from a test file. Nobody has opened the packaged app, pressed Install,
watched an approval dialog, or seen a widget actually paint in a window. That
is the one gap this section cannot close, and closing it is a manual pass
against a running build, not another test file.
