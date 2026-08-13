#!/usr/bin/env node
/**
 * A minimal MCP server that returns one UI component.
 *
 * Exists to exercise the sandboxed widget host end to end — install the folder
 * from the plugins page, ask the model to call `show_demo_card`, and a frame
 * should appear in the transcript. The widget deliberately tries to escape (see
 * `widget.html`) and reports what it managed, so the isolation checklist in
 * `docs/plugin-system.md` §5 can be read straight off the card.
 *
 * Speaks JSON-RPC over stdio by hand rather than importing the MCP SDK: a
 * fixture that has to be installed and its dependencies resolved before it can
 * be run is a fixture nobody runs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'widget.html'), 'utf8');

const TOOL = {
  name: 'show_demo_card',
  description: 'Show the plugin-UI sandbox test card. Returns a ui:// component and a one-line summary.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false
  }
};

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function handle(message) {
  switch (message.method) {
    case 'initialize':
      return respond(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-ui-demo', version: '1.0.0' }
      });

    case 'tools/list':
      return respond(message.id, { tools: [TOOL] });

    case 'tools/call':
      return respond(message.id, {
        content: [
          // The headless half. A client with no UI host must still get a usable
          // answer, which is the property the plugin architecture asks for.
          { type: 'text', text: 'Sandbox test card rendered. It reports which escapes it managed.' },
          {
            type: 'resource',
            resource: { uri: 'ui://demo/hello', mimeType: 'text/html', text: widget }
          }
        ],
        structuredContent: { card: 'sandbox-test' }
      });

    default:
      // Notifications carry no id and want no reply.
      if (message.id != null) {
        respond(message.id, {});
      }
  }
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  let newline = buffer.indexOf('\n');

  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);

    if (line) {
      try {
        handle(JSON.parse(line));
      } catch {
        // A malformed line is the harness's problem, not a reason to die.
      }
    }

    newline = buffer.indexOf('\n');
  }
});
