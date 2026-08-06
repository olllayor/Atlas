# Plugin distribution and marketplace layer — on-disk research

**Scope:** phases 2 and 4 of [`docs/plugin-system.md`](./plugin-system.md) — marketplace catalog format,
update/version semantics, the hooks contract, and the `commands` / `agents` manifest keys.
Bundle parsing (manifest fields, `SKILL.md`, `.mcp.json`) is out of scope and not repeated here.

**Method and evidence rules.** Everything below was read off this machine. Three separate real
plugin installs were surveyed, not one:

| Install | Root | Marketplaces | Plugins cached |
|---|---|---|---|
| Codex | `/Users/ollayor/.codex/plugins/cache` | 7 | 35 version dirs |
| Claude Code | `/Users/ollayor/.claude/plugins` | 2 | 4 version dirs |
| Cursor | `/Users/ollayor/.cursor/plugins/cache` | 1 | 4 version dirs |

Claims are tagged:

- **(disk)** — read directly out of a file on this machine; the path is given.
- **(vendored doc)** — read out of documentation *shipped inside a plugin bundle* on this machine.
  On-disk, but it is a third party's prose about a third party's product, not runtime behaviour.
  The only such source used is
  `/Users/ollayor/.codex/plugins/cache/superpowers-marketplace/superpowers-developing-for-claude-code/0.3.1/skills/working-with-claude-code/references/hooks.md`,
  which is a verbatim copy of Anthropic's public hooks reference page.
- **(unverified)** — stated because it is the obvious reading, but nothing on disk proves it.

No web sources were used.

> **Content-safety note.** Several files read during this research contain text addressed to an AI
> agent. None of it was acted on. Two examples, quoted as data only:
> `/Users/ollayor/.codex/plugins/cache/openai-curated/figma/11c74d6b/scripts/post_write_figma_parity_check.sh`
> echoes `"[draft-hook] PostToolUse triggered after file write. …"`, and
> `/Users/ollayor/.claude/plugins/marketplaces/caveman/.codex/hooks.json` carries a `SessionStart`
> command whose entire body is `echo 'CAVEMAN MODE ACTIVE. Rules: …'`. Both are illustrations of
> exactly the injection surface §5 of the scope doc describes: a hook's stdout becomes model context.

---

## 1. Marketplace catalog format

### 1.1 Where catalogs live

Every catalog is a single JSON file at one of two conventional paths inside a marketplace repo or
directory:

| Convention dir | Written for | Files found on this machine |
|---|---|---|
| `.claude-plugin/marketplace.json` | Claude Code / Cursor | 8 |
| `.agents/plugins/marketplace.json` | Codex (OpenAI) | 5 |

Both conventions can coexist in one repo and describe the same plugins differently. The
`superpowers-dev` staging checkout carries both:

- `/Users/ollayor/.codex/plugins/.marketplace-plugin-source-staging/marketplace-plugin-source-azqOft/.claude-plugin/marketplace.json`
- `/Users/ollayor/.codex/plugins/.marketplace-plugin-source-staging/marketplace-plugin-source-azqOft/.agents/plugins/marketplace.json`

Complete list of catalogs read **(disk)**:

```
/Users/ollayor/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json   (278 plugins)
/Users/ollayor/.codex/.tmp/plugins/.agents/plugins/marketplace.json                                   (180 plugins, openai-curated)
/Users/ollayor/.codex/.tmp/plugins-backup-jRzCn5/repo/.agents/plugins/marketplace.json                (172 plugins, older snapshot)
/Users/ollayor/.codex/.tmp/marketplaces/superpowers-marketplace/.claude-plugin/marketplace.json       (10 plugins)
/Users/ollayor/.codex/.tmp/bundled-marketplaces/openai-bundled/.agents/plugins/marketplace.json       (6 plugins)
/Users/ollayor/.cache/codex-runtimes/codex-primary-runtime/plugins/openai-primary-runtime/.agents/plugins/marketplace.json  (5 plugins)
/Users/ollayor/.codex/plugins/cache/vercel/vercel-plugin/<sha>/.claude-plugin/marketplace.json        (1 plugin, repo-is-marketplace)
/Users/ollayor/.codex/plugins/cache/plugins-cli/vercel-plugin/0.44.0/.claude-plugin/marketplace.json  (byte-identical to the above)
/Users/ollayor/.codex/plugins/.marketplace-plugin-source-staging/marketplace-plugin-source-azqOft/{.claude-plugin,.agents/plugins}/marketplace.json
/Users/ollayor/.codex/plugins/cache/superpowers-marketplace/superpowers-developing-for-claude-code/0.3.1/examples/full-featured-plugin/.claude-plugin/marketplace.json  (example, not live)
```

There is a published JSON Schema URL, declared by Anthropic's catalog **(disk)**:

```json
"$schema": "https://anthropic.com/claude-code/marketplace.schema.json"
```

(`/Users/ollayor/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`, line 1.)
The schema document itself was not fetched (no web access used), so its contents are **unverified**.

### 1.2 Top-level catalog keys

Union across all catalogs read **(disk)**:

| Key | Type | Seen in |
|---|---|---|
| `name` | string | all — the marketplace id, used as the `@marketplace` suffix everywhere |
| `plugins` | array | all — required |
| `owner` | `{name, email?}` | superpowers, vercel, claude-plugins-official |
| `metadata` | `{description, version}` | superpowers only |
| `description` | string | claude-plugins-official, superpowers-dev |
| `interface` | `{displayName}` | Codex `.agents/` catalogs only |
| `$schema` | string | claude-plugins-official only |
| `renames` | `{old: new}` | claude-plugins-official only |

`metadata.version` versions the *catalog*, not any plugin:

```json
{ "name": "superpowers-marketplace",
  "owner": { "name": "Jesse Vincent", "email": "jesse@fsck.com" },
  "metadata": { "description": "Skills, workflows, and productivity tools", "version": "1.0.13" },
  ... }
```

`renames` is a plugin-identity migration map — an installed plugin whose name appears as a key should
be re-pointed at the value **(disk)**:

```json
"renames": {
  "adlc": "agentforce-adlc",
  "airwallex": "airwallex-agentos",
  "convex-backend": "convex",
  "vals": "valtown",
  "wordpress.com": "build-with-wordpress",
  "qodo-skills": "qodo"
}
```

This is not in the scope doc and Atlas needs it: without it, a rename in the upstream catalog silently
orphans a user's install. The `plugin_installs` table should key on `(marketplace_id, plugin_name)`
and apply `renames` on every catalog refresh.

### 1.3 Plugin entry keys

Union across all catalogs **(disk)**:

`name`, `source`, `description`, `version`, `author`, `homepage`, `repository`, `license`,
`keywords`, `category`, `tags`, `displayName`, `strict`, `policy`, `skills`, `lspServers`.

Codex `.agents/` catalogs use a strikingly small subset — exactly four keys across all 180
`openai-curated` entries: `name`, `source`, `policy`, `category`. No `version`, no `description`.

### 1.4 `source` — the complete observed taxonomy

Five distinct shapes. **`source.source` takes four values: `url`, `git-subdir`, `github`, `local`** —
and the whole `source` may also be a bare string. There is no `npm` and no `registry` kind anywhere
on this machine.

**(a) Bare string — relative path inside the marketplace repo.** 53 occurrences in
claude-plugins-official, plus the vercel catalog.

```json
{ "name": "agent-sdk-dev", "source": "./plugins/agent-sdk-dev", ... }
```
```json
{ "name": "vercel-plugin", "source": "./", "description": "Build and deploy web apps and agents", ... }
```
(`/Users/ollayor/.codex/plugins/cache/vercel/vercel-plugin/4a6d0bef8b669e8d1658abb6004fcf0e9dd3c12d/.claude-plugin/marketplace.json`)
`"./"` means *the marketplace repo is itself the plugin* — a one-plugin marketplace.

**(b) `{"source": "local", "path": …}` — the Codex spelling of (a).** All 180 `openai-curated`
entries, all 6 `openai-bundled`, all 5 `openai-primary-runtime`.

```json
{ "name": "browser",
  "source": { "source": "local", "path": "./plugins/browser" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
  "category": "Engineering" }
```
(`/Users/ollayor/.codex/.tmp/bundled-marketplaces/openai-bundled/.agents/plugins/marketplace.json`)

