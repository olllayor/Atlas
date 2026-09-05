import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { ChildProcess } from 'node:child_process';

import { AcpClient, AcpError, type AcpSessionInfo } from '../src/main/ai/acp/acpClient.js';

class FakeStdin {
  readonly lines: string[] = [];

  constructor(private readonly onWrite?: (line: string) => void) {}

  write(line: string): boolean {
    this.lines.push(line);
    this.onWrite?.(line);
    return true;
  }

  frames(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin: FakeStdin;
  readonly pid = 424242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills: Array<NodeJS.Signals | undefined> = [];

  constructor(onWrite?: (line: string) => void) {
    super();
    this.stdin = new FakeStdin(onWrite);
  }

  override kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal);
    if (signal === 'SIGKILL') {
      this.exitCode = null;
      this.signalCode = 'SIGKILL';
      this.emit('exit', null, 'SIGKILL');
    } else if (signal === 'SIGTERM') {
      // Die like a well-behaved child so shutdown never waits out the grace.
      setImmediate(() => {
        this.exitCode = 0;
        this.emit('exit', 0, null);
      });
    }
    return true;
  }

  emitFrame(frame: unknown): void {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
  }

  emitRaw(text: string): void {
    this.stdout.emit('data', Buffer.from(text));
  }

  simulateExit(): void {
    this.exitCode = 1;
    this.emit('exit', 1, null);
  }
}

function answerInitialize(
  child: FakeChild,
  requestId: number,
  agentCapabilities: unknown = { sessionCapabilities: { resume: {} } }
): void {
  child.emitFrame({
    jsonrpc: '2.0',
    id: requestId,
    result: {
      protocolVersion: 1,
      agentCapabilities,
      authMethods: [{ id: 'opencode-login' }],
      agentInfo: { name: 'OpenCode', version: '1.18.27' }
    }
  });
}

test('a binary that does not exist fails the start instead of crashing the process', async () => {
  let evicted = 0;
  const client = new AcpClient({
    cwd: '/proj',
    binaryPath: '/nope/claude-code-acp',
    onExit: () => {
      evicted += 1;
    },
    childFactory: () => {
      const child = new FakeChild();
      // Node reports a failed spawn as an `error` event, never `exit`.
      setImmediate(() => {
        const failure: NodeJS.ErrnoException = new Error('spawn ENOENT');
        failure.code = 'ENOENT';
        child.emit('error', failure);
      });
      return child as unknown as ChildProcess;
    }
  });

  await assert.rejects(() => client.start(), /was not found/);
  assert.equal(evicted, 1, 'the owner is told to evict the dead client');
});

