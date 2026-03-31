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
   - Sign and notarize macOS builds if signing secrets are configured
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

## Code signing (optional, for production macOS releases)

For macOS notarization and signing, set these repository secrets:

- `CSC_LINK` - Base64-encoded signing certificate
- `CSC_KEY_PASSWORD` - Certificate password
- `APPLE_API_KEY` - Contents of the App Store Connect `.p8` API key
- `APPLE_API_KEY_ID` - App Store Connect key ID
- `APPLE_API_ISSUER` - App Store Connect issuer ID

If those secrets are absent, the workflow still publishes unsigned macOS artifacts.
