// Fence-language routing for the transcript's code blocks.
//
// Streamdown decides whether a fenced block is handed to our `CodeBlock`
// by matching the fence's *literal* info string against this list. Anything
// not listed falls through to Streamdown's own `<pre>` — different chrome,
// no copy button, no highlighting — so a transcript could contain two
// visually different code blocks side by side.
//
// The fix is not to enumerate every grammar shiki ships (that would pull
// the whole bundle in at startup); it is to make the fallback unreachable:
// `streamdownCodeLanguages` covers the canonical names *and* every alias a
// model realistically emits, and `MessageResponseContent` additionally
// registers a catch-all so untagged and unknown fences route here too.
//
// `languageAliases` is the single alias table — `CodeBlock` resolves the
// real shiki grammar through it, and the list below is derived from it so
// the two can never drift apart again.

/** Fence tag → shiki grammar id. */
export const languageAliases: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  py: 'python',
  py3: 'python',
  rb: 'ruby',
  rs: 'rust',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  h: 'c',
  golang: 'go',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  shellsession: 'bash',
  terminal: 'bash',
  bat: 'batch',
  ps: 'powershell',
  ps1: 'powershell',
  yml: 'yaml',
  jsonc: 'json',
  json5: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  hcl: 'hcl',
  tf: 'hcl',
  terraform: 'hcl',
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  proto: 'proto',
  patch: 'diff',
  txt: 'text',
  plain: 'text',
  plaintext: 'text',
  text: 'text',
  '': 'text',
};

/**
 * Canonical grammars we advertise to Streamdown. Kept separate from the
 * alias table only so the union below reads as "names + aliases".
 */
const canonicalLanguages: string[] = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'c',
  'cpp',
  'csharp',
  'objective-c',
  'bash',
  'batch',
  'powershell',
  'sql',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'yaml',
  'toml',
  'ini',
  'xml',
  'markdown',
  'diff',
  'docker',
  'make',
  'nginx',
  'graphql',
  'proto',
  'lua',
  'perl',
  'haskell',
  'elixir',
  'erlang',
  'clojure',
  'scala',
  'groovy',
  'r',
  'dart',
  'zig',
  'nim',
  'julia',
  'matlab',
  'vue',
  'svelte',
  'astro',
  'hcl',
  'regex',
  'text',
];

/**
 * Every fence tag routed to `CodeBlock` — canonical names plus every alias.
 * Includes the empty string so untagged fences (```` ``` ````) come here
 * rather than to Streamdown's bare `<pre>`.
 */
export const streamdownCodeLanguages: string[] = Array.from(
  new Set<string>([...canonicalLanguages, ...Object.keys(languageAliases)])
);

/** Resolve a fence tag to the grammar id shiki knows it by. */
export function resolveLanguageAlias(language?: string | null): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  return languageAliases[normalized] ?? normalized ?? 'text';
}

/** Extension used when a snippet is downloaded. */
export const fileExtensions: Record<string, string> = {
  javascript: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  tsx: 'tsx',
  python: 'py',
  bash: 'sh',
  batch: 'bat',
  powershell: 'ps1',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  markdown: 'md',
  yaml: 'yml',
  toml: 'toml',
  xml: 'xml',
  sql: 'sql',
  rust: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  lua: 'lua',
  dart: 'dart',
  hcl: 'tf',
  diff: 'patch',
  docker: 'Dockerfile',
  vue: 'vue',
  svelte: 'svelte',
  text: 'txt',
};