function startHarness(
  onWrite?: (line: string, child: FakeChild) => void,
  options: {
    spawnTimeoutMs?: number;
    onConfigOptionsUpdated?: (info: AcpSessionInfo) => void;
    onStderr?: (chunk: string) => void | Promise<void>;
    agentCapabilities?: unknown;
  } = {}
): { client: AcpClient; child: () => FakeChild } {
  let current: FakeChild | null = null;
  const client = new AcpClient({
    cwd: '/proj',
    ...(options.spawnTimeoutMs !== undefined ? { spawnTimeoutMs: options.spawnTimeoutMs } : {}),
    ...(options.onConfigOptionsUpdated
      ? { onConfigOptionsUpdated: options.onConfigOptionsUpdated }
      : {}),
    ...(options.onStderr ? { onStderr: options.onStderr } : {}),
    childFactory: () => {
      const child = new FakeChild(onWrite ? (line) => onWrite(line, child) : undefined);
      current = child;
      // Answer the handshake on the next tick, like a real agent would.
      setImmediate(() => {
        const init = child.stdin.frames().find((frame) => frame.method === 'initialize');
        if (typeof init?.id === 'number') {
          answerInitialize(child, init.id, options.agentCapabilities);
        }
      });
      return child as unknown as ChildProcess;
    }
  });
  return {
    client,
    child: () => {
      assert.ok(current, 'child was spawned');
      return current;
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('start finishes the initialize handshake and exposes capabilities', async () => {
  const { client } = startHarness();
  const { capabilities, authMethods } = await client.start();

  assert.deepEqual(capabilities, { sessionCapabilities: { resume: {} } });
  assert.deepEqual(authMethods, [{ id: 'opencode-login' }]);
  await client.shutdown();
});

test('start times out when the agent stays silent', async () => {
  let current: FakeChild | null = null;
  const client = new AcpClient({
    cwd: '/proj',
    spawnTimeoutMs: 20,
    childFactory: () => {
      current = new FakeChild();
      return current as unknown as ChildProcess;
    }
  });

  await assert.rejects(client.start(), /Timed out.*handshake/);
  assert.ok(current);
});

test('stderr handler failures reject the in-flight handshake', async () => {
  const client = new AcpClient({
    cwd: '/proj',
    onStderr: () => {
      throw new Error('browser helper failed');
    },
    childFactory: () => {
      const child = new FakeChild();
      setImmediate(() => {
        child.stderr.emit('data', Buffer.from('browser helper output\n'));
      });
      return child as unknown as ChildProcess;
    }
  });

  await assert.rejects(client.start(), /browser helper failed/);
});

test('createSession parses the model catalog from config options', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/new') {
      setImmediate(() =>
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          result: {
            sessionId: 'ses_1',
            configOptions: [
              {
                id: 'model',
                currentValue: 'opencode/big-pickle',
                options: [
                  { value: 'opencode/big-pickle', name: 'Big Pickle' },
                  { value: 'opencode/other', name: 'Other' }
                ]
              },
              { id: 'unrelated', options: [] }
            ]
          }
        })
      );
    }
  });
  await client.start();

  const session = await client.createSession();
  assert.equal(session.sessionId, 'ses_1');
  assert.equal(session.currentModel, 'opencode/big-pickle');
  assert.deepEqual(session.models, [
    { value: 'opencode/big-pickle', name: 'Big Pickle' },
    { value: 'opencode/other', name: 'Other' }
  ]);
  assert.equal(child().stdin.frames().find((frame) => frame.method === 'session/new')?.params !== undefined, true);
  const params = child().stdin.frames().find((frame) => frame.method === 'session/new')
    ?.params as Record<string, unknown>;
  assert.equal(params.cwd, '/proj');
  await client.shutdown();
});

test('config option notifications refresh the catalog, including an empty catalog', async () => {
  const updates: AcpSessionInfo[] = [];
  const { client, child } = startHarness(undefined, {
    onConfigOptionsUpdated: (info) => updates.push(info)
  });
  await client.start();
  child().emitFrame({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'ses_1',
      update: { sessionUpdate: 'config_option_update', configOptions: [] }
    }
  });
  await flush();
  assert.deepEqual(updates, [{ sessionId: 'ses_1', models: [], currentModel: null }]);
  await client.shutdown();
});

test('prompt collects message chunks and returns stop reason plus usage', async () => {
  const { client } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      setImmediate(() => {
        agent.emitFrame({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'ses_1',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'acp-' }
            }
          }
        });
        agent.emitFrame({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'ses_1',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'ok' }
            }
          }
        });
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          result: {
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 1 }
          }
        });
      });
    }
  });
  await client.start();

  const chunks: string[] = [];
  const result = await client.prompt('ses_1', [{ type: 'text', text: 'hi' }], ({ delta }) => {
    chunks.push(delta);
  });
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.text, 'acp-ok');
  assert.deepEqual(chunks, ['acp-', 'ok']);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 2, cachedReadTokens: 1 });
  await client.shutdown();
});

