# Atlas

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/olllayor/Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/olllayor/Atlas/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/olllayor/Atlas)](https://github.com/olllayor/Atlas/releases/latest)

Atlas is a local-first desktop chat client for BYOK AI interactions. Save your API keys once, browse cached model catalogs, pick models manually, chat with streaming responses, and keep your conversation history on your machine.

This repository is open source. The core app scaffold is in place and production builds work. Development startup still has an unresolved Electron runtime issue in this environment, so the project should currently be treated as an early OSS codebase rather than a polished public release.

## What it does

- **Multi-provider BYOK flow** — OpenRouter, Google GLM, and extensible provider architecture
- **OS keychain storage** — API keys secured via `keytar` in system keychain
- **Cached model catalog** — Local SQLite storage with free-model filtering, vision/tool support detection
- **Streaming chat responses** — Real-time text streaming from Electron main process
- **Tool calling** — Built-in local tools: file read, grep search, glob search, web search, web fetch, bash execution, model catalog search
- **Visual rendering** — Markdown, code blocks with syntax highlighting, Mermaid diagrams, Math equations, iframes
- **Reasoning support** — Expose model reasoning tokens for supported models
- **Conversation management** — Local SQLite persistence for conversations and messages with full history
- **Abort support** — Cancel in-flight requests
- **Security-oriented Electron architecture** — Typed preload bridge, renderer doesn't access secrets

## Stack

- Electron
- React
- TypeScript
- Vite / electron-vite
- Zustand
- Tailwind CSS
- better-sqlite3
- keytar
- Vercel AI SDK

## Current status

- `pnpm build` passes
- The main app architecture and UI flow are implemented
- Multi-provider support (OpenRouter, GLM) with extensible architecture
- Tool calling with built-in local tools
- Visual rendering (markdown, code, diagrams, math, iframes)
- Full conversation persistence in SQLite
- `pnpm dev` is not stable yet in this environment because of an Electron module-resolution/runtime mismatch during startup

If you want to contribute, the highest-value first task is fixing the dev runner so the local development loop matches the build output cleanly.

## Getting started

### Requirements

- Node.js `>= 22`
- `pnpm`
- macOS, Linux, or Windows with native build tooling required by `better-sqlite3` and `keytar`

### Install

```bash
pnpm install
```

### Run in development

```bash
pnpm dev
```

Known issue as of April 7, 2026: this currently fails in this environment during Electron startup. See the notes in this README and the source for the current runtime wiring.

### Build

```bash
pnpm build
```

## Installing on macOS

Atlas is distributed as an unsigned DMG via GitHub Releases. macOS will warn you because the app has not been notarized with an Apple Developer account. Here is how to install it.

### Download

1. Go to [Releases](https://github.com/olllayor/Atlas/releases)
2. Download the DMG matching your Mac:
   - `Atlas-*-arm64.dmg` — Apple Silicon (M1/M2/M3/M4)
   - `Atlas-*-x64.dmg` — Intel Macs
3. Open the DMG and drag Atlas to your Applications folder

### Bypassing the "unidentified developer" warning

The first time you open Atlas, macOS will block it with one of these messages:

- **"Atlas can't be opened because it is from an unidentified developer"**
- **"Atlas is damaged and can't be opened. You should move it to the Trash"**

Both are expected for unsigned apps. To bypass them:

**Method 1 — System Settings**

1. Open **System Settings** → **Privacy & Security**
2. Scroll to the Security section
3. You should see a message: *"Atlas was blocked from use because it is not from an identified developer"*
4. Click **Open Anyway**
5. Confirm by clicking **Open** in the dialog

**Method 2 — Terminal (if Method 1 doesn't show the button)**

```bash
xattr -d com.apple.quarantine /Applications/Atlas.app
```

This removes the quarantine flag that triggers the warning. You only need to do this once.

**Method 3 — Right-click open**

1. Right-click (or Control-click) on Atlas.app
2. Select **Open** from the context menu
3. Click **Open** in the confirmation dialog

This method sometimes works for the "unidentified developer" warning but not for the "damaged" warning — use the `xattr` command above if you see "damaged."

### Why is this necessary?

Apple requires developers to pay $99/year for a Developer Program membership to sign and notarize apps. Atlas is an open-source personal project without a paid Apple account. The app is safe — you can review the source code and build it yourself from this repository.

## Product scope

Atlas v1 is intentionally small:

- single-user desktop app
- local-only storage
- manual model selection

Out of scope for v1:

- accounts or cloud sync
- multi-device sync
- automatic provider routing
- hosted backend services

## Roadmap

### Providers

- [x] OpenRouter — API key support
- [x] Google GLM — API key support
- [ ] OpenAI — API key + CLI OAuth login
- [ ] Google Gemini — API key + CLI OAuth login
- [ ] Anthropic Claude — API key support
- [ ] Multi-provider fallback — auto-failover between configured providers
- [ ] Provider health dashboard — per-provider status, last successful call, rate-limit indicators

### AI capabilities (powered by Vercel AI SDK)

- [x] Tool / function calling — model tool use with local tool execution (web search, file read, code exec)
- [ ] Structured output — JSON mode for models that support it (`generateObject` / `streamObject`)
- [x] Reasoning / thinking — expose model reasoning tokens for supported models
- [x] Image input / vision — drag-and-drop images into the composer (multi-modal messages)
- [ ] Prompt templates — save and reuse common prompt patterns
- [ ] Auto-title conversations — generate titles from first message
- [ ] Model comparison — send the same prompt to multiple models side by side
- [ ] Streaming resume — reconnect and resume interrupted streams

### UI/UX

- [x] Keyboard shortcuts — quick model switch, new chat, search, settings
- [x] Code block copy button — one-click copy on rendered code blocks
- [x] Syntax highlighting — language-specific code highlighting
- [ ] Conversation search — full-text search across message history
- [ ] Message editing — edit and regenerate assistant responses
- [ ] Branch conversations — fork a conversation at any message
- [ ] Conversation export — Markdown, JSON, and PDF export per conversation
- [ ] Import conversations — restore from exported files
- [ ] Custom system prompts — per-conversation or global default
- [ ] Theme support — light mode, custom accent colors
- [ ] Window management — remember window size, position, sidebar state

### Core features

- [x] Cost tracking — estimated cost per message and per conversation (OpenRouter usage accounting built in)
- [ ] Conversation memory — long-term memory with vector embeddings stored locally
- [ ] Session management — named sessions within a conversation, separate context windows
- [ ] Token budget controls — per-conversation or global max-token limits
- [ ] Offline mode — view history and draft messages without a network connection
- [ ] Conversation folders / tags — organize conversations with labels

### Platform

- [x] Auto-updates — built-in update checker and silent background downloads
- [ ] Native menus — proper macOS/Windows/Linux application menus
- [ ] Tray icon — background operation with tray notifications
- [ ] Portable mode — run without installation (Windows/Linux)
- [ ] Code signing & notarization — macOS notarization, Windows code signing

## Repository layout

```text
src/main/           Electron main process, providers, tools, IPC, DB, keychain
src/main/ai/        AI core: providers (OpenRouter, GLM), chat engine, model registry
src/main/ai/tools/  Built-in tools (file read, grep, glob, web search/fetch, bash)
src/main/db/       SQLite client and repositories
src/main/secrets/  OS keychain integration
src/preload/       Typed bridge exposed to the renderer
src/renderer/      React UI components
src/shared/        Shared contracts, types, utilities
```

## Security model

- renderer code does not access secrets directly
- API calls happen from the Electron main process
- secrets are stored in the OS keychain, not SQLite
- renderer communication goes through a narrow preload API

This is still a personal-tool codebase moving toward public OSS quality. Review the code before using it with sensitive credentials.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

### Releases

Atlas uses GitHub Releases for distribution. To cut a new release:

```bash
# bump patch (0.1.0 -> 0.1.1)
pnpm release

# bump minor (0.1.0 -> 0.2.0)
pnpm release:minor

# bump major (0.1.0 -> 1.0.0)
pnpm release:major
```

Then push the tag to trigger the release workflow:

```bash
git push && git push --tags
```

This triggers the CI release workflow, which builds macOS DMG and ZIP artifacts for Apple Silicon and Intel, optionally signs/notarizes them if Apple secrets are configured, and publishes them to GitHub Releases with `latest-mac.yml` and blockmaps.

## Security

See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
