# P0 Implementation Plan: Multi-Provider Support + Store Refactor

## Context

CheapChat currently supports only OpenRouter as an AI provider. The SDK packages for OpenAI (`@ai-sdk/openai`), Google Gemini (`@ai-sdk/google`), and Anthropic (`@ai-sdk/anthropic`) are already installed but have no provider implementations. The shared types (`ProviderId`, `KeychainStore`, `SettingsRepo`) already scaffold for these providers.

The Zustand store (`useAppStore.ts`, 576 lines) is a monolith that handles all state. It needs splitting into modular slices to support multi-provider complexity and future features.

The `useChat` hook from `@ai-sdk/react` is not viable for Electron's IPC architecture. Instead, we'll refactor the existing Zustand store into clean slices with proper separation of concerns.

---

## Part 1: Multi-Provider Support

### Step 1.1 — Create `OpenAIProvider`
**File:** `src/main/ai/providers/openai.ts`

Implement `ProviderAdapter` using `@ai-sdk/openai`:

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
```

Methods:
- `validateCredential(apiKey)` — call OpenAI `/v1/models` endpoint
- `listModels(apiKey)` — fetch models, normalize to `ModelSummary[]` with `providerId: 'openai'`
- `streamChat(request)` — use `streamText` with `createOpenAI({ apiKey })`, same pattern as `OpenRouterProvider`

Model normalization logic:
- Extract `supportsVision` from model capabilities (GPT-4o, GPT-4.1 families support vision)
- Extract `supportsTools` (all GPT-4+ models support tools)
- Detect free/cheap models from pricing data

### Step 1.2 — Create `GeminiProvider`
**File:** `src/main/ai/providers/gemini.ts`

Implement `ProviderAdapter` using `@ai-sdk/google`:

```ts
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
```

Methods:
- `validateCredential(apiKey)` — call Google Generative AI list models endpoint
- `listModels(apiKey)` — fetch and normalize Gemini models
- `streamChat(request)` — use `streamText` with `createGoogleGenerativeAI({ apiKey })`

### Step 1.3 — Create `AnthropicProvider`
**File:** `src/main/ai/providers/anthropic.ts`

Implement `ProviderAdapter` using `@ai-sdk/anthropic`:

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
```

Methods:
- `validateCredential(apiKey)` — call Anthropic `/v1/models` endpoint
- `listModels(apiKey)` — fetch and normalize Anthropic models
- `streamChat(request)` — use `streamText` with `createAnthropic({ apiKey })`

### Step 1.4 — Update `contracts.ts`
**File:** `src/shared/contracts.ts`

Changes:
- `ProviderId` already includes `'openrouter' | 'openai' | 'gemini'` — add `'anthropic'`
- `RendererApi.settings` — add `saveOpenAiKey`, `validateOpenAiKey`, `saveGeminiKey`, `validateGeminiKey`, `saveAnthropicKey`, `validateAnthropicKey`
- `RendererApi.models` — add `refreshProvider(providerId)` for per-provider refresh

### Step 1.5 — Update `ipc.ts`
**File:** `src/shared/ipc.ts`

Add channels:
```ts
settingsSaveOpenAiKey: 'settings:saveOpenAiKey',
settingsValidateOpenAiKey: 'settings:validateOpenAiKey',
settingsSaveGeminiKey: 'settings:saveGeminiKey',
settingsValidateGeminiKey: 'settings:validateGeminiKey',
settingsSaveAnthropicKey: 'settings:saveAnthropicKey',
settingsValidateAnthropicKey: 'settings:validateAnthropicKey',
modelsRefreshProvider: 'models:refreshProvider',
```

### Step 1.6 — Update `keychain.ts`
**File:** `src/main/secrets/keychain.ts`

Update `ACCOUNT_NAMES`:
```ts
const ACCOUNT_NAMES: Record<ProviderId, string> = {
  openrouter: 'openrouter-api-key',
  openai: 'openai-api-key',
  gemini: 'gemini-api-key',
  anthropic: 'anthropic-api-key',
};
```

### Step 1.7 — Update `settingsRepo.ts`
**File:** `src/main/db/repositories/settingsRepo.ts`

Update `PROVIDERS` array:
```ts
const PROVIDERS: ProviderId[] = ['openrouter', 'openai', 'gemini', 'anthropic'];
```

### Step 1.8 — Refactor `ModelRegistry` to be multi-provider
**File:** `src/main/ai/core/ModelRegistry.ts`

- Change constructor to accept a `Map<ProviderId, ProviderAdapter>` instead of a single provider
- `refresh()` → iterate over all providers that have credentials, call `listModels` on each, merge results
- `refreshProvider(providerId)` → refresh a single provider's models
- `validateCredential(providerId)` → validate a specific provider's key
- `getSettingsSummary()` remains the same (already reads from `provider_credentials`)

### Step 1.9 — Refactor `ChatEngine` to be multi-provider
**File:** `src/main/ai/core/ChatEngine.ts`