test('a second prompt on the same session rejects; other sessions run free', async () => {
  const { client } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      // Answer only the ses_b turn; ses_a hangs until shutdown.
      if ((frame.params as Record<string, unknown>).sessionId === 'ses_b') {
        setImmediate(() =>
          agent.emitFrame({
            jsonrpc: '2.0',
            id: frame.id,
            result: { stopReason: 'end_turn', usage: {} }
          })
        );
      }
    }
  });
  await client.start();

  // No server answer is scripted, so the first prompt hangs until shutdown.
  const first = client.prompt('ses_a', [{ type: 'text', text: 'one' }]);
  first.catch(() => undefined);
  await assert.rejects(
    client.prompt('ses_a', [{ type: 'text', text: 'again' }]),
    /already in flight on this session/
  );
  const second = await client.prompt('ses_b', [{ type: 'text', text: 'two' }]);
  assert.equal(second.stopReason, 'end_turn');
  await client.shutdown();
  await assert.rejects(first, /shut down/);
});

test('cancel sends an id-less notification, never a request', async () => {
  const { client, child } = startHarness();
  await client.start();

  client.cancel('ses_9');
  const frames = child().stdin.frames();
  const cancel = frames.find((frame) => frame.method === 'session/cancel');
  assert.ok(cancel);
  assert.equal('id' in cancel, false);
  assert.deepEqual(cancel.params, { sessionId: 'ses_9' });
  await client.shutdown();
});

test('permission asks resolve to the offered reject option', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      setImmediate(() => {
        agent.emitFrame({
          jsonrpc: '2.0',
          id: 7,
          method: 'session/request_permission',
          params: {
            sessionId: 'ses_1',
            toolCall: { toolCallId: 'call_1' },
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
              { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
            ]
          }
        });
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          result: { stopReason: 'end_turn', usage: {} }
        });
      });
    }
  });
  await client.start();

  await client.prompt('ses_1', [{ type: 'text', text: 'do a thing' }]);
  const replies = child()
    .stdin.frames()
    .filter((frame) => frame.id === 7);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0]?.result, { outcome: { outcome: 'selected', optionId: 'reject' } });
  await client.shutdown();
});

test('reads outside the workspace are denied without touching disk', async () => {
  const reads: string[] = [];
  let agent: FakeChild | null = null;
  const client = new AcpClient({
    cwd: '/proj',
    childFactory: () => {
      const child = new FakeChild((line) => {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.method === 'initialize' && typeof frame.id === 'number') {
          setImmediate(() => answerInitialize(child, frame.id as number));
        }
        if (frame.method === 'session/prompt') {
          setImmediate(() => {
            child.emitFrame({
              jsonrpc: '2.0',
              id: 3,
              method: 'fs/read_text_file',
              params: { path: '/etc/passwd' }
            });
            child.emitFrame({
              jsonrpc: '2.0',
              id: frame.id,
              result: { stopReason: 'end_turn', usage: {} }
            });
          });
        }
      });
      agent = child;
      return child as unknown as ChildProcess;
    },
    readTextFile: async (path) => {
      reads.push(path);
      return 'secret';
    }
  });
  await client.start();

  await client.prompt('ses_1', [{ type: 'text', text: 'read outside' }]);
  assert.ok(agent);
  const replies = agent
    .stdin.frames()
    .filter((frame) => frame.id === 3);
  assert.equal(replies.length, 1);
  assert.match(String((replies[0]?.error as Record<string, unknown> | undefined)?.message ?? ''), /denied/);
  assert.deepEqual(reads, []);
  await client.shutdown();
});

