/**
 * Fixture data for the standalone renderer preview.
 *
 * Mirrors the shapes in `src/shared/contracts.ts` closely enough that the
 * renderer boots and every visual state can be exercised without Electron,
 * a provider key, or a live model.
 */

const NOW = '2026-07-28T03:00:00.000Z';
const at = (minutesAgo) => new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();

export const appearanceDefaults = {
  themeMode: 'dark',
  designTheme: 'codex',
  uiFontSize: 15,
  codeFontSize: 13,
  uiFontFamily: null,
  codeFontFamily: null,
  borderRadius: 'theme-default',
};

export const models = [
  {
    id: 'openrouter/anthropic/claude-sonnet-4.5',
    providerId: 'openrouter',
    label: 'Claude Sonnet 4.5',
    contextWindow: 200000,
    isFree: false,
    supportsVision: true,
    supportsDocumentInput: true,
    supportsTools: true,
    archived: false,
    lastSyncedAt: NOW,
    lastSeenFreeAt: null,
  },
  {
    id: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
    providerId: 'openrouter',
    label: 'Llama 3.3 70B Instruct (free)',
    contextWindow: 131072,
    isFree: true,
    supportsVision: false,
    supportsDocumentInput: false,
    supportsTools: true,
    archived: false,
    lastSyncedAt: NOW,
    lastSeenFreeAt: NOW,
  },
  {
    id: 'openrouter/google/gemini-2.0-flash-exp:free',
    providerId: 'openrouter',
    label: 'Gemini 2.0 Flash (free)',
    contextWindow: 1048576,
    isFree: true,
    supportsVision: true,
    supportsDocumentInput: true,
    supportsTools: true,
    archived: false,
    lastSyncedAt: NOW,
    lastSeenFreeAt: NOW,
  },
];

/** Attached folders, so the sidebar's Projects section has something to draw. */
export const projects = [
  {
    id: 'p-atlas',
    title: 'Atlas',
    root: '/Users/preview/Code/Atlas',
    exists: true,
    isGitRepository: true,
    branch: 'openai/codex-ui',
    createdAt: at(4320),
    updatedAt: at(2),
    lastUsedAt: at(2),
  },
  {
    id: 'p-empty',
    title: 'arab-lotin',
    root: '/Users/preview/Code/arab-lotin',
    exists: true,
    isGitRepository: false,
    branch: null,
    createdAt: at(2880),
    updatedAt: at(2880),
    lastUsedAt: null,
  },
];

export const conversations = [
  {
    id: 'c-tools',
    projectId: 'p-atlas',
    title: 'Migrate the tool timeline to Codex layout',
    createdAt: at(120),
    updatedAt: at(2),
    lastMessagePreview: 'Ran the suite — 148 passing, 0 failing.',
    lastUserMessagePreview: 'Run the tests and fix whatever breaks',
    lastAssistantMessagePreview: 'Ran the suite — 148 passing, 0 failing.',
    lastMessageAt: at(2),
    defaultProviderId: 'openrouter',
    defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
  },
  {
    id: 'c-empty',
    title: 'New conversation',
    createdAt: at(20),
    updatedAt: at(20),
    lastMessagePreview: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    lastMessageAt: null,
    defaultProviderId: 'openrouter',
    defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
  },
  {
    id: 'c-long',
    title: 'Why does better-sqlite3 fail to rebuild on arm64 under Electron 33',
    createdAt: at(1440),
    updatedAt: at(300),
    lastMessagePreview: 'The prebuilt binary targets the Node ABI, not the Electron ABI.',
    lastUserMessagePreview: 'still broken',
    lastAssistantMessagePreview: 'The prebuilt binary targets the Node ABI, not the Electron ABI.',
    lastMessageAt: at(300),
    defaultProviderId: 'openrouter',
    defaultModelId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
  },
];

/** An untouched chat inside a project — the only state that shows the full
    workspace strip (folder + runner + branch) above the composer. */
