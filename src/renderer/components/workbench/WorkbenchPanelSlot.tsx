import type { ChatMessage, WorkLogEntry } from '../../../shared/contracts';
import { useAppStore } from '../../stores/useAppStore';
import { WorkbenchPanel, type WorkbenchPanelProps } from './WorkbenchPanel';

/** Shared empty tails, so "nothing here" keeps one identity across renders. */
const NO_MESSAGES: ChatMessage[] = [];
const NO_ACTIVITIES: WorkLogEntry[] = [];

type WorkbenchPanelSlotProps = Omit<WorkbenchPanelProps, 'messages' | 'activities'> & {
  conversationId?: string;
};

/**
 * Owns the workbench's subscription to the thread's messages and activity log.
 *
 * Both are rewritten on every stream flush — the activity log because a text
 * delta folds into a `message.*` entry — so reading them in `App` put the whole
 * window on the token path. The workbench genuinely wants live tool output, so
 * the subscription stays; it just lives next to the thing that renders it.
 */
export function WorkbenchPanelSlot({ conversationId, ...panelProps }: WorkbenchPanelSlotProps) {
  const messages = useAppStore((state) =>
    conversationId ? state.conversationDetails[conversationId]?.messages ?? NO_MESSAGES : NO_MESSAGES
  );
  const activities = useAppStore((state) =>
    conversationId ? state.activitiesByConversation[conversationId] ?? NO_ACTIVITIES : NO_ACTIVITIES
  );

  return (
    <WorkbenchPanel
      {...panelProps}
      conversationId={conversationId}
      messages={messages}
      activities={activities}
    />
  );
}
