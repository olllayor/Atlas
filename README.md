# CheapChat

CheapChat is a local-first desktop chat client for BYOK usage with OpenRouter. The goal is narrow: save your own OpenRouter API key once, browse cached free-tier models, pick one manually, chat with streaming responses, and keep your conversation history on your machine.

This repository is being prepared for open source release. The core app scaffold is in place and production builds work. Development startup still has an unresolved Electron runtime issue in this environment, so the project should currently be treated as an early OSS codebase rather than a polished public release.

## What it does

- OpenRouter-first BYOK flow
- OS keychain storage for your API key via `keytar`
- Cached model catalog with free-model filtering
- Local SQLite persistence for conversations and messages
- Streaming chat responses from the Electron main process
- Abort support for in-flight requests
- Security-oriented Electron architecture with a typed preload bridge

## Stack

- Electron
- React
- TypeScript
- Vite / electron-vite
- Zustand
- Tailwind CSS
- better-sqlite3
- keytar

## Current status

- `pnpm build` passes
- the main app architecture and UI flow are implemented
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

Known issue as of March 31, 2026: this currently fails in this environment during Electron startup. See the notes in this README and the source for the current runtime wiring.

### Build

```bash
pnpm build
```

## Product scope

CheapChat v1 is intentionally small:

- single-user desktop app
- local-only storage
- manual model selection
- text chat only

Out of scope for v1:

- accounts or cloud sync
- attachments and vision
- tools or function calling
- automatic provider routing
- hosted backend services

## Repository layout

```text
src/main/       Electron main process, OpenRouter client, IPC, DB, keychain
src/preload/    Typed bridge exposed to the renderer
src/renderer/   React UI
src/shared/     Shared contracts and types
```

## Security model

- renderer code does not access secrets directly
- API calls happen from the Electron main process
- secrets are stored in the OS keychain, not SQLite
- renderer communication goes through a narrow preload API

This is still a personal-tool codebase moving toward public OSS quality. Review the code before using it with sensitive credentials.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
