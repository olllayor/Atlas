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
   - Produce **unsigned** artifacts by default (see "Code signing" below)
   - Run post-package verification (`ls`, `codesign -dv`; strict verify when signed)
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

## Code signing

### Current default: unsigned

Releases ship **unsigned** until a Developer ID certificate is configured.
`pnpm package` sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder
never attempts signing. `release.yml` chooses the unsigned path when
`secrets.CSC_LINK` is empty. This is intentional, not a bug: there is no Apple
Developer account on this project yet, and the pipeline is fail-closed so a
half-configured secret cannot silently produce a "signed" release that Gatekeeper
still rejects.

### Packaging scripts

| Script | Behavior |
| --- | --- |
| `pnpm package` | Unsigned. `CSC_IDENTITY_AUTO_DISCOVERY=false`. Local/dev distribution. |
| `pnpm package:signed` | Sets `ATLAS_REQUIRE_SIGNING=1`. Uses `scripts/sign-macos.mjs`. **Throws** if no identity is resolved. Does not notarize. |
| `pnpm package:notarized` | Same as signed, plus `-c.mac.notarize=true`. Notarization runs only when Apple API env vars are present; missing API vars fail the notarize step. |

`scripts/sign-macos.mjs` is the fail-closed gate. When `ATLAS_REQUIRE_SIGNING`
is set and electron-builder passes no identity, the hook throws instead of
returning. Unsigned builds leave the flag unset, so the hook no-ops.

### Enabling signed releases (when certs exist)

Add these GitHub Actions repository secrets:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application certificate (`.p12`) |
| `CSC_KEY_PASSWORD` | Password for the `.p12` |
| `CSC_NAME` | Optional. Exact identity name if not using auto-discovery |
| `APPLE_API_KEY` | Contents of the App Store Connect API `.p8` key (workflow writes it to a temp file; electron-builder expects a path) |
| `APPLE_API_KEY_ID` | API key ID |
| `APPLE_API_ISSUER` | API issuer UUID |

`release.yml` then picks the path automatically:

1. `CSC_LINK` empty → `pnpm package` (unsigned). Current behavior.
2. `CSC_LINK` set, Apple API secrets incomplete → `pnpm package:signed`.
3. `CSC_LINK` + all three Apple API secrets set → `pnpm package:notarized`.

No workflow change is required after adding the secrets.

### Local signed package

With a Developer ID Application cert in your login keychain:

```bash
pnpm package:signed
```

Or with an explicit cert file:

```bash
export CSC_LINK="$(base64 < DeveloperID.p12 | tr -d '\n')"
export CSC_KEY_PASSWORD='...'
pnpm package:signed
```

Without an identity, `package:signed` fails immediately. That is the point.

### Local notarized package

```bash
export APPLE_API_KEY=/path/to/AuthKey_XXX.p8
export APPLE_API_KEY_ID=...
export APPLE_API_ISSUER=...
# plus CSC_LINK / keychain identity
pnpm package:notarized
```

### What still cannot work without an Apple account

- Obtaining a Developer ID Application certificate
- App Store Connect API keys for notarization
- Gatekeeper acceptance on user machines (`spctl --assess` fails for unsigned apps)
- Squirrel.Mac auto-update (refuses to swap an app whose signing identity it cannot validate). See `src/main/updates/UpdateService.ts` — the updater currently downloads the DMG for the running arch and opens it, leaving drag-to-Applications to the user.

The release pipeline already publishes everything a future auto-updater needs
(`latest-mac.yml`, per-arch `.zip`, `.blockmap` files). Signing is the only
missing piece, and the CI path is ready the moment secrets appear.
