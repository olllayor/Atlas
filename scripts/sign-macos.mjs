import { sign as signApplication } from '@electron/osx-sign';

/**
 * Electron Builder normally starts one `codesign` process per file. Grouping
 * files with identical signing options keeps the signing result the same
 * while substantially reducing process-spawn overhead.
 */
export default async function sign(options) {
  // Electron Builder calls a configured hook even when signing is disabled.
  // Preserve its normal unsigned-build behavior.
  if (!options.identity) {
    return;
  }

  await signApplication({
    ...options,
    batchCodesignCalls: true,
  });
}