**(c) `{"source": "url", "url": …, "sha": …, "path"?: …, "ref"?: …}` — a git clone.** 143 entries in
claude-plugins-official, all 10 in superpowers. In Anthropic's catalog `sha` is **always present**
(0 entries without it); in the superpowers catalog it is always absent.

```json
{ "name": "superpowers",
  "source": { "source": "url", "url": "https://github.com/obra/superpowers.git" },
  "description": "Core skills library: TDD, debugging, collaboration patterns, and proven techniques",
  "version": "6.2.0", "strict": true }
```
```json
{ "name": "superpowers-dev",
  "source": { "source": "url", "url": "https://github.com/obra/superpowers.git", "ref": "dev" },
  "description": "DEV BRANCH: YOU MUST UNINSTALL OTHER VERSIONS OF SUPERPOWERS BEFORE INSTALLING THIS",
  "version": "0.0.2026021001", "strict": true }
```
Two entries in one catalog pointing at the same repo, distinguished only by `ref` — so `ref` is part
of the plugin's identity, not a hint.

With a subdirectory:
```json
{ "name": "revenuecat",
  "source": { "source": "url", "url": "https://github.com/RevenueCat/rc-claude-code-plugin.git",
              "path": "revenuecat", "sha": "bcce7a3261b17fcd3a79a2b45b03cdbedab5ea1a" } }
```
Note `rc` and `revenuecat` are two catalog entries resolving to the identical url+path+sha — the
content-addressed dedupe in §4 of the scope doc pays for itself immediately.

**(d) `{"source": "git-subdir", "url": …, "path": …, "ref": …, "sha": …}`.** 80 entries. Distinct
from (c)+`path` only in that `ref` is mandatory here (79 of 80 carry it).

```json
{ "name": "42crunch-api-security-testing",
  "source": { "source": "git-subdir",
              "url": "https://github.com/42Crunch-AI/claude-plugins.git",
              "path": "plugins/api-security-testing",
              "ref": "v1.5.5",
              "sha": "30287f5e3f122a646d1ac5ca3ab96e130c52a3ad" } }
```

`ref` distribution across all object-sources in claude-plugins-official: `(none)` 146, `main` 72,
`master` 6, `v1.5.5` 1. So refs are overwhelmingly branch names, and every one of them is
**accompanied by a pinned `sha`** — the catalog does exactly what the scope doc's §4 recommends
("never re-resolve a tag silently"), and it does it *in the catalog*, not at install time.

**(e) `{"source": "github", "repo": "owner/name", "commit": …, "sha": …}`.** Only 2 entries, both
third-party.

```json
{ "name": "fullstory",
  "source": { "source": "github", "repo": "fullstorydev/fullstory-skills",
              "commit": "1ec5865e7ab1449f9a0859d164c4b6a8c53b6e2f",
              "sha":    "b20614e2d08d7a7c70775bb62b5af640f60b024b" } }
```
```json
{ "name": "jfrog",
  "source": { "source": "github", "repo": "jfrog/claude-plugin",
              "commit": "259c8e718266c16e99b4f30ae9b1ed0f9f00d98d",
              "sha":    "5525279d72af8e1982acfc8dabd1058d55b8b167" } }
```
Both carry `commit` **and** `sha` and the two differ. What each means is **unverified**; the most
likely reading is `commit` = upstream repo commit, `sha` = a content/tarball digest computed by the
marketplace's build pipeline, but nothing on disk confirms it. Atlas should treat the `github` kind
as a shorthand for `url` = `https://github.com/<repo>.git`, pin to `commit`, and ignore `sha` until
its meaning is established.

**Recommendation for Atlas.** Normalise all five into one internal record — `{kind: 'git' | 'path',
url?, repoPath?, subPath?, ref?, pinnedSha?}` — at catalog-parse time. The `source_kind` column
already in `plugin_marketplaces` (`'git' | 'path' | 'builtin'`) is the right granularity; the five
spellings are a parser concern, not a data-model concern.

### 1.5 Version pinning

Three independent pinning mechanisms coexist, and they disagree:

1. **`sha` inside `source`** — Anthropic's catalog pins every git source. Authoritative, immutable.
2. **`version` on the catalog entry** — superpowers pins all 10; Anthropic pins only 14 of 278
   (all of them `source: "./…"` in-repo plugins); Codex `.agents/` catalogs pin **none**.
3. **`version` inside the bundle manifest** — always present except for `strict: false` plugins.

Mechanism 2 goes stale. On this machine, the superpowers catalog says:

```json
{ "name": "superpowers-chrome",
  "source": { "source": "url", "url": "https://github.com/obra/superpowers-chrome.git" },
  "version": "3.0.1", "strict": true }
```

but the installed bundle is `3.0.2`, both by directory name and by manifest:
`/Users/ollayor/.codex/plugins/cache/superpowers-marketplace/superpowers-chrome/3.0.2/.claude-plugin/plugin.json`
→ `"version": "3.0.2"`. `~/.codex/config.toml` records the catalog was fetched
`last_updated = "2026-07-27T17:35:52Z"` and the bundle directory is dated `Jul 27 22:37` local
(UTC+5) — i.e. minutes later, from the same catalog. **The catalog version was simply wrong when the
plugin was installed.** See §2.

### 1.6 The `strict` flag — meaning established

`strict` appears on catalog entries (`true` on all 10 superpowers entries; `false` on 15 of 278
Anthropic entries; absent on the other 263) and, echoed, inside one bundle manifest.

The decisive evidence is `swift-lsp`, one of the `strict: false` entries. Its catalog entry **(disk)**:

```json
{ "name": "swift-lsp",
  "description": "Swift language server (SourceKit-LSP) for code intelligence",
  "version": "1.0.0",
  "author": { "name": "Anthropic", "email": "support@anthropic.com" },
  "source": "./plugins/swift-lsp",
  "category": "development",
  "strict": false,
  "lspServers": { "sourcekit-lsp": { "command": "sourcekit-lsp",
                  "extensionToLanguage": { ".swift": "swift" } } } }
```

And its bundle, both as shipped and as installed, contains **no manifest at all**:

```
/Users/ollayor/.claude/plugins/marketplaces/claude-plugins-official/plugins/swift-lsp/LICENSE
/Users/ollayor/.claude/plugins/marketplaces/claude-plugins-official/plugins/swift-lsp/README.md
```
```
/Users/ollayor/.claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0/LICENSE
/Users/ollayor/.claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0/README.md
/Users/ollayor/.claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0/.in_use/…
```

No `.claude-plugin/`, no `plugin.json`. Yet the plugin installs and runs — `installed_plugins.json`
records it at version `1.0.0`, which exists *only* in the catalog entry.

> **`strict: false` means: this catalog entry is self-describing; do not require the bundle to carry
> its own manifest, and take name/version/components from the entry.**
> **`strict: true` means: the bundle must carry a valid manifest, and that manifest is authoritative.**

Corroborating: all 15 `strict: false` entries are ones whose components cannot be discovered by
convention — 12 are LSP-only plugins with no `skills/` at all, and the other three declare
non-standard skill locations via a catalog-level `skills` array, e.g.

```json
{ "name": "amd-skills", "strict": false,
  "skills": ["./local-ai-use", "./local-ai-app-integration",
             "./serving-llms-on-instinct", "./tracelens-analysis-orchestrator"] }
```

Absent `strict` behaves like `true` on all 263 remaining Anthropic entries (they all ship manifests).