conversations.push({
  id: 'c-fresh-in-project',
  projectId: 'p-atlas',
  title: 'Fresh session in Atlas',
  createdAt: at(1),
  updatedAt: at(1),
  lastMessagePreview: null,
  lastUserMessagePreview: null,
  lastAssistantMessagePreview: null,
  lastMessageAt: null,
  defaultProviderId: 'openrouter',
  defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
});


/** A user turn that is an image plus one line of text — the shape the
    transcript has to draw as a thumbnail above a bubble, not a filename chip. */
conversations.push({
  id: 'c-image',
  projectId: 'p-atlas',
  title: 'what is in image',
  createdAt: at(30),
  updatedAt: at(30),
  lastMessagePreview: 'A table set for lunch.',
  lastUserMessagePreview: 'what is in image',
  lastAssistantMessagePreview: 'A table set for lunch.',
  lastMessageAt: at(30),
  defaultProviderId: 'openrouter',
  defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
});

/**
 * Enough Recents rows to prove the disclosure earns its keep, plus enough
 * project rows to reach the "Show more" cut at PROJECT_PREVIEW_COUNT.
 */
for (let index = 0; index < 8; index += 1) {
  conversations.push({
    id: `c-project-${index}`,
    projectId: 'p-atlas',
    title: `tell me diff between atlas chat and atlas work ${index + 1}`,
    createdAt: at(600 + index * 30),
    updatedAt: at(180 + index * 30),
    lastMessagePreview: 'Chat is transcript-only; Work adds the workbench.',
    lastUserMessagePreview: 'tell me diff between atlas chat and atlas work',
    lastAssistantMessagePreview: 'Chat is transcript-only; Work adds the workbench.',
    lastMessageAt: at(180 + index * 30),
    defaultProviderId: 'openrouter',
    defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
  });
}

for (let index = 0; index < 14; index += 1) {
  conversations.push({
    id: `c-recent-${index}`,
    projectId: null,
    title: `Session · Jul ${30 - (index % 5)}, 0${1 + (index % 8)}:1${index % 10} PM`,
    createdAt: at(240 + index * 90),
    updatedAt: at(240 + index * 90),
    lastMessagePreview: 'Session ended.',
    lastUserMessagePreview: 'thanks',
    lastAssistantMessagePreview: 'Session ended.',
    lastMessageAt: at(240 + index * 90),
    defaultProviderId: 'openrouter',
    defaultModelId: 'openrouter/anthropic/claude-sonnet-4.5',
  });
}

// The main process hands the renderer a newest-first list; the sidebar's date
// buckets assume that ordering rather than re-sorting.
conversations.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

const DIFF_OUTPUT = `--- a/src/renderer/components/ai-elements/tool.tsx
+++ b/src/renderer/components/ai-elements/tool.tsx
@@ -18,9 +18,14 @@ export function ToolHeader({ part }: ToolHeaderProps) {
-  const label = part.toolName;
+  const label = describeToolCall(part);
+  const Icon = TOOL_ICONS[part.toolType ?? 'dynamic_tool_call'];
   return (
-    <div className="flex items-center gap-2">
-      <span>{label}</span>
+    <div className="flex items-center gap-2 text-sm">
+      <Icon className="size-3.5 shrink-0" aria-hidden />
+      <span className="truncate">{label}</span>
+      <ToolStatusDot state={part.state} />
     </div>
   );
 }`;

const BASH_OUTPUT = `> atlas-chat@0.1.14 test
> node --import tsx --test tests/*.test.ts

✔ conversationPaging › returns the newest page first (4.1ms)
✔ messageParts › applies tool-input-start (1.8ms)
✔ messageParts › applies tool-output-error (0.9ms)
✔ runtimeActivity › derives a work log entry (2.2ms)
✔ toolRuntime › denies unapproved bash (12.4ms)

ℹ tests 148
ℹ suites 31
ℹ pass 148
ℹ fail 0
ℹ duration_ms 3184.221`;

