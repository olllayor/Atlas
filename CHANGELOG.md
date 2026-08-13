# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Releases v0.1.15 through v0.1.18 were cut on `main` and have not been merged
> back into `dev`, so `dev` still reports version 0.1.14. The entries below
> describe what shipped; the branch divergence is a separate problem.

## [Unreleased]

### Fixed
- Light mode is no longer offered for design themes that have no light palette.
  Picking it under `default` or `xai` set `color-scheme: light` — whitening
  native inputs, scrollbars and autofill — while every app surface stayed dark.
  The mode is now disabled for those themes and clamped to dark if already
  stored.
- The onboarding "You're all set" screen is reachable again. Opening Settings
  from "Add a provider" unmounted the flow and nothing restored it, so a user
  who configured a provider was dropped into an empty chat with no confirmation
  and the `onboarding completed` event never fired.

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
