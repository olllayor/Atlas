import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SEARCH_QUERY_CHARS,
  formatExplainPrompt,
  formatMarkdownQuote,
  sanitizeSearchQuery,
} from '../src/renderer/lib/contextMenu';
import { IPC_CHANNELS } from '../src/shared/ipc';
import type {
  ChatContextMenuAction,
  ConversationContextMenuAction,
  ProjectContextMenuAction,
  ShowChatSelectionMenuRequest,
  ShowConversationContextMenuRequest,
  ShowProjectContextMenuRequest,
  ShowSidebarBackgroundContextMenuRequest,
  SidebarBackgroundContextMenuAction,
} from '../src/shared/contracts';

test('formatMarkdownQuote formats single line as blockquote', () => {
  const result = formatMarkdownQuote('Hello world');
  assert.equal(result, '> Hello world\n\n');
});

test('formatMarkdownQuote formats multi-line text with empty lines correctly', () => {
  const input = 'First line\n\nSecond line\nThird line';
  const result = formatMarkdownQuote(input);
  assert.equal(result, '> First line\n>\n> Second line\n> Third line\n\n');
});

test('formatMarkdownQuote returns empty string for empty or whitespace-only inputs', () => {
  assert.equal(formatMarkdownQuote(''), '');
  assert.equal(formatMarkdownQuote('   \n  \t '), '');
});

test('formatMarkdownQuote trims leading and trailing whitespace', () => {
  const input = '   \n  Indented text here   \n\n  ';
  const result = formatMarkdownQuote(input);
  assert.equal(result, '> Indented text here\n\n');
});

test('formatExplainPrompt wraps quoted text with explanation prompt', () => {
  const input = 'const x = 42;';
  const result = formatExplainPrompt(input);
  assert.equal(result, 'Explain the following:\n\n> const x = 42;\n\n');
});

test('formatExplainPrompt returns empty string for empty input', () => {
  assert.equal(formatExplainPrompt('   '), '');
});

test('IPC channel contextMenuShowChatSelection is defined', () => {
  assert.equal(IPC_CHANNELS.contextMenuShowChatSelection, 'context-menu:show-chat-selection');
});

test('formatMarkdownQuote normalizes CRLF and whitespace-only lines', () => {
  assert.equal(formatMarkdownQuote('a\r\n\r\nb'), '> a\n>\n> b\n\n');
  assert.equal(formatMarkdownQuote('a\n   \nb'), '> a\n>\n> b\n\n');
});

test('sanitizeSearchQuery collapses whitespace and caps length', () => {
  assert.equal(sanitizeSearchQuery('  hello\nworld\tfoo  '), 'hello world foo');
  assert.equal(sanitizeSearchQuery('   '), '');
  const long = 'x'.repeat(MAX_SEARCH_QUERY_CHARS + 50);
  const sanitized = sanitizeSearchQuery(long);
  assert.equal(sanitized.length, MAX_SEARCH_QUERY_CHARS);
});

test('ShowChatSelectionMenuRequest accepts optional linkURL', () => {
  const withLink: ShowChatSelectionMenuRequest = {
    selectionText: 'link text',
    hasActiveConversation: true,
    linkURL: 'https://example.com',
  };
  assert.equal(withLink.linkURL, 'https://example.com');
});

test('ChatContextMenuAction types match contract', () => {
  const quoteAction: ChatContextMenuAction = {
    action: 'quote-in-prompt',
    text: 'test text',
  };
  const explainAction: ChatContextMenuAction = {
    action: 'explain-selection',
    text: 'test text',
  };
  const searchAction: ChatContextMenuAction = {
    action: 'search-in-workspace',
    text: 'test text',
  };
  const citeAction: ChatContextMenuAction = {
    action: 'cite-in-prompt',
    text: 'test text',
  };

  assert.equal(quoteAction.action, 'quote-in-prompt');
  assert.equal(explainAction.action, 'explain-selection');
  assert.equal(searchAction.action, 'search-in-workspace');
  assert.equal(citeAction.action, 'cite-in-prompt');

  const request: ShowChatSelectionMenuRequest = {
    selectionText: 'some selection',
    hasActiveConversation: true,
  };
  assert.equal(request.selectionText, 'some selection');
  assert.equal(request.hasActiveConversation, true);
});

