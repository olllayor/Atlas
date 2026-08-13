# First-Spawn Consent for Plugin MCP Servers (2026-08-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the activation-time hole the plugin audit found: today a plugin-carried stdio server **spawns its process the moment it is activated** (skill load, `alwaysOn`, or ungated eager connect), and Atlas's approval ladder only governs tool *calls*. A malicious bundle's code can therefore run with zero prompts as long as it never calls a tool. This plan interposes a one-time consent prompt before the first spawn of each stdio server.

**Non-goals (explicit):**
- No OS-level sandboxing of stdio children (that is the follow-up: reuse `tools/sandbox/denial.ts` for `StdioClientTransport`).
- No consent for HTTP/SSE servers (no local code executes; they are covered by HTTPS-only rules and the existing per-tool-call ladder).
- No change to the tool-call approval ladder (`mcpToolNeedsApproval` stays as-is).
- No change to the install-preview dialog (capabilities are already shown there; this prompt protects the install itself, not the preview).

## Decisions (locked)

These four choices shape every task below. Defaults were chosen to match already-shipped patterns; flip any of them before implementation with a one-line edit here.

- **D1 — Consent key: `(serverId, command, hash(args + cwd))`.** Consent is recorded for a concrete command line. Changing the manifest, the resolved binary path, the arguments, or the working directory re-asks. Cheap, durable across reinstalls, and sensitive to the thing that can actually hurt the user. It does *not* detect an in-place binary swap after consent — that requires content hashing and is deferred to the OS-sandbox follow-up.
- **D2 — Persistence: SQLite.** A new `spawn_consents` table, following the `approval_requests` shape (schema.ts:238). Conversation-scoped ephemeral grants are untouched — they live in `ToolApprovalController` and are a different mechanism.
- **D3 — Prewarm semantics: skip-until-answered.** A consent-pending server is absent from this turn's tool set; the prompt surfaces asynchronously; the next turn picks it up. Mirrors the shipped invariant "activation takes effect on the next turn, not this one" (`skillTools.ts:46-49`) and keeps `prewarm`/`listTools` infallible.
- **D4 — Denial UX: deny + remember.** A denial writes a persistent `denied` row; the server refuses to spawn until the user clears the record from the plugin detail panel. A prompt that re-asks after "no" trains users to say yes.

**Architecture:** A small persistent consent registry keyed by spawn identity, consulted inside `McpClientManager` before `StdioClientTransport` construction. Denials and pending servers fail closed into the existing "server contributes zero tools" path, so a refused server behaves exactly like one that failed to start. The UI reuses the existing `tool-approval-request` → `ApprovalPrompt` round-trip, extended to carry a spawn-specific payload so the prompt shows the literal command line, args, cwd, and env keys instead of tool arguments.

**Tech Stack:** Electron main+preload+renderer, better-sqlite3, `node --import tsx --test` (NOT vitest), TypeScript.

## Global Constraints

- Tests run via `node --import tsx --test 'tests/**/*.test.ts'` from repo root. Never vitest — it reports false failures.
- The Mimosa pre-commit hook may block `git commit` over pre-existing test fixtures. If it fails, do NOT retry with `--no-verify`; leave staged, record `COMMIT_BLOCKED: <task>`.
- Do not re-implement anything already in the working tree. `git diff HEAD -- <path>` is the source of truth.

---

### Task 1: Spawn-identity helper + consent store

**Files:**
- Modify: `src/shared/mcp.ts` (add `spawnConsentKey` beside `namespaceMcpTool`; reuse its FNV-1a `hashFor` helper, which is already defined there)
- Modify: `src/main/db/schema.ts` (new `spawn_consents` table, following `approval_requests` at line 238)
- Create: `src/main/db/repositories/spawnConsentRepo.ts`
- Test: `tests/spawnConsent.test.ts`

**Interfaces:**
- Consumes: `McpServerConfig` (`id`, `command`, `args`, `cwd`) for the identity; the repo for the check.
- Produces: `spawnConsentKey(server: Pick<McpServerConfig, 'id' | 'command' | 'args' | 'cwd'>): string` and a repo with `get(key)`, `grant(key)`, `deny(key)`, `clear(key)`.

`★ Insight: the key helper must be pure and shared between the write path and the check path. If the two computed the key differently, a user could consent to one string and have it cover another.`

- [ ] **Step 1: Write the identity helper (D1)**

```ts
// in src/shared/mcp.ts
export function spawnConsentKey(
  server: Pick<McpServerConfig, 'id' | 'command' | 'args' | 'cwd'>
): string {
  // command is null for non-stdio servers; this helper is only called on the
  // stdio branch, so treat null as a programming error, not a consent case.
  const argv = [server.command, ...server.args].join('\0');
  return `${server.id}\n${hashFor(`${argv}${server.cwd ?? ''}`)}`;
}
```

- [ ] **Step 2: Create the `spawn_consents` table**

Columns: surrogate `id`, `key` (unique), `decision` (`'granted' | 'denied'`), `created_at`, `updated_at`. Index on `key`. Add the migration block alongside the existing ones, not inside an unrelated `CREATE TABLE`.

- [ ] **Step 3: Write the repo + tests**

Repo: `get(key) → 'granted' | 'denied' | null`, `grant(key)`, `deny(key)` (overwrites a grant), `clear(key)`. Tests: round-trip, deny-overwrites-grant, distinct commands produce distinct keys, null command throws.

---

### Task 2: Consent gate inside `McpClientManager`