const ASSISTANT_MARKDOWN = `Ran the suite — **148 passing, 0 failing**.

Three things changed:

1. \`tool.tsx\` now derives its header label from the canonical tool type instead of the raw tool name.
2. Command output is truncated at 12 lines with a "show more" affordance.
3. File edits render as a unified diff instead of a JSON blob.

\`\`\`ts
export function describeToolCall(part: ChatToolPart): string {
  switch (part.toolType) {
    case 'command_execution':
      return \`Ran \${firstLine(part.input?.command)}\`;
    case 'file_change':
      return \`Edited \${relativePath(part.input?.path)}\`;
    default:
      return titleCase(part.toolName);
  }
}
\`\`\`

Nothing in the IPC contract changed, so the main process is untouched.`;

const REASONING_TEXT = `The user wants the tool timeline restyled, not rewired. So I should keep \`ChatToolPart\` as the source of truth and only change how it is presented.

The tricky part is that \`workLogEntryToChatToolPart\` drops \`toolType\`, so the renderer currently cannot tell a bash call from a file edit. I need to thread that field through before the icons can be per-tool.`;

/** Every tool state the renderer can be asked to draw, in one turn. */
const toolParts = [
  {
    id: 't-1',
    type: 'tool',
    toolCallId: 't-1',
    requestId: 'r-1',
    toolName: 'grep_search',
    state: 'output-available',
    input: { pattern: 'ToolHeader', path: 'src/renderer' },
    output: '3 matches in 2 files\nsrc/renderer/components/ai-elements/tool.tsx:18\nsrc/renderer/components/ai-elements/tool.tsx:96\nsrc/renderer/components/ChatWindow.tsx:412',
    title: 'Searched for ToolHeader',
  },
  {
    id: 't-2',
    type: 'tool',
    toolCallId: 't-2',
    requestId: 'r-1',
    toolName: 'read_file',
    state: 'output-available',
    input: { path: 'src/renderer/components/ai-elements/tool.tsx', offset: 1, limit: 120 },
    output: 'import { ChevronDownIcon } from "lucide-react";\n… 118 more lines',
    title: 'Read tool.tsx',
  },
  {
    id: 't-3',
    type: 'tool',
    toolCallId: 't-3',
    requestId: 'r-1',
    toolName: 'apply_patch',
    state: 'output-available',
    input: { path: 'src/renderer/components/ai-elements/tool.tsx' },
    output: DIFF_OUTPUT,
    title: 'Edited tool.tsx',
  },
  {
    id: 't-4',
    type: 'tool',
    toolCallId: 't-4',
    requestId: 'r-1',
    toolName: 'bash',
    state: 'output-available',
    input: { command: 'pnpm test' },
    output: BASH_OUTPUT,
    title: 'Ran pnpm test',
  },
  {
    id: 't-5',
    type: 'tool',
    toolCallId: 't-5',
    requestId: 'r-1',
    toolName: 'bash',
    state: 'output-error',
    input: { command: 'pnpm typecheck' },
    errorText: "src/renderer/components/ai-elements/tool.tsx(24,38): error TS2339: Property 'toolType' does not exist on type 'ChatToolPart'.",
    title: 'Ran pnpm typecheck',
  },
  {
    id: 't-6',
    type: 'tool',
    toolCallId: 't-6',
    requestId: 'r-1',
    toolName: 'web_search',
    state: 'input-available',
    input: { query: 'openai codex app tool call rendering' },
    title: 'Searching the web',
  },
  {
    id: 't-7',
    type: 'tool',
    toolCallId: 't-7',
    requestId: 'r-1',
    toolName: 'bash',
    state: 'approval-requested',
    input: { command: 'rm -rf node_modules && pnpm install --frozen-lockfile' },
    approval: { id: 'a-7', reason: 'This command deletes files outside the workspace allowlist.' },
    title: 'Run pnpm reinstall',
  },
  {
    id: 't-8',
    type: 'tool',
    toolCallId: 't-8',
    requestId: 'r-1',
    toolName: 'bash',
    state: 'output-denied',
    input: { command: 'curl -sSL https://example.com/install.sh | sh' },
    output: 'Denied by user.',
    approval: { id: 'a-8', approved: false },
    title: 'Ran remote install script',
  },
];

