# Security Policy

## Supported status

Atlas is an early open source project and does not currently offer formal security support windows or coordinated release SLAs.

## Reporting

If you discover a security issue, do not open a public issue with exploit details.

Report it privately to the maintainer before disclosure. If no private channel has been published yet, open a minimal public issue asking for a contact path without including sensitive details.

## Scope notes

- API keys should be stored in the OS keychain via `keytar`
- secrets should not be written to SQLite or exposed to renderer code
- provider requests should stay in the Electron main process

Security-sensitive changes should preserve those boundaries.