**Files:**
- Modify: `src/main/ai/mcp/McpClientManager.ts` (add a `spawnConsent` dependency; check it in the stdio branch before `new StdioClientTransport` at line ~377)
- Test: extend coverage for "denied / pending → zero tools, manager does not throw."

`★ Insight: the gate goes in McpClientManager, not in PluginActivation, because the manager is the one place every spawn — activation, prewarm, manual connect — must pass through. Putting it at activation would miss the eager (ungated) plugin case entirely.`

- [ ] **Step 1: Inject the consent hook**

Extend the constructor with an optional `spawnConsent` object:

```ts
spawnConsent?: {
  check(server: McpServerConfig): SpawnConsentDecision; // 'granted' | 'denied' | 'pending'
  request(server: McpServerConfig): void;               // D3: fire-and-forget prompt
}
```

- [ ] **Step 2: Gate the stdio branch**

```ts
// Immediately before the StdioClientTransport construction (~line 377):
if (server.transport === 'stdio') {
  const decision = this.spawnConsent?.check(server) ?? 'granted'; // absent = headless/tests
  if (decision === 'denied' || decision === 'pending') {
    if (decision === 'pending') this.spawnConsent?.request(server);
    logger.info('mcp.spawn_consent', { serverId: server.id, decision });
    return null as never; // land on the existing "server contributes zero tools" path
  }
}
```

Do not hold the connection open waiting for an answer (D3-B: this turn proceeds without the server; the next turn gets it if the user granted).

- [ ] **Step 3: Audit the outcome**

In `mcpToolsProvider.ts`, extend the `mcp_list_tools` audit row so a server that offered zero tools because of consent records `outcome: 'consent-pending' | 'consent-denied'` with the key in `detail`. The audit log must be able to answer "why did that plugin's tools not appear?"

---

### Task 3: Consent prompt UI + IPC round-trip

**Files:**
- Modify: `src/shared/contracts.ts` (add `SpawnConsentRequest` to the approval-request contract)
- Modify: `src/renderer/components/transcript/ToolCell.tsx` (extend `ApprovalPrompt` for a `kind: 'spawn'` variant)
- Modify: wherever `tool-approval-request` chunks are translated into conversation state (`ChatSessionRuntime.ts:1324-1358`), to accept a spawn-shaped request

**Interfaces:**

```ts
export type SpawnConsentRequest = {
  kind: 'spawn';
  serverId: string;
  pluginName: string | null;
  command: string;
  args: string[];
  cwd: string | null;
  envKeys: string[]; // names only — never values
};
```

- [ ] **Step 1: Carry the spawn payload through the approval stream**

The existing `tool-approval-request` mechanism (streamCore.ts:255-284 → ChatSessionRuntime → `approval_requests` table → chat:respondToolApproval IPC) already does everything except understand a non-tool payload. Extend the chunk type to `{ kind: 'tool' | 'spawn', ... }` rather than adding a parallel channel.

- [ ] **Step 2: Render the literal command line, not prose**

Reuse the `InstallFromUrlDialog` principle (its comment lines 10-16): show `command`, `args`, `cwd`, and the env *keys* verbatim. Do not summarize the command as "run a helper" — a summary is a string the bundle could be lying about. Buttons: **Approve**, **Deny and don't ask again** (D4-C).

- [ ] **Step 3: Wire the response**

`Approve` → `grant(key)`, then optionally `activate` the conversation's plugin so the next turn picks the server up. `Deny` → `deny(key)`; record an `approval_responded` audit row as today.

---

### Task 4: Integration points (`alwaysOn`, `prewarm`, `load_skill`, detail panel)

**Files:**
- Modify: `src/main/plugins/skillTools.ts:56-57` — when `activated` is true but consent is pending, the appended sentence must say "waiting for your approval," not "connecting now." Thread a consent-aware lookup through `onLoaded`'s return, or have the store expose `pendingPluginNames(conversationId)`.
- Modify: `src/renderer/components/plugins/PluginDetailPanel.tsx` — add a "Spawn permissions" row listing granted/denied keys for this plugin with a **Revoke** button (calls `clear(key)`), only when D4-C applies (it does).
- Verify: `prewarm` needs no change — `listTools` filtering handles exclusion; add a test asserting prewarm does not throw with a pending server.

`★ Insight: prewarm stays untouched on purpose. It already funnels through listTools → toolsFor, so a consent-pending server is excluded by the gate in Task 2 with no special-casing. That is the payoff of putting the gate at the single choke point.`

---

### Task 5: Tests + dogfood

- [ ] **Step 1: Round-trip test** — fixture plugin with a stdio server; activate; answer prompt; assert row exists; rebuild the manager; assert no second prompt and the server connects.
- [ ] **Step 2: Denial test** — deny; assert zero tools from that server; re-activate in a fresh conversation; assert *no prompt* (denial persists) until `clear`.
- [ ] **Step 3: Consent-key drift test** — after granting, change the fixture's `args`; assert the next activation prompts again.
- [ ] **Step 4: Full suite** — `node --import tsx --test 'tests/**/*.test.ts'`; then commit (with the Mimosa caveat above).

---

Note for the executor of Task 1, Step 1 (3 lines that carry the whole threat model): the environment that already shipped this exact pattern is the child env allowlist in `buildMcpServerEnv` — "rebuilt, not filtered" — and this task's consent key follows the same posture: the key names exactly what was consented to, and anything not named re-asks. When you write `spawnConsentKey`, resist adding fields not in D1 (e.g. env values): consenting to a command line does not mean consenting to its secrets, and bloating the key makes re-prompts noisy.
