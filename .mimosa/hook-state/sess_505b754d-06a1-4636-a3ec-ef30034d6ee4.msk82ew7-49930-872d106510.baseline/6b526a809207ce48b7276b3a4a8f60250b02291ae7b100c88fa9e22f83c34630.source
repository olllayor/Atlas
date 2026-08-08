import type {
  KeybindingCommand,
  KeybindingContext,
  KeybindingRule,
  KeybindingShortcut,
  ResolvedKeybindingRule,
} from '../../shared/contracts';
import { evaluateKeybindingWhen } from '../../shared/keybindings';

export type ShortcutPlatform = 'mac' | 'windows' | 'linux';

type KeyboardEventLike = Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>;

const EVENT_CODE_ALIASES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
};

const KEY_ALIASES: Record<string, string> = {
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  ArrowUp: 'arrowup',
  Down: 'arrowdown',
  Esc: 'escape',
  Escape: 'escape',
  Left: 'arrowleft',
  Right: 'arrowright',
  Spacebar: 'space',
  Up: 'arrowup',
};

const MAC_MODIFIER_LABELS = {
  altKey: '⌥',
  ctrlKey: '⌃',
  metaKey: '⌘',
  shiftKey: '⇧',
} as const;

const WINDOWS_MODIFIER_LABELS = {
  altKey: 'Alt',
  ctrlKey: 'Ctrl',
  metaKey: 'Meta',
  shiftKey: 'Shift',
} as const;

const DISPLAY_KEY_LABELS: Record<string, string> = {
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  arrowup: 'Up',
  escape: 'Esc',
  space: 'Space',
};

const MAC_DISPLAY_KEY_LABELS: Record<string, string> = {
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  escape: '⎋',
  space: 'Space',
};

const MODIFIER_KEYS = new Set(['alt', 'control', 'meta', 'shift']);

function normalizeKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const alias = KEY_ALIASES[trimmed];
  if (alias) {
    return alias;
  }

  if (trimmed.length === 1) {
    return trimmed.toLowerCase();
  }

  return trimmed.toLowerCase();
}

function resolveExpectedModifiers(shortcut: KeybindingShortcut, platform: ShortcutPlatform) {
  return {
    altKey: Boolean(shortcut.altKey),
    ctrlKey: Boolean(shortcut.ctrlKey || (shortcut.modKey && platform !== 'mac')),
    metaKey: Boolean(shortcut.metaKey || (shortcut.modKey && platform === 'mac')),
    shiftKey: Boolean(shortcut.shiftKey),
  };
}

export function resolveShortcutPlatform(platform = navigator.platform) {
  const normalized = platform.toLowerCase();

  if (normalized.includes('mac')) {
    return 'mac';
  }

  if (normalized.includes('win')) {
    return 'windows';
  }

  return 'linux';
}

export function normalizeShortcutKey(key: string) {
  return normalizeKey(key);
}

export function getNormalizedEventKey(event: KeyboardEventLike) {
  return normalizeKey(EVENT_CODE_ALIASES[event.code] ?? event.key);
}

export function isModifierOnlyKey(key: string) {
  return MODIFIER_KEYS.has(normalizeShortcutKey(key));
}

export function serializeShortcut(shortcut: KeybindingShortcut) {
  const normalizedKey = normalizeShortcutKey(shortcut.key);
  return [
    normalizedKey,
    shortcut.metaKey ? 'meta' : '',
    shortcut.ctrlKey ? 'ctrl' : '',
    shortcut.shiftKey ? 'shift' : '',
    shortcut.altKey ? 'alt' : '',
    shortcut.modKey ? 'mod' : '',
  ]
    .filter(Boolean)
    .join('+');
}

export function createShortcutFromKeyboardEvent(
  event: KeyboardEventLike,
  platform: ShortcutPlatform,
): KeybindingShortcut | null {
  const key = getNormalizedEventKey(event);
  if (!key || isModifierOnlyKey(key)) {
    return null;
  }

  const useModKey =
    (platform === 'mac' && event.metaKey && !event.ctrlKey) ||
    (platform !== 'mac' && event.ctrlKey && !event.metaKey);

  return {
    key,
    metaKey: Boolean(useModKey ? false : event.metaKey),
    ctrlKey: Boolean(useModKey ? false : event.ctrlKey),
    shiftKey: Boolean(event.shiftKey),
    altKey: Boolean(event.altKey),
    modKey: useModKey,
  };
}

function matchesShortcutModifiers(event: KeyboardEventLike, shortcut: KeybindingShortcut, platform: ShortcutPlatform) {
  const expected = resolveExpectedModifiers(shortcut, platform);
  return (
    event.metaKey === expected.metaKey &&
    event.ctrlKey === expected.ctrlKey &&
    event.shiftKey === expected.shiftKey &&
    event.altKey === expected.altKey
  );
}

export function matchesShortcut(
  event: KeyboardEventLike,
  shortcut: KeybindingShortcut,
  platform: ShortcutPlatform,
) {
  return matchesShortcutModifiers(event, shortcut, platform) && getNormalizedEventKey(event) === normalizeShortcutKey(shortcut.key);
}

