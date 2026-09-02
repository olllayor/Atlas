import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseOrphanedOpenCodePids,
  reapOrphanedOpenCodeServers,
} from '../src/main/ai/providers/opencode/orphanReaper.js';

test('parseOrphanedOpenCodePids finds processes with PPID 1 running opencode serve', () => {
  const samplePs = `
  PID  PPID COMMAND
  100     1 /usr/sbin/syslogd
 1234     1 /path/to/bin/opencode serve --port 4096
 1235   500 /path/to/bin/opencode serve --port 4097
 1236     1 /path/to/bin/opencode2 serve --register
 1237     1 /usr/bin/python3 -m http.server
 1238     1 node /lib/opencode/cli.js serve
  `;

  const orphans = parseOrphanedOpenCodePids(samplePs);
  assert.deepEqual(orphans, [1234, 1236, 1238]);
});

test('parseOrphanedOpenCodePids ignores processes whose parent is not PID 1', () => {
  const samplePs = `
  PID  PPID COMMAND
 2001   501 opencode serve --port 1000
 2002  1000 opencode2 serve --register
  `;

  const orphans = parseOrphanedOpenCodePids(samplePs);
  assert.deepEqual(orphans, []);
});

test('reapOrphanedOpenCodeServers invokes killer for all detected orphans', async () => {
  const samplePs = `
 5001     1 /Users/test/bin/opencode serve --hostname=127.0.0.1 --port=9000
 5002     1 /Users/test/bin/opencode2 serve --register
 5003   100 /Users/test/bin/opencode serve --port=9001
  `;

  const killed: number[] = [];
  const reaped = await reapOrphanedOpenCodeServers({
    psRunner: async () => samplePs,
    killer: (pid) => killed.push(pid),
  });

  assert.deepEqual(reaped, [5001, 5002]);
  assert.deepEqual(killed, [5001, 5002]);
});
