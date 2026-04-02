import { z } from 'zod';

export const KEYBINDING_COMMANDS = [
  'app.commandPalette.toggle',
  'sidebar.toggle',
  'chat.new',
  'settings.open',
  'composer.focus',
  'models.openSwitcher',
  'conversation.previous',
  'conversation.next',
  'conversation.jump.1',
  'conversation.jump.2',
  'conversation.jump.3',
  'conversation.jump.4',
  'conversation.jump.5',
  'conversation.jump.6',
  'conversation.jump.7',
  'conversation.jump.8',
  'conversation.jump.9',
] as const;

export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number];

export const KEYBINDING_WHEN_IDENTIFIERS = [
  'view.chat',
  'view.settings',
  'commandPalette.open',
  'modelPicker.open',
  'composer.focus',
] as const;

export type KeybindingWhenIdentifier = (typeof KEYBINDING_WHEN_IDENTIFIERS)[number];

export type KeybindingShortcut = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  modKey: boolean;
};

export type KeybindingRule = {
  command: KeybindingCommand;
  shortcut: KeybindingShortcut;
  when?: string;
};

export type KeybindingWhenNode =
  | {
      type: 'identifier';
      value: KeybindingWhenIdentifier;
    }
  | {
      type: 'not';
      child: KeybindingWhenNode;
    }
  | {
      type: 'and' | 'or';
      left: KeybindingWhenNode;
      right: KeybindingWhenNode;
    };

export type ResolvedKeybindingRule = {
  command: KeybindingCommand;
  shortcut: KeybindingShortcut;
  whenAst?: KeybindingWhenNode;
};

export type KeybindingContext = Record<KeybindingWhenIdentifier, boolean>;

export const KeybindingShortcutSchema = z.object({
  key: z.string().trim().min(1).max(64),
  metaKey: z.boolean().default(false),
  ctrlKey: z.boolean().default(false),
  shiftKey: z.boolean().default(false),
  altKey: z.boolean().default(false),
  modKey: z.boolean().default(false),
});

export const KeybindingRuleSchema = z.object({
  command: z.enum(KEYBINDING_COMMANDS),
  shortcut: KeybindingShortcutSchema,
  when: z.string().trim().min(1).max(256).optional(),
});

export const KeybindingRulesSchema = z.array(KeybindingRuleSchema).max(256);

export const DEFAULT_KEYBINDING_RULES: KeybindingRule[] = [
  {
    command: 'app.commandPalette.toggle',
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
    command: 'sidebar.toggle',
    shortcut: {
      key: 'b',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
    when: 'view.chat',
  },
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
  },
  {
    command: 'settings.open',
    shortcut: {
      key: ',',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
  },
  {
    command: 'composer.focus',
    shortcut: {
      key: 'l',
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    },
    when: 'view.chat',
  },
  {
    command: 'models.openSwitcher',
    shortcut: {
      key: 'm',
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    },
    when: 'view.chat',
  },
  {
    command: 'conversation.previous',
    shortcut: {
      key: 'ArrowUp',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      modKey: true,
    },
    when: 'view.chat',
  },
  {
    command: 'conversation.next',
    shortcut: {
      key: 'ArrowDown',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      modKey: true,
    },
    when: 'view.chat',
  },
  ...Array.from({ length: 9 }, (_value, index) => ({
    command: `conversation.jump.${index + 1}` as KeybindingCommand,
    shortcut: {
      key: String(index + 1),
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
    when: 'view.chat',
  })),
];

type WhenToken =
  | { type: 'identifier'; value: KeybindingWhenIdentifier }
  | { type: 'and' | 'or' | 'not' | 'lparen' | 'rparen' };

function tokenizeWhenExpression(input: string) {
  const tokens: WhenToken[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const char = input[cursor];

    if (!char) {
      break;
    }

    if (/\s/.test(char)) {
      cursor += 1;
      continue;
    }

    const next = input.slice(cursor, cursor + 2);
    if (next === '&&') {
      tokens.push({ type: 'and' });
      cursor += 2;
      continue;
    }

    if (next === '||') {
      tokens.push({ type: 'or' });
      cursor += 2;
      continue;
    }

    if (char === '!') {
      tokens.push({ type: 'not' });
      cursor += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'lparen' });
      cursor += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen' });
      cursor += 1;
      continue;
    }

    const match = /^[A-Za-z][A-Za-z0-9.]*/.exec(input.slice(cursor));
    if (!match) {
      throw new Error(`Invalid keybinding condition near "${input.slice(cursor)}".`);
    }

    const identifier = match[0] as KeybindingWhenIdentifier;
    if (!KEYBINDING_WHEN_IDENTIFIERS.includes(identifier)) {
      throw new Error(`Unsupported keybinding condition "${identifier}".`);
    }

    tokens.push({ type: 'identifier', value: identifier });
    cursor += match[0].length;
  }

  return tokens;
}

