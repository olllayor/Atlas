# R1 — Pin the 33 ms stream coalescer with merge-invariant tests

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → [gap G1](../00-deep-dive-and-plan.md).

## Why

`ChatEngine.ts:85` (`STREAM_BATCH_INTERVAL_MS = 33`) coalesces stream chunks into
one IPC flush to cut renderer traffic by orders of magnitude. That is a load
bearing performance claim, yet it has **no dedicated test**. If merge semantics
drift (two parts merged into one, text merged into a tool-input, reasoning merged
into text), transcript accuracy breaks silently — and the user can't tell whether
a visible glitch is a provider or our coalescer.

## Scope

- Extract or expose the pure merge/queue logic so it can be tested without a
  real timer: `queueBufferedEvent` / `mergeBufferedEvents` / `getBufferedEventKey`
  (`ChatEngine.ts:1056–1090`). Prefer a small exported pure function (`mergeIntoBuffer`)
  over reaching into the private methods.
- Tests in `tests/streamBuffer.test.ts` (follow `node:test` + `assert/strict`).

## Invariants to pin

1. Two `chunk` deltas with the **same** part id and part type merge into one.
2. Two different part ids never merge.
3. A `chunk` (text) and a `tool-input-delta` for the same id **never** merge.
4. A `reasoning` delta and a `chunk` delta never cross-merge, even same part id.
5. Order is preserved across a flush (no reordering).
6. A flush clears the pending map; a later event starts a fresh batch.

## Acceptance

- New tests green under `pnpm test`.
- `pnpm build` passes.
- No behaviour change (test-only track).
