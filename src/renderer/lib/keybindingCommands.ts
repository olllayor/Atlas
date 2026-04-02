import type { ConversationSummary, KeybindingCommand } from '../../shared/contracts';

export type AppCommandDefinition = {
  command: KeybindingCommand;
  title: string;
  description: string;
  section: 'General' | 'Navigation';
  allowWhileEditable?: boolean;
  showInCommandPalette?: boolean;
};

export const APP_COMMAND_DEFINITIONS: AppCommandDefinition[] = [
  {
    command: 'app.commandPalette.toggle',
    title: 'Toggle command palette',
    description: 'Open or close the global command palette.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'sidebar.toggle',
    title: 'Toggle sidebar',
    description: 'Hide or show the conversation sidebar.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'chat.new',
    title: 'New chat',
    description: 'Create a new conversation and switch to it.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'settings.open',
    title: 'Open settings',
    description: 'Open Atlas settings.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'composer.focus',
    title: 'Focus composer',
    description: 'Move focus to the chat composer.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'models.openSwitcher',
    title: 'Open model switcher',
    description: 'Open the model picker for the active conversation.',
    section: 'General',
    allowWhileEditable: true,
  },
  {
    command: 'conversation.previous',
    title: 'Previous conversation',
    description: 'Select the previous conversation in the sidebar.',
    section: 'Navigation',
  },
  {
    command: 'conversation.next',
    title: 'Next conversation',
    description: 'Select the next conversation in the sidebar.',
    section: 'Navigation',
  },
  ...Array.from({ length: 9 }, (_value, index) => ({
    command: `conversation.jump.${index + 1}` as KeybindingCommand,
    title: `Jump to conversation ${index + 1}`,
    description: `Select conversation ${index + 1} in the current sidebar order.`,
    section: 'Navigation' as const,
    showInCommandPalette: false,
  })),
];

export const APP_COMMANDS_BY_ID = Object.fromEntries(
  APP_COMMAND_DEFINITIONS.map((definition) => [definition.command, definition]),
) as Record<KeybindingCommand, AppCommandDefinition>;

export function getAdjacentConversationId(
  conversations: ConversationSummary[],
  selectedConversationId: string | null,
  direction: 'previous' | 'next',
) {
  if (!selectedConversationId || conversations.length === 0) {
    return null;
  }

  const currentIndex = conversations.findIndex((conversation) => conversation.id === selectedConversationId);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
  return conversations[nextIndex]?.id ?? null;
}

export function getConversationJumpId(conversations: ConversationSummary[], jumpIndex: number) {
  return conversations[jumpIndex]?.id ?? null;
}