**Recommendation for Atlas.** Implement `strict: true` / absent only. Reject `strict: false` at
install with a typed error ("this plugin's definition lives in the marketplace catalog, which Atlas
does not treat as authoritative"). It is a small population, it is entirely LSP plugins Atlas has no
use for, and honouring it means letting a catalog — which the §5 threat model already says can lie —
define what gets loaded.

### 1.7 The `policy` block — now verified

The scope doc marks this *unverified*. It is on disk, in every Codex `.agents/` catalog **(disk)**:

```json
"policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }
```

Distribution across the 180 `openai-curated` entries
(`/Users/ollayor/.codex/.tmp/plugins/.agents/plugins/marketplace.json`):

| Field | Values observed | Counts |
|---|---|---|
| `installation` | `AVAILABLE` | 180/180 |
| `authentication` | `ON_INSTALL`, `ON_USE` | 177 / 3 |
| `products` | `["CODEX"]` | present on 15, absent on 165 |

The doc's guess of `ON_FIRST_USE` is wrong — the actual token is **`ON_USE`**. The three `ON_USE`
entries in `openai-curated` are `build-web-apps`, `build-web-data-visualization`, `codex-security`;
all five `openai-primary-runtime` entries are also `ON_USE`
(`/Users/ollayor/.cache/codex-runtimes/codex-primary-runtime/plugins/openai-primary-runtime/.agents/plugins/marketplace.json`).

```json
{ "name": "codex-security",
  "source": { "source": "local", "path": "./plugins/codex-security" },
  "policy": { "installation": "AVAILABLE", "authentication": "ON_USE", "products": ["CODEX"] },
  "category": "Security" }
```

Readings:

- **`authentication`** — *when* the install flow demands credentials. `ON_INSTALL` = prompt during
  install; `ON_USE` = defer until the plugin is first exercised. Only two values seen, so an
  enumeration with an unknown-value fallback is safe. The correlation is exact and telling: every
  `ON_USE` plugin is one whose value is skills, not a connector — this is the same distinction as
  §6's dependency gating, expressed in the catalog. **Atlas should treat `ON_USE` as a hint that this
  plugin's servers are gate-eligible.**
- **`installation`** — only `AVAILABLE` seen, so it is an enum with at least one other member
  (`UNAVAILABLE` / `BLOCKED` / `DEPRECATED` are plausible; **unverified**). Treat any value other
  than `AVAILABLE` as "do not offer for install", and surface it in the UI.
- **`products`** — a product allowlist. Only `"CODEX"` observed. An Atlas implementation should
  **not** filter on it (Atlas is not in anyone's allowlist yet); display it and move on.

`policy` never appears on `.claude-plugin/marketplace.json` entries. Anthropic's equivalent is the
separate blocklist described in §2.5.

### 1.8 `category` vocabulary

Two disjoint vocabularies, which matters if Atlas wants one browse UI.

Codex `.agents/` (title case, 11 values, `openai-curated`): `Developer Tools` 44, `Productivity` 44,
`Finance` 27, `Business & Operations` 15, `Data & Analytics` 13, `Communication` 12,
`Education & Research` 11, `Creativity` 9, `Travel` 2, `Other` 2, `Security` 1.

Claude `.claude-plugin/` (lowercase, free-form): `security`, `design`, `development`, `deployment`,
`monitoring`, … Not enumerated exhaustively.

Atlas should normalise to its own list and keep the raw string.

---

## 2. Update and version semantics

### 2.1 The on-disk cache layout, in all three products

```
<root>/plugins/cache/<marketplace>/<plugin>/<version>/…bundle…
```

Identical shape in Codex, Claude Code and Cursor. Full enumeration of the 43 version-level
directories on this machine:

| Path (abbrev) | Version dir | Bundle manifest `version` | Kind of key |
|---|---|---|---|
| `.claude/…/claude-plugins-official/vercel/` | `0.44.0` | `0.44.0` | semver |
| `.claude/…/claude-plugins-official/vercel/` | `0.45.1` | `0.45.1` | semver |
| `.claude/…/claude-plugins-official/swift-lsp/` | `1.0.0` | *(no manifest)* | semver, from catalog |
| `.claude/…/caveman/caveman/` | `25d22f864ad6` | *(manifest has no `version`)* | 12-char commit SHA |
| `.codex/…/openai-bundled/chrome/` | `26.727.51351` | `26.727.51351` | app build number |
| `.codex/…/openai-bundled/chrome/` | `latest` → symlink | — | mutable pointer |
| `.codex/…/openai-curated/*/` (11 plugins) | `11c74d6b` | `0.1.2` … `2.0.13` | 8-char *marketplace* SHA |
| `.codex/…/openai-primary-runtime/*/` (5) | `26.802.11031` | same | runtime build number |
| `.codex/…/superpowers-marketplace/*/` (9) | `6.2.0`, `1.4.2`, … | same | semver |
| `.codex/…/vercel/vercel-plugin/` | `4a6d0bef…` (40 hex) | `0.44.0` | full commit SHA |
| `.codex/…/plugins-cli/vercel-plugin/` | `0.44.0` | `0.44.0` | semver |
| `.cursor/…/cursor-public/*/` (4) | 40-hex, all four | varies | full commit SHA |

### 2.2 The rule for what goes in the `<version>` segment

Working it out from the table:

> **The version segment is the plugin's resolved identity string: the manifest `version` when the
> plugin has an independent version, and a commit SHA when it does not.**

Concretely, in priority order:

1. **Bundle manifest `version`**, when the plugin resolves independently — a git repo of its own
   (superpowers, plugins-cli/vercel-plugin), or a catalog-versioned in-repo plugin (swift-lsp,
   claude-plugins-official/vercel).
2. **A commit SHA**, when the plugin has no independent version to resolve:
   - the manifest has no `version` key at all → `caveman` (`.claude-plugin/plugin.json` keys are
     exactly `author, description, hooks, name`) → keyed `25d22f864ad6`, and
     `installed_plugins.json` confirms `"version": "25d22f864ad6"` with
     `"gitCommitSha": "25d22f864ad68cc447a4cb93aefde918aa4aec9f"` — **the version *is* the truncated
     SHA**;
   - the plugin is a subdirectory of the marketplace repo, so the marketplace commit is the only
     coherent pin → all 11 `openai-curated` plugins share the directory name `11c74d6b`, which is
     the first 8 characters of `/Users/ollayor/.codex/.tmp/plugins.sha`:
     ```
     11c74d6ba24d3a6d48f54a194cd00ef3beea18f9
     ```
     confirmed by `git -C ~/.codex/.tmp/plugins rev-parse HEAD` → the same SHA, remote
     `https://github.com/openai/plugins.git`. Their manifest versions differ wildly (`0.1.2`
     through `2.0.13`) and are **not** used;
   - the marketplace *is* the plugin (`source: "./"`) → `vercel/vercel-plugin/4a6d0bef…`, the full
     40-char SHA, verified by `git rev-parse HEAD` inside that directory. Cursor does this for
     everything.
3. **`latest`**, an actual filesystem symlink, only in the bundled marketplace:
   ```
   latest -> /Users/ollayor/.codex/plugins/cache/openai-bundled/chrome/26.727.51351
   ```
   `diff -rq` of the two paths is empty. It is a mutable alias, not a separate copy.

**On the premise in the brief:** `latest` exists and is a symlink. **No version directory named
`local` exists anywhere on this machine** — the only `local` is `/Users/ollayor/.cursor/plugins/local`,
an empty sibling of `cache/` for locally-developed plugins, one level too shallow to be a version
segment. Truncation length is inconsistent (8 / 12 / 40 chars) across products, so a consumer must
not assume a fixed width.

### 2.3 Which is the source of truth: catalog or manifest?

**The bundle manifest, whenever there is one.** Three independent confirmations:

1. **superpowers-chrome** — catalog `3.0.1`, installed and cached as `3.0.2` (§1.5). The installer
   resolved the git ref, read the manifest, and used what it found rather than what the catalog
   promised.
2. **openai-curated** — manifest versions exist and are ignored entirely for cache keying; the
   catalog carries no version at all. The pin comes from neither: it comes from the repo commit.
3. **swift-lsp** — the *only* case where the catalog wins is `strict: false`, i.e. precisely when
   there is no manifest to consult.

Anthropic's install record makes the layering explicit
(`/Users/ollayor/.claude/plugins/installed_plugins.json`) **(disk)**:

```json
{
  "version": 2,
  "plugins": {
    "vercel@claude-plugins-official": [
      { "scope": "user",
        "installPath": "/Users/ollayor/.claude/plugins/cache/claude-plugins-official/vercel/0.45.1",
        "version": "0.45.1",
        "installedAt": "2026-06-14T19:39:12.179Z",
        "lastUpdated": "2026-07-24T10:34:32.123Z",
        "gitCommitSha": "4a6d0bef8b669e8d1658abb6004fcf0e9dd3c12d" }
    ],
    "caveman@caveman": [
      { "scope": "user",
        "installPath": "/Users/ollayor/.claude/plugins/cache/caveman/caveman/25d22f864ad6",
        "version": "25d22f864ad6",
        "installedAt": "2026-07-02T12:55:27.953Z",
        "lastUpdated": "2026-07-02T12:55:27.953Z",
        "gitCommitSha": "25d22f864ad68cc447a4cb93aefde918aa4aec9f" }
    ],
    "swift-lsp@claude-plugins-official": [
      { "scope": "user",
        "installPath": "/Users/ollayor/.claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0",
        "version": "1.0.0",
        "installedAt": "2026-07-22T17:30:44.895Z",
        "lastUpdated": "2026-07-22T17:30:44.895Z" }
      ]
  }
}
```

This maps almost exactly onto the proposed `plugin_installs` table. Two differences worth adopting:

- **The value is an array, keyed by `scope`.** One plugin can have several concurrent installs at
  different scopes (`"user"` observed; a project scope is implied by the shape but **unverified**).
  This is open decision #1 in the scope doc, already answered by the format: the array *is* the
  per-scope model. Atlas's proposed `UNIQUE (marketplace_id, plugin_name)` would forbid it.
- **`installedAt` and `lastUpdated` are separate.** The proposed schema has only `installed_at`.
  Without both you cannot show "updated 2 days ago" or drive an update-check backoff.

**A caution, straight off this disk.** The `vercel@claude-plugins-official` record claims version
`0.45.1` with `gitCommitSha: 4a6d0bef…`. But `4a6d0bef…` is verifiably the commit of the **0.44.0**
checkout — `git -C ~/.claude/plugins/cache/claude-plugins-official/vercel/0.44.0 rev-parse HEAD`
returns exactly that, and the same SHA names the Codex cache directory holding manifest version
`0.44.0`. The `0.45.1` directory has no `.git` at all. So the recorded `gitCommitSha` **was carried
over unchanged across an update** and no longer describes the installed bytes. Whether this is a bug
or a deliberate "originally installed from" field is **unverified**, but the lesson for Atlas is
concrete: `plugin_installs.source_ref` must be re-derived on every update and asserted against the
published bundle, or it becomes a lie that the §5 install-confirmation surface then displays as fact.

### 2.4 What the layout implies about updates and rollbacks

- **Versions are immutable, side-by-side directories.** `vercel/0.44.0` and `vercel/0.45.1` coexist
  under `~/.claude/plugins/cache/claude-plugins-official/`. An update is a *new directory plus a
  pointer move*, never a mutation. Rollback is therefore free as long as the old directory survives:
  repoint `installPath`/`version`, no refetch. Atlas's content-addressed store gets this property by
  construction.
- **The pointer is data, except where it is a symlink.** Claude and Codex point via a registry file
  (`installed_plugins.json`) or config (`[plugins."x@y"]`); `openai-bundled` additionally publishes a
  `latest` symlink. A symlink is the wrong choice for Atlas — it is not atomic across a crash on all
  filesystems and it is invisible to the database.
- **Garbage collection is reference-counted by live process, not by row.** Directories carry
  `.in_use/<pid>` marker files:
  ```
  /Users/ollayor/.claude/plugins/cache/claude-plugins-official/swift-lsp/1.0.0/.in_use/83118
  ```
  whose content is **(disk)**:
  ```json
  {"pid":83118,"procStart":"Wed Aug  5 11:07:16 2026"}
  ```
  and a sweep watermark at `/Users/ollayor/.claude/plugins/.last_inuse_sweep` containing
  `2026-08-05T07:03:42.428Z`. Recording `procStart` alongside `pid` is the right detail — it makes
  the marker robust against PID reuse, which a bare pidfile is not. `vercel/0.45.1`, the *current*
  install, has no `.in_use` directory while the superseded `0.44.0` does — so markers are created by
  running sessions and outlive the install record. Atlas's GC ("the store directory is GC'd when no
  row references it") is weaker than this: a row can be deleted while a live conversation still has
  the bundle's MCP server spawned out of it. Add a liveness marker.
- **Staging is a sibling directory, and it leaks.** Three abandoned staging directories from
  2026-07-18 are still present:
  ```
  ~/.codex/.tmp/bundled-marketplaces/openai-bundled.staging-271623e9-7458-4272-a761-44aa71705a96
  ~/.codex/.tmp/bundled-marketplaces/openai-bundled.staging-6bea22bc-44b0-4867-88fd-decb77c67f24
  ~/.codex/.tmp/bundled-marketplaces/openai-bundled.staging-7abeef50-0874-479a-8783-b1e35b89a0d4
  ```
  each containing a partial `plugins/` tree, alongside the live `openai-bundled/`. Also
  `~/.codex/plugins/.marketplace-plugin-source-staging/marketplace-plugin-source-{azqOft,Rhrc3E}/`
  and an empty `~/.codex/plugins/.remote-plugin-install-staging/`. This is the exact
  `<target>.staging-<uuid>` → `rename()` pattern §4 of the scope doc proposes — including its
  failure mode. **The "swept at next launch" clause is load-bearing and this install proves nobody
  implements it.**

### 2.5 Marketplace-level update state

`~/.codex/config.toml` **(disk)**:

```toml
[marketplaces.openai-bundled]
last_updated = "2026-08-04T15:27:37Z"
source_type = "local"
source = "/Users/ollayor/.codex/.tmp/bundled-marketplaces/openai-bundled"

[marketplaces.superpowers-marketplace]
last_updated = "2026-07-27T17:35:52Z"
last_revision = "e4b6482d74109bef66e55660784b4d628acc83c6"
source_type = "git"
source = "https://github.com/obra/superpowers-marketplace.git"
```

`last_revision` matches `git -C ~/.codex/.tmp/marketplaces/superpowers-marketplace rev-parse HEAD`
exactly. `source_type` observed: `"local"`, `"git"`. Claude's equivalent
(`~/.claude/plugins/known_marketplaces.json`) **(disk)**:

```json
{ "claude-plugins-official": {
    "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
    "installLocation": "/Users/ollayor/.claude/plugins/marketplaces/claude-plugins-official",
    "lastUpdated": "2026-08-05T10:56:13.066Z" } }
```

Note the marketplace registry reuses the **same `source` object grammar** as catalog entries, so one
parser covers both.

Enablement is a separate, versionless axis. `~/.codex/config.toml` **(disk)**:

```toml
[plugins."build-ios-apps@openai-curated"]
enabled = true

[plugins."build-web-apps@openai-curated"]
enabled = false
```

The `<plugin>@<marketplace>` composite key is used identically by Codex config, Claude's
`installed_plugins.json`, Claude's blocklist, and Codex's `[hooks.state]`. **Atlas should adopt it
verbatim as the plugin's public identity string.**

### 2.6 The blocklist — a distribution mechanism the scope doc does not have

`/Users/ollayor/.claude/plugins/blocklist.json` **(disk)**:

```json
{
  "fetchedAt": "2026-05-24T09:19:03.672Z",
  "plugins": [
    { "plugin": "code-review@claude-plugins-official",
      "added_at": "2026-02-11T03:16:31.424Z",
      "reason": "just-a-test",
      "text": "This is a test #5" },
    { "plugin": "fizz@testmkt-marketplace",
      "added_at": "2026-02-12T00:00:00.000Z",
      "reason": "security",
      "text": "this is a security test" }
  ]
}
```

A separately-fetched, cached revocation list keyed by `<plugin>@<marketplace>`, with a machine
`reason` (`security`, `just-a-test`) and human `text`. This is the kill switch for a plugin that
turns out to be malicious after users have installed it. Nothing in the current phase-2 plan provides
one. It is cheap — one more cached JSON blob and a check in `PluginRegistry` — and it is the only
mechanism here that can respond to a compromise faster than users notice.

### 2.7 One more sidecar

`/Users/ollayor/.codex/plugins/cache/openai-curated-remote/openai-templates/.codex-remote-plugin-install.json`
**(disk)**, sitting at the *plugin* level, above the version directories:

```json
{ "schema_version": 1,
  "remote_plugin_id": "plugin_connector_1p_2330815c823c8191941e5dc465bb899f" }
```

Per-plugin, version-independent install metadata for the first-party connector family
(`.app.json`), which the scope doc lists as a non-goal. Noted only so it is not mistaken for a
version directory during cache scanning.

---

## 3. Hooks contract

### 3.1 Every `hooks.json` on this machine

Codex-installed bundles:
```
~/.codex/hooks.json                                                        (user-level)
~/.codex/plugins/cache/superpowers-marketplace/superpowers/6.2.0/hooks/hooks.json
~/.codex/plugins/cache/superpowers-marketplace/superpowers/6.2.0/hooks/hooks-cursor.json
~/.codex/plugins/cache/superpowers-marketplace/claude-session-driver/4.0.0/hooks/hooks.json
~/.codex/plugins/cache/superpowers-marketplace/double-shot-latte/1.2.0/hooks/hooks.json
~/.codex/plugins/cache/superpowers-marketplace/episodic-memory/1.4.2/hooks/hooks.json
~/.codex/plugins/cache/superpowers-marketplace/superpowers-developing-for-claude-code/0.3.1/examples/full-featured-plugin/hooks/hooks.json
~/.codex/plugins/cache/openai-curated/figma/11c74d6b/hooks.json            (note: bundle root, not hooks/)
~/.codex/plugins/cache/vercel/vercel-plugin/<sha>/hooks/hooks.json
~/.codex/plugins/cache/plugins-cli/vercel-plugin/0.44.0/hooks/hooks.json
~/.codex/plugins/.marketplace-plugin-source-staging/marketplace-plugin-source-azqOft/hooks/{hooks.json,hooks-cursor.json}
~/.codex/.tmp/plugins/plugins/{figma,replayio}/hooks.json
```
Claude-installed:
```
~/.claude/plugins/cache/claude-plugins-official/vercel/{0.44.0,0.45.1}/hooks/hooks.json
~/.claude/plugins/marketplaces/claude-plugins-official/plugins/{claude-security,hookify,ralph-loop,security-guidance,explanatory-output-style,learning-output-style}/hooks/hooks.json
~/.claude/plugins/marketplaces/caveman/.codex/hooks.json
~/.claude/plugins/cache/caveman/caveman/25d22f864ad6/.codex/hooks.json
```
Cursor:
```
~/.cursor/hooks.json                                                       (user-level, Cursor dialect)
~/.cursor/agent-hooks.json                                                 (a third, unrelated format)
~/.cursor/plugins/cache/cursor-public/convex/<sha>/hooks.json              (Cursor dialect)
~/.cursor/plugins/cache/cursor-public/vercel/<sha>/hooks/hooks.json        (Claude dialect)
```

**Two facts about placement.** The file is normally `hooks/hooks.json`, but `openai-curated/figma`
puts it at the bundle root (`hooks.json`) and `caveman` puts it at `.codex/hooks.json` — so the path
must come from the manifest's `hooks` key, not from convention. And a bundle may ship several
dialect variants side by side (`hooks.json` + `hooks-cursor.json`, and per `~/.codex/config.toml` a
`hooks-codex.json` too); the host picks.

### 3.2 File shape (Claude/Codex dialect)

```jsonc
{
  "description": "…optional, human-readable, describes the whole file…",
  "hooks": {
    "<EventName>": [                       // array of matcher groups
      { "matcher": "<pattern>",            // optional
        "hooks": [                         // array of hook entries
          { "type": "command",
            "command": "<shell command>",
            "timeout": 10,                 // seconds
            "shell": "bash",
            "async": false,
            "statusMessage": "Loading caveman mode",
            "if": "Bash(git commit:*)",
            "asyncRewake": true,
            "rewakeMessage": "…",
            "rewakeSummary": "…" } ] } ] } }
```

Every one of those keys is observed. Sources: `timeout` in hookify and security-guidance;
`shell`/`async` in `superpowers/6.2.0/hooks/hooks.json`; `statusMessage` in
`~/.claude/plugins/marketplaces/caveman/.codex/hooks.json`; `if`, `asyncRewake`, `rewakeMessage`,
`rewakeSummary` all in
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/hooks.json`;
top-level `description` in claude-security, hookify, ralph-loop, security-guidance.

`type` is `"command"` in 100% of entries.

### 3.3 Event vocabulary

**Observed in real `hooks.json` files on this machine (disk):**

| Event | Seen in |
|---|---|
| `SessionStart` | superpowers, episodic-memory, claude-session-driver, vercel ×2, caveman, explanatory/learning-output-style, security-guidance, `~/.codex/hooks.json` |
| `SessionEnd` | claude-session-driver, vercel ×2 |
| `PreToolUse` | claude-session-driver, hookify, `~/.codex/hooks.json` |
| `PostToolUse` | figma, hookify, security-guidance, full-featured-plugin example, `~/.codex/hooks.json` |
| `UserPromptSubmit` | claude-session-driver, hookify, security-guidance, `~/.codex/hooks.json` |
| `Stop` | double-shot-latte, claude-session-driver, hookify, ralph-loop, security-guidance, `~/.codex/hooks.json` |
| `PermissionRequest` | `~/.codex/hooks.json` — **Codex-only; not a Claude Code event** |
| `UserPromptExpansion` | claude-security — fires on slash-command expansion |

**Documented but not present in any hooks file here (vendored doc):** `Notification`,
`SubagentStop`, `PreCompact`.

That is 11 events total. The scope doc lists 5.

**Cursor uses a completely different vocabulary** — camelCase, and named after operations rather than
lifecycle **(disk)**:

```json
// ~/.cursor/hooks.json
{ "version": 1,
  "hooks": { "beforeMCPExecution": [ { "command": "./save_hook_payload.sh" } ] } }
```
```json
// ~/.cursor/plugins/cache/cursor-public/convex/<sha>/hooks.json
{ "version": 1,
  "hooks": { "beforeShellExecution": [
    { "command": "./scripts/pre-commit-checks.sh", "matcher": "\\bgit\\s+commit\\b" } ] } }
```
```json
// superpowers/6.2.0/hooks/hooks-cursor.json
{ "version": 1, "hooks": { "sessionStart": [ { "command": "./hooks/run-hook.cmd session-start" } ] } }
```

Cursor: top-level `version: 1`, event names `beforeMCPExecution` / `beforeShellExecution` /
`sessionStart`, a **flat** array of `{command, matcher?}` with no nested `hooks` array and no `type`.
Atlas would need a separate parser; `hooks-cursor.json` is not a drop-in.

`~/.cursor/agent-hooks.json` is yet a third format (`{"agent_done": "<cmd>", "agent_notify": "<cmd>",
"version": 1}`) and is unrelated to plugins.

### 3.4 Matcher semantics

- Applies to `PreToolUse` / `PostToolUse` (matching **tool names**) and to `SessionStart` (matching
  the **trigger source**). Also to `UserPromptExpansion`, matching the command id.
- Regex, case-sensitive. `"*"`, `""`, or an omitted `matcher` all mean "everything".
- Real examples **(disk)**:
  - tool names: `"Write|Edit"` (figma, full-featured-plugin), `"Edit|Write|MultiEdit|NotebookEdit"`
    (security-guidance), `"Bash"` (security-guidance), `"*"` (claude-session-driver, `~/.codex/hooks.json`)
  - SessionStart sources: `"startup|resume|clear|compact"` (vercel), `"startup|clear|compact"`
    (superpowers), `"startup|resume|clear"` (episodic-memory), `"startup|resume"` (caveman)
  - command id: `"^claude-security:claude-security$"` (anchored regex, claude-security)
  - shell text, Cursor dialect: `"\\bgit\\s+commit\\b"` (convex)
- `SessionStart` sources **(vendored doc):** `startup` (fresh start), `resume`
  (`--resume`/`--continue`/`/resume`), `clear` (`/clear`), `compact` (auto or manual compact).
- A **second-level filter** exists beyond `matcher`: `"if": "Bash(git commit:*)"` on individual hook
  entries in security-guidance, using Claude Code's permission-rule syntax. Five entries in one
  `PostToolUse` group each carry a different `if` — so the group matches `Bash` and the `if`
  discriminates the actual command.

### 3.5 stdin payload

Every hook receives **one JSON object on stdin**. This is confirmed by the plugin code itself, not
just documentation. From
`/Users/ollayor/.codex/plugins/cache/vercel/vercel-plugin/<sha>/hooks/session-end-cleanup.mjs`
**(disk)**:

```js
function parseSessionEndHookInput(raw) {
  try { if (!raw.trim()) return null; return JSON.parse(raw); } catch { return null; }
}
function parseSessionIdFromStdin() {
  return normalizeSessionEndSessionId(parseSessionEndHookInput(readFileSync(0, "utf8")));
}
```

and from `double-shot-latte/1.2.0/hooks/claude-judge-continuation` **(disk)**:

```bash
EVENT=$(cat)
STOP_HOOK_ACTIVE=$(echo "$EVENT" | jq -r '.stop_hook_active // false')
TRANSCRIPT_PATH=$(echo "$EVENT" | jq -r '.transcript_path // ""')
SESSION_ID=$(echo "$EVENT" | jq -r '.session_id // "unknown"')
```

**Common fields (vendored doc, corroborated by the code above):** `session_id`, `transcript_path`,
`cwd`, `hook_event_name`.

**Per-event additions (vendored doc):**

| Event | Extra fields |
|---|---|
| `PreToolUse` | `tool_name`, `tool_input` (shape depends on the tool) |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response` |
| `UserPromptSubmit` | `prompt` |
| `Notification` | `message` |
| `Stop` / `SubagentStop` | `stop_hook_active` |
| `PreCompact` | `trigger` (`manual` \| `auto`), `custom_instructions` |
| `SessionStart` | `source` (`startup` \| `resume` \| `clear` \| `compact`) |
| `SessionEnd` | `reason` (`clear` \| `logout` \| `prompt_input_exit` \| `other`) |

Verbatim example **(vendored doc)**:

```json
{ "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-….jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path/to/file.txt", "content": "file content" },
  "tool_response": { "filePath": "/path/to/file.txt", "success": true } }
```

**Cursor's payload differs and that difference is load-bearing.** The vercel plugin's `compat.mjs`
**(disk)** is a runtime platform-detector built exactly around it:

```js
function detectPlatform(raw) {
  if ("conversation_id" in raw || "workspace_roots" in raw || "cursor_version" in raw) {
    return "cursor";
  }
  return "claude-code";
}
function normalizeInput(raw) {
  const platform = detectPlatform(raw);
  const sessionId = readString(raw.session_id ?? raw.conversation_id) ?? "";
  const cwd = readString(raw.cwd) ?? readWorkspaceRoot(raw)
    ?? process.env.CURSOR_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const hookEvent = readString(raw.hook_event_name) ?? "";
  const toolOutput = normalizeToolOutputValue(raw.tool_output ?? raw.tool_response);
  …
}
```

So: `session_id` ↔ `conversation_id`, `cwd` ↔ `workspace_roots[0]`, `tool_response` ↔ `tool_output`,
plus `cursor_version`. Its unit test asserts each mapping
(`hooks/compat.test.ts`, `test_detectPlatform_returns_cursor_when_cursor_fields_are_present`).

**Practical consequence for Atlas:** third-party hooks *sniff the host* from payload field names.
Atlas emitting Claude-shaped payloads means existing hooks work unmodified. Inventing an
Atlas-shaped payload means every one of them falls into a `claude-code` default branch and may
mis-format its output.

### 3.6 stdout / exit-code contract

Three return channels, in increasing sophistication.

**(1) Exit code (vendored doc).**

- `0` — success; stdout shown in transcript view **except** for `UserPromptSubmit` and
  `SessionStart`, where **stdout is injected into the model's context**.
- `2` — blocking error; **stderr is fed back to the model**. Per-event: `PreToolUse` blocks the tool
  call; `PostToolUse` shows stderr to the model (tool already ran); `UserPromptSubmit` blocks and
  erases the prompt (stderr to user only); `Stop`/`SubagentStop` block the stop; `Notification`,
  `PreCompact`, `SessionStart`, `SessionEnd` — user only.
- anything else — non-blocking; stderr to the user.

The bare-`echo` figma hook and the bare-`echo` caveman hook are both using channel (1): plain text
on stdout from a `SessionStart`/`PostToolUse` hook lands in context.

**(2) Common JSON fields on stdout, any event (vendored doc):**

```json
{ "continue": true,
  "stopReason": "string",
  "suppressOutput": true,
  "systemMessage": "string" }
```

`continue: false` beats every `decision: "block"`. `systemMessage` is used for real by hookify
**(disk)** — `{"systemMessage": f"Hookify import error: {e}"}` in
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/pretooluse.py`.

**(3) `hookSpecificOutput` on stdout (vendored doc, plus disk evidence for each shape):**

```json
// PreToolUse — decision control
{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "ask",
    "permissionDecisionReason": "My reason here" } }
```
`allow` bypasses the permission system entirely; `deny` blocks and the reason goes to the model;
`ask` defers to the user. The legacy `decision: "approve"|"block"` spelling maps to `allow`/`deny`
and is deprecated.

```json
// PostToolUse / UserPromptSubmit
{ "decision": "block" | undefined, "reason": "…",
  "hookSpecificOutput": { "hookEventName": "PostToolUse",
                          "additionalContext": "Additional information for Claude" } }
```

```json
// Stop / SubagentStop
{ "decision": "block" | undefined, "reason": "Must be provided when Claude is blocked from stopping" }
```

```json
// SessionStart — multiple hooks' additionalContext values are concatenated
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "…" } }
```

Live confirmation of the `Stop` shape, from `double-shot-latte/1.2.0/hooks/claude-judge-continuation`
**(disk)**:

```bash
jq -n --arg reason "Claude evaluator determined continuation is appropriate: $REASONING" \
   '{ "decision": "block", "reason": $reason }'
