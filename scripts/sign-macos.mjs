import { sign as signApplication } from '@electron/osx-sign';

/**
 * Electron Builder custom sign hook for macOS.
 *
 * Fail-closed contract:
 * - `package:signed` / `package:notarized` set ATLAS_REQUIRE_SIGNING=1.
 *   If no identity is resolved (no CSC_LINK, no keychain Developer ID), throw
 *   so the build cannot silently ship an unsigned app.
 * - Unsigned `pnpm package` leaves ATLAS_REQUIRE_SIGNING unset. electron-builder
 *   still invokes this hook; with no identity we no-op to preserve its normal
 *   unsigned-build behavior.
 *
 * Electron Builder normally starts one `codesign` process per file. Grouping
 * files with identical signing options keeps the signing result the same
 * while substantially reducing process-spawn overhead.
 */
function isSigningRequired() {
  const flag = process.env.ATLAS_REQUIRE_SIGNING;
  return flag === '1' || flag === 'true';
}

export default async function sign(options) {
  if (!options.identity) {
    if (isSigningRequired()) {
      throw new Error(
        'ATLAS_REQUIRE_SIGNING is set but no code-signing identity was resolved. ' +
          'Provide CSC_LINK + CSC_KEY_PASSWORD (base64 .p12), or a "Developer ID Application" ' +
          'certificate in the login keychain (optionally CSC_NAME). ' +
          'Refusing to produce an unsigned build.'
      );
    }
    return;
  }

  await signApplication({
    ...options,
    batchCodesignCalls: true,
  });
}
