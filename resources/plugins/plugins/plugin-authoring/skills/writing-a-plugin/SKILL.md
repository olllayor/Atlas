---
name: writing-a-plugin
description: "Create a plugin bundle — the manifest, where components live, and how to install it locally. Use when the user wants to build, scaffold, or package a plugin."
---

# Writing a plugin

A plugin is a directory with a manifest and, beside it, some combination of
skills, MCP servers, and hooks. The manifest is the only required file.

## Layout

```
my-plugin/
├── .atlas-plugin/plugin.json   # the manifest — required
├── skills/<name>/SKILL.md      # instructions, loaded on demand
├── .mcp.json                   # MCP servers
├── hooks.json                  # lifecycle commands (Atlas does not run these)
└── assets/                     # icon, logo
```

`.atlas-plugin/` is Atlas's own directory and the one to use for a plugin meant
for Atlas. Use `.plugin/` instead if you want the same bundle to work in other
agents too — it is the vendor-neutral spelling and Atlas prefers it over any
other vendor's.

`.codex-plugin/`, `.claude-plugin/`, `.cursor-plugin/` and `.kimi-plugin/` are
also read, so a bundle written for another agent installs here unchanged. You
need none of them to write one.

Component directories are found by convention. A path in the manifest **adds
to** the conventional location rather than replacing it, so a bundle that
declares `"skills": "./extra/"` still has `./skills/` scanned.

## The manifest

Three fields are required. Everything else is optional.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin is for.",
  "author": { "name": "You" },
  "license": "MIT",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "My Plugin",
    "shortDescription": "Shown under the name",
    "category": "Developer Tools",
    "logo": "./assets/logo.png"
  }
}
```

`name` is the plugin's identity. It qualifies every skill (`my-plugin:my-skill`)
and every MCP server, so keep it kebab-case with no spaces or separators.

`interface` is presentation only. Nothing in it decides behaviour — the install
summary a user sees is built from resolved commands and paths, never from
strings the manifest author wrote.

## The `atlas` block

Everything above is a format several agents share. `atlas` is the part only
Atlas reads, and it exists because the shared format has no vocabulary for the
things that decide whether a plugin fits *here*.

```json
{
  "atlas": {
    "workspaceModes": ["code"],
    "requiresProject": true,
    "minAppVersion": "0.2.0"
  }
}
```

- **`workspaceModes`** — `"code"`, `"work"`, or both. Omit it and the plugin
  applies everywhere. A code-only plugin is left out of a work session's skill
  index entirely, so it costs nothing there rather than costing a line every
  turn and the occasional wrong pick.
- **`requiresProject`** — the plugin is meaningless without a project folder. Its
  skills are withheld from a chat with none attached, instead of being offered
  and then failing on nothing to act on.
- **`minAppVersion`** — the oldest Atlas that understands the bundle. An older
  build refuses it outright and says so, rather than loading it without the
  parts you relied on.

Withholding is about cost, not permission. A skill left out of the index is
still loadable by name, so a user who asks for it by name still gets it.

Declare none of this and nothing changes — the block is how a plugin says
something more precise, never a requirement for saying anything.

## Declaring MCP servers

`.mcp.json` takes either transport:

```json
{
  "mcpServers": {
    "my-service": {
      "command": "npx",
      "args": ["-y", "@myorg/my-mcp-server"],
      "env_vars": ["HOME"]
    },
    "my-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "bearer_token_env_var": "MY_API_TOKEN"
    }
  }
}
```

Rules worth knowing before you debug them:

- A `command` containing a separator is a path **inside the bundle** and is
  resolved against the bundle root. A bare name like `npx` is resolved through
  `PATH`.
- A stdio server with no `cwd` runs with the bundle root as its working
  directory, so relative arguments like `./cli/server.js` resolve.
- `env_vars` lists variables forwarded from the host. Everything else is
  cleared — a spawned server does not inherit the app's environment.
- `bearer_token_env_var` names a variable; never put the token itself in a
  manifest you are going to commit.

## Installing it

Open **Plugins** and choose **Install**, then pick the bundle directory. Atlas
copies it, validates what actually landed, and publishes it with one atomic
rename.

A bundle may contain symlinks — an npm-installed plugin has them under
`node_modules/.bin` — but they must point inside the bundle. A link out is
refused, because it names a file the install review never covered.

## Publishing it

A marketplace is a directory or git repository with one catalogue file:

```json
{
  "name": "my-marketplace",
  "interface": { "displayName": "My Plugins" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": { "source": "local", "path": "./plugins/my-plugin" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

Put it at `.atlas/plugins/marketplace.json` in the repository root, or
`.agents/plugins/marketplace.json` for a catalogue meant to serve several
agents. `.claude-plugin/marketplace.json` is read too, for catalogues written
elsewhere.

For a plugin hosted in another repository, use a pinned source so what installs
is what you reviewed:

```json
{ "source": "git-subdir", "url": "https://github.com/you/repo.git",
  "path": "plugins/my-plugin", "ref": "v1.0.0", "sha": "<full commit sha>" }
```

Without a `sha` the entry installs whatever the branch points at that day, and
the UI labels it *unpinned*.