- Change constructor to accept `Map<ProviderId, ProviderAdapter>` instead of single provider
- In `runRequest`, resolve provider from `request.providerId`:
  ```ts
  const provider = this.providers.get(request.providerId);
  if (!provider) throw new Error(`Unknown provider: ${request.providerId}`);
  ```
- Update `MissingCredentialError` message to reference the specific provider

### Step 1.10 — Update `main/index.ts` (wiring)
**File:** `src/main/index.ts`

```ts
import { OpenRouterProvider } from './ai/providers/openrouter';
import { OpenAIProvider } from './ai/providers/openai';
import { GeminiProvider } from './ai/providers/gemini';
import { AnthropicProvider } from './ai/providers/anthropic';

const providers = new Map<ProviderId, ProviderAdapter>([
  ['openrouter', new OpenRouterProvider()],
  ['openai', new OpenAIProvider()],
  ['gemini', new GeminiProvider()],
  ['anthropic', new AnthropicProvider()],
]);

// Sync secret presence for all providers
for (const [providerId] of providers) {
  database.settings.syncSecretPresence(providerId, Boolean(await keychain.getSecret(providerId)));
}

const modelRegistry = new ModelRegistry(database.models, database.settings, keychain, providers);
const chatEngine = new ChatEngine(database.conversations, keychain, providers);
```

### Step 1.11 — Update IPC handlers
**File:** `src/main/ipc/settings.ts`

- Add handlers for `saveOpenAiKey`, `validateOpenAiKey`, `saveGeminiKey`, `validateGeminiKey`, `saveAnthropicKey`, `validateAnthropicKey`
- Generalize validation: `validateProviderKey(providerId)` instead of hardcoded `validateOpenRouterKey`

**File:** `src/main/ipc/models.ts`

- Add `modelsRefreshProvider` handler that calls `modelRegistry.refreshProvider(providerId)`

### Step 1.12 — Update `preload/index.ts`
**File:** `src/preload/index.ts`

Add the new IPC invocations to match the updated `RendererApi` contract.

### Step 1.13 — Update `ErrorNormalizer.ts`
**File:** `src/main/ai/core/ErrorNormalizer.ts`

- Replace hardcoded "OpenRouter" strings with dynamic provider names
- Add provider-specific error message formatting

### Step 1.14 — Update `useAppStore.ts` provider handling
**File:** `src/renderer/stores/useAppStore.ts`

- Replace hardcoded `'openrouter'` provider references with dynamic provider resolution
- `sendMessage`: determine provider from selected model's `providerId`
- Add actions for saving/validating each provider's key
- `refreshModels`: support per-provider refresh

---

## Part 2: Zustand Store Refactor

### Step 2.1 — Extract `settingsSlice`
**File:** `src/renderer/stores/slices/settingsSlice.ts`

Extract from `useAppStore`:
- State: `settingsDialogOpen`, `keyDraft`, `isSavingKey`, `isValidatingKey`, `settings`
- Actions: `openSettings`, `closeSettings`, `setKeyDraft`, `saveProviderKey(providerId)`, `validateProviderKey(providerId)`, `updatePreferences`

### Step 2.2 — Extract `modelsSlice`
**File:** `src/renderer/stores/slices/modelsSlice.ts`

Extract:
- State: `models`, `isRefreshingModels`, `selectedModelIdByConversation`
- Actions: `refreshModels`, `refreshProviderModels(providerId)`, `setSelectedModel`

### Step 2.3 — Extract `conversationsSlice`
**File:** `src/renderer/stores/slices/conversationsSlice.ts`

Extract:
- State: `conversations`, `conversationDetails`, `selectedConversationId`
- Actions: `refreshConversationList`, `loadConversation`, `createConversation`

### Step 2.4 — Extract `chatSlice`
**File:** `src/renderer/stores/slices/chatSlice.ts`

Extract:
- State: `draftsByConversation`, `requestToConversation`, `notice`
- Actions: `sendMessage`, `abortConversation`, `handleStreamEvent`, `dismissNotice`

### Step 2.5 — Compose slices in `useAppStore.ts`
**File:** `src/renderer/stores/useAppStore.ts`

```ts
import { create } from 'zustand';
import { createSettingsSlice, type SettingsSlice } from './slices/settingsSlice';
import { createModelsSlice, type ModelsSlice } from './slices/modelsSlice';
import { createConversationsSlice, type ConversationsSlice } from './slices/conversationsSlice';
import { createChatSlice, type ChatSlice } from './slices/chatSlice';

type AppState = SettingsSlice & ModelsSlice & ConversationsSlice & ChatSlice & {
  bootstrapping: boolean;
  initialized: boolean;
  bootstrapError: string | null;
  bootstrap: () => Promise<void>;
};

export const useAppStore = create<AppState>()((...args) => ({
  bootstrapping: true,
  initialized: false,
  bootstrapError: null,
  bootstrap: async () => { /* combined init logic */ },
  ...createSettingsSlice(...args),
  ...createModelsSlice(...args),
  ...createConversationsSlice(...args),
  ...createChatSlice(...args),
}));
```

### Step 2.6 — Update `sendMessage` to resolve provider dynamically
Instead of hardcoding `providerId: 'openrouter'`, derive it from the selected model:

