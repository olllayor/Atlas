// Static list of languages the custom CodeBlock renderer is interested in.
//
// We can't use the dynamic `codeHighlighter.getSupportedLanguages()` here
// without paying for the full shiki grammar bundle at app startup. Streamdown
// uses this list only to decide whether a fenced code block should be handed
// off to our renderer; anything not in the list falls through to the default
// Streamdown code block (which is fine for unknown languages).
//
// The aliases here mirror the user-facing names the model is most likely to
// emit in chat responses. If we ever need a missing language, append it.
export const streamdownCodeLanguages: string[] = [
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
  'bash',
  'shell',
  'sh',
  'zsh',
  'sql',
  'html',
  'css',
  'scss',
  'json',
  'yaml',
  'toml',
  'xml',
  'markdown',
  'md',
  'diff',
  'dockerfile',
  'graphql',
  'lua',
  'perl',
  'haskell',
  'elixir',
  'scala',
  'r',
  'dart',
  'plaintext',
  'text',
];
