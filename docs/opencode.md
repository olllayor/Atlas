# OpenCode in Atlas (Beta)

Atlas can hand a chat turn to [OpenCode](https://opencode.ai) instead of calling a
model API directly. OpenCode holds its own credentials, runs its own tools, and
keeps its own session history; Atlas drives it and renders what comes back —
streamed text, reasoning, tool cells, approvals, token counts.

The integration is off by default. Nothing spawns, connects, or probes until you
turn it on in Settings → Beta.

## Setup

1. Install the CLI: `brew install sst/tap/opencode` (or see opencode.ai/docs).
   Atlas needs **v1.14.19 or newer**.
2. Sign in: `opencode auth login`. Atlas never stores a model API key for
   OpenCode — the CLI owns those credentials.
3. In Atlas, open Settings → Beta → OpenCode and turn it on.
4. Press **Test connection**. A healthy install reports the version and how many
   upstream providers OpenCode has connected.
5. OpenCode's models appear in the picker under "OpenCode", addressed as
   `<provider>/<model>` (for example `opencode/claude-opus-4-7`). The catalog
   refreshes itself when you turn the integration on.

The group is badged **Agent**, because nothing stops you from also pointing an
ordinary base-URL provider at the same OpenCode server. Those two entries can
even carry the same name, and they behave nothing alike: the badged one runs
the turn inside OpenCode, with OpenCode's tools, approvals and sampling. The
other is a plain HTTP endpoint Atlas calls itself.

### Integration mode

Two transports, both under the same Beta toggle:

- **SDK server** (default) — Atlas spawns `opencode serve` on a free local port
  and drives it over the official SDK. This is the path that ships today.
- **ACP** — launches OpenCode as an Agent Client Protocol agent over stdio.
  Planned; the setting exists so the choice is a first-class one rather than a
  rewrite later.

### Using your own server

Leave **Server URL** blank and Atlas manages the server itself: one shared
`opencode serve` child per app run, reaped ten minutes after the last turn and
killed on quit.

Set a URL and Atlas connects to that server instead and never spawns anything.
If it requires a password, save it in the same section — it goes to the OS
keychain (service `atlas-chat`, account `opencode-server-password`), never to
the settings file, and the renderer only ever learns that one is stored.

## What a turn looks like

- Atlas maps the conversation to an OpenCode session and remembers it, so a
  follow-up continues the same session rather than starting over.
- The session is scoped to the project directory. Move a conversation to a
  different project and Atlas starts a fresh session — resuming would graft the
  other project's history onto the chat.
- **OpenCode runs the tools**, not Atlas. Your Atlas toolset is left behind for
  the turn and a one-line notice says so.
- **OpenCode owns sampling.** Its prompt API takes no temperature, output
  ceiling, effort level or tool choice, so Atlas' controls for those do not
  apply to an OpenCode model. Configure them in OpenCode's own config instead.
- Permission requests surface as ordinary Atlas approvals. Your decision goes
  back over the wire and the same turn continues — the request is not re-run.
- Stopping a turn aborts the OpenCode session first, then unwinds locally.

## Troubleshooting

| What you see | What it means |
|---|---|
| "OpenCode CLI (`opencode`) is not installed or not on PATH." | The binary was not found. Install it, or set an explicit binary path in Settings. |
| "OpenCode v1.13.x is too old." | Upgrade to v1.14.19 or newer; older builds lack the session API Atlas drives. |
| "macOS is blocking the OpenCode binary (quarantine attribute)." | Run `xattr -dr com.apple.quarantine` on the binary, or reinstall via Homebrew. |
| "…did not report any connected upstream providers." | The CLI is healthy but signed out. Run `opencode auth login`. |
| "OpenCode server rejected authentication." | Wrong server URL or password for a user-managed server. |
| "Couldn't reach the configured OpenCode server at …" | The URL is right but nothing is listening, or the network path is blocked. |

`pnpm tsx scripts/probe-opencode.ts` runs the same check from a terminal and
prints the raw result, which is usually faster than round-tripping the UI.

## Notes and limits

- Windows is untested; OpenCode's own guidance is to run it under WSL.
- One OpenCode configuration at a time. Two side-by-side configs would need
  instance routing, which is deliberately out of scope.
- Title and commit-message generation still go through your other providers.
