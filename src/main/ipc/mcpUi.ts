import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { McpUiDescriptor } from '../../shared/mcpUi';
import type { McpUiStore } from '../ai/mcp/McpUiStore';
import { assertTrustedSender } from './security';

/**
 * Asking whether a finished tool call left a UI component to draw.
 *
 * Only a descriptor crosses this channel — the call id, the component's
 * `ui://` name, and the server that sent it. The markup never does. The
 * renderer points a sandboxed frame at `atlas-widget://<id>` and the protocol
 * handler serves the bytes, so widget markup is never a string sitting in the
 * process that has the React tree and the preload bridge.
 *
 * `assertTrustedSender` matters more here than it looks. A widget frame's URL
 * is `atlas-widget://…`, which is neither `file://` nor the dev server, so even
 * if a widget somehow reached `ipcRenderer` this handler would refuse it. That
 * is a second line behind the sandbox rather than the first: the frame has no
 * preload and no Node, so it has no `ipcRenderer` to begin with.
 */
export function registerMcpUiIpc(store: Pick<McpUiStore, 'describe'>) {
  ipcMain.handle(
    IPC_CHANNELS.mcpUiDescribe,
    (event, toolCallId: unknown): McpUiDescriptor | null => {
      assertTrustedSender(event);

      // Never throws. A transcript row asking about a call that predates the
      // store — anything from before this launch — is the ordinary case, not an
      // error, and a rejected promise per scrolled-past row would be noise.
      return typeof toolCallId === 'string' && toolCallId ? store.describe(toolCallId) : null;
    }
  );
}
