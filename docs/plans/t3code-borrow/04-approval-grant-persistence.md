# R4 — Decide + (optionally) persist `accept_for_session` grants

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → gap G2.

## Status: ✅ decided + tested (`tests/toolApprovalController.test.ts`)

## Why

`ToolApprovalController.accept_for_session` ("always allow for this session")
stores grants in an in-memory `Map` (`grantedScopesByConversation`). Across an app
restart the grants vanish — safe, but the UI never says so, and a user who
expects "always allow" to survive a restart gets a surprise re-prompt.

## Decision: **document, don't persist.**

Grants are scope-keyed (`getApprovalScopeKey`) and designed as ephemeral session
state, consistent with the privacy posture that pending approvals live only
in-memory and mirror t3code's "session" semantics. Persistence would be a product
change needing a real table plus a clear-grants UI and can be revisited as its
own feature.

## What shipped

- A semantic doc-comment on `ToolApprovalController` pinning the rules: grants are
  **conversation-scoped**, **per-runtime-session and ephemeral**, and only
  `accept_for_session` (with a `sessionScopeKey`) ever writes one.
- `tests/toolApprovalController.test.ts` (7 tests) proving grants:
  - do not leak across conversations for the same scope key;
  - do not cover a different scope key;
  - are never written by a plain `accept` / `decline`;
  - cannot be minted by an approval that carries no `sessionScopeKey`;
  - are cleared with the request.

## Acceptance

- `pnpm test` green; `pnpm build` passes. (Verified: 7/7 tests pass.)

