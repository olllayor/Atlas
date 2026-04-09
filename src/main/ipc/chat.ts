import { BrowserWindow, ipcMain } from 'electron/main';

import type { ChatStartRequest, OpenVisualWindowRequest, ToolApprovalResponseRequest } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ChatEngine } from '../ai/core/ChatEngine';
import { assertTrustedSender } from './security';

export function registerChatIpc(chatEngine: ChatEngine) {
  ipcMain.handle(IPC_CHANNELS.chatStart, async (event, request: ChatStartRequest) => {
    assertTrustedSender(event);

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('Unable to resolve the source window for this chat request.');
    }

    return chatEngine.start(window, request);
  });

  ipcMain.handle(IPC_CHANNELS.chatAbort, (event, requestId: string) => {
    assertTrustedSender(event);
    chatEngine.abort(requestId);
  });

  ipcMain.handle(IPC_CHANNELS.chatRespondToolApproval, async (event, request: ToolApprovalResponseRequest) => {
    assertTrustedSender(event);
    await chatEngine.respondToolApproval(request);
  });

  ipcMain.handle(IPC_CHANNELS.chatOpenVisualWindow, async (event, request: OpenVisualWindowRequest) => {
    assertTrustedSender(event);

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('Unable to resolve the source window for this visual request.');
    }

    await chatEngine.openVisualWindow(window, request);
  });
}
