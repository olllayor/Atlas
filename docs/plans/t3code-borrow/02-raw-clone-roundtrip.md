# R2 — Assert raw mode round-trips through `git apply --check`

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → [gap G4](../00-deep-dive-and-plan.md).

## Why

Raw transcript mode produces copy that is promised to be `git apply`-able
(`shared/contracts.ts:790` region; transcript raw mode, CHANGELOG `87d93c6`).
That promise is exactly what makes raw copy useful (paste a patch into a repo).
It is currently unverified, so a future change to the `+++/---` grammar could
silently break it.

## Scope

- Locate the raw-copy builder in the transcript (the `tryParseIntoCells` /
  `git apply` path in `shared/contracts.ts` + the renderer copy handler).
- Add `tests/rawClone.test.ts`:
  - Build a synthetic turn (one file edit with `+`/`-` hunks + one new file), run
    its raw output through `git apply --check` in a temp repo, assert exit 0.
  - If git-invoking is environment-gated, fall back to an offline parser assertion
    of the hunk grammar (`+++/---` counts, `@@` headers, file markers).

## Acceptance

- `git apply --check` accepts the raw copy of the fixture (or the offline grammar
  assertion passes in non-git environments).
- `pnpm build` and `pnpm test` pass.
