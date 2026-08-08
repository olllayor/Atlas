import type { IpcMainInvokeEvent } from 'electron';

export function assertTrustedSender(event: IpcMainInvokeEvent) {
  const url = event.senderFrame?.url ?? '';
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
  const senderOrigin = url.startsWith('http') ? new URL(url).origin : null;
  const isTrustedFile = url.startsWith('file://');
  const isTrustedDevServer = Boolean(devOrigin && senderOrigin === devOrigin);

  if (!isTrustedFile && !isTrustedDevServer) {
    throw new Error(`Blocked IPC from untrusted sender: ${url}`);
  }
}
