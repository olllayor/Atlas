---
name: openheard-triage
description: Use when a user reports feature feedback or a bug on the Atlas board, or asks to move a post or draft release notes.
disable-model-invocation: true
---

# OpenHeard triage

Maintainer tooling for board `atlas-features` at https://atlas.openheard.com.

## Auth

`OPENHEARD_WORKSPACE_TOKEN` is a maintainer-only workspace credential. End users post and vote on the public board without a key. Supply the token through plugin credentials only. Never paste it into chat or a committed file.

## Tools

| Tool | Use |
| --- | --- |
| `list_boards` | Confirm board ids. Live board is `atlas-features`. |
| `list_statuses` | Status keys and labels. |
| `list_posts` | Board posts. Prefer this over many `get_post` calls. |
| `get_post` | One post with comments. |
| `create_post` | File a feature request or bug. |
| `set_status` | Move a post to a new status. |
| `add_comment` | Triage notes and replies. |
| `list_changelog` | Published and draft changelog entries. |
| `draft_changelog` | Prepare release notes. |
| `publish_changelog` | Publish a draft changelog entry. |

## Status keys

`open`, `review`, `planned`, `progress`, `done`, `closed`.

## Limits

Rate limit is 60 requests per minute per key. Batch list calls in one turn (`list_posts` with `list_statuses` or `list_changelog`) instead of serial single-purpose rounds.

## Workflow

1. `list_posts` (batch `list_statuses` when the status map is unclear).
2. Summarize duplicates and vote leaders.
3. `set_status` and `add_comment` for triage decisions.
4. `draft_changelog` before `publish_changelog` when shipping.
