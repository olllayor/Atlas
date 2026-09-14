/**
 * Whether in-app Cloud Sandbox worker deploy can run.
 *
 * Packaged builds never ship `workers/cloud-sandbox`, so cwd/appPath probes
 * cannot succeed. Keep this pure so capability wiring and tests need no Electron.
 */
export type CloudSandboxDeployAvailability = {
  canDeploy: boolean;
  error?: string;
  code?: 'packaged-unavailable';
};

export const PACKAGED_DEPLOY_UNAVAILABLE_ERROR =
  'Cloud Sandbox deploy is a source-checkout feature. Packaged apps do not bundle the Cloudflare Worker sources. Deploy workers/cloud-sandbox yourself, then paste the worker URL and auth secret below.';

export function cloudSandboxDeployAvailability(isPackaged: boolean): CloudSandboxDeployAvailability {
  if (isPackaged) {
    return {
      canDeploy: false,
      code: 'packaged-unavailable',
      error: PACKAGED_DEPLOY_UNAVAILABLE_ERROR,
    };
  }
  return { canDeploy: true };
}