test('Sidebar IPC channels are properly defined', () => {
  assert.equal(IPC_CHANNELS.contextMenuShowConversation, 'context-menu:show-conversation');
  assert.equal(IPC_CHANNELS.contextMenuShowProject, 'context-menu:show-project');
  assert.equal(IPC_CHANNELS.contextMenuShowSidebarBackground, 'context-menu:show-sidebar-background');
});

test('ShowConversationContextMenuRequest and ConversationContextMenuAction match contracts', () => {
  const req: ShowConversationContextMenuRequest = {
    conversationId: 'c1',
    isArchived: false,
    isPinned: true,
    isSettled: false,
    isSnoozed: true,
    snoozePresets: [{ id: 'later', label: 'Later today', whenLabel: '5:00 PM', snoozedUntil: '2026-09-03T17:00:00Z' }],
    canFork: true,
    canRename: true,
  };
  assert.equal(req.conversationId, 'c1');
  assert.equal(req.isPinned, true);

  const snoozeAction: ConversationContextMenuAction = {
    action: 'snooze',
    conversationId: 'c1',
    snoozedUntil: '2026-09-03T17:00:00Z',
  };
  const wakeAction: ConversationContextMenuAction = {
    action: 'wake',
    conversationId: 'c1',
  };
  const deleteAction: ConversationContextMenuAction = {
    action: 'delete',
    conversationId: 'c1',
  };

  assert.equal(snoozeAction.action, 'snooze');
  assert.equal(wakeAction.action, 'wake');
  assert.equal(deleteAction.action, 'delete');

  const regenAction: ConversationContextMenuAction = {
    action: 'regenerate-title',
    conversationId: 'c1',
  };
  const unreadAction: ConversationContextMenuAction = {
    action: 'mark-unread',
    conversationId: 'c1',
  };
  const readAction: ConversationContextMenuAction = {
    action: 'mark-read',
    conversationId: 'c1',
  };
  const settingsAction: ConversationContextMenuAction = {
    action: 'project-settings',
    conversationId: 'c1',
  };

  assert.equal(regenAction.action, 'regenerate-title');
  assert.equal(unreadAction.action, 'mark-unread');
  assert.equal(readAction.action, 'mark-read');
  assert.equal(settingsAction.action, 'project-settings');
});

test('IPC channel conversationsRegenerateTitle is defined', () => {
  assert.equal(IPC_CHANNELS.conversationsRegenerateTitle, 'conversations:regenerate-title');
});

test('ShowProjectContextMenuRequest and ProjectContextMenuAction match contracts', () => {
  const req: ShowProjectContextMenuRequest = {
    projectId: 'p1',
    projectTitle: 'Atlas',
    projectExists: true,
    isPinned: false,
    canRename: true,
  };
  assert.equal(req.projectId, 'p1');

  const newChatAction: ProjectContextMenuAction = {
    action: 'new-chat',
    projectId: 'p1',
  };
  const revealAction: ProjectContextMenuAction = {
    action: 'reveal',
    projectId: 'p1',
  };

  assert.equal(newChatAction.action, 'new-chat');
  assert.equal(revealAction.action, 'reveal');
});

test('ShowSidebarBackgroundContextMenuRequest and SidebarBackgroundContextMenuAction match contracts', () => {
  const req: ShowSidebarBackgroundContextMenuRequest = {
    hasActiveProject: true,
  };
  assert.equal(req.hasActiveProject, true);

  const newChatAction: SidebarBackgroundContextMenuAction = {
    action: 'new-chat',
  };
  const attachProjectAction: SidebarBackgroundContextMenuAction = {
    action: 'attach-project',
  };

  assert.equal(newChatAction.action, 'new-chat');
  assert.equal(attachProjectAction.action, 'attach-project');
});