export function resolveShortcutCommand(
  event: KeyboardEventLike,
  keybindings: ResolvedKeybindingRule[],
  options: {
    context: KeybindingContext;
    platform: ShortcutPlatform;
  },
): KeybindingCommand | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const rule = keybindings[index];
    if (!rule) {
      continue;
    }

    if (rule.whenAst && !evaluateKeybindingWhen(rule.whenAst, options.context)) {
      continue;
    }

    if (matchesShortcut(event, rule.shortcut, options.platform)) {
      return rule.command;
    }
  }

  return null;
}

export function findEffectiveShortcutForCommand(
  keybindings: ResolvedKeybindingRule[],
  command: KeybindingCommand,
  options: {
    context: KeybindingContext;
  },
) {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const rule = keybindings[index];
    if (!rule || rule.command !== command) {
      continue;
    }

    if (rule.whenAst && !evaluateKeybindingWhen(rule.whenAst, options.context)) {
      continue;
    }

    return rule.shortcut;
  }

  return null;
}

function formatDisplayKey(key: string, platform: ShortcutPlatform) {
  const normalized = normalizeShortcutKey(key);
  const displayLabels = platform === 'mac' ? MAC_DISPLAY_KEY_LABELS : DISPLAY_KEY_LABELS;
  if (displayLabels[normalized]) {
    return displayLabels[normalized];
  }

  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatShortcutLabel(shortcut: KeybindingShortcut, platform: ShortcutPlatform) {
  const resolved = resolveExpectedModifiers(shortcut, platform);

  if (platform === 'mac') {
    return [
      resolved.ctrlKey ? MAC_MODIFIER_LABELS.ctrlKey : '',
      resolved.altKey ? MAC_MODIFIER_LABELS.altKey : '',
      resolved.shiftKey ? MAC_MODIFIER_LABELS.shiftKey : '',
      resolved.metaKey ? MAC_MODIFIER_LABELS.metaKey : '',
      formatDisplayKey(shortcut.key, platform),
    ]
      .filter(Boolean)
      .join('');
  }

  return [
    resolved.ctrlKey ? WINDOWS_MODIFIER_LABELS.ctrlKey : '',
    resolved.altKey ? WINDOWS_MODIFIER_LABELS.altKey : '',
    resolved.shiftKey ? WINDOWS_MODIFIER_LABELS.shiftKey : '',
    resolved.metaKey ? WINDOWS_MODIFIER_LABELS.metaKey : '',
    formatDisplayKey(shortcut.key, platform),
  ]
    .filter(Boolean)
    .join('+');
}

export function shortcutLabelForCommand(
  keybindings: ResolvedKeybindingRule[],
  command: KeybindingCommand,
  options: {
    context: KeybindingContext;
    platform: ShortcutPlatform;
  },
) {
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, {
    context: options.context,
  });

  return shortcut ? formatShortcutLabel(shortcut, options.platform) : null;
}

export function shouldShowConversationJumpHints(
  event: KeyboardEventLike,
  keybindings: ResolvedKeybindingRule[],
  options: {
    context: KeybindingContext;
    platform: ShortcutPlatform;
  },
) {
  for (let jump = 1; jump <= 9; jump += 1) {
    const shortcut = findEffectiveShortcutForCommand(keybindings, `conversation.jump.${jump}` as KeybindingCommand, {
      context: options.context,
    });

    if (!shortcut) {
      continue;
    }

    if (!matchesShortcutModifiers(event, shortcut, options.platform)) {
      continue;
    }

    if (getNormalizedEventKey(event) === normalizeShortcutKey(shortcut.key)) {
      continue;
    }

    return true;
  }

  return false;
}

export function shouldShowShortcutHintForCommand(
  event: KeyboardEventLike,
  keybindings: ResolvedKeybindingRule[],
  command: KeybindingCommand,
  options: {
    context: KeybindingContext;
    platform: ShortcutPlatform;
  },
) {
  const shortcut = findEffectiveShortcutForCommand(keybindings, command, {
    context: options.context,
  });

  if (!shortcut) {
    return false;
  }

  if (!matchesShortcutModifiers(event, shortcut, options.platform)) {
    return false;
  }

  if (getNormalizedEventKey(event) === normalizeShortcutKey(shortcut.key)) {
    return false;
  }

  return true;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const element = target as {
    closest?: (selector: string) => unknown;
    isContentEditable?: boolean;
    tagName?: string;
  };
  const tagName = element.tagName?.toLowerCase();

  return Boolean(
    element.isContentEditable ||
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      element.closest?.('[contenteditable="true"]'),
  );
}

export function resolveKeybindingConflicts(rules: KeybindingRule[], command: KeybindingCommand) {
  const targetRule = rules.find((rule) => rule.command === command);
  if (!targetRule) {
    return [];
  }

  const targetShortcut = serializeShortcut(targetRule.shortcut);
  if (!targetShortcut) {
    return [];
  }

  return rules
    .filter((rule) => rule.command !== command && serializeShortcut(rule.shortcut) === targetShortcut)
    .map((rule) => rule.command);
}
