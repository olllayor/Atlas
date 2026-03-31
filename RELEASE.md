# Release Checklist

Use this checklist for each release to ensure nothing is missed.

## Before cutting a release

- [ ] All PRs for this release are merged
- [ ] `pnpm build` passes locally
- [ ] CI is green on main branch
- [ ] CHANGELOG.md is updated with all changes since last release
- [ ] No unresolved security issues
- [ ] README.md is accurate (remove outdated "early release" notes when appropriate)

## Cutting a release

1. Run the release script:
   ```bash
   # For patch releases (bug fixes)
   pnpm release

   # For minor releases (new features, backwards compatible)
   pnpm release:minor

   # For major releases (breaking changes)
   pnpm release:major
   ```

2. Push the tag:
   ```bash
   git push && git push --tags
   ```

3. The release workflow will automatically:
   - Build macOS DMGs for Apple Silicon and Intel
   - Upload the DMGs, blockmaps, and `latest-mac.yml` to a GitHub Release draft

4. Review the release draft:
   - Edit the release notes (copy from CHANGELOG.md)
   - Verify both macOS DMGs are attached
   - Verify `latest-mac.yml` is attached if auto-update metadata is expected
   - Publish the release when ready

## After publishing

- [ ] Verify download links work for both macOS artifacts
- [ ] Smoke test the released binary on at least one platform
- [ ] Update CHANGELOG.md [Unreleased] section header to the new version
- [ ] Announce release in relevant channels (if applicable)

## Code signing (optional, for production macOS releases)

For macOS notarization and signing, set these repository secrets:

- `APPLE_ID` - Apple Developer account
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Team ID from Apple Developer portal
- `CSC_LINK` - Base64-encoded signing certificate
- `CSC_KEY_PASSWORD` - Certificate password

These are not required for draft releases or early open source distribution.
