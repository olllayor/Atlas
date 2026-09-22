# Atlas

## Branch and PR workflow

- Base work on `dev`. Open every feature, fix, and docs PR against `dev`.
- `main` is release-only. Do not merge day-to-day PRs into `main`.
- The only PR into `main` is the release PR: `dev` → `main`. That merge means cut a new app version. Follow RELEASE.md (`pnpm release`, `pnpm release:minor`, or `pnpm release:major`), update CHANGELOG.md, and tag.
- If a change needs to ship to users, it lands on `dev` first. Release from `main` after.

## Pull requests

- Target `dev`, unless this is the release PR.
- Open a real PR, not a draft.
- Keep scope narrow. Leave unrelated cleanup out of the patch.
- Explain the user-visible change and how you verified it.
- Rebase onto latest `dev` before opening.

## Project pointers

- CONTRIBUTING.md has code guidelines and local setup.
- RELEASE.md has the release checklist and signing notes.
