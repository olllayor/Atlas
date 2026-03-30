Your plan is solid. The biggest shift Id make is to turn it from a desktop chat app plan into a **reliable local AI client platform** plan.

A few parts are already strong: keeping model calls in the Electron main process is the right security boundary, the AI SDK does support provider-based streaming flows, and OpenRouter has both a community provider in the AI SDK plus a free-model collection and an `openrouter/free` router now. ([AI SDK][1])

Heres the sharper version.

## What to keep

Keep Electron + React + TypeScript + Vite. That stack is still a practical Electron setup, and the electron-vite ecosystem supports React templates and native addons, which matters because `better-sqlite3` is native. ([GitHub][2])

Keep SQLite with `better-sqlite3`, but treat packaging as a first-class concern. `better-sqlite3` needs Electron rebuild handling, and native libraries in packaged apps often need to be unpacked from `asar`. ([GitHub][3])

Keep AI calls in main process. That is the right call.

## What I would change

### 1. Do not store keys in plain `config.json`

This is the biggest architectural weakness in your plan.

For a desktop BYOK app, use:

* **OS keychain/credential vault** for API keys
* local config file only for non-secret prefs like default provider, theme, model sort, streaming settings

Reason: if the apps value proposition is trust, plain JSON secrets in `~/.config/...` weakens it immediately. Even if permissions are locked down, that is still a softer target than OS-backed secret storage.

Sharper rule:

* `config.json`  preferences only
* keychain  provider secrets
* renderer never sees raw secrets

### 2. Do not make live OpenRouter free models your core dependency

Fetching the model list live is good, but basing UX on whatever is free right now is fragile. OpenRouters free catalog is real, but availability and routing can shift. ([OpenRouter][4])

Better:

* maintain a **normalized local model registry**
* hydrate it from provider APIs on refresh
* cache it with timestamps
* mark models as `available`, `rate_limited`, `disabled`, `unknown`
* keep a user-pinned favorites list

So instead of always show whats free live, use:

* cached registry on startup
* background refresh on app open / manual refresh
* degraded mode if provider metadata fails

### 3. Dont stream over ad hoc IPC events only

Your IPC sketch is directionally right, but I would formalize it into a **job/session protocol**.

Instead of:

```ts
ipcRenderer.invoke('chat:send', { model, messages })
```

Use:

```ts
chat:start -> returns requestId
chat:stream:chunk
chat:stream:meta
chat:stream:error
chat:stream:done
chat:abort
```

Why:

* supports parallel chats
* easier cancellation
* easier retry
* cleaner persistence
* avoids mixed streams when users switch conversations fast

### 4. Treat providers as adapters, not SDK setup

This is the second biggest improvement.

Your `src/main/ai/` should not just be Vercel AI SDK provider setup.
It should be:

```txt
ai/
  core/
    ChatEngine.ts
    ProviderRegistry.ts
    ModelRegistry.ts
    types.ts
  providers/
    openrouter.ts
    openai.ts
    gemini.ts
  policies/
    fallback.ts
    rateLimit.ts
    pricing.ts
```

The AI SDK is a good abstraction layer, but your app should own the higher-level contract. The SDK may simplify provider calls, but your product logic is:

* auth
* capabilities
* retries
* abort
* usage capture
* fallback
* model metadata normalization

The official AI SDK docs position it as a general TS toolkit with provider modules, and OpenRouter is exposed as a provider integration rather than the whole architecture. ([AI SDK][5])

## The architecture Id recommend

## Revised project structure

```txt
src/
  main/
    index.ts
    bootstrap/
      createWindow.ts
      security.ts
    ipc/
      chat.ts
      conversations.ts
      settings.ts
      models.ts
      diagnostics.ts
    ai/
      core/
        ChatEngine.ts
        ProviderRegistry.ts
        ModelRegistry.ts
        CapabilityMap.ts
      providers/
        openrouter.ts
        openai.ts
        gemini.ts
      policies/
        fallbackPolicy.ts
        retryPolicy.ts
        modelSelection.ts
      usage/
        usageNormalizer.ts
    db/
      client.ts
      migrations.ts
      schema.ts
      repositories/
        conversationsRepo.ts
        messagesRepo.ts
        usageRepo.ts
        settingsRepo.ts
    secrets/
      keychain.ts
    config/
      appConfig.ts
    telemetry/
      logger.ts
  preload/
    index.ts
  renderer/
    app/
    pages/
    components/
    stores/
    hooks/
    lib/
  shared/
    ipc.ts
    models.ts
    conversations.ts
    providers.ts
```

The missing piece in your original structure is **preload**. In Electron, that bridge is where you want your typed safe API exposed to the renderer rather than giving the renderer broad Electron access.

## Core domain model

You should normalize around these entities:

* **Provider**

  * id
  * displayName
  * authStatus
  * baseUrl
  * supportsStreaming
  * supportsTools
  * supportsVision
  * supportsStructuredOutput

* **Model**

  * id
  * providerId
  * label
  * contextWindow
  * inputModalities
  * outputModalities
  * freeTier
  * archived
  * rateLimitHint
  * capabilities

* **Conversation**

  * id
  * title
  * createdAt
  * updatedAt
  * defaultProviderId
  * defaultModelId
  * systemPrompt

* **Message**

  * id
  * conversationId
  * role
  * content
  * status
  * providerId
  * modelId
  * inputTokens
  * outputTokens
  * reasoningTokens nullable
  * latencyMs
  * errorCode nullable

This makes analytics, retry, export, and fallback much easier later.

## Sharper IPC contract

Use a typed contract like this:

