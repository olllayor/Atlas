import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultKeybindingRules,
  parseKeybindingRules,
  parseKeybindingWhenExpression,
  resolveKeybindingRules,
} from '../src/shared/keybindings.js';
import { getAdjacentConversationId, getConversationJumpId } from '../src/renderer/lib/keybindingCommands.js';
import {
  formatShortcutLabel,
  isEditableTarget,
  matchesShortcut,
  resolveShortcutCommand,
  shouldShowConversationJumpHints,
} from '../src/renderer/lib/keybindings.js';

test('matchesShortcut respects modKey on macOS and non-macOS', () => {
  const [paletteRule] = resolveKeybindingRules(getDefaultKeybindingRules());
  assert.ok(paletteRule);

  assert.equal(
    matchesShortcut(
      { altKey: false, code: 'KeyK', ctrlKey: false, key: 'k', metaKey: true, shiftKey: false },
      paletteRule.shortcut,
      'mac',
    ),
    true,
  );
  assert.equal(
    matchesShortcut(
      { altKey: false, code: 'KeyK', ctrlKey: true, key: 'k', metaKey: false, shiftKey: false },
      paletteRule.shortcut,
      'windows',
    ),
    true,
  );
});

test('matchesShortcut normalizes event code aliases', () => {
  const rules = resolveKeybindingRules([
    {
      command: 'settings.open',
      shortcut: {
        key: '[',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: false,
      },
    },
  ]);

  assert.equal(
    resolveShortcutCommand(
      { altKey: false, code: 'BracketLeft', ctrlKey: false, key: '[', metaKey: false, shiftKey: false },
      rules,
      {
        context: {
          'view.chat': true,
          'view.settings': false,
          'commandPalette.open': false,
          'modelPicker.open': false,
          'composer.focus': false,
        },
        platform: 'linux',
      },
    ),
    'settings.open',
  );
});

test('resolveShortcutCommand uses last-binding-wins', () => {
  const rules = resolveKeybindingRules([
    {
      command: 'chat.new',
      shortcut: {
        key: 'k',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    },
    {
      command: 'settings.open',
      shortcut: {
        key: 'k',
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    },
  ]);

  assert.equal(
    resolveShortcutCommand(
      { altKey: false, code: 'KeyK', ctrlKey: true, key: 'k', metaKey: false, shiftKey: false },
      rules,
      {
        context: {
          'view.chat': true,
          'view.settings': false,
          'commandPalette.open': false,
          'modelPicker.open': false,
          'composer.focus': false,
        },
        platform: 'windows',
      },
    ),
    'settings.open',
  );
});

test('when expressions parse and evaluate correctly', () => {
  const ast = parseKeybindingWhenExpression('view.chat && !composer.focus');
  assert.equal(
    resolveShortcutCommand(
      { altKey: false, code: 'KeyN', ctrlKey: true, key: 'n', metaKey: false, shiftKey: false },
      resolveKeybindingRules([
        {
          command: 'chat.new',
          shortcut: {
            key: 'n',
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
          when: 'view.chat && !composer.focus',
        },
      ]),
      {
        context: {
          'view.chat': true,
          'view.settings': false,
          'commandPalette.open': false,
          'modelPicker.open': false,
          'composer.focus': false,
        },
        platform: 'windows',
      },
    ),
    'chat.new',
  );
  assert.equal(ast.type, 'and');
});

test('invalid when expressions are rejected', () => {
  assert.throws(
    () =>
      parseKeybindingRules([
        {
          command: 'chat.new',
          shortcut: {
            key: 'n',
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
          when: 'view.unknown',
        },
      ]),
    /Unsupported keybinding condition/,
  );
});

test('formatShortcutLabel uses platform-specific output', () => {
  const shortcut = {
    key: 'ArrowDown',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: true,
    modKey: true,
  };

  assert.equal(formatShortcutLabel(shortcut, 'mac'), '⌥⌘↓');
  assert.equal(formatShortcutLabel(shortcut, 'windows'), 'Ctrl+Alt+Down');
});

test('shouldShowConversationJumpHints detects matching held modifiers', () => {
  const rules = resolveKeybindingRules(getDefaultKeybindingRules());

  assert.equal(
    shouldShowConversationJumpHints(
      { altKey: false, code: 'MetaLeft', ctrlKey: false, key: 'Meta', metaKey: true, shiftKey: false },
      rules,
      {
        context: {
          'view.chat': true,
          'view.settings': false,
          'commandPalette.open': false,
          'modelPicker.open': false,
          'composer.focus': false,
        },
        platform: 'mac',
      },
    ),
    true,
  );
});

test('editable target detection handles inputs and plain elements', () => {
  assert.equal(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget), false);
});

test('conversation navigation helpers resolve adjacent and jump targets', () => {
  const conversations = [
    {
      id: 'one',
      title: 'One',
      createdAt: '',
      updatedAt: '',
      lastMessagePreview: null,
      lastUserMessagePreview: null,
      lastAssistantMessagePreview: null,
      lastMessageAt: null,
      defaultProviderId: null,
      defaultModelId: null,
    },
    {
      id: 'two',
      title: 'Two',
      createdAt: '',
      updatedAt: '',
      lastMessagePreview: null,
      lastUserMessagePreview: null,
      lastAssistantMessagePreview: null,
      lastMessageAt: null,
      defaultProviderId: null,
      defaultModelId: null,
    },
    {
      id: 'three',
      title: 'Three',
      createdAt: '',
      updatedAt: '',
      lastMessagePreview: null,
      lastUserMessagePreview: null,
      lastAssistantMessagePreview: null,
      lastMessageAt: null,
      defaultProviderId: null,
      defaultModelId: null,
    },
  ];

  assert.equal(getAdjacentConversationId(conversations, 'two', 'previous'), 'one');
  assert.equal(getAdjacentConversationId(conversations, 'two', 'next'), 'three');
  assert.equal(getConversationJumpId(conversations, 1), 'two');
});
