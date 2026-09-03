import { BrowserWindow, Menu, type MenuItemConstructorOptions, clipboard, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import type {
  ChatContextMenuAction,
  ConversationContextMenuAction,
  ProjectContextMenuAction,
  ShowChatSelectionMenuRequest,
  ShowConversationContextMenuRequest,
  ShowProjectContextMenuRequest,
  ShowSidebarBackgroundContextMenuRequest,
  SidebarBackgroundContextMenuAction,
} from '../../shared/contracts';
import { withUserFacingErrors } from './errors';
import { assertTrustedSender } from './security';

/** Cap so a whole-transcript selection does not balloon the IPC payload twice (request + result). */
export const MAX_CHAT_SELECTION_CHARS = 4000;

/**
 * Attaches default native context-menu behaviors to a BrowserWindow:
 * 1. Editable elements (<input>, <textarea>, contentEditable) get native
 *    macOS Cut, Copy, Paste, Undo, Redo, Select All.
 * 2. Hyperlinks get "Open Link in Browser" and "Copy Link Address".
 */
export function attachContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    if (params.isEditable) {
      const editMenu = Menu.buildFromTemplate([
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      ]);
      editMenu.popup({ window });
      return;
    }

    // Link-only right-clicks get the link menu here. Link *plus* selection is
    // owned by the chat-selection IPC menu below (which includes the same two
    // link items), so this branch stays selection-free to avoid double popups.
    if (params.linkURL && !params.selectionText) {
      const linkMenu = Menu.buildFromTemplate([
        {
          label: 'Open Link in Browser',
          click: () => {
            void shell.openExternal(params.linkURL);
          },
        },
        {
          label: 'Copy Link Address',
          click: () => {
            clipboard.writeText(params.linkURL);
          },
        },
      ]);
      linkMenu.popup({ window });
    }
  });
}

/**
 * Registers IPC handlers for native context menus (chat selection, sidebar rows).
 */
