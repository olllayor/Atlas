# Contributing

CheapChat is still early-stage. Small, focused contributions are the right fit.

## Before opening a PR

- keep scope narrow
- preserve the local-first and BYOK model
- do not add hosted services or unnecessary abstraction
- prefer concrete fixes over broad refactors

## Local setup

```bash
pnpm install
pnpm build
```

`pnpm dev` is not reliable yet in this environment, so include build verification with your change and note any dev-runtime observations clearly in the PR.

## Code guidelines

- TypeScript first
- keep renderer code free of direct secret access
- route provider calls through the main process
- keep IPC interfaces narrow and typed
- avoid feature creep in v1

## Good first contribution areas

- Electron dev-runtime fix
- tests around model caching and chat streaming behavior
- error normalization improvements
- packaging and release hardening
- UI polish that does not expand product scope

## Pull requests

- explain the user-visible change
- describe how you verified it
- call out any platform-specific assumptions
- keep unrelated cleanup out of the patch
