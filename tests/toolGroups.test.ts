import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts';
import { buildToolCells, type ToolCell } from '../src/shared/toolCellGrammar';
import {
  commandProgram,
  groupToolCells,
  liveToolLabel,
  summarizeToolGroup,
} from '../src/shared/toolGroups';

function toolPart(overrides: Partial<ChatToolPart> & Pick<ChatToolPart, 'toolName'>): ChatToolPart {
  return {
    id: overrides.id ?? overrides.toolName,
    type: 'tool',
    toolCallId: overrides.toolCallId ?? overrides.id ?? overrides.toolName,
    toolName: overrides.toolName,
    state: 'output-available',
    ...overrides,
  } as ChatToolPart;
}

function cell(overrides: Partial<ToolCell> & Pick<ToolCell, 'id' | 'kind' | 'status'>): ToolCell {
  return {
    label: `${overrides.kind} ${overrides.id}`,
    verb: 'Did',
    subject: '',
    subjectIsCode: false,
    continuation: [],
    continuationOmitted: 0,
    continuationAll: [],
    detail: { type: 'none' },
    durationMs: null,
    parts: [],
    ...overrides,
  };
}

const settled = (id: string, kind: ToolCell['kind'] = 'command') =>
  cell({ id, kind, status: 'success' });
const live = (id: string, kind: ToolCell['kind'] = 'command') =>
  cell({ id, kind, status: 'running' });

describe('groupToolCells', () => {
  it('leaves a lone settled cell alone', () => {
    assert.deepEqual(groupToolCells([settled('a')]), [{ kind: 'single', cell: settled('a') }]);
  });

  it('leaves a lone live cell alone', () => {
    const groups = groupToolCells([live('a')]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.kind, 'single');
  });

  it('folds consecutive settled cells into one group keyed on the first cell', () => {
    const groups = groupToolCells([settled('a'), settled('b'), settled('c')]);
    assert.equal(groups.length, 1);
    const group = groups[0]!;
    assert.equal(group.kind, 'settled');
    if (group.kind === 'settled') {
      assert.equal(group.id, 'tg:settled:a');
      assert.deepEqual(
        group.cells.map((item) => item.id),
        ['a', 'b', 'c']
      );
    }
  });

  it('groups a trailing live run and keeps a separated live run visible', () => {
    const groups = groupToolCells([
      live('a'),
      live('b'),
      settled('c'),
      live('d'),
      live('e'),
    ]);
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['live', 'single', 'live']
    );
  });

  it('never folds an approval prompt', () => {
    const approval = cell({ id: 'appr', kind: 'edit', status: 'awaiting-approval' });
    const groups = groupToolCells([settled('a'), approval, settled('b')]);
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['single', 'single', 'single']
    );
  });

  it('folds real grammar output: buildToolCells explores merge, groups form around them', () => {
    const cells = buildToolCells([
      toolPart({ toolName: 'read_file', id: 'r1', toolCallId: 'r1', input: { path: 'a.ts' } }),
      toolPart({ toolName: 'read_file', id: 'r2', toolCallId: 'r2', input: { path: 'b.ts' } }),
      toolPart({
        toolName: 'bash',
        id: 'c1',
        toolCallId: 'c1',
        toolType: 'command_execution',
        input: { command: 'pnpm test' },
      }),
    ]);
    // Two reads coalesce into one Explored cell; the command stands alone.
    assert.equal(cells.length, 2);
    const groups = groupToolCells(cells);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.kind, 'settled');
  });
});

describe('summarizeToolGroup', () => {
  it('counts commands per call', () => {
    assert.deepEqual(summarizeToolGroup([settled('a'), settled('b')]), {
      text: 'Ran 2 commands',
      hasFailure: false,
    });
  });

  it('counts distinct edited files', () => {
    const first = cell({ id: 'a', kind: 'edit', status: 'success' });
    const second = cell({ id: 'b', kind: 'edit', status: 'success' });
    assert.equal(summarizeToolGroup([first, second]).text, 'Changed 2 files');
    assert.equal(summarizeToolGroup([first]).text, 'Changed 1 file');
  });

  it('reads explore entries as files and searches', () => {
    const exploreCell = cell({ id: 'e', kind: 'explore', status: 'success' });
    (exploreCell as { detail: ToolCell['detail'] }).detail = {
      type: 'explore',
      entries: [
        { label: 'Read', values: ['a.ts', 'b.ts'] },
        { label: 'Search', values: ['foo'], scope: 'src' },
      ],
    };
    assert.equal(
      summarizeToolGroup([exploreCell]).text,
      'Explored 2 files and searched code 1 time'
    );
  });

  it('joins three clauses with Oxford comma and lowercases after the first', () => {
    const web = cell({ id: 'w', kind: 'web', status: 'success' });
    assert.equal(summarizeToolGroup([settled('a'), settled('b'), web]).text, 'Ran 2 commands and searched the web 1 time');
  });

  it('flags failures without changing the counts', () => {
    const failed = cell({ id: 'f', kind: 'command', status: 'failed' });
    assert.deepEqual(summarizeToolGroup([settled('a'), failed]), {
      text: 'Ran 2 commands',
      hasFailure: true,
    });
  });

  it('calls anything else Used N tools', () => {
    const mcp = cell({ id: 'm', kind: 'mcp', status: 'success' });
    assert.equal(summarizeToolGroup([mcp]).text, 'Used 1 tool');
  });
});

describe('commandProgram', () => {
  it('takes the first token and strips directories', () => {
    assert.equal(commandProgram('pnpm test'), 'pnpm');
    assert.equal(commandProgram('/usr/local/bin/docker ps'), 'docker');
    assert.equal(commandProgram('  git   status  '), 'git');
  });

  it('respects quotes', () => {
    assert.equal(commandProgram('"my tool" --flag'), 'my tool');
  });

  it('skips assignments and unwraps env/sudo', () => {
    assert.equal(commandProgram('FOO=1 BAR=2 pnpm test'), 'pnpm');
    assert.equal(commandProgram('sudo systemctl restart x'), 'systemctl');
    assert.equal(commandProgram('env -u FOO pnpm test'), 'pnpm');
    assert.equal(commandProgram('sudo -u root npm run build'), 'npm');
  });

  it('returns null when nothing names a program', () => {
    assert.equal(commandProgram(''), null);
    assert.equal(commandProgram('   '), null);
    assert.equal(commandProgram('FOO=1'), null);
  });
});

describe('liveToolLabel', () => {
  it('names the latest command program', () => {
    const first = cell({ id: 'a', kind: 'command', status: 'running', subject: 'git status' });
    const second = cell({ id: 'b', kind: 'command', status: 'running', subject: 'pnpm test' });
    assert.equal(liveToolLabel([first, second]), 'Running pnpm');
  });

  it('falls back to the cell label for non-commands', () => {
    const searching = cell({
      id: 'w',
      kind: 'web',
      status: 'running',
      label: 'Searching the web',
    });
    assert.equal(liveToolLabel([searching]), 'Searching the web');
  });

  it('says Working with no cells', () => {
    assert.equal(liveToolLabel([]), 'Working');
  });
});