export function registerContextMenuIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.contextMenuShowChatSelection,
    withUserFacingErrors(
      IPC_CHANNELS.contextMenuShowChatSelection,
      async (event, request: ShowChatSelectionMenuRequest): Promise<ChatContextMenuAction | null> => {
        assertTrustedSender(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) return null;
        const rawSelection = typeof request?.selectionText === 'string' ? request.selectionText.trim() : '';
        if (!rawSelection) return null;
        const selectionText =
          rawSelection.length > MAX_CHAT_SELECTION_CHARS
            ? rawSelection.slice(0, MAX_CHAT_SELECTION_CHARS)
            : rawSelection;
        const linkURL = typeof request?.linkURL === 'string' ? request.linkURL.trim() : '';
        const hasLink = linkURL.length > 0;
        // Renderer-supplied href: only http(s) may launch a browser. Anything
        // else (javascript:, file:, data:) still offers Copy Link Address.
        const canOpenLink = /^https?:\/\//i.test(linkURL);

        return new Promise<ChatContextMenuAction | null>((resolve) => {
          let resolved = false;
          const finish = (result: ChatContextMenuAction | null) => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          };

          const template: MenuItemConstructorOptions[] = [
            {
              label: 'Copy',
              role: 'copy',
              accelerator: 'CmdOrCtrl+C',
              click: () => finish(null),
            },
            ...(hasLink
              ? ([
                  ...(canOpenLink
                    ? [
                        {
                          label: 'Open Link in Browser',
                          click: () => {
                            void shell.openExternal(linkURL);
                            finish(null);
                          },
                        },
                      ]
                    : []),
                  {
                    label: 'Copy Link Address',
                    click: () => {
                      clipboard.writeText(linkURL);
                      finish(null);
                    },
                  },
                ] as MenuItemConstructorOptions[])
              : []),
            { type: 'separator' },
          {
            label: 'Quote in Prompt',
            enabled: Boolean(request?.hasActiveConversation),
            click: () => finish({ action: 'quote-in-prompt', text: selectionText }),
          },
          {
            label: 'Cite in Prompt',
            enabled: Boolean(request?.hasActiveConversation),
            click: () => finish({ action: 'cite-in-prompt', text: selectionText }),
          },
            {
              label: 'Ask Atlas to Explain',
              enabled: Boolean(request?.hasActiveConversation),
              click: () => finish({ action: 'explain-selection', text: selectionText }),
            },
            {
              label: 'Search in Workspace',
              click: () => finish({ action: 'search-in-workspace', text: selectionText }),
            },
            { type: 'separator' },
            {
              label: 'Select All',
              role: 'selectAll',
              accelerator: 'CmdOrCtrl+A',
              click: () => finish(null),
            },
          ];

          const menu = Menu.buildFromTemplate(template);
          menu.popup({
            window,
            callback: () => {
              // Give menuItem click handler a moment to execute before resolving with null
              setTimeout(() => finish(null), 50);
            },
          });
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.contextMenuShowConversation,
    withUserFacingErrors(
      IPC_CHANNELS.contextMenuShowConversation,
      async (event, request: ShowConversationContextMenuRequest): Promise<ConversationContextMenuAction | null> => {
        assertTrustedSender(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed() || !request?.conversationId) return null;

        return new Promise<ConversationContextMenuAction | null>((resolve) => {
          let resolved = false;
          const finish = (result: ConversationContextMenuAction | null) => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          };

          const template: MenuItemConstructorOptions[] = [];

          if (request.isArchived) {
            template.push(
              {
                label: 'Restore thread',
                click: () => finish({ action: 'restore', conversationId: request.conversationId }),
              },
              { type: 'separator' },
              {
                label: 'Delete',
                click: () => finish({ action: 'delete', conversationId: request.conversationId }),
              }
            );
          } else {
            // Group 1: Pin / Settle / Snooze
            template.push({
              label: request.isPinned ? 'Unpin thread' : 'Pin thread',
              click: () => finish({ action: 'toggle-pin', conversationId: request.conversationId }),
            });

            template.push({
              label: request.isSettled ? 'Reopen thread' : 'Settle thread',
              click: () => finish({ action: 'toggle-settled', conversationId: request.conversationId }),
            });

            if (request.isSnoozed) {
              template.push({
                label: 'Wake now',
                click: () => finish({ action: 'wake', conversationId: request.conversationId }),
              });
            } else if (request.snoozePresets && request.snoozePresets.length > 0) {
              template.push({
                label: 'Snooze',
                submenu: request.snoozePresets.map((preset) => ({
                  label: `${preset.label}  (${preset.whenLabel})`,
                  click: () =>
                    finish({
                      action: 'snooze',
                      conversationId: request.conversationId,
                      snoozedUntil: preset.snoozedUntil,
                    }),
                })),
              });
            }

            template.push({ type: 'separator' });

            // Group 2: Rename thread / Regenerate title / Mark unread
            template.push({
              label: 'Rename thread',
              enabled: request.canRename,
              click: () => finish({ action: 'rename', conversationId: request.conversationId }),
            });

            template.push({
              label: 'Regenerate title',
              click: () => finish({ action: 'regenerate-title', conversationId: request.conversationId }),
            });

            template.push({
              label: request.isUnread ? 'Mark read' : 'Mark unread',
              click: () =>
                finish({
                  action: request.isUnread ? 'mark-read' : 'mark-unread',
                  conversationId: request.conversationId,
                }),
            });

            template.push({ type: 'separator' });

            // Group 3: Copy > / Project settings
            template.push({
              label: 'Copy',
              submenu: [
                {
                  label: 'Copy Link',
                  click: () => {
                    clipboard.writeText(`atlas://chat/${request.conversationId}`);
                    finish(null);
                  },
                },
                {
                  label: 'Copy Thread ID',
                  click: () => {
                    clipboard.writeText(request.conversationId);
                    finish(null);
                  },
                },
                ...(request.conversationTitle
                  ? [
                      {
                        label: 'Copy Title',
                        click: () => {
                          clipboard.writeText(request.conversationTitle!);
                          finish(null);
                        },
                      },
                    ]
                  : []),
              ],
            });

            template.push({
              label: 'Project settings',
              enabled: Boolean(request.hasProject),
              click: () => finish({ action: 'project-settings', conversationId: request.conversationId }),
            });

            template.push({ type: 'separator' });

            // Group 4: Archive thread / Delete
            template.push({
              label: 'Archive thread',
              click: () => finish({ action: 'archive', conversationId: request.conversationId }),
            });

            template.push({
              label: 'Delete',
              click: () => finish({ action: 'delete', conversationId: request.conversationId }),
            });
          }

          const menu = Menu.buildFromTemplate(template);
          menu.popup({
            window,
            callback: () => {
              setTimeout(() => finish(null), 50);
            },
          });
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.contextMenuShowProject,
    withUserFacingErrors(
      IPC_CHANNELS.contextMenuShowProject,
      async (event, request: ShowProjectContextMenuRequest): Promise<ProjectContextMenuAction | null> => {
        assertTrustedSender(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed() || !request?.projectId) return null;

        return new Promise<ProjectContextMenuAction | null>((resolve) => {
          let resolved = false;
          const finish = (result: ProjectContextMenuAction | null) => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          };

          const template: MenuItemConstructorOptions[] = [
            {
              label: `New Chat in ${request.projectTitle || 'Project'}`,
              click: () => finish({ action: 'new-chat', projectId: request.projectId }),
            },
            { type: 'separator' },
            {
              label: request.isPinned ? 'Unpin Project' : 'Pin Project',
              click: () => finish({ action: 'toggle-pin', projectId: request.projectId }),
            },
          ];

          if (request.canRename) {
            template.push({
              label: 'Rename Project',
              click: () => finish({ action: 'rename', projectId: request.projectId }),
            });
          }

          template.push(
            {
              label: 'Reveal in File Manager',
              enabled: Boolean(request.projectExists),
              click: () => finish({ action: 'reveal', projectId: request.projectId }),
            },
            { type: 'separator' },
            {
              label: 'Remove Project',
              click: () => finish({ action: 'remove', projectId: request.projectId }),
            }
          );

          const menu = Menu.buildFromTemplate(template);
          menu.popup({
            window,
            callback: () => {
              setTimeout(() => finish(null), 50);
            },
          });
        });
      }
    )
  );

  ipcMain.handle(
    IPC_CHANNELS.contextMenuShowSidebarBackground,
    withUserFacingErrors(
      IPC_CHANNELS.contextMenuShowSidebarBackground,
      async (event, _request?: ShowSidebarBackgroundContextMenuRequest): Promise<SidebarBackgroundContextMenuAction | null> => {
        assertTrustedSender(event);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) return null;

        return new Promise<SidebarBackgroundContextMenuAction | null>((resolve) => {
          let resolved = false;
          const finish = (result: SidebarBackgroundContextMenuAction | null) => {
            if (!resolved) {
              resolved = true;
              resolve(result);
            }
          };

          const template: MenuItemConstructorOptions[] = [
            {
              label: 'New Chat',
              accelerator: 'CmdOrCtrl+N',
              click: () => finish({ action: 'new-chat' }),
            },
            {
              label: 'Open Project...',
              accelerator: 'CmdOrCtrl+O',
              click: () => finish({ action: 'attach-project' }),
            },
          ];

          const menu = Menu.buildFromTemplate(template);
          menu.popup({
            window,
            callback: () => {
              setTimeout(() => finish(null), 50);
            },
          });
        });
      }
    )
  );
}