```
```bash
echo '{"decision": "approve", "reason": "Maximum continuation cycles reached in time window, forcing stop to prevent infinite loops"}'
```

And of the whole output-formatting matrix, from `compat.mjs` **(disk)**:

```js
function formatOutput(platform, internal) {
  if (platform === "cursor") {
    const output = {};
    if (typeof internal.additionalContext !== "undefined") output.additional_context = internal.additionalContext;
    if (typeof internal.permission !== "undefined")        output.permission = internal.permission;
    if (Object.keys(env).length > 0)                       output.env = env;
    if (typeof internal.userMessage !== "undefined")       output.user_message = internal.userMessage;
    return output;
  }
  const hookSpecificOutput = {};
  if (typeof internal.additionalContext !== "undefined") {
    if (currentHookEventName) hookSpecificOutput.hookEventName = currentHookEventName;
    hookSpecificOutput.additionalContext = internal.additionalContext;
  }
  if (typeof internal.permission !== "undefined") {
    if (currentHookEventName) hookSpecificOutput.hookEventName = currentHookEventName;
    hookSpecificOutput.permissionDecision = internal.permission;
  }
  if (Object.keys(hookSpecificOutput).length === 0) return {};
  return { hookSpecificOutput };
}
```

So the mapping is exactly:

| Meaning | Claude / Codex | Cursor |
|---|---|---|
| inject context | `hookSpecificOutput.additionalContext` | `additional_context` (top level) |
| permission verdict | `hookSpecificOutput.permissionDecision` | `permission` (top level) |
| message to user | `systemMessage` | `user_message` |
| set session env | write `export K="v"` to `$CLAUDE_ENV_FILE` | `env: {K: v}` in the JSON |

The third-party superpowers `session-start` script names a **third** dialect **(disk)** — worth
quoting because it is the clearest statement of the fragmentation, and because it documents a real
Claude Code parsing hazard:

```bash
# Cursor hooks expect additional_context (snake_case).
# Claude Code hooks expect hookSpecificOutput.additionalContext (nested).
# Copilot CLI (v1.0.11+) and others expect additionalContext (top-level, SDK standard).
# Claude Code reads BOTH additional_context and hookSpecificOutput without
# deduplication, so we must emit only the field the current platform consumes.
if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "additional_context": "%s"\n}\n' "$session_context" | cat
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context" | cat
else
  printf '{\n  "additionalContext": "%s"\n}\n' "$session_context" | cat
