import { sign as signApplication } from "@electron/osx-sign";

/**
 * Custom macOS sign hook for electron-builder, opt-in for signed builds via
 * `pnpm package:signed` (see package.json). Signs files with matching
 * options together instead of spawning one `codesign` process per file —
 * port of pingdotgg/t3code#8093, which measured codesign calls dropping ~80%.
 *
 * Deliberately NOT wired into the default `package` script: @electron/osx-sign
 * v2 requires a real certificate identity and throws when none exists, while
 * unsigned local builds rely on electron-builder's default ad-hoc path.
 */
export default async function sign(options) {
  await signApplication({ ...options, batchCodesignCalls: true });
}
