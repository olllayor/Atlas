# Local agents

A local agent is a coding CLI already installed on your machine — OpenCode,
Claude Code, Codex, Cursor, Grok, Antigravity. It holds its own credentials,
carries its own model catalog and runs its own tools; Atlas drives it and
renders what comes back.

They live in **Settings → Providers → Local agents**, separate from custom
endpoints, because they share none of an endpoint's shape: no base URL, no API
key, no model list you type by hand.

## What each row tells you

| Field | Where it comes from |
| --- | --- |
| Version | `<binary> --version`, parsed down to its first version-looking token |
| Installed | a login-shell `command -v`, so a packaged app resolves the same PATH your terminal does |
| Status dot | detection first, then whether the agent is on, then the last Test connection |

Detection is cached for ten seconds, so saving a field does not re-shell six
CLIs; changing a binary path re-checks immediately.

## Transports

Enabling an agent is only offered when Atlas can actually drive it.

- **ACP** (`claude-code`) — the agent speaks the [Agent Client
  Protocol](https://agentclientprotocol.com) over stdio. Atlas lists its models
  from the session it opens and runs turns through the shared `AcpClient`.
- **SDK** (`opencode` only) — Atlas spawns `opencode serve` and drives it over
  the official SDK, the way t3code does. Its lifecycle belongs to
  `OpenCodeController`, not to the ACP pool; see [opencode.md](./opencode.md).
- **Detect only** (`codex`, `cursor`, `grok`, `antigravity`) — no ACP endpoint
  exists, so the row shows the version and takes configuration, but the switch
  is disabled and says why. Enabling one over IPC is refused in the controller,
  not just in the UI.

Claude Code does not speak ACP itself; Zed's bridge does. Install it with
`npm install -g @zed-industries/claude-code-acp`, or point **ACP bridge
command** at your own build. Without it, Test connection says exactly that.

## Configuration

Per agent: display name, accent colour, binary path, ACP bridge command (when
one applies), launch arguments and environment variables. Launch arguments are
split like a shell would split them — `--title "my run"` is two arguments — and
environment variables are merged over the inherited environment at spawn.

Changing anything that shapes a spawn retires that agent's live ACP children,
so the next turn starts from the new configuration rather than the one already
running. Idle children are reaped after 30s, deferred while a turn is in flight.

OpenCode keeps its own settings blob (`providers.opencode`) because it predates
this list and carries fields none of the others have — server URL and a keychain
password. Its card bridges to that blob for everything that shapes a spawn;
display name and accent, which opencode has no field for, live with every other
agent's settings under `providers.localAgents`.

## Where the code lives

| Concern | File |
| --- | --- |
| Catalog + types | `src/shared/localAgents.ts` |
| Settings validator | `src/shared/localAgentsSchema.ts` |
| Detection | `src/main/ai/agents/localAgentDetection.ts` |
| Lifecycle, registry, probes | `src/main/ai/agents/localAgentController.ts` |
| ACP driver | `src/main/ai/acp/acpClient.ts`, `src/main/ai/acp/AcpAgentAdapter.ts` |
| Session cursors | `src/main/db/repositories/localAgentSessionsRepo.ts` |
| UI | `src/renderer/components/providers/LocalAgentsSection.tsx` |

Adding an agent is a catalog entry: id, label, logo id, binary, version args,
transport and (for ACP) how to start it. Everything else follows.
