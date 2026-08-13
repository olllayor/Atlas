import { BrowserWindow, ipcMain } from 'electron/main';

import type {
  ChatStartRequest,
  GetContextUsageRequest,
  OpenVisualWindowRequest,
  ToolApprovalResponseRequest,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { ChatEngine } from '../ai/core/ChatEngine';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

export function registerChatIpc(chatEngine: ChatEngine) {
  ipcMain.handle(
    IPC_CHANNELS.chatStart,
    withUserFacingErrors(IPC_CHANNELS.chatStart, async (event, request: ChatStartRequest) => {
      assertTrustedSender(event);

      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error('Unable to resolve the source window for this chat request.');
      }

      return chatEngine.start(window, request);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatAbort,
    withUserFacingErrors(IPC_CHANNELS.chatAbort, async (event, requestId: string) => {
      assertTrustedSender(event);
      await chatEngine.abort(requestId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatRespondToolApproval,
    withUserFacingErrors(
      IPC_CHANNELS.chatRespondToolApproval,
      async (event, request: ToolApprovalResponseRequest) => {
        assertTrustedSender(event);
        await chatEngine.respondToolApproval(request);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatGetContextUsage,
    withUserFacingErrors(IPC_CHANNELS.chatGetContextUsage, async (event, request: GetContextUsageRequest) => {
      assertTrustedSender(event);
      return chatEngine.getContextUsage(request);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatGetRuntimeState,
    withUserFacingErrors(IPC_CHANNELS.chatGetRuntimeState, async (event, request: { conversationId: string }) => {
      assertTrustedSender(event);
      return chatEngine.getRuntimeState(request);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatRecoverEvents,
    withUserFacingErrors(
      IPC_CHANNELS.chatRecoverEvents,
      async (event, request: { conversationId: string; afterSequence: number }) => {
        assertTrustedSender(event);
        return chatEngine.recoverEvents(request);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.chatOpenVisualWindow,
    withUserFacingErrors(IPC_CHANNELS.chatOpenVisualWindow, async (event, request: OpenVisualWindowRequest) => {
      assertTrustedSender(event);

      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error('Unable to resolve the source window for this visual request.');
      }

      await chatEngine.openVisualWindow(window, request);
    }),
  );
}