test('writes, terminals, and unknown methods are refused with codes', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      setImmediate(() => {
        agent.emitFrame({
          jsonrpc: '2.0',
          id: 11,
          method: 'fs/write_text_file',
          params: { path: '/proj/notes.txt', content: 'hi' }
        });
        for (const [id, method] of [
          [12, 'terminal/create'],
          [13, 'frob/nicate']
        ] as const) {
          agent.emitFrame({
            jsonrpc: '2.0',
            id,
            method,
            params:
              method === 'fs/write_text_file'
                ? { sessionId: 'ses_1', path: '/proj/file.txt', content: 'x' }
                : {}
          });
        }
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          result: { stopReason: 'end_turn', usage: {} }
        });
      });
    }
  });
  await client.start();

  await client.prompt('ses_1', [{ type: 'text', text: 'try everything' }]);
  const byId = new Map(
    child()
      .stdin.frames()
      .filter((frame) => typeof frame.id === 'number' && frame.error !== undefined)
      .map((frame) => [frame.id, frame.error as Record<string, unknown>])
  );
  // A well-formed write with no handler is denied (no approval surface);
  // malformed params fail validation first.
  assert.equal(byId.get(11)?.code, -32000);
  assert.equal(byId.get(12)?.code, -32000);
  assert.equal(byId.get(13)?.code, -32601);
  await client.shutdown();
});

test('malformed writes fail validation', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      setImmediate(() => {
        agent.emitFrame({ jsonrpc: '2.0', id: 21, method: 'fs/write_text_file', params: {} });
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          result: { stopReason: 'end_turn', usage: {} }
        });
      });
    }
  });
  await client.start();
  await client.prompt('ses_1', [{ type: 'text', text: 'bad write' }]);
  const byId = new Map(
    child()
      .stdin.frames()
      .filter((frame) => typeof frame.id === 'number' && frame.error !== undefined)
      .map((frame) => [frame.id, frame.error as Record<string, unknown>])
  );
  assert.equal(byId.get(21)?.code, -32602);
  await client.shutdown();
});

test('agent exit fails the in-flight prompt', async () => {
  const { client, child } = startHarness();
  await client.start();

  const pending = client.prompt('ses_1', [{ type: 'text', text: 'never answered' }]);
  await flush();
  child().simulateExit();
  await assert.rejects(pending, /exited/);
});

test('updates arriving before a handler registers are replayed', async () => {
  const { client, child } = startHarness();
  await client.start();

  child().emitFrame({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'ses_1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'early' } }
    }
  });
  child().emitRaw('this is a log line, not json\n');
  await flush();

  const seen: string[] = [];
  client.handleSessionUpdate((update) => {
    if (update.text !== undefined) {
      seen.push(update.text);
    }
  });
  assert.deepEqual(seen, ['early']);
  await client.shutdown();
});

test('resumeSession re-attaches and setModel selects via configId model', async () => {
  const { client } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    const answer = (result: unknown) =>
      setImmediate(() => agent.emitFrame({ jsonrpc: '2.0', id: frame.id, result }));
    if (frame.method === 'session/resume') {
      answer({ sessionId: 'ses_old', configOptions: [] });
    }
    if (frame.method === 'session/set_config_option') {
      const params = frame.params as Record<string, unknown>;
      assert.equal(params.configId, 'model');
      answer({ sessionId: 'ses_old', configOptions: [] });
    }
  });
  await client.start();

  const resumed = await client.resumeSession('ses_old');
  assert.equal(resumed.sessionId, 'ses_old');
  const updated = await client.setModel('ses_old', 'opencode/big-pickle');
  assert.equal(updated.sessionId, 'ses_old');
  await client.shutdown();
});

