# Deep OpenCode Integration — Implementation Plan (t3code-method)

> Method provenance: this replicates how `pingdotgg/t3code` handles the **opencode**
> provider — the *deep* SDK/server path, not their ACP driver path. Blueprint refs
> like `t3: apps/server/src/provider/…` point into the t3code snapshot reviewed
> for this plan (cloned at `/tmp/t3code`, MIT). ACP is an explicit non-goal;
> see §10 Extension Points for where an ACP driver would slot in later.

## 0) Decision record

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Integration style = **SDK over spawned `opencode serve`** (t3code deep path), not ACP | Deep path gives pre-connect inventory (`provider.list()`), BYO remote server (`serverUrl` + password), and full SDK surface. Matches user goal "exact method that t3code did". |
| D2 | **No Effect-TS.** Port patterns (scoped closures, typed errors, capability flags) into plain TS with constructor-injected deps | Atlas has zero Effect usage; its `ProviderAdapter` impls already prove the seams pattern (see STEAL_PLAN.md 0.2). |
| D3 | Secrets (**server password**) go to **keytar**, never the settings JSON | t3code stores plaintext ("Stored in plain text on disk."). Atlas' keychain convention is `${providerId}-*` accounts under service `atlas-chat`. Strict improvement over t3code. |
| D4 | During an opencode turn, **opencode owns tool execution**; Atlas renders its tool events/approvals via the existing ToolCell / ToolApprovalController surfaces | That is exactly what t3code does (adapter normalizes native events; it never runs the tools itself). |
| D5 | New code implements the existing **`ProviderAdapter` SPI** (`src/main/ai/core/ProviderAdapter.ts`) so `ChatSessionRuntime`, transcript UI, token lens, and streaming reducers work unchanged | Keeps the blast radius small; the runtime-event vocabulary steal (STEAL_PLAN 0.2) already normalized our side. |
| D6 | Single instance (`providerId: "opencode"`), settings off by default, opt-in from Settings UI | Mirrors t3code `enabled: default false` gating ("the binding is not yet stable enough to probe on every install"). Multi-instance is deliberately deferred — t3code's instance registry exists because they have 5 drivers × N instances; we have 1 driver. |
| D7 | **Dual integration modes, user-selectable** — `integrationMode: 'server' \| 'acp'` in `OpenCodeSettings` (default `'server'`); Settings renders both options under the same Beta banner | User request post-T3: expose ACP as a peer option rather than a buried extension point. `'server'` = the deep SDK path this plan implements first (pre-connect inventory, BYO remote server). `'acp'` = stdio JSON-RPC via `opencode acp`, architected so the *same* client stack can later drive other registry agents (t3's own split: Codex/Claude/OpenCode use SDK; Cursor/Grok ship ACP-only). |

## 1) Architecture mapping (t3code → Atlas)

| t3code (blueprint) | Atlas (target) |
|---|---|
| `packages/contracts/src/settings.ts:501` `OpenCodeSettings` (Effect Schema + form annotations) | `src/shared/opencodeSettings.ts` — Zod schema `{ enabled, binaryPath?, serverUrl?, serverPassword?→keychain, customModels[] }`; form metadata kept as a tiny parallel const for the renderer |
| open branded `ProviderDriverKind` slug (`providerInstance.ts`) | Not needed — `ProviderId = string` is already open; we fix `"opencode"` |
| `apps/server/src/provider/opencodeRuntime.ts` (spawn/scoped serve, ready-line watch, CLI parsers) | `src/main/ai/providers/opencode/OpenCodeRuntime.ts` (Node `child_process`, own scope mgmt) |
| `@opencode-ai/sdk/v2` client factory + Basic auth | Same package (`^1.18.x`), thin factory in `OpenCodeClient.ts` |
| `Layers/OpenCodeProvider.ts` status probe, `MINIMUM_OPENCODE_VERSION="1.14.19"`, friendly error taxonomy | `probeOpenCode.ts` + `openCodeErrors.ts` |
| inventory flatteners (`flattenOpenCodeModels/Skills`, `parseModelsCliOutput`, `parseAgentListCliOutput`) | `inventory.ts` (models first; skills/agents stretch) |
| `Layers/OpenCodeAdapter.ts` (session scope map, event translation table, resume adopt, one-shot exit guards) | `OpenCodeAgentAdapter.ts` (per-conversation session contexts in a Map, same guards) |
| `Drivers/OpenCodeDriver.ts` maintenance/npm-brew/native-update resolvers | Deferred (§10); min-version banner only in v1 |
| `textGeneration/OpenCodeTextGeneration.ts` (commit-msg/PR/title ops) | Deviation: skip in v1 — Atlas already generates titles/commit msgs through its own providers (D-recorded). Revisit post-v1. |
| generic settings-form driven by schema annotations (`providerSettingsForm`) | Bespoke small Settings section (Atlas renders bespoke forms today) |

Sequence-cursor subscriptions, unavailable-driver shadow snapshots, and instance reconciliation are **not needed** at single-instance scale — noted in §10 as the reason t3code has them, so future-us doesn't cargo-cult them.

## 2) Phased tasks

Convention per task: **Goal → Files → Blueprint → Implementation details → Tests → Done-when.**
All new main-process code under `src/main/ai/providers/opencode/`; shared types in `src/shared/`.

---

### T0 — Contracts: settings schema + persistence

**Goal.** A validated, forward-compatible settings shape for the opencode provider.

**Files**
- NEW `src/shared/opencodeSettings.ts`
- MOD `src/shared/contracts.ts` (export re-entry)
- Persistence lands with T7 wiring (`settingsRepo` JSON blob — confirm its shape before coding).

**Blueprint.** `t3: packages/contracts/src/settings.ts:501-551`; enable-flag resolution "most restrictive wins" `t3: Layers/ProviderInstanceRegistryLive.ts:105-111`.

**Implementation details**
```ts
const OpenCodeSettingsSchema = z.object({
  enabled: z.boolean().default(false),           // D6 opt-in
  binaryPath: z.string().trim().default(''),     // '' ⇒ PATH lookup "opencode"
  serverUrl: z.string().trim().default(''),      // '' ⇒ spawn locally; validated when non-empty
  customModels: z.array(z.string()).default([])  // extra raw slugs surfaced, t3 parity
});
```
- **serverPassword never lives here** (D3): keychain account `opencode-server-password` via existing `KeychainStore` (service `atlas-chat`). Settings expose a derived `hasServerPassword` for UI.
- Defaults mirror t3code exactly (`enabled:false`, empty strings = "auto"), including UI hint semantics: `serverUrl` placeholder `http://127.0.0.1:4096`, description "Leave blank to let Atlas spawn the server when needed."
- Closed schema (unknown keys stripped + logged once) — t3code needs opaque envelopes only because it hosts forks; we don't.

**Tests** (`tests/opencodeSettings.test.ts`)
- defaults decode `{}`; bad URL rejected; password round-trips via keychain mock, absent from JSON.

**Done-when.** Schema consumed by main and renderer without Node builtins leaking into shared.

---

### T1 — Dependency + module scaffold

**Goal.** SDK installed, folder skeleton compiles behind no behavior change.

**Files**: `package.json` (+ `@opencode-ai/sdk@^1.18.23`), NEW `src/main/ai/providers/opencode/` stubs.

**Details.** t3 imports `createOpencodeClient` and types (`Model`, `Agent`, `ProviderListResponse`, part types) from the SDK's v2 subpath at pin ^1.x — verify subpath exports on install and mirror whichever entry 1.18.x ships. Expected pure-JS package (no postinstall ⇒ no `onlyBuiltDependencies` change). Renderer-safe re-exports go through `src/shared/` only.

**Done-when.** `pnpm i && pnpm build` green; smoke test resolves `createOpencodeClient`.

---

### T2 — `OpenCodeRuntime`: scoped server lifecycle

**Goal.** Own/spawn/tear down an `opencode serve` child exactly like t3code's runtime service.

**Files.** NEW `src/main/ai/providers/opencode/OpenCodeRuntime.ts`; pure parsers split into `openCodeParsers.ts`.

**Blueprint.** `t3: opencodeRuntime.ts` — constants L51-53; `parseServerUrlFromOutput` L188-197; full spawn flow L495-652; external-vs-owned connect L654-678.

**Implementation details**
- Constants verbatim: ready prefix `"opencode server listening"`; host default `127.0.0.1`; timeout `30_000ms`.
- Port: ephemeral grab via `node:net` (`listen(0)` → read port → close).
- Spawn args: `["serve", "--hostname=127.0.0.1", "--port=N"]`. Binary resolution: explicit `binaryPath` else `"opencode"` on PATH (win32: `.cmd` shim via `where.exe`, reusing Atlas' existing shell-resolution helpers).
- Env injection reproduces **t3code's fix, not their bug**: only set `OPENCODE_CONFIG_CONTENT` when caller/inherited env provides it; otherwise leave unset so the user's own opencode config (providers/models) loads. Their comment at t3 L520-528 documents the clobber bug this avoids.
- Ready detection: accumulate stdout; per-line prefix check + regex `/on\s+(https?:\/\/[^\s]+)/`; resolve on match, reject typed error on 30 s timeout or early exit (surface stderr tail like t3 does).
- Teardown ladder: POSIX group kill (`SIGTERM` → 1 s grace → `SIGKILL`); Windows `.kill()` with force-after (`taskkill /T /F` fallback). Registered on Electron `will-quit`; unexpected-exit watcher emits a notice (`opencode.serverExited`) if sessions are live.
- API (single shared server, D6):
```ts
interface OpenCodeRuntime {
  connect(input: { settings: OpenCodeSettings; env?: NodeJS.ProcessEnv }):
    Promise<{ baseUrl: string; owned: boolean }>;   // owned=false when serverUrl set
  shutdown(): Promise<void>;
}
```
- Deviation note: t3 binds server lifetime to Effect scopes per consumer; we run one long-lived serve + idle reap (10 min, configurable) — simpler for single-instance Atlas and keeps turn latency low.
- Crash policy mirrors t3's `emitUnexpectedExit`: one-shot guard flag so event-pump vs exit-watcher can't double-emit.

**Tests** (`tests/openCodeRuntime.test.ts`)
- parser matrix (ready line variants, noisy stdout, no match);
- fake-spawn harness: ready-resolve, timeout reject, TERM→KILL ordering, env passthrough rules, external short-circuit (never spawns), no lingering processes after close.

**Done-when.** Unit harness + real-machine script (T3 probe) leave zero lingering `opencode serve` processes.

---

### T3 — Client factory + status probe + error taxonomy

**Goal.** One client constructor plus a probe answering: installed? version ok? authed? how many upstream providers?

**Files.** NEW `OpenCodeClient.ts`, `probeOpenCode.ts`, `openCodeErrors.ts`; dev script `scripts/probe-opencode.ts` (style of existing one-off probes).

**Blueprint.** Client factory + Basic auth + `throwOnError:true` — `t3: opencodeRuntime.ts:680-692`. Probe, version floor, message hygiene — `t3: Layers/OpenCodeProvider.ts` (incl. `normalizeProbeMessage` trimming).

**Implementation details**
- `MIN_OPENCODE_VERSION = '1.14.19'` (same floor as t3); tiny semver-compare helper (~20 LOC; port `compareSemverVersions` semantics, no new dep).
- Auth header: `Authorization: Basic base64("opencode:<password>")`, only when keychain secret present (D3).
- Probe result shape mirrors t3 verbatim:
```ts
{ installed: boolean; version: string|null;
  status: 'ready'|'warning'|'error';
  auth: { status: 'authenticated'|'unknown' };
  connectedProviders: string[]; message?: string }
```
  with `authenticated ⇔ connectedProviders.length > 0`, and the "N upstream provider(s) connected …" copy lifted from t3.
- Error taxonomy ports t3's branches 1:1 → friendly messages: ENOENT ⇒ "OpenCode CLI (`opencode`) is not installed or not on PATH."; macOS quarantine text; external-server 401/403 ⇒ "rejected authentication. Check the server URL and password."; ECONNREFUSED/ENOTFOUND/timeout/socket-hang-up ⇒ "Couldn't reach the configured OpenCode server at <url>…"; too-old version ⇒ upgrade-to-floor message.
- Version discovery: run `<binary> --version` once per probe, parse first semver-looking token (`parseGenericCliVersion` equivalent).
- Inventory: SDK `provider.list()`; probe connects scoped (external mode) exactly like t3's `Effect.scoped` probe branch so a transient connect never leaks.

**Tests.** Error-mapping table tests; semver edge cases (prerelease tags, missing patch); happy-path probe against mocked client returning canned `ProviderListResponse`; noise-filtering (empty/whitespace messages dropped like `normalizeProbeMessage`).

**Done-when.** `pnpm tsx scripts/probe-opencode.ts` prints installed/version/status/auth against a real local opencode and exits 0.

---

### T4 — Model catalog: inventory → `modelsRepo`

**Goal.** OpenCode's upstream models appear in Atlas' model picker as ordinary `ModelSummary` rows.

**Files.** NEW `inventory.ts`; MOD `ModelRegistry.ts` (list path), `src/main/db/repositories/modelsRepo.ts` (upsert semantics if needed).

**Blueprint.** `t3: Layers/OpenCodeProvider.ts` (`flattenOpenCodeModels`, `providerModelsFromSettings(settingsModels, customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES)`); slug parsing `t3: opencodeRuntime.ts:318-335 parseOpenCodeModelSlug`.

**Implementation details**
- Composite model id convention: `<providerID>/<modelID>` under `providerId: "opencode"` (Atlas `ProviderId = string`; registry entry keyed `"opencode"`). Custom models append raw slugs (validated by the same slug parser).
- Each row: `displayName` from opencode metadata, context window + capability hints → `ModelRuntimeHints`; unknown capability fields fall back to t3's `DEFAULT_OPENCODE_MODEL_CAPABILITIES` defaults rather than zeros.
- `ProviderCapabilities` for our adapter: `{ requiresApiKeyForCatalog: false, returnsCompleteCatalog: true, catalogRequiresNetwork: true }` (opencode aggregates auth state itself; a probe-refresh *is* meaningful validation).
- The hidden `plan` agent/model handling: Atlas has no plan-mode dropdown coupling, but exclude agent-flavored pseudo-models from the picker the way t3 filters `KNOWN_HIDDEN_AGENTS` (compaction/summary/title) and hides `plan` unless relevant.

**Tests.** Flatten/cap-merge tests from canned inventory JSON (mirrors fixtures shape of t3's `opencodeRuntime.inventory.test.ts`); custom-model merge dedupe; slug rejection cases (no `/`, empty halves).

**Done-when.** With opencode installed+authed, Settings→Models refresh lists its models grouped under OpenCode; unauthed shows warning-state provider card instead.

---

### T5 — Streaming adapter: `OpenCodeAgentAdapter` (session flow)

**Goal.** A chat turn against an opencode model streams through Atlas' existing pipeline indistinguishably from an AI-SDK turn (UI-wise).

**Files.** NEW `src/main/ai/providers/opencode/OpenCodeAgentAdapter.ts` + `sessionMap.ts`; MOD `ChatSessionRuntime.ts` only for plumbing the resume-cursor persistence hook (kept minimal per STEAL_PLAN 0.2).

**Blueprint.** Session lifecycle/resume rules — `t3: Layers/OpenCodeAdapter.ts` L60-96 (`parseOpenCodeResume`, `isOpenCodeNotFound`, fresh-session fallback on confirmed miss only); text-delta normalization L736+; one-shot stop guard; usage extraction — `t3: textGeneration/OpenCodeTextGeneration.ts` run-loop patterns; permission bridging in §T6 below.

**Implementation details**
1. **Session binding (resume cursor).** Map conversationId ⇄ opencode `sessionId`, persisted via existing runtimeState repo per conversation (t3 persists resume cursor blob in thread state). Rules copied exactly:
   - resume attempt first; **only a confirmed 404-style miss** (`isOpenCodeNotFound`) silently recreates — any other failure fails the turn with typed error;
   - directory-mismatch check (`isSameOpenCodeDirectory`) — recreate when cwd changed, since opencode scopes history by session.
2. **Turn send.** Latest user turn (and bounded tail) mapped to prompt parts: text parts + attachments resolved to file parts (path resolution like Atlas' attachmentStore/t3's resolveAttachmentPath); system prompts stay Atlas-side-injected into the prompt text header (documented; opencode owns AGENTS.md etc.).
3. **Event pump → SPI callbacks.** Subscribe to SDK event stream; translate:
   - assistant text part deltas → `onChunk`;
   - reasoning part deltas → `onReasoningChunk`;
   - tool part input-ready/delta/output/denied/error → `onToolInputStart/Delta/Available/OutputAvailable/Denied/Error` (title/toolName passthrough keeps ToolCell rendering intact);
   - step-start/finish tokens → usage accounting (inputTokens/outputTokens/reasoningTokens/**cachedInputTokens** — absent stays absent, never coerced 0, matching `ProviderStreamResult` doc);
   - final session idle/step-count ⇒ stream result completion.
4. **Abort/interrupt.** AbortSignal → SDK `session.abort({ sessionID })` then scope close; mirrors t3's abort ordering (abort API best-effort, always teardown local scope).
5. **Model switch mid-session.** If requested composite slug ≠ session's current model → `setSessionModel` (capability flag pattern from t3's `applyGrokAcpModelSelection` generalized: no-op when equal, error surfaced otherwise).
6. **Errors** normalize through existing `ErrorNormalizer` (timeouts, offline, HTTP status mapping) so the retry/offline UX matches other providers.

**Tests.** Mocked SDK client scripted scenario: happy turn (text deltas sequence), resume-after-restart (404 ⇒ recreate), directory-change recreation, tool-part translation table, abort ladder, usage presence/absence matrix. These are pure fakes — same style as t3's adapter test suite which runs without a real server.

**Done-when.** Manual e2e: conversation using an opencode model shows streamed text, reasoning trace, tool cells, token lens, revert/checkpoint interplay unchanged.

---

### T6 — Approvals & permissions bridging

**Goal.** Opencode's permission requests surface as Atlas approval checkpoints; decisions route back.

**Files.** NEW `permissions.ts`; MOD nothing in ToolApprovalController (consume its existing request API).

**Blueprint.** `t3: Layers/OpenCodeAdapter.ts` permission-request handling + decision mapping — `t3: provider/acp/AcpAdapterSupport.ts acpPermissionOutcome` shows their decision vocabulary; SDK shapes come from the `session/*` API used throughout the adapter.

**Implementation details**
- Incoming permission request → `onToolApprovalRequested({ approvalId, toolCallId, toolName, reason })` (SPI already has this event).
- Decision mapping table: Atlas' approve/deny + optional "always allow" → opencode respond semantics; record audit through existing McpAuditLog-style tool execution rows so Review mode inspects them like local tools.
- Timeout/no-decision ⇒ deny-with-reason propagated as tool-denied part (never hangs the turn).

**Tests.** Mapping-table tests both directions incl. duplicate-decision race (second resolve is a no-op — t3's one-shot guard pattern).

**Done-when.** e2e: agent file-write prompts Atlas approval overlay; approve lets opencode proceed; deny returns a clean denied tool cell.

---

### T7 — Registry & lifecycle wiring + IPC

**Goal.** Adapter registered when enabled; probe reachable from settings IPC; zero cost when disabled.

**Files.** MOD `src/main/index.ts` bootstrap, `src/main/ipc/settings.ts` (+ new channels in `src/shared/ipc.ts`, preload mirror), NEW `openCodeController.ts` gluing settings↔runtime↔registry, persistence via `settingsRepo` shape confirmed at T0.

**Details**
- Registration mirrors t3's hydration contract: disabled ⇒ adapter absent from `ProviderRegistry` and *nothing probes* (t3's rationale verbatim); enable toggle ⇒ lazy construct runtime+client on first need.
- New IPC: `settingsOpenCodeProbe()` returning T3's probe result; `settingsOpenCodeSetPassword(secret)` / clear (keytar behind preload like other keys); test-connection button consumes probe.
- Quit path: `will-quit` → `runtime.shutdown()`.
- Notice channel reuses existing notice plumbing for server-crash/status toasts.

**Tests.** Controller unit tests with fake repos/keychain/spawner: enable→probe→register sequence; disable unregisters + shuts down; password set/clear round-trip; probe error surfaces verbatim message over IPC mock.

**Done-when.** App boots with feature dark (no spawns, no registry entry); enabling via Settings wires everything without restart beyond model refresh.

---

### T8 — Renderer: Settings UI + model picker

**Goal.** OpenCode appears in Settings with a test-connection card; its models render under their own group.

**Files.** NEW `src/renderer/components/settings/OpenCodeSettingsSection.tsx`; MOD settings page assembly + model picker grouping; icon asset (opencode.svg fetched from ACP registry CDN is MIT'd project icon — or draw minimal inline SVG).

**Details**
- Form fields in t3's order (`binaryPath`, `serverUrl`, `serverPassword`) with their exact placeholder/description copy adapted ("Leave blank to let Atlas spawn the server when needed.").
- **Integration mode selector (D7)**: segmented control `SDK server (recommended)` / `ACP (beta)`. Switching modes swaps the *visible* sub-form: `server` ⇒ binaryPath/serverUrl/password + probe card; `acp` ⇒ binaryPath + note that auth uses OpenCode's own `auth login` and that the session launches via `opencode acp`. Both share the single `enabled` Beta toggle.
- Status card states rendered from probe result: not-installed / too-old (with floor version) / connected-N-providers / auth-warning / unreachable-URL. Version advisory = same "too old" UX as t3's snapshot enrichment.
- Password field uses type=password, `clearWhenEmpty` semantics; stored via IPC only.
- Model picker: group label "OpenCode"; composite ids hidden from display (show modelID), tooltip shows full slug.

**Tests.** uiPreview fixture addition (scripted states); component smoke tests for status-card branching.

**Done-when.** Every probe state reachable in preview fixtures without an opencode install.

---

### T9 — Docs, QA matrix, rollout polish

- README feature bullet + docs page (`docs/opencode.md`) covering: install opencode, `opencode auth login`, optional remote server mode, troubleshooting table mirroring T3 error copy.
- Manual QA matrix: macOS spawn/kill; external server mode w/ wrong password (friendly error); WSL caveat documented for Windows (per opencode's own guidance); app-quit leaves no processes; offline behavior mid-turn.
- Release note + changelog entry.

## 2b) Status (all phases built)

| Task | Commit | State |
|---|---|---|
| T0 settings schema + persistence | `c699caf` | done |
| T1 SDK dependency | `83ec036` | done |
| T2 `OpenCodeRuntime` | `d9a5571` | done |
| T3 client, probe, error taxonomy | `8ec3700` | done |
| D7 dual integration modes | `1c89985` | done |
| T4 inventory to `ModelSummary` | `f91be0a` | done |
| T5 streaming adapter | `2006246` | done |
| T6 approvals bridge | `d7067fa` | done |
| T7 controller, IPC, boot wiring | `4bafd79` | done |
| T8 picker + Settings card | `d2de590`, `9799f50` | done |
| T9 docs | `fc2609f` | done |
| T10 ACP transport | — | planned (§7) |

### What the live server actually does (opencode 1.18.23)

Verified with `scripts/e2e-opencode-turn.ts` against a real `opencode serve`,
free model, two turns on one conversation:

1. **Only the legacy event vocabulary fires.** No `session.next.*` at all.
   Both families are supported and the translator latches onto whichever
   speaks first, so a future switch needs no change.
2. **The user's own message parts are echoed back over the same stream.**
   Rendering them replayed the prompt as the answer. Parts are now filtered by
   message role, learned from `message.updated`.
3. **A reasoning part's deltas also carry `field: "text"`.** Routing by field
   name streamed the model's thinking into the answer. Deltas now route by the
   part kind learned from the preceding `message.part.updated`.
4. **`tokens.input` excludes cache reads** (turn 2: `input 76`, `cache.read
   22336`, `total 22429`). Atlas reports `inputTokens = input + cache.read`
   with `cachedInputTokens = cache.read`, which matches its own contract.
5. Session resume across turns works, and `GET /provider` answers
   `{ all, default, connected }` — not the `providers` map the first client
   draft assumed.

### Deviations from the plan as written

- **Approvals do not re-run the turn.** Atlas' AI-SDK path answers an approval
  by restarting the request with an approval message; an opencode turn is still
  open server-side waiting for a reply. `ProviderAdapter.resolveApproval` is the
  seam: adapters that own their tools answer mid-turn and keep streaming.
- **`ProviderStreamRequest.agentContext`** was added (conversation id +
  workspace root). The SPI carried neither, and session resume needs both.
- **Resume cursor lives in its own table** (`opencode_sessions`), not in the
  settings blob: it is per conversation and cascades on delete.
- **Sampling is delegated, not mapped.** `session/prompt` carries no
  temperature, output ceiling, effort or tool choice, so §T5.5's parameter
  mapping has nothing to map onto. The catalog reports
  `supportsTemperature: false` and no effort ladder so the UI stops offering
  controls that cannot reach the model.
- **Context-less calls use a scratch session.** Title and summary generation
  reach the adapter without an `agentContext`; each creates a session and
  deletes it afterwards rather than accumulating junk in opencode's history.

## 3) Test strategy summary

Atlas runner: `pnpm test` = `node --import tsx --test tests/*.test.ts`. All new suites are **pure-fake based** (t3 does the same — its adapter suite never boots a real server):
- parsers/slug/semver/error-taxonomy → pure tables;
- runtime lifecycle → EventEmitter fake child;
- adapter translation → scripted mock client;
- controller → fake repos/keychain/spawner.
Plus one real-machine script `scripts/probe-opencode.ts` and manual e2e checklist (T9).

## 4) Risks & lessons copied from t3code's scars

| Risk | Mitigation (provenance) |
|---|---|
| Clobbering user's opencode config env | Only set `OPENCODE_CONFIG_CONTENT` when inherited (t3 fix comment L520-528) |
| Orphaned `serve` processes | Group-kill ladder + will-quit shutdown + crash watcher |
| Silent session recreation hiding errors | Recreate only on confirmed 404-class miss (t3 L86-96) |
| Fake 0% cache rate | Never coerce absent cached-tokens to 0 (`ProviderStreamResult` contract) |
| Duplicate exit/approval events | One-shot ref guard pattern throughout adapter |
| Plaintext secrets | Keychain instead of settings file (improvement over t3) |
| Version drift vs SDK | Pin floor 1.14.19 now; SDK ^1.18.x; probe warns below floor |

## 5) Effort ordering (S/M/L)

T0 S · T1 S · T2 M · T3 M · T4 M · T5 L · T6 M · T7 M · T8 M · T9 S
Critical path: **T0→T1→T2→T3→T5**; T4/T6 can parallelize after T3; T7 before T5's e2e acceptance but after T2+T3 compile-green.

## 6) Blueprint appendix — files referenced from t3code

```
packages/contracts/src/settings.ts            OpenCodeSettings schema          L501-551
packages/contracts/src/providerInstance.ts    driver-kind philosophy           module doc
packages/contracts/src/providerRuntime.ts     RuntimeEventRaw vocabulary       L22-40
apps/server/src/provider/opencodeRuntime.ts   runtime service                  L51-197,495-692
apps/server/src/provider/Layers/OpenCodeProvider.ts   probe/status/auth         whole file
apps/server/src/provider/Layers/OpenCodeAdapter.ts    sessions/events/resume    L60-146,580-745
apps/server/src/provider/builtInDrivers.ts    registration pattern             whole file
apps/server/src/server.ts                     composition root                 L370-424
apps/web/src/components/settings/providerDriverMeta.ts client definitions      L37-90
```

## 7) Dual-mode roadmap (updated after D7)

### Shipped foundation (T0–T3, commits dffbcf2…8ec3700)
`integrationMode` is already part of `OpenCodeSettings` (default `'server'`, validated enum, persisted) — the Settings selector and both transports plug into an existing typed contract, not an afterthought.

### T10 — ACP transport behind `integrationMode: 'acp'` (planned, L)
Mirror of t3's `provider/acp/*` + `packages/effect-acp`, ported to plain TS (D2):
1. **`acp/protocol.ts`** — minimal JSON-RPC-over-stdio framing + method types (initialize, session/new, session/load, session/prompt, session/update, session/request_permission, fs read/write/text_file). Only the methods opencode's ACP server exercises; keep the module generic so future registry agents reuse it.
2. **`acp/AcpConnection.ts`** — spawn `{ command: binaryPath || 'opencode', args: ['acp'] }`, length-prefixed/LSP-style framing per ACP spec, request/response correlation, notification pump, scope-owned teardown (reuse OpenCodeRuntime's ladder patterns).
3. **`acp/OpenCodeAcpAdapter.ts`** — same SPI implementation as T5's server adapter; the T5 event-translation layer is written transport-agnostic precisely so this file stays thin (session setup ↔ `onTool*`/`onChunk`, permission bridging shared with T6).
4. **Probe for acp mode** — binary/version floor only (no server to list); auth surfaces from the `initialize` response's `authMethods` on first connect; Settings card copy: "Launches OpenCode as an ACP agent; sign in with `opencode auth login`."
5. **Tests** — scripted stdio fake-child harness (same FakeChild pattern as T2/T5); fixture transcript of a full ACP session exchange.
6. **Follow-on win** — `acp/registry.ts` client for `cdn.agentclientprotocol.com/registry/v1` to later install/launch *any* registry agent (Claude Agent, Codex, Gemini CLI…) with the same stack; out of scope until T10 ships.

### Previously-deferred items (unchanged)
2. **Auto-update resolver** (npm/homebrew/native `opencode upgrade` triple like t3's maintenance resolvers) — needs T3 probe groundwork already done here.
3. **Multi-instance** (two opencode configs side-by-side): requires adopting t3's instance-id routing; single D6 keeps us out of that complexity until demanded.






