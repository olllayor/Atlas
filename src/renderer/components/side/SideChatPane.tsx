import { useMemo, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

import { useAppStore, resolveSelectedModelId } from '../../stores/useAppStore';
import { useMeasuredHeight } from '../../hooks/useMeasuredHeight';
import type { ReasoningEffort, ToolPermissionMode } from '../../../shared/chatParameters';
import { DEFAULT_REASONING_EFFORT, DEFAULT_TOOL_PERMISSION_MODE } from '../../../shared/chatParameters';
import type { WorkspaceMode } from '../../../shared/workspaceModes';
import { isWorkspaceModeReady } from '../../../shared/workspaceModes';
import { ChatWindow } from '../ChatWindow';
import { ChatComposerSlot } from '../ChatComposerSlot';
import { RendererErrorBoundary } from '../RendererErrorBoundary';

/**
 * The side chat (C5): an ephemeral transcript beside the main one.
 *
 * It is a second `ChatWindow` instance, not a special view — the pane's
 * conversation is a real row, just one no listing shows. Everything
 * per-conversation in the store (drafts, streaming state, activities) is
 * already keyed by id, so a parallel instance composes instead of needing
 * new state. Promotion is what gives the row a sidebar life; closing the
 * pane leaves it hidden where it was.
 */
export function SideChatPane() {
  const sideChat = useAppStore((state) => state.sideChat);
  const detail = useAppStore((state) =>
    state.sideChat ? state.conversationDetails[state.sideChat.sideId] ?? null : null
  );
  const draft = useAppStore((state) =>
    state.sideChat ? state.draftsByConversation[state.sideChat.sideId] ?? null : null
  );
  const models = useAppStore((state) => state.models);
  const selectedModelIdByConversation = useAppStore((state) => state.selectedModelIdByConversation);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const settings = useAppStore((state) => state.settings);
  const sendMessage = useAppStore((state) => state.sendMessage);
  const clearComposerDraft = useAppStore((state) => state.clearComposerDraft);
  const abortConversation = useAppStore((state) => state.abortConversation);
  const loadOlderMessages = useAppStore((state) => state.loadOlderMessages);
  const respondToolApproval = useAppStore((state) => state.respondToolApproval);
  const setConversationWorkspace = useAppStore((state) => state.setConversationWorkspace);
  const setConversationToolPermissionMode = useAppStore((state) => state.setConversationToolPermissionMode);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const closeSideChat = useAppStore((state) => state.closeSideChat);
  const promoteSideChat = useAppStore((state) => state.promoteSideChat);

  // The picker is pane-local on purpose: the global flag belongs to the main
  // composer, and two surfaces fighting over one boolean reads as a bug.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // The detail payload carries no permission rung, so the pane holds the value
  // locally after an explicit change instead of waiting on a refetch.
  const [permissionOverride, setPermissionOverride] = useState<ToolPermissionMode | null>(null);
  const composerDock = useMeasuredHeight<HTMLDivElement>();

  const sideId = sideChat?.sideId ?? null;
  const selectedModelId = useMemo(
    () =>
      resolveSelectedModelId(
        sideId,
        selectedModelIdByConversation,
        detail && sideId ? { [sideId]: detail } : {},
        models
      ),
    [sideId, selectedModelIdByConversation, detail, models]
  );

  if (!sideChat || !detail || !sideId) {
    return null;
  }

  const conversation = detail.conversation;
  const sideWorkspaceMode = (conversation.workspaceMode ?? 'work') as WorkspaceMode;
  const workspaceReady = isWorkspaceModeReady(sideWorkspaceMode, Boolean(conversation.projectId));

  return (
    <aside
      aria-label="Side chat"
      className="relative flex w-[38%] min-w-[300px] max-w-[560px] shrink-0 flex-col border-l border-border-subtle bg-bg-base"
      style={
        composerDock.height > 0
          ? ({ '--composer-dock-height': `${composerDock.height}px` } as React.CSSProperties)
          : undefined
      }
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span className="truncate text-xs font-medium text-text-secondary" title={conversation.title}>
          {conversation.title}
        </span>
        <span className="rounded-full border border-border-subtle px-1.5 text-2xs text-text-muted">side</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void promoteSideChat()}
            title="Keep this chat: promote it into a normal conversation"
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-hidden />
            Keep
          </button>
          <button
            type="button"
            onClick={closeSideChat}
            title="Close side chat (⌘⌥S)"
            aria-label="Close side chat"
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      <RendererErrorBoundary resetKey={sideId}>
        <ChatWindow
          detail={detail}
          draft={draft}
          hasCredential={Boolean(settings?.providers.some((provider) => provider.hasSecret))}
          isLoadingConversation={false}
          isLoadingOlder={false}
          onOpenSettings={() => {}}
          onSuggestionClick={(prompt) => {
            // Suggestions pre-seed the draft rather than sending, matching
            // the main window's appendToComposer behavior.
            useAppStore.getState().setComposerDraft(sideId, prompt);
          }}
          onLoadOlderMessages={(loadConversationId) => loadOlderMessages(loadConversationId)}
          onRespondToolApproval={(request) => respondToolApproval(request)}
        />
      </RendererErrorBoundary>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-bg-base" ref={composerDock.ref}>
        <ChatComposerSlot
          conversationId={sideId}
          disabled={false}
          isStreaming={draft?.status === 'streaming'}
          models={models}
          selectedModelId={selectedModelId}
          modelPickerOpen={modelPickerOpen}
          composerFocusNonce={0}
          detail={detail}
          draft={draft}
          onSend={(message) => {
            const sentAttachmentIds = message.files.map((file) => file.id);
            return sendMessage({
              text: message.text,
              files: message.files,
              conversationId: sideId,
            }).then(() => {
              clearComposerDraft(sideId, sentAttachmentIds);
            });
          }}
          onAbort={() => void abortConversation(sideId)}
          onSelectModel={(modelId) => setSelectedModel(sideId, modelId)}
          onModelPickerOpenChange={setModelPickerOpen}
          onComposerFocusChange={() => {}}
          reasoningEffort={settings?.chat.reasoningEffort ?? DEFAULT_REASONING_EFFORT}
          toolPermissionMode={
            permissionOverride ??
            settings?.chat.toolPermissionMode ??
            DEFAULT_TOOL_PERMISSION_MODE
          }
          workspaceMode={sideWorkspaceMode}
          workspaceReady={workspaceReady}
          onWorkspaceModeChange={(mode) =>
            void setConversationWorkspace(sideId, { mode })
          }
          onReasoningEffortChange={(reasoningEffort: ReasoningEffort) =>
            void updatePreferences({ chat: { reasoningEffort } })
          }
          onToolPermissionModeChange={(mode) => {
            setPermissionOverride(mode);
            void setConversationToolPermissionMode(sideId, mode);
          }}
          onOpenGallery={() => {}}
        />
      </div>
    </aside>
  );
}
