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

- **ACP** (`antigravity`) — Google's official Antigravity ACP agent over
  stdio, installed and driven the way t3code does (see *Antigravity* below).
- **SDK** (`opencode`, `claude-code`) — driven over their official SDKs
  directly. opencode's lifecycle belongs to `OpenCodeController`, not to the
  ACP pool; see [opencode.md](./opencode.md).
- **Detect only** (`codex`, `cursor`, `grok`) — no ACP endpoint exists, so the
  row shows the version and takes configuration, but the switch is disabled
  and says why. Enabling one over IPC is refused in the controller, not just
  in the UI.

Claude Code runs over its official Agent SDK (`@anthropic-ai/claude-agent-sdk`)
— no bridge package needed. Sign in with `claude login`; **Home path** isolates
its config via `CLAUDE_CONFIG_DIR` without moving `HOME` (which would hide the
macOS keychain credentials). Skills in `<config>/skills` and
`<cwd>/.claude/skills` are discovered per turn, and `$skill` mentions dispatch
to native `/skill` invocations.

## Antigravity

Google ships an official Antigravity agent on the ACP registry, but it has no
CLI, no npm package and no login command — so Atlas installs and signs it in
the way t3code PR #9348 does:

1. **Enable Antigravity in Settings**, then click **Install**. Atlas downloads
   the official archive from Google, checks its SHA-256, extracts the
   executable pair and validates it with an ACP `initialize` call. Progress
   streams to the card. There is no Intel Mac build on the registry; the card
   says so instead of failing a download.
2. **Sign in with Google** and complete consent. On the host machine the
   loopback redirect finishes on its own. From a phone or another computer,
   paste the failed `127.0.0.1` redirect URL into the setup card.
3. Pick a Gemini model and chat. Google returns every Gemini generation the
   account can use; only the Gemini 3.8 Flash trio counts as current and the
   rest fold under Legacy. New threads start on 3.8 Flash (High).

The **sign-in method** selects `Google account` (default), `Gemini
Enterprise`, `Gemini API key` or `Agent Platform`. API keys live in the OS
keychain and the GCP project/location in settings; Atlas never falls back
from the method you pick. Each install gets its own `GEMINI_HOME` profile
with file token storage, ambient `GOOGLE_*` variables are stripped, and a
controlled `BROWSER` helper stops the agent opening a browser on the host.

Turns map Atlas permission modes onto the agent's `default`, `auto_edit` and
`yolo` modes, route the agent's `interaction_*` questions through approvals,
and send audio attachments (wav, mp3, m4a, ogg, flac, webm) as native audio
blocks. Agent file edits arrive as file-change approvals, so Supervised and
Auto-accept behave like other providers. Sign out, cancel, retry and **Remove
downloaded runtime** share the same card.

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
| Antigravity runtime | `src/main/ai/providers/antigravity/` (release table, managed install, auth, protocol, models) |
| Antigravity IPC | `src/main/ipc/antigravity.ts` |
| Session cursors | `src/main/db/repositories/localAgentSessionsRepo.ts` |
| UI | `src/renderer/components/providers/LocalAgentsSection.tsx` |

Adding an agent is a catalog entry: id, label, logo id, binary, version args,
transport and (for ACP) how to start it. Everything else follows.
