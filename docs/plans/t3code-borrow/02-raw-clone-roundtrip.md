# R2 — Assert composed review patches round-trip through `git apply --check`

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → gap G4.

## Status: ✅ built (`tests/gitApplyRoundTrip.test.ts`)

## Why

`parseReviewDiff` (`shared/review.ts`) slices `git diff` into per-file and
per-hunk patches, each carrying the file headers so a single hunk stands alone.
That is the promise the review pane's stage / unstage / revert rely on
("apply hunk 3" of an ever-moving working tree). The trailing newline and the
verbatim header round-trip are the two things a naive re-serialisation breaks,
and a patch that has been through a lossy round trip is one `git apply` silently
rejects.

## What the test proves (against a real temp repo, no sandbox)

- A **modified** file with two separated edits: the whole-file patch **and** each
  individual hunk patch pass `git apply --check` when applied to the committed
  base tree (after `git checkout -- .`).
- A **newly-added** file (staged, `git diff --cached`): the composed `added`
  patch passes `git apply --check` when the file is taken out of the tree first.

## Notes

- Reuses the `makeRepo()` / `run()` real-git harness from `gitReview.test.ts`.
- The earlier "raw transcript copy" framing was set aside: the actual `git apply`-
  ready artifact in this codebase is the review patch composer, which is the
  thing that really reaches `git apply`. This track pins that contract instead of
  inventing a separate one for raw copy.

## Acceptance

- `pnpm test` green; `pnpm build` passes. (Verified: both new tests pass.)