```ts
type ChatStartRequest = {
  conversationId: string;
  providerId: string;
  modelId: string;
  messages: UiMessage[];
  temperature?: number;
  maxOutputTokens?: number;
};

type ChatStartResponse = {
  requestId: string;
};

type StreamChunkEvent = {
  requestId: string;
  delta: string;
};

type StreamMetaEvent = {
  requestId: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
};

type StreamErrorEvent = {
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
};

type StreamDoneEvent = {
  requestId: string;
  messageId: string;
};
```

That is much safer than a loose event bus.

## Database advice

SQLite is perfect here.

Use tables like:

* `conversations`
* `messages`
* `message_parts` if you want rich multimodal/tool support later
* `providers`
* `model_cache`
* `usage_events`
* `app_settings`

One good trick: store the final assistant message separately from in-progress stream state. During streaming, keep chunks in memory and flush to DB in small batches or on completion. That avoids excessive writes.

## Settings and secrets

Use a split:

**Keychain**

* OpenRouter API key
* OpenAI API key
* Gemini API key

**SQLite or JSON**

* default provider
* default model
* sidebar width
* theme
* auto-title conversations
* fetch model catalog on startup
* fallback preferences

This will feel much more professional.

## Model discovery strategy

For OpenRouter:

* fetch provider model metadata on demand or at startup
* cache results with `lastSyncedAt`
* allow filter: free only / multimodal / tools / long context
* expose a stale badge if cache is old

Because OpenRouters free-model offering changes, cached discovery plus manual refresh is better than assuming the live endpoint is always reachable or stable. ([OpenRouter][4])

## Reliability policies you should add now

This is what turns the app from hobby project into something people keep open.

### Retry policy

* retry once or twice for transient 429 / 5xx / timeouts
* jittered backoff
* no retry on auth errors

### Fallback policy

* if selected model fails, optionally fall back to:

  1. same provider, another free model
  2. users configured backup model
  3. stop and explain clearly

### Health status

Track:

* last successful call per provider
* last auth validation
* model catalog sync status

### Abort support

Every streaming request needs cancellation.

## UI pieces worth adding to the plan

Your components list is good, but Id replace `TokenTracker` with a broader `RunStatusBar`.

Better UI set:

* Sidebar
* ChatWindow
* Composer
* ModelPicker
* ProviderStatus
* RunStatusBar
* ConversationList
* SettingsDialog
* ModelCatalogSheet

`RunStatusBar` can show:

* provider
* model
* streaming state
* token usage
* latency
* fallback happened / not

That matters more than raw tokens alone.

## Security checklist

Because this is Electron, Id explicitly lock down:

* `contextIsolation: true`
* `nodeIntegration: false`
* narrow preload bridge
* no raw secret access in renderer
* sanitize markdown rendering
* disable arbitrary remote content where possible

This matters as much as the AI part.

## My rewritten version of your plan

Heres the sharper version in your style:

---

**Stack**

* Electron + React + TypeScript + Vite
* Vercel AI SDK for unified text generation and streaming across providers ([AI SDK][5])
* SQLite via `better-sqlite3` for local-first persistence; package with Electron rebuild/native-unpack handling ([GitHub][3])
* Tailwind CSS
* Zustand for UI state only

---

**Architecture**

* Renderer is a thin UI shell
* Preload exposes a typed, minimal API
* Main process owns:

  * provider clients
  * streaming orchestration
  * retries/fallbacks
  * DB writes
  * model discovery
  * secret access

---

**Secrets**

* API keys stored in OS keychain
* config file or DB stores only non-secret preferences

---

**Model System**

* Maintain normalized local model registry
* Sync provider metadata on startup/manual refresh
* Cache model list with timestamps
* Support filters: free, tools, vision, long-context
* Allow favorite/pinned models

---

**Streaming Flow**

```txt
Renderer -> chat:start
Main -> creates requestId
Main -> provider stream
Main -> emits chunk/meta/error/done events
Renderer -> updates in-progress assistant message
Renderer -> can issue chat:abort(requestId)
```

---

**Persistence**

* conversations
* messages
* usage_events
* model_cache
* app_settings

Store completed responses and normalized usage; avoid writing every token chunk directly to SQLite unless buffered.

---

**Policies**

* retry transient failures
* optional fallback model chain
* provider health indicators
* explicit error normalization across providers

---

**Priority MVP**

1. provider key setup
2. model catalog + free filter
3. streaming chat
4. conversation persistence
5. retry + abort
6. usage panel
7. export/import chats

---

My blunt opinion: your original plan is already good enough to start, but these 4 upgrades make it much sharper:

1. keychain instead of plain JSON secrets
2. preload layer explicitly included
3. requestId-based stream protocol
4. provider/model registry + fallback policies

That turns it from Electron wrapper around model APIs into a real BYOK product.

I can turn this into a **one-page technical spec** next, or into a **scaffolded folder tree with exact TypeScript interfaces**.

[1]: https://ai-sdk.dev/providers/community-providers/openrouter?utm_source=chatgpt.com "Community Providers: OpenRouter"
[2]: https://github.com/electron-vite/electron-vite-react?utm_source=chatgpt.com "Electron + Vite + React + Sass boilerplate."
[3]: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md?utm_source=chatgpt.com "better-sqlite3/docs/troubleshooting.md at master"
[4]: https://openrouter.ai/collections/free-models?utm_source=chatgpt.com "Free AI Models on OpenRouter"
[5]: https://ai-sdk.dev/docs/introduction?utm_source=chatgpt.com "AI SDK by Vercel"