test('prompt resolves file blocks and reports skipped entries', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  let agent: FakeChild | null = null;
  const client = new AcpClient({
    cwd: '/proj',
    childFactory: () => {
      const child = new FakeChild((line) => {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.method === 'initialize' && typeof frame.id === 'number') {
          setImmediate(() => answerInitialize(child, frame.id as number));
        }
        if (frame.method === 'session/prompt') {
          setImmediate(() =>
            child.emitFrame({
              jsonrpc: '2.0',
              id: frame.id,
              result: { stopReason: 'end_turn', usage: {} }
            })
          );
        }
      });
      agent = child;
      return child as unknown as ChildProcess;
    },
    readFileBytes: async (path) => {
      if (path === '/proj/pic.png') return png;
      if (path === '/proj/note.txt') return Buffer.from('hello file', 'utf8');
      throw new Error(`unexpected read ${path}`);
    }
  });
  await client.start();

  const result = await client.prompt('ses_1', [
    { type: 'text', text: 'see attached' },
    { type: 'file', mime: 'image/png', path: '/proj/pic.png' },
    { type: 'file', mime: 'text/plain', path: '/proj/note.txt' },
    { type: 'file', mime: 'application/zip', path: '/proj/blob.zip' },
    { type: 'file', mime: 'text/plain', path: '/etc/passwd' }
  ]);

  assert.ok(agent);
  const promptFrame = agent.stdin
    .frames()
    .find((frame) => frame.method === 'session/prompt');
  const sent = (promptFrame?.params as { prompt: Array<Record<string, unknown>> }).prompt;
  assert.deepEqual(sent[0], { type: 'text', text: 'see attached' });
  assert.equal((sent[1] as Record<string, unknown>).type, 'image');
  assert.equal((sent[1] as Record<string, unknown>).mimeType, 'image/png');
  assert.equal((sent[1] as Record<string, unknown>).data, png.toString('base64'));
  assert.deepEqual(sent[2], {
    type: 'resource',
    resource: { uri: 'file:///proj/note.txt', mimeType: 'text/plain', text: 'hello file' }
  });
  // Skipped files degrade to a trailing path line.
  assert.match(String((sent[sent.length - 1] as Record<string, unknown>).text), /blob\.zip/);
  assert.match(String((sent[sent.length - 1] as Record<string, unknown>).text), /passwd/);
  assert.deepEqual(
    result.skipped.map((entry) => entry.path),
    ['/proj/blob.zip', '/etc/passwd']
  );
  await client.shutdown();
});

test('a registered permission handler routes asks to resolvePermission', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/prompt') {
      setImmediate(() => {
        agent.emitFrame({
          jsonrpc: '2.0',
          id: 9,
          method: 'session/request_permission',
          params: {
            sessionId: 'ses_1',
            toolCall: { toolCallId: 'call_2' },
            options: [
              { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
              { optionId: 'reject', kind: 'reject_once', name: 'Reject' }
            ]
          }
        });
        // Answer the turn after the test had a chance to resolve the ask.
        setTimeout(
          () =>
            agent.emitFrame({
              jsonrpc: '2.0',
              id: frame.id,
              result: { stopReason: 'end_turn', usage: {} }
            }),
          30
        );
      });
    }
  });
  await client.start();

  const asked: string[] = [];
  client.setPermissionHandler((ask) => {
    asked.push(ask.approvalId);
  });
  // Resolve before the turn completes so the agent is never left hanging.
  setTimeout(() => client.resolvePermission('call_2', 'approve'), 10);
  await client.prompt('ses_1', [{ type: 'text', text: 'do a thing' }]);

  assert.deepEqual(asked, ['call_2']);
  const replies = child()
    .stdin.frames()
    .filter((frame) => frame.id === 9);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0]?.result, { outcome: { outcome: 'selected', optionId: 'once' } });

  // Settled ids no-op.
  client.resolvePermission('call_2', 'deny');
  assert.equal(
    child()
      .stdin.frames()
      .filter((frame) => frame.id === 9).length,
    1
  );
  await client.shutdown();
});

test('authenticate passes the method id through untouched', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'authenticate') {
      setImmediate(() =>
        agent.emitFrame({ jsonrpc: '2.0', id: frame.id, result: { ok: true } })
      );
    }
  });
  await client.start();

  const result = await client.authenticate('opencode-login');
  assert.deepEqual(result, { ok: true });
  const sent = child()
    .stdin.frames()
    .find((frame) => frame.method === 'authenticate');
  assert.deepEqual(sent?.params, { methodId: 'opencode-login' });
  await client.shutdown();
});

