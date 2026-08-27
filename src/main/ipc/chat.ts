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
    IPC_CHANNELS.chatCompact,
    withUserFacingErrors(IPC_CHANNELS.chatCompact, async (event, conversationId: string) => {
      assertTrustedSender(event);
      chatEngine.compactConversation(conversationId);
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

  ipcMain.handle(
    IPC_CHANNELS.subagentsList,
    withUserFacingErrors(IPC_CHANNELS.subagentsList, async (event, parentConversationId: string) => {
      assertTrustedSender(event);
      return chatEngine.listSubagents(parentConversationId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.subagentsFollowup,
    withUserFacingErrors(IPC_CHANNELS.subagentsFollowup, async (event, request: { parentConversationId: string; childId: string; content: string }) => {
      assertTrustedSender(event);
      return chatEngine.followupSubagent(request.parentConversationId, request.childId, request.content);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.subagentsInterrupt,
    withUserFacingErrors(IPC_CHANNELS.subagentsInterrupt, async (event, childId: string) => {
      assertTrustedSender(event);
      return chatEngine.interruptSubagent(childId);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.subagentsHistory,
    withUserFacingErrors(
      IPC_CHANNELS.subagentsHistory,
      async (event, request: { parentConversationId: string; childId: string; mode?: string | null }) => {
        assertTrustedSender(event);
        return chatEngine.getSubagentHistory(request);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.subagentsLiveness,
    withUserFacingErrors(IPC_CHANNELS.subagentsLiveness, async (event) => {
      assertTrustedSender(event);
      const map = chatEngine.getSubagentsLiveness();
      return Object.fromEntries(map);
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.subagentsComposerState,
    withUserFacingErrors(IPC_CHANNELS.subagentsComposerState, async (event, childId: string) => {
      assertTrustedSender(event);
      return chatEngine.getSubagentComposerState(childId);
    }),
  );
}