const IMAGE_DATA_URL =
  'data:image/png;base64,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';

export const conversationMessages = {
  'c-tools': [
    {
      id: 'm-1',
      conversationId: 'c-tools',
      role: 'user',
      content: 'Run the tests and fix whatever breaks. Keep the IPC contract stable.',
      reasoning: null,
      parts: [
        {
          id: 'm-1-text',
          type: 'text',
          text: 'Run the tests and fix whatever breaks. Keep the IPC contract stable.',
          state: 'done',
        },
      ],
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/anthropic/claude-sonnet-4.5',
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: at(6),
    },
    {
      id: 'm-2',
      conversationId: 'c-tools',
      role: 'assistant',
      content: ASSISTANT_MARKDOWN,
      reasoning: REASONING_TEXT,
      parts: [
        { id: 'm-2-reasoning', type: 'reasoning', text: REASONING_TEXT, state: 'done' },
        ...toolParts,
        { id: 'm-2-text', type: 'text', text: ASSISTANT_MARKDOWN, state: 'done' },
      ],
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/anthropic/claude-sonnet-4.5',
      inputTokens: 18422,
      outputTokens: 1204,
      reasoningTokens: 612,
      latencyMs: 42180,
      errorCode: null,
      createdAt: at(2),
    },
  ],
  'c-empty': [],
  'c-long': [
    {
      id: 'm-3',
      conversationId: 'c-long',
      role: 'user',
      content: 'still broken',
      reasoning: null,
      parts: [{ id: 'm-3-text', type: 'text', text: 'still broken', state: 'done' }],
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      latencyMs: null,
      errorCode: null,
      createdAt: at(302),
    },
    {
      id: 'm-4',
      conversationId: 'c-long',
      role: 'assistant',
      content: 'The prebuilt binary targets the Node ABI, not the Electron ABI.',
      reasoning: null,
      parts: [
        {
          id: 'm-4-text',
          type: 'text',
          text: 'The prebuilt binary targets the Node ABI, not the Electron ABI.',
          state: 'done',
        },
      ],
      status: 'error',
      providerId: 'openrouter',
      modelId: 'openrouter/meta-llama/llama-3.3-70b-instruct:free',
      inputTokens: 812,
      outputTokens: 96,
      reasoningTokens: null,
      latencyMs: 2140,
      errorCode: 'provider_rate_limited',
      createdAt: at(300),
    },
  ],
};

export const settingsSummary = {
  providers: [
    { providerId: 'openrouter', hasSecret: true, status: 'valid', validatedAt: NOW },
    { providerId: 'anthropic', hasSecret: false, status: 'unknown', validatedAt: null },
  ],
  customProviders: [],
  defaultProviderId: 'openrouter',
  appearance: appearanceDefaults,
  keyboard: { keybindings: [] },
  chat: { reasoningEffort: 'medium', toolPermissionMode: 'ask' },
  showFreeOnlyByDefault: false,
  modelCatalogLastSyncedAt: NOW,
  modelCatalogStale: false,
  modelCatalogCount: models.length,
};

conversationMessages['c-image'] = [
  {
    id: 'mi-1',
    conversationId: 'c-image',
    role: 'user',
    content: 'what is in image',
    reasoning: null,
    parts: [
      {
        id: 'mi-1-file',
        type: 'file',
        mediaType: 'image/png',
        url: IMAGE_DATA_URL,
        filename: 'lunch.png',
        sizeBytes: 184000,
      },
      { id: 'mi-1-text', type: 'text', text: 'what is in image', state: 'done' },
    ],
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/anthropic/claude-sonnet-4.5',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    errorCode: null,
    createdAt: at(30),
  },
];