test('logout requires the advertised capability and sends the ACP request', async () => {
  const { client, child } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'logout') {
      setImmediate(() => agent.emitFrame({ jsonrpc: '2.0', id: frame.id, result: {} }));
    }
  }, {
    agentCapabilities: { auth: { logout: true } }
  });

  await client.logout();
  const sent = child()
    .stdin.frames()
    .find((frame) => frame.method === 'logout');
  assert.deepEqual(sent?.params, {});
  await client.shutdown();
});

test('agent exit fires onExit and a respawn starts clean', async () => {
  let exits = 0;
  const children: FakeChild[] = [];
  const client = new AcpClient({
    cwd: '/proj',
    childFactory: () => {
      const child = new FakeChild((line) => {
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.method === 'initialize' && typeof frame.id === 'number') {
          setImmediate(() => answerInitialize(child, frame.id as number));
        }
      });
      children.push(child);
      return child as unknown as ChildProcess;
    },
    onExit: () => {
      exits += 1;
    }
  });
  await client.start();

  children[0]!.simulateExit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits, 1);

  // The cached death does not poison the respawn.
  const { capabilities } = await client.start();
  assert.deepEqual(capabilities, { sessionCapabilities: { resume: {} } });
  assert.equal(children.length, 2);
  await client.shutdown();
});

test('agent errors carry code and data; not-found matches on code', async () => {
  const { client } = startHarness((line, agent) => {
    const frame = JSON.parse(line) as Record<string, unknown>;
    if (frame.method === 'session/resume') {
      setImmediate(() =>
        agent.emitFrame({
          jsonrpc: '2.0',
          id: frame.id,
          error: { code: 404, message: 'gone', data: { sessionId: 'ses_old' } }
        })
      );
    }
  });
  await client.start();

  const error = await client.resumeSession('ses_old').then(
    () => null,
    (cause: unknown) => cause
  );
  assert.ok(error instanceof AcpError);
  assert.equal((error as AcpError).code, 404);
  assert.deepEqual((error as AcpError).data, { sessionId: 'ses_old' });
  const { isAcpNotFound } = await import('../src/main/ai/acp/acpClient.js');
  assert.equal(isAcpNotFound(error), true);
  assert.equal(isAcpNotFound(new Error('plain failure')), false);
  await client.shutdown();
});

test('stderr tail rides on the exit error', async () => {
  const { client, child } = startHarness();
  await client.start();

  child().emitRaw('log line one\n');
  const pending = client.prompt('ses_1', [{ type: 'text', text: 'never answered' }]);
  pending.catch(() => undefined);
  child().stderr.emit('data', Buffer.from('FATAL: something broke badly\n'));
  child().simulateExit();
  await assert.rejects(pending, /something broke badly/);
});

test("boundToolOutput bounds large tool outputs to 8000 characters tail", async () => {
  const { boundToolOutput, MAX_ACP_TOOL_OUTPUT_CHARS } = await import("../src/main/ai/acp/acpClient.js");
  assert.equal(boundToolOutput(undefined), undefined);
  assert.equal(boundToolOutput("short text"), "short text");
  const oversized = "A".repeat(10_000);
  const bounded = boundToolOutput(oversized);
  assert.ok(bounded?.startsWith("[Earlier output truncated]\n\n"));
  assert.equal(bounded?.endsWith("A".repeat(MAX_ACP_TOOL_OUTPUT_CHARS)), true);
});

test("a newline-free output flood resets the client instead of buffering unbounded", async () => {
  const { client, child } = startHarness();
  await client.start();

  const pending = client.prompt("ses_1", [{ type: "text", text: "flood me" }]);
  pending.catch(() => undefined);
  // 17 MB with no newline: over the framing guard, under nothing legitimate.
  child().emitRaw("x".repeat(17_000_000));
  await flush();
  await assert.rejects(pending, /without a newline/);

  // The client is dead after the reset: further turns fail fast, and a
  // newline afterwards cannot resurrect a framing state that was dropped.
  await assert.rejects(client.prompt("ses_1", [{ type: "text", text: "again" }]), /shut down|dead|reset/i);
  await client.shutdown();
});