```ts
const selectedModel = state.models.find(m => m.id === modelId);
const providerId = selectedModel?.providerId ?? 'openrouter';
```

---

## Part 3: UI Updates for Multi-Provider

### Step 3.1 — Update `SettingsPanel.tsx`
**File:** `src/renderer/components/SettingsPanel.tsx`

- Add a provider tab/section system (OpenRouter, OpenAI, Gemini, Anthropic)
- Each section has its own key input, save, and validate buttons
- Show credential status per provider

### Step 3.2 — Update `OnboardingFlow.tsx`
**File:** `src/renderer/components/OnboardingFlow.tsx`

- Add provider selection step (which provider to start with)
- Adapt key input to work with the selected provider
- Show links to get keys from each provider

### Step 3.3 — Update `ModelSelector.tsx`
**File:** `src/renderer/components/ModelSelector.tsx`

- Add provider grouping/filtering in the model list
- Show provider badge on each model (e.g., "OpenAI", "Gemini", "Anthropic")

### Step 3.4 — Update `App.tsx`
**File:** `src/renderer/App.tsx`

- Replace `openRouterCredential` check with multi-provider credential check
- `hasCredential` → true if ANY provider has a valid credential

---

## Part 4: Database Migration

### Step 4.1 — Add Anthropic to provider_credentials
**File:** `src/main/db/schema.ts`

The `provider_credentials` table uses `provider_id TEXT PRIMARY KEY`, so adding `'anthropic'` is handled at runtime by `syncSecretPresence`. No schema change needed — the SettingsRepo already iterates over `PROVIDERS` and calls `getCredential()` which returns defaults for missing rows.

### Step 4.2 — Migration for existing users
Existing users have only `openrouter` credentials. The app should:
1. On boot, call `syncSecretPresence` for all 4 providers
2. Existing `openrouter` credentials are preserved
3. New providers show as `'missing'` until configured

No database migration script needed — the existing `syncSecretPresence` logic handles this.

---

## File Change Summary

### New files (8):
| File | Purpose |
|------|---------|
| `src/main/ai/providers/openai.ts` | OpenAI provider adapter |
| `src/main/ai/providers/gemini.ts` | Google Gemini provider adapter |
| `src/main/ai/providers/anthropic.ts` | Anthropic provider adapter |
| `src/renderer/stores/slices/settingsSlice.ts` | Settings state slice |
| `src/renderer/stores/slices/modelsSlice.ts` | Models state slice |
| `src/renderer/stores/slices/conversationsSlice.ts` | Conversations state slice |
| `src/renderer/stores/slices/chatSlice.ts` | Chat state slice |

### Modified files (16):
| File | Change |
|------|--------|
| `src/shared/contracts.ts` | Add `'anthropic'` to `ProviderId`, extend `RendererApi` |
| `src/shared/ipc.ts` | Add provider-specific IPC channels |
| `src/main/secrets/keychain.ts` | Add `'anthropic'` to `ACCOUNT_NAMES` |
| `src/main/db/repositories/settingsRepo.ts` | Add `'anthropic'` to `PROVIDERS` |
| `src/main/ai/core/ModelRegistry.ts` | Accept `Map<ProviderId, ProviderAdapter>`, add `refreshProvider()` |
| `src/main/ai/core/ChatEngine.ts` | Accept `Map<ProviderId, ProviderAdapter>`, resolve provider dynamically |
| `src/main/ai/core/ErrorNormalizer.ts` | Dynamic provider name in error messages |
| `src/main/ipc/settings.ts` | Add handlers for all 4 providers |
| `src/main/ipc/models.ts` | Add `refreshProvider` handler |
| `src/main/index.ts` | Wire all 4 providers |
| `src/preload/index.ts` | Add new IPC invocations |
| `src/renderer/stores/useAppStore.ts` | Compose slices, dynamic provider resolution |
| `src/renderer/components/SettingsPanel.tsx` | Multi-provider key management UI |
| `src/renderer/components/OnboardingFlow.tsx` | Provider selection step |
| `src/renderer/components/ModelSelector.tsx` | Provider badges/grouping |
| `src/renderer/App.tsx` | Multi-provider credential check |

---

## Implementation Order

1. **Phase A** — Shared types & IPC (Steps 1.4, 1.5, 1.6, 1.7)
2. **Phase B** — Provider implementations (Steps 1.1, 1.2, 1.3)
3. **Phase C** — Core engine refactor (Steps 1.8, 1.9, 1.10, 1.11, 1.12, 1.13)
4. **Phase D** — Store refactor (Steps 2.1–2.6)
5. **Phase E** — UI updates (Steps 1.14, 3.1, 3.2, 3.3, 3.4)

Each phase builds on the previous. Phases A–C can be tested by verifying OpenRouter still works after wiring changes.

---

## Verification

After each phase:
1. Run `pnpm build` to verify TypeScript compilation
2. Verify OpenRouter chat still works (regression test)
3. After Phase B: test each new provider with a real API key
4. After Phase E: verify Settings UI shows all providers, model selector shows provider badges
5. Full integration: send messages with models from different providers, verify correct provider routing