fi
```

Note the branch conditions: hooks discriminate on **which `*_PLUGIN_ROOT` env var is set**. An Atlas
that sets `CLAUDE_PLUGIN_ROOT` inherits Claude's output dialect for free; one that sets only
`ATLAS_PLUGIN_ROOT` falls into every plugin's `else` branch.

### 3.7 Environment variables

Observed in real hook commands and scripts **(disk)**:

| Variable | Meaning | Seen in |
|---|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | bundle root | superpowers, claude-session-driver, double-shot-latte, all 6 claude-official, cursor-public/vercel |
| `${CODEX_PLUGIN_ROOT}` | bundle root | `~/.codex/plugins/cache/vercel/vercel-plugin/<sha>/hooks/hooks.json` |
| `${CURSOR_PLUGIN_ROOT}` | bundle root | superpowers `hooks/session-start` (branch condition) |
| `${PLUGIN_ROOT}` | vendor-neutral, with fallback | episodic-memory: `node "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/cli/episodic-memory.js"` |
| `CLAUDE_PROJECT_DIR` / `CLAUDE_PROJECT_ROOT` | project root | `compat.mjs`, `inject-claude-md.mjs`, `hook-env.mjs` |
| `CURSOR_PROJECT_DIR` | project root | `compat.mjs` |
| `CLAUDE_ENV_FILE` | append-only file for exporting session env | `compat.mjs` `setSessionEnv` |
| `COPILOT_CLI` | host discriminator | superpowers `session-start` |

The `${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` idiom in episodic-memory is the ecosystem converging on a
neutral name. **Atlas should set all of `ATLAS_PLUGIN_ROOT`, `PLUGIN_ROOT`, and `CLAUDE_PLUGIN_ROOT`
to the bundle root** — anything less breaks the majority of existing hooks, and the last one is what
makes them emit the right output dialect.

`CLAUDE_ENV_FILE` deserves a decision. From `compat.mjs` **(disk)**:

```js
function setSessionEnv(platform, key, value) {
  if (platform === "cursor") { cursorSessionEnv.set(key, value); return; }
  const envFile = getEnvFilePath();       // process.env.CLAUDE_ENV_FILE
  if (!envFile) return;
  appendFileSync(envFile, `export ${key}="${escapeShellEnvValue(value)}"\n`);
}
```

A hook mutates the *session's* environment by appending shell `export` lines to a host-provided file.
That is a privilege escalation channel (a hook sets `PATH`, or `NODE_OPTIONS`, for every later
command in the session). If Atlas does not implement it, the variable is simply unset and
`setSessionEnv` no-ops — which is the safe default. Recommend not implementing it in phase 4.

### 3.8 `[hooks.state]` in `~/.codex/config.toml` — per-hook trust

This is a **per-hook approval ledger**, and it is exactly the mechanism phase 4 of the scope doc
proposes. Verbatim excerpts **(disk)**:

```toml
[hooks.state]

[hooks.state."/Users/ollayor/.codex/hooks.json:permission_request:0:0"]
trusted_hash = "sha256:f92cb639072b6970b027e4d7b32231e8494fd6e9696335f2ae9718a7ab3f3a69"

[hooks.state."vercel-plugin@plugins-cli:hooks/hooks.json:session_start:0:0"]
trusted_hash = "sha256:146eedfa10f48cfcb6d2cfb2c8fc36e8d8bb8751d2167ba205fa0b967c8a7f6e"

[hooks.state."vercel-plugin@plugins-cli:hooks/hooks.json:session_start:0:1"]
trusted_hash = "sha256:1b7bf88920f9d93c5bd508088299ba969739865da51a3043b931819328abf7d5"

[hooks.state."vercel-plugin@plugins-cli:hooks/hooks.json:session_start:0:2"]
trusted_hash = "sha256:7c0c78b3d111a81aed993357e32d997f3996cf32bbf4ab475efe9ce08772673a"

[hooks.state."claude-session-driver@superpowers-marketplace:hooks/hooks.json:pre_tool_use:0:0"]
trusted_hash = "sha256:5e45718aba81a14e79bf583ca7d36872f155f2a26603e186ec20b2abbdeef2cb"

[hooks.state."superpowers@superpowers-marketplace:hooks/hooks-codex.json:session_start:0:0"]
trusted_hash = "sha256:687e7af87f0cb59b1bcc71d368e097304b45d84999c90dc97358a22811691a3f"
```

**Key grammar:** `<origin>:<event>:<groupIndex>:<hookIndex>` where

- `<origin>` is either an **absolute path** to a user-level hooks file, or
  `<plugin>@<marketplace>:<path-relative-to-bundle-root>` for a plugin hook — the same composite
  identity used everywhere else, extended with the hooks-file path so a bundle shipping multiple
  dialect files is disambiguated;
- `<event>` is the event name **normalised to snake_case**: `session_start`, `session_end`,
  `pre_tool_use`, `post_tool_use`, `user_prompt_submit`, `stop`, `permission_request`;
- `<groupIndex>` indexes into the event's array of matcher groups, `<hookIndex>` into that group's
  `hooks` array. The three `vercel-plugin … session_start:0:{0,1,2}` rows correspond one-to-one to
  the three commands in that plugin's single `SessionStart` group.

**Value:** `trusted_hash = "sha256:<64 hex>"`. The exact preimage is **unverified** — several
plausible formulations (raw command string, with/without trailing newline, the serialised hook
object, the whole file) were computed and none matched the recorded digests. What the field *does* is
unambiguous from its shape and name: it binds approval to a specific hook's content, so that editing
the command invalidates the grant and re-prompts. That is precisely the property phase 4 needs, and
Atlas can choose its own preimage (recommend: the fully-resolved command string after
`${*_PLUGIN_ROOT}` substitution, so that moving the bundle re-triggers approval).

Feature gate, same file: `[features] hooks = true`.

**A live staleness bug, visible on this machine.** The ledger contains
`superpowers@superpowers-marketplace:hooks/hooks-codex.json:session_start:0:0`, but the installed
bundle at `~/.codex/plugins/cache/superpowers-marketplace/superpowers/6.2.0/hooks/` contains only
`hooks.json`, `hooks-cursor.json`, `run-hook.cmd`, `session-start` — **there is no
`hooks-codex.json`**. The grant survived an update that removed the file it referred to. Atlas should
garbage-collect trust rows whose origin no longer resolves, and — more importantly — must never let
a stale row satisfy a lookup for a hook that reappears later under the same index.

---

## 4. The `commands` and `agents` manifest keys

### 4.1 Where they appear

| Convention | `commands` | `agents` | Files (this machine) |
|---|---|---|---|
| `.claude-plugin/plugin.json` | yes | yes | vercel ×3, episodic-memory, superpowers-chrome |
| `.cursor-plugin/plugin.json` | yes | yes | vercel ×3, cursor-public/agent-compatibility |
| `.kimi-plugin/plugin.json` | yes | no | claude-plugins-official/vercel/0.45.1 |
| `.codex-plugin/plugin.json` | **never** | **never** | 20 manifests checked, 0 hits |
| `.plugin/plugin.json` | **never** | **never** | 5 manifests, all metadata-only |

Confirmed by enumerating every `plugin.json` across all three caches. The scope doc's observation
holds exactly.

**Two spellings.** Claude uses an **array of file paths**; Cursor uses a **directory string**. Same
bundle, two manifests **(disk)**,
`~/.codex/plugins/cache/vercel/vercel-plugin/4a6d0bef…/`:

```json
// .claude-plugin/plugin.json
{ "name": "vercel", "version": "0.44.0",
  "commands": [ "./commands/bootstrap.md", "./commands/deploy.md", "./commands/env.md",
                "./commands/marketplace.md", "./commands/status.md" ],
  "agents":   [ "./agents/ai-architect.md", "./agents/deployment-expert.md",
                "./agents/performance-optimizer.md" ] }
```
```json
// .cursor-plugin/plugin.json
{ "name": "vercel", "version": "0.44.0",
  "logo": "assets/vercel.svg",
  "skills": "skills", "agents": "agents", "commands": "commands" }
```
```json
// .codex-plugin/plugin.json  — same bundle, different identity, no commands/agents
{ "name": "vercel-plugin", "version": "0.44.0",
  "skills": "./skills/", "mcpServers": "./.mcp.json",
  "interface": { "displayName": "Vercel-plugin", "developerName": "Vercel",
                 "category": "Coding", "capabilities": ["Interactive", "Write"],
                 "websiteURL": "https://github.com/vercel/vercel-plugin" } }
```

Note in passing: **the plugin's `name` differs per convention** (`vercel` vs `vercel-plugin`) in the
same bundle. Identity is per-convention, so Atlas must fix which manifest it reads *first* and be
consistent, or the same bundle installed twice will collide with itself.

The `.commands/` directory also contains `.md.tmpl` siblings for each file — templates the plugin's
build step renders from. Only the `.md` files are referenced by the manifest; a directory-scan
implementation (Cursor's spelling) must therefore filter to `*.md` or it will load templates.

### 4.2 What a **command** actually is

A Markdown file with a one-key frontmatter (`description`) and a body of instructions, invoked by
the user as a slash command named after the file. All five vercel commands **(disk)**:

```
commands/bootstrap.md   description: Bootstrap a repository with Vercel-linked resources by running preflight checks, provisioning integrations, verifying env keys, and then executing db/dev startup commands safely.
commands/deploy.md      description: Deploy the current project to Vercel. Pass "prod" or "production" as argument to deploy to production. Default is preview deployment.
commands/env.md         description: Manage Vercel environment variables. Commands include list, pull, add, remove, and diff. …
commands/marketplace.md description: Discover and install Vercel Marketplace integrations. …
commands/status.md      description: Show the status of the current Vercel project — recent deployments, linked project info, and environment overview.
```

And there is a convention file, `commands/_conventions.md`, whose frontmatter is literally
`description: One-line summary of what the command does.` — i.e. the author's own template.

The body is prose aimed at the model, structured as a procedure. From `commands/deploy.md`
**(disk)**:

```markdown
# Deploy to Vercel

Deploy the current project to Vercel using the CLI, with preflight safety checks, explicit
production confirmation, and post-deploy verification.

## Preflight

Run these checks before any deployment. Stop on failure and print actionable guidance.

1. **CLI available?** — Confirm `vercel` is on PATH.
2. **Project linked?** — Check for `.vercel/project.json` …
```

Arguments are free-form and interpreted by the model, not parsed by the host ("Pass `prod` or
`production` as argument").

**So a command is: a user-invoked, named, parameterised prompt template.** It is *not* executable
code — it never runs; it gets pasted into the conversation.

**Equivalent in Atlas?** Partially. `src/renderer/components/CommandPalette.tsx` exists but is UI
navigation, not prompt expansion. Atlas has no user-invoked prompt-template concept today. The
closest primitive is the composer mention system (`src/shared/mentions.ts`), which open decision #3
already proposes reusing for skills.

**Assessment: commands are a genuinely new component type, and they are cheap.** They differ from
skills on exactly one axis — a skill is chosen by the *model* from a description index; a command is
chosen by the *user* by name. The loading machinery (`SkillsService`: frontmatter parse, fingerprint,
byte budget, untrusted-content fencing) is identical, and the §5 fencing requirement applies verbatim
since a command body is third-party Markdown entering context. Recommend: implement in the same pass
as skills, surfaced through mentions or a `/` prefix, with the same fencing. Do **not** treat it as a
separate subsystem.

### 4.3 What an **agent** actually is

A Markdown file whose frontmatter declares a **constrained sub-agent configuration** and whose body
is that sub-agent's system prompt. Frontmatter keys observed across the four bundles that ship
agents **(disk)**:

```yaml
# superpowers-chrome/3.0.2/agents/browser-user.md
name: browser-user
description: Analyzes web content and browser behavior using Chrome DevTools Protocol. Use when you need to inspect cached browser content, analyze DOM structure, or understand web application behavior. Read-only access - cannot create, modify, or delete files.
tools: Read, Grep, Glob, Skill, mcp__plugin_superpowers-chrome_chrome__use_browser
model: sonnet
permissionMode: default
skills: superpowers-chrome:browsing
```
```yaml
# episodic-memory/1.4.2/agents/search-conversations.md
description: Use when searching Claude Code and Codex history for information learned in past conversations …
capabilities: ["semantic-search", "conversation-synthesis", "historical-context", "pattern-recognition", "decision-archaeology"]
model: haiku
tools: Read, mcp__plugin_episodic-memory_episodic-memory__search, mcp__plugin_episodic-memory_episodic-memory__read
```
```yaml
# cursor-public/agent-compatibility/<sha>/agents/startup-review.md
name: startup-review
description: Try to bootstrap and start a repository like a cold agent, then report where the path breaks down
model: fast
readonly: true
```
```yaml
# vercel-plugin/<sha>/agents/deployment-expert.md
name: deployment-expert
description: Specializes in Vercel deployment strategies, CI/CD pipelines, preview URLs, production promotions, rollbacks, environment variables, and domain configuration. Use when troubleshooting deployments, setting up CI/CD, or optimizing the deploy pipeline.
```

Union of keys: `name`, `description`, `tools`, `model`, `permissionMode`, `skills`, `capabilities`,
`readonly`. Bodies are long system prompts — `deployment-expert.md` opens
`You are a Vercel deployment specialist. Use the diagnostic decision trees below …` followed by
several thousand words of ASCII decision trees.

**So an agent is: a named sub-agent — a separate model invocation with its own system prompt, its own
model tier, and a restricted tool allowlist.** It is delegation, not context injection. The
`description` is written in exactly the same "Use when…" register as a skill description, because it
serves the same purpose: it is what the orchestrating model reads to decide whether to delegate.

**Two hard blockers for Atlas.**

1. **Atlas has no sub-agent mechanism.** Searching `src/` for `subagent`, `spawnAgent`, `subAgent`,
   `Task tool` returns nothing. There is no second-model-invocation path, no tool-allowlist-per-
   invocation, no nested transcript rendering. `agents` is not a parsing problem; it is a
   feature Atlas does not have, of comparable size to the whole rest of phase 1.
2. **`tools:` allowlists are written against Claude Code's MCP namespacing.**
   `mcp__plugin_superpowers-chrome_chrome__use_browser` decomposes as
   `mcp__plugin_<plugin-name>_<server-key>__<tool>`. The scope doc proposes
   `<plugin>/<server-key>` → `mcp__github_github__search_issues` — **no `plugin_` infix**. Under
   Atlas's scheme every plugin-authored agent allowlist silently matches nothing, and an agent
   declared read-only would either get no tools or, worse, be run unrestricted. If Atlas ever
   implements `agents`, either adopt the `mcp__plugin_<plugin>_<server>__<tool>` form or normalise
   allowlist entries on read.

The `.kimi-plugin` manifest for superpowers shows a third vendor solving this by hand, with a
`skillInstructions` string that translates one host's tool names into another's **(disk, excerpt)**:

> "When a Superpowers skill says `Task tool (general-purpose)` or asks you to dispatch an
> implementer/reviewer subagent, use Kimi Code's `Agent` tool with a Kimi subagent type."

That file also carries `sessionStart: {"skill": "using-superpowers"}` — a declarative alternative to
a `SessionStart` hook, naming a skill to inject rather than a command to run. Strictly safer than a
hook and worth stealing if Atlas ever wants session-start injection without shipping arbitrary
command execution.

**Assessment: `agents` is out of scope for phases 2 and 4 and should stay out.** Concretely: parse
it, list the agent files in the install confirmation surface with their names and descriptions, and
show a "not supported by Atlas" badge. The alternative — silently ignoring the key — means a user
installs `superpowers-chrome` and never learns that a third of it did not load, which is the same
silent-drop failure the scope doc already rules out for skill-name collisions.

---

## 5. Summary of deltas against `docs/plugin-system.md`

| § in scope doc | Status after this research |
|---|---|
| "`policy.authentication` … not observed on disk — unverified" | **Verified**, but the token is `ON_USE`, not `ON_FIRST_USE`. `policy.installation` (`AVAILABLE`) and `policy.products` (`["CODEX"]`) also exist. |
| "Marketplace sources are git URLs, local directories, or binary-bundled" | Five concrete spellings: bare string, `local`, `url`, `git-subdir`, `github`. No npm/registry kind. |
| `strict` listed as an uninterpreted bool | Means "the bundle need not carry a manifest; the catalog entry is authoritative". Recommend rejecting `strict: false`. |
| Events: `SessionStart, SessionEnd, PreToolUse, UserPromptSubmit, Stop` | 11 events. Add `PostToolUse`, `PermissionRequest` (Codex-only), `UserPromptExpansion`, and documented-only `Notification`, `SubagentStop`, `PreCompact`. |
| `${CODEX_PLUGIN_ROOT}` | Four spellings in use; `${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` is the emerging neutral form. Hooks branch on which is set. |
| `plugin_installs UNIQUE (marketplace_id, plugin_name)` | Contradicts the per-scope install array in `installed_plugins.json`; blocks open decision #1's "global install, per-project enable". |
| `installed_at` only | Real records keep `installedAt` **and** `lastUpdated`. |
| GC "when no row references it" | Real implementations use `.in_use/<pid>` markers with `procStart`, plus a sweep watermark. Row-only GC can delete a bundle out from under a live server. |
| Staging swept at next launch | Three abandoned staging dirs from 2026-07-18 prove this is not free. |
| No blocklist | `blocklist.json` exists and is the only fast revocation path. |
| No catalog `renames` | Exists; without it, upstream renames orphan installs. |
| `mcp__<plugin>_<server>__<tool>` namespacing | Ecosystem uses `mcp__plugin_<plugin>_<server>__<tool>`; agent `tools:` allowlists depend on it. |
| Hooks "parsed and displayed, never run" in phase 1 | Correct and vindicated — `[hooks.state]`'s content-bound `trusted_hash` is exactly the phase-4 design, and the stale `hooks-codex.json` grant shows the failure mode. |
