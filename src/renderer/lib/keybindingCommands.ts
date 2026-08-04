import type { ConversationSummary, KeybindingCommand } from '../../shared/contracts';

export type AppCommandDefinition = {
  command: KeybindingCommand;
  title: string;
  description: string;
  section: 'General' | 'Navigation';
  allowWhileEditable?: boolean;
  showInCommandPalette?: boolean;
  /**
   * Extra search terms for the command palette. Users type what they *want*
   * ("dark mode", "hide sidebar"), not the command's official title.
   */
  keywords?: string[];
};

export const APP_COMMAND_DEFINITIONS: AppCommandDefinition[] = [
  {
    command: 'app.commandPalette.toggle',
    title: 'Toggle command palette',
    description: 'Open or close the global command palette.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['palette', 'search', 'actions', 'run command', 'quick open'],
  },
  {
    command: 'sidebar.toggle',
    title: 'Toggle sidebar',
    description: 'Hide or show the conversation sidebar.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['hide sidebar', 'show sidebar', 'collapse', 'expand', 'panel', 'rail'],
  },
  {
    command: 'chat.new',
    title: 'New chat',
    description: 'Create a new conversation and switch to it.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['new conversation', 'start chat', 'create', 'compose', 'blank'],
  },
  {
    command: 'workspace.mode.toggle',
    title: 'Switch between Work and Code',
    description: 'Toggle this conversation between Work mode and Code mode.',
    section: 'General',
    keywords: ['work mode', 'code mode', 'coding', 'editing', 'switch mode', 'agent mode'],
  },
  {
    command: 'workspace.project.attach',
    title: 'Choose project folder',
    description: 'Attach a folder to this conversation as its working directory.',
    section: 'General',
    keywords: ['project', 'folder', 'repository', 'repo', 'open folder', 'workspace', 'directory'],
  },
  {
    command: 'terminal.toggle',
    title: 'Toggle terminal',
    description: 'Show or hide the terminal docked at the bottom of the window.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['terminal', 'shell', 'console', 'bash', 'zsh', 'command line', 'panel', 'bottom'],
  },
  {
    command: 'transcript.raw.toggle',
    title: 'Toggle raw transcript',
    description: 'Render every transcript cell as plain text, so selections copy cleanly.',
    section: 'General',
    allowWhileEditable: true,
    keywords: [
      'raw',
      'plain text',
      'plaintext',
      'no markdown',
      'unformatted',
      'copy',
      'paste',
      'select text',
      'source',
    ],
  },
  {
    command: 'settings.open',
    title: 'Open settings',
    description: 'Open Atlas settings.',
    section: 'General',
    allowWhileEditable: true,
    keywords: [
      'preferences',
      'theme',
      'dark mode',
      'light mode',
      'appearance',
      'api key',
      'providers',
      'keyboard shortcuts',
      'font',
      'config',
    ],
  },
  {
    command: 'composer.focus',
    title: 'Focus composer',
    description: 'Move focus to the chat composer.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['input', 'prompt', 'type', 'message box', 'write'],
  },
  {
    command: 'models.openSwitcher',
    title: 'Open model switcher',
    description: 'Open the model picker for the active conversation.',
    section: 'General',
    allowWhileEditable: true,
    keywords: ['model', 'change model', 'gpt', 'claude', 'llm', 'provider'],
  },
  {
    command: 'conversation.previous',
    title: 'Previous conversation',
    description: 'Select the previous conversation in the sidebar.',
    section: 'Navigation',
    keywords: ['back', 'up', 'prior chat'],
  },
  {
    command: 'conversation.next',
    title: 'Next conversation',
    description: 'Select the next conversation in the sidebar.',
    section: 'Navigation',
    keywords: ['forward', 'down', 'following chat'],
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
