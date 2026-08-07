# R4 — Decide + (optionally) persist `accept_for_session` grants

Part of [`00-deep-dive-and-plan.md`](00-deep-dive-and-plan.md) → [gap G2](../00-deep-dive-and-plan.md).

## Why

`ToolApprovalController.accept_for_session` ("always allow for this session")
stores grants in an in-memory `Map` (`grantedScopesByConversation`). Across an app
restart the grants vanish — safe, but the UI never says so, and a user who
expects "always allow" to survive a restart gets a surprise re-prompt.

## Decision

Default: **document, don't persist.** Grants are scope-keyed (`getApprovalScopeKey`)
and designed as ephemeral session state, consistent with the privacy posture that
pending approvals live only in-memory. Persistence is a product choice that would
require a small table (`conversation_approval_grants`) plus UI to clear grants.

## Scope

1. Document the semantics on `ToolApprovalController` and in the approval UI copy
   ("until you quit Atlas", not "forever").
2. Add a test pinning that grants are scoped per conversation and do not leak
   across conversations (`tests/toolApprovalController.test.ts` if absent).
3. **Only if** persistence is requested: add the grants table, load grants at
   runtime start, expose a clear-grants IPC, and gate it behind the same
   `sessionScopeKey` validation already used at write time.

## Acceptance

- Default path: documented + existing behaviour unchanged, tests green, `pnpm build`.
- Persistence path (if approved): restart keeps per-conversation grants; clearing
  them revokes immediately; `pnpm test` green.
