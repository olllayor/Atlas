# Release Checklist

Use this checklist for each release to ensure nothing is missed.

The release workflow triggers on tags matching `v*.*.*` such as `v0.1.4` or `v0.1.4-beta.1`.

## Branch workflow

- All development happens on `dev`
- When ready to release, merge `dev` → `main` via PR
- Cut the release from `main`

## Before cutting a release

- [ ] All PRs for this release are merged to `dev`
- [ ] `dev` → `main` PR is merged
- [ ] `pnpm build` passes locally on `main`
- [ ] If branding changed, replace the root `icon.png` source and run `pnpm icons:mac` to refresh `build/icon.png` and `build/icon.icns`
- [ ] CI is green on `main` branch
- [ ] CHANGELOG.md is updated with all changes since last release
- [ ] No unresolved security issues
- [ ] README.md is accurate (remove outdated "early release" notes when appropriate)

## Cutting a release

1. Check out `main` and pull latest:
   ```bash
   git checkout main && git pull
   ```

2. Run the release script:
   ```bash
   # For patch releases (bug fixes)
   pnpm release

   # For minor releases (new features, backwards compatible)
   pnpm release:minor

   # For major releases (breaking changes)
   pnpm release:major
   ```

3. Push the tag:
   ```bash
   git push && git push --tags
   ```

4. The release workflow will automatically:
   - Build macOS DMG and ZIP artifacts for Apple Silicon and Intel
   - Produce **unsigned** artifacts (see "Code signing" below)
   - Publish a GitHub Release with the installers, blockmaps, and `latest-mac.yml`

5. Review the published GitHub Release:
   - Verify both macOS DMGs are attached
   - Verify both macOS ZIPs are attached
   - Verify `latest-mac.yml` is attached if auto-update metadata is expected
   - Confirm prerelease tags such as `v0.1.4-beta.1` were marked as prereleases

## After publishing

- [ ] Verify download links work for both macOS artifacts
- [ ] Smoke test the released binary on at least one platform
- [ ] Update CHANGELOG.md [Unreleased] section header to the new version
- [ ] Announce release in relevant channels (if applicable)

## Code signing (not currently enabled)

Releases are **unsigned today**, and setting repository secrets alone will not
change that: `pnpm package` passes `CSC_IDENTITY_AUTO_DISCOVERY=false`, which
disables signing even when a certificate is present, and `release.yml` does not
forward any signing environment to the build step.

Enabling signing means all three of:

1. Dropping `CSC_IDENTITY_AUTO_DISCOVERY=false` from the `package` script (or
   releasing via `package:signed` with the flag removed).
2. Adding a notarization step and passing these secrets through `release.yml`:
   - `CSC_LINK` - Base64-encoded Developer ID certificate
   - `CSC_KEY_PASSWORD` - Certificate password
   - `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` - App Store
     Connect credentials for notarization
3. An active Apple Developer Program membership for the Developer ID itself.

### Why this gates auto-update

Until the above is done, in-app auto-update is impossible on macOS, not merely
unconfigured: Squirrel.Mac refuses to swap an app whose signing identity it
cannot validate, and electron-builder's documentation is explicit that "macOS
application must be signed in order for auto updating to work."

The updater therefore does the most it can without a certificate - it downloads
the correct disk image for the running architecture and opens it, leaving the
drag to Applications to the user. See `src/main/updates/UpdateService.ts`.

The release pipeline already publishes everything a future auto-updater would
need (`latest-mac.yml`, per-arch `.zip`, and `.blockmap` files for differential
downloads), so signing is the only missing piece.