export function parseKeybindingWhenExpression(input: string): KeybindingWhenNode {
  const tokens = tokenizeWhenExpression(input);
  let index = 0;

  const peek = () => tokens[index];
  const consume = () => tokens[index++];

  const parsePrimary = (): KeybindingWhenNode => {
    const token = consume();
    if (!token) {
      throw new Error('Unexpected end of keybinding condition.');
    }

    if (token.type === 'identifier') {
      return {
        type: 'identifier',
        value: token.value,
      };
    }

    if (token.type === 'not') {
      return {
        type: 'not',
        child: parsePrimary(),
      };
    }

    if (token.type === 'lparen') {
      const expression = parseOr();
      const closing = consume();
      if (!closing || closing.type !== 'rparen') {
        throw new Error('Expected ")" in keybinding condition.');
      }
      return expression;
    }

    throw new Error(`Unexpected token "${token.type}" in keybinding condition.`);
  };

  const parseAnd = (): KeybindingWhenNode => {
    let left = parsePrimary();

    while (peek()?.type === 'and') {
      consume();
      left = {
        type: 'and',
        left,
        right: parsePrimary(),
      };
    }

    return left;
  };

  const parseOr = (): KeybindingWhenNode => {
    let left = parseAnd();

    while (peek()?.type === 'or') {
      consume();
      left = {
        type: 'or',
        left,
        right: parseAnd(),
      };
    }

    return left;
  };

  const result = parseOr();
  if (index < tokens.length) {
    throw new Error('Unexpected trailing input in keybinding condition.');
  }

  return result;
}

export function evaluateKeybindingWhen(node: KeybindingWhenNode, context: KeybindingContext): boolean {
  if (node.type === 'identifier') {
    return context[node.value];
  }

  if (node.type === 'not') {
    return !evaluateKeybindingWhen(node.child, context);
  }

  if (node.type === 'and') {
    return evaluateKeybindingWhen(node.left, context) && evaluateKeybindingWhen(node.right, context);
  }

  return evaluateKeybindingWhen(node.left, context) || evaluateKeybindingWhen(node.right, context);
}

export function cloneKeybindingRules(rules: KeybindingRule[]) {
  return rules.map((rule) => ({
    command: rule.command,
    shortcut: { ...rule.shortcut },
    ...(rule.when ? { when: rule.when } : {}),
  }));
}

export function getDefaultKeybindingRules() {
  return cloneKeybindingRules(DEFAULT_KEYBINDING_RULES);
}

export function parseKeybindingRules(value: unknown) {
  const rules = KeybindingRulesSchema.parse(value);
  for (const rule of rules) {
    if (rule.when) {
      parseKeybindingWhenExpression(rule.when);
    }
  }

  return rules;
}

export function resolveKeybindingRules(rules: KeybindingRule[]): ResolvedKeybindingRule[] {
  return parseKeybindingRules(rules).map((rule) => ({
    command: rule.command,
    shortcut: rule.shortcut,
    whenAst: rule.when ? parseKeybindingWhenExpression(rule.when) : undefined,
  }));
}

export function decodeKeybindingRules(value: unknown) {
  try {
    return parseKeybindingRules(value);
  } catch {
    return getDefaultKeybindingRules();
  }
}
