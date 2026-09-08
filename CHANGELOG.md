# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Releases v0.1.15 through v0.1.18 were cut on `main` and have not been merged
> back into `dev`, so `dev` still reports version 0.1.14. The entries below
> describe what shipped; the branch divergence is a separate problem.

## [Unreleased]

## [0.2.1] - 2026-09-08

### Fixed
- Fresh installs no longer crash on launch when the OpenCode CLI is absent.
  The missing binary surfaced as an uncaught `spawn opencode ENOENT` in the
  main process; the serve spawn now fails its own call instead, and the
  integration reports itself as not installed.

## [0.2.0] - 2026-09-08

### Added
- OpenCode integration with SDK server default and ACP beta behind
  integration modes, including model inventory, streaming session adapter,
  approvals bridge, Settings card, and keychain account support.
- Antigravity provider over ACP transport with auth recovery and
  provider banners, plus local agent detection and Claude adapter.
- Plugin system: install from folders and marketplaces, settings page,
  MCP servers served from bundles, per-chat tool gating.
- Subagents: catalog, continuable runtime with FIFO follow-ups, durable
  conversations, permission presets, composer takeover, and a live
  agent count badge.
- Terminal tab with panes, right panel surfaces, conversation fork and
  side conversations, raw transcript mode.
- Per-conversation model persistence and tool permission mode, context
  window framed as remaining, composer prompt history recall.
- Attachment staging with background compression, HEIC photo conversion,
  inline sandboxed visuals, markdown favicons and brand marks,
  session search, checkpoints with compaction prompts.
- Durable follow-up queue with restart resume, sticky compaction boundary.

### Changed
- New interface pass across the app shell, slim sidebar rows, compact
  composer, centered empty state.

### Fixed
- Settled turns no longer shimmer: reasoning rows require a live turn,
  and missed terminal events reconcile locally instead of sticking the
  draft at streaming.
- Custom Electron schemes register in one call so privileges no longer
  overwrite each other.
- Light mode clamped to themes that have a light palette; onboarding
  completion screen reachable again.
- Sidebar hover card flow debounced, model labels resolved from catalog,
  tool output streaming optimized, orphaned serve processes reaped.

## [0.1.18] - 2026-04-06

### Changed
- New interface pass across the app shell.

## [0.1.17] - 2026-04-06

### Added
- Inline sandboxed visuals in the transcript, with a streaming parser and an
  expand window.
- Visual diagrams in assistant responses.
- PostHog product analytics.
- CI for the `dev` branch.
- Streaming spinner in the composer.

### Fixed
- Hardcoded blue focus rings replaced with theme colors.
- Missing `modelLabel` argument in the message metadata row.
- Appearance changes now confirm with a toast.

## [0.1.16] - 2026-04-03

### Added
- Configurable typography: UI and code font family and size, with bundled fonts
  dropped in favour of system and user-supplied families.
- Keyboard shortcuts, and a refined collapsed sidebar.
- GLM provider support.
- View transitions for sidebar and settings navigation.

### Changed
- Inline notices replaced with compact toasts.
- Compact composer and a centered empty state.
- Composer attachment chips refined; media types normalized.

### Fixed
- Hardened model refresh against partial provider failures.

## [0.1.15] - 2026-04-02

### Changed
- Settings moved out of a modal into a dedicated workspace.
- Sidebar session rows refined for compact loading states.

## [0.1.14] - 2026-04-01

### Fixed
- macOS Dock icon loading, and the dev-mode icon launcher and generation.

## [0.1.8] — [0.1.13] - 2026-04-01

### Added
- In-app update checker with a compact update button.
- Local and web tools with an approval-ready chat UI.
- Reasoning streaming and its transcript UI.
- Additional model providers beyond OpenRouter.

### Fixed
- Model selector reliability.
- macOS title bar centering and traffic-light spacing.

## [0.1.1] — [0.1.7] - 2026-03-31

### Added
- Initial open source release.
- OpenRouter-first BYOK desktop chat client.
- OS keychain storage for API keys via keytar.
- Cached model catalog with free-model filtering.
- Local SQLite persistence for conversations and messages.
- Streaming chat responses.
- Abort support for in-flight requests.
- Security-oriented Electron architecture with a typed preload bridge.
- macOS app icon generation and release packaging.

[Unreleased]: https://github.com/olllayor/Atlas/compare/v0.1.18...HEAD
[0.1.18]: https://github.com/olllayor/Atlas/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/olllayor/Atlas/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/olllayor/Atlas/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/olllayor/Atlas/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/olllayor/Atlas/compare/v0.1.13...v0.1.14
