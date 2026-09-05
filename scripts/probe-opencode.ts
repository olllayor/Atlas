/**
 * One-off developer probe — the machine-side twin of Settings' "Test connection".
 *
 * Usage (from repo root):
 *   pnpm tsx scripts/probe-opencode.ts                      # spawned mode
 *   pnpm tsx scripts/probe-opencode.ts --server-url http://127.0.0.1:4096
 *   OPENCODE_PASSWORD=… pnpm tsx scripts/probe-opencode.ts --server-url …
 *
 * Exit codes: 0 = ready/warning reachable state, 1 = error/no install.
 * No credentials are ever logged; only presence flags.
 */

import { homedir } from 'node:os';

import {
  probeOpenCode
} from '../src/main/ai/providers/opencode/probeOpenCode.js';
import { OpenCodeRuntime } from '../src/main/ai/providers/opencode/OpenCodeRuntime.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettings.js';

function parseArgs(argv: readonly string[]) {
  const args: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--server-url') args.serverUrl = argv[++index] ?? '';
    else if (argv[index] === '--binary') args.binaryPath = argv[++index] ?? '';
    else if (argv[index] === '--dir') args.directory = argv[++index] ?? process.cwd();
    else if (argv[index] === '--skip-binary-check') args.skip = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runtime = new OpenCodeRuntime();
  const settings = {
    ...defaultOpenCodeSettings(),
    enabled: true,
    ...(typeof args.binaryPath === 'string' && args.binaryPath.length > 0
      ? { binaryPath: args.binaryPath }
      : {}),
    ...(typeof args.serverUrl === 'string' && args.serverUrl.length > 0
      ? { serverUrl: args.serverUrl }
      : {})
  };

  try {
    const result = await probeOpenCode({
      settings,
      directory: typeof args.directory === 'string' ? args.directory : process.cwd(),
      // Never print secrets — read from env like opencode's own tools do.
      ...(process.env.OPENCODE_PASSWORD
        ? { serverPassword: process.env.OPENCODE_PASSWORD }
        : {}),
      skipBinaryVersionCheck: args.skip === true,
      deps: {
        connectOwnedServer: async () => {
          const connection = await runtime.connect({ settings });
          return { baseUrl: connection.baseUrl };
        }
      }
    });

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'error' ? 1 : 0;
  } finally {
    await runtime.shutdown().catch(() => undefined);
  }

  console.error(`(home dir used for opencode config: ${homedir()})`);
}

void main();
