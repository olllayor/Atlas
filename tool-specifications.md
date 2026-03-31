# Tool Specifications for Integration

## 1. Read Tool

**Purpose:** Read file contents with support for text, images, PDFs, and notebooks.

### Input Schema
```json
{
  "file_path": "string (required) - Absolute path to the file",
  "offset": "number (optional) - Line number to start reading from (1-indexed)",
  "limit": "number (optional) - Number of lines to read",
  "pages": "string (optional) - Page range for PDFs (e.g., '1-5', '3')"
}
```

### Output Schema
```json
{
  "type": "text | image | notebook | pdf | file_unchanged",
  "file": {
    "filePath": "string",
    "content": "string (for text)",
    "base64": "string (for images/PDFs)",
    "numLines": "number",
    "startLine": "number",
    "totalLines": "number",
    "originalSize": "number (bytes)"
  }
}
```

### Prompt/Instructions
```
Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for larger files)
- Results are returned using cat -n format, with line numbers starting at 1
- This tool can read images (PNG, JPG, etc.) and renders them visually
- This tool can read PDF files (.pdf)
- This tool can read Jupyter notebooks (.ipynb files)
- This tool can only read files, not directories
```

---

## 2. Grep Tool

**Purpose:** Search file contents using regular expressions (built on ripgrep).

### Input Schema
```json
{
  "pattern": "string (required) - Regex pattern to search for",
  "path": "string (optional) - File or directory to search in (defaults to cwd)",
  "glob": "string (optional) - Glob pattern to filter files (e.g., '*.js', '*.{ts,tsx}')",
  "output_mode": "string (optional) - 'content' | 'files_with_matches' | 'count' (default: 'files_with_matches')",
  "-B": "number (optional) - Lines of context before match",
  "-A": "number (optional) - Lines of context after match",
  "-C": "number (optional) - Lines of context before and after",
  "context": "number (optional) - Alias for -C",
  "-n": "boolean (optional) - Show line numbers (default: true)",
  "-i": "boolean (optional) - Case insensitive search",
  "type": "string (optional) - File type (js, py, rust, go, java, etc.)",
  "head_limit": "number (optional) - Limit results (default: 250, 0 for unlimited)",
  "offset": "number (optional) - Skip first N results before applying head_limit",
  "multiline": "boolean (optional) - Enable multiline mode (default: false)"
}
```

### Output Schema
```json
{
  "mode": "content | files_with_matches | count",
  "numFiles": "number",
  "filenames": "string[]",
  "content": "string (for content/count mode)",
  "numLines": "number (for content mode)",
  "numMatches": "number (for count mode)",
  "appliedLimit": "number (optional)",
  "appliedOffset": "number (optional)"
}
```

### Prompt/Instructions
```
A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter
- Output modes: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts
- Pattern syntax: Uses ripgrep - literal braces need escaping (use `interface\\{\\}` to find `interface{}` in Go)
- Multiline matching: By default patterns match within single lines only. Use `multiline: true` for cross-line patterns
```

---

## 3. Glob Tool

**Purpose:** Find files by glob/wildcard patterns.

### Input Schema
```json
{
  "pattern": "string (required) - Glob pattern to match files against",
  "path": "string (optional) - Directory to search in (defaults to cwd)"
}
```

### Output Schema
```json
{
  "durationMs": "number",
  "numFiles": "number",
  "filenames": "string[]",
  "truncated": "boolean (true if results were limited to 100 files)"
}
```

### Prompt/Instructions
```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- For open-ended searches requiring multiple rounds, use the Agent tool instead
```

---

## 4. WebSearch Tool

**Purpose:** Search the web for current information using Anthropic's native web search API.

### Input Schema
```json
{
  "query": "string (required, min 2 chars) - The search query",
  "allowed_domains": "string[] (optional) - Only include results from these domains",
  "blocked_domains": "string[] (optional) - Never include results from these domains"
}
```

### Output Schema
```json
{
  "query": "string",
  "results": [
    {
      "tool_use_id": "string",
      "content": [
        { "title": "string", "url": "string" }
      ]
    },
    "string (text commentary)"
  ],
  "durationSeconds": "number"
}
```

### Prompt/Instructions
```
- Allows Claude to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks with links as markdown hyperlinks
- Use this tool for accessing information beyond the model's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT:
- After answering the user's question, include a "Sources:" section at the end
- List all relevant URLs from search results as markdown hyperlinks: [Title](URL)
- This is MANDATORY - never skip including sources

Usage notes:
- Domain filtering is supported to include or block specific websites
- Maximum 8 searches per request

IMPORTANT - Use the correct year in search queries:
- Use the current year when searching for recent information, documentation, or current events
```

**Note:** This tool requires Anthropic API with Claude 4.0+ models and uses the `web_search_20250305` tool type in the API request.

---

## 5. WebFetch Tool

**Purpose:** Fetch and extract content from URLs.

### Input Schema
```json
{
  "url": "string (required, valid URL) - The URL to fetch",
  "prompt": "string (required) - Prompt to run on the fetched content"
}
```

### Output Schema
```json
{
  "bytes": "number (content size)",
  "code": "number (HTTP status code)",
  "codeText": "string (HTTP status text)",
  "result": "string (processed content)",
  "durationMs": "number",
  "url": "string (the fetched URL)"
}
```

### Prompt/Instructions
```
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content

Usage notes:
- The URL must be a fully-formed valid URL
- HTTP URLs are automatically upgraded to HTTPS
- The prompt should describe what information you want to extract
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- Includes a 15-minute cache for faster responses on repeated accesses
- For redirected URLs, the tool informs you and provides the redirect URL
- For GitHub URLs, prefer using the gh CLI via Bash instead
```

---

## 6. Bash Tool

**Purpose:** Execute shell commands with security validation, sandboxing, and background task support.

### Input Schema
```json
{
  "command": "string (required) - The shell command to execute",
  "timeout": "number (optional) - Timeout in milliseconds (max varies by config)",
  "description": "string (optional) - Clear description of what this command does in active voice",
  "run_in_background": "boolean (optional) - Run command in background",
  "dangerouslyDisableSandbox": "boolean (optional) - Disable sandbox mode"
}
```

### Output Schema
```json
{
  "stdout": "string",
  "stderr": "string",
  "rawOutputPath": "string (optional, for large outputs)",
  "interrupted": "boolean",
  "isImage": "boolean (optional)",
  "backgroundTaskId": "string (optional)",
  "backgroundedByUser": "boolean (optional)",
  "assistantAutoBackgrounded": "boolean (optional)",
  "dangerouslyDisableSandbox": "boolean (optional)",
  "returnCodeInterpretation": "string (optional)",
  "noOutputExpected": "boolean (optional)",
  "structuredContent": "any[] (optional)",
  "persistedOutputPath": "string (optional)",
  "persistedOutputSize": "number (optional)"
}
```

### Prompt/Instructions
```
Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not.

IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands. Instead, use the appropriate dedicated tool.

Instructions:
- If your command will create new directories or files, first verify the parent directory exists
- Always quote file paths that contain spaces with double quotes
- Try to maintain your current working directory using absolute paths
- You may specify an optional timeout (default and max vary by configuration)
- When issuing multiple commands:
  - If independent and can run in parallel, make multiple Bash tool calls in a single message
  - If dependent and must run sequentially, use '&&' to chain them together
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
- For git commands:
  - Prefer creating new commits rather than amending
  - Never skip hooks (--no-verify) unless explicitly requested
  - Before running destructive operations, consider safer alternatives
```

---

## Implementation Examples

### 1. Read Tool Implementation

```typescript
import { readFile, stat } from 'fs/promises'
import * as path from 'path'

async function readTool(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<{ content: string; totalLines: number; startLine: number }> {
  const absolutePath = path.resolve(filePath)

  // Validate file exists
  const stats = await stat(absolutePath)
  if (!stats.isFile()) {
    throw new Error('Path is not a file')
  }

  // Read file content
  const content = await readFile(absolutePath, 'utf-8')
  const allLines = content.split('\n')
  const totalLines = allLines.length

  // Apply offset and limit
  const startLine = offset ?? 1
  const endLine = limit ? startLine + limit - 1 : totalLines
  const slicedLines = allLines.slice(startLine - 1, endLine)

  return {
    content: slicedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n'),
    totalLines,
    startLine,
  }
}

// Usage:
// const result = await readTool('/path/to/file.ts', 1, 100)
```

**Dependencies:** `fs/promises`, `path` (Node.js built-in)

---

### 2. Grep Tool Implementation

```typescript
import { spawn } from 'child_process'

async function grepTool(
  pattern: string,
  options: {
    path?: string
    glob?: string
    outputMode?: 'content' | 'files_with_matches' | 'count'
    caseInsensitive?: boolean
    lineNumbers?: boolean
    contextLines?: number
    maxResults?: number
    signal?: AbortSignal
  } = {},
): Promise<{ files: string[]; content?: string; count?: number }> {
  const {
    path = '.',
    glob,
    outputMode = 'files_with_matches',
    caseInsensitive = false,
    lineNumbers = true,
    contextLines,
    maxResults = 250,
    signal,
  } = options

  const args: string[] = ['--hidden']

  // Exclude VCS directories
  for (const dir of ['.git', '.svn', '.hg']) {
    args.push('--glob', `!${dir}`)
  }

  if (caseInsensitive) args.push('-i')
  if (lineNumbers && outputMode === 'content') args.push('-n')
  if (outputMode === 'files_with_matches') args.push('-l')
  if (outputMode === 'count') args.push('-c')
  if (contextLines !== undefined) args.push('-C', String(contextLines))
  if (glob) args.push('--glob', glob)

  // Handle pattern starting with dash
  if (pattern.startsWith('-')) {
    args.push('-e', pattern)
  } else {
    args.push(pattern)
  }

  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, { cwd: path, signal })
    let stdout = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        // 0 = matches, 1 = no matches
        const lines = stdout.trim().split('\n').filter(Boolean)
        const truncated = maxResults > 0 && lines.length > maxResults
        const results = truncated ? lines.slice(0, maxResults) : lines

        resolve({
          files: outputMode === 'files_with_matches' ? results : [],
          content: outputMode === 'content' ? results.join('\n') : undefined,
          count: outputMode === 'count' ? results.length : undefined,
        })
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

// Usage:
// const result = await grepTool('function\\s+\\w+', {
//   path: './src',
//   glob: '*.ts',
//   outputMode: 'files_with_matches',
//   maxResults: 100,
// })
```

**Dependencies:** `ripgrep` (`rg`) must be installed on the system. Install via:
- macOS: `brew install ripgrep`
- Ubuntu: `apt install ripgrep`
- Windows: `winget install BurntSushi.ripgrep.MSVC`

---

### 3. Glob Tool Implementation

```typescript
import { glob as fastGlob } from 'fast-glob'
import * as path from 'path'

async function globTool(
  pattern: string,
  searchPath: string = '.',
  limit: number = 100,
): Promise<{ files: string[]; truncated: boolean }> {
  const absolutePath = path.resolve(searchPath)

  const files = await fastGlob(pattern, {
    cwd: absolutePath,
    absolute: true,
    onlyFiles: true,
    dot: true, // Include hidden files
    followSymbolicLinks: false,
  })

  // Sort by modification time (newest first)
  const sorted = files.sort((a, b) => {
    const statA = fs.statSync(a)
    const statB = fs.statSync(b)
    return statB.mtimeMs - statA.mtimeMs
  })

  const truncated = sorted.length > limit
  return {
    files: truncated ? sorted.slice(0, limit) : sorted,
    truncated,
  }
}

// Usage:
// const result = await globTool('**/*.ts', './src', 50)
```

**Dependencies:** `fast-glob` (npm package) or use Node.js built-in `fs.glob` (Node 22+)

```bash
npm install fast-glob
```

---

### 4. WebSearch Tool Implementation

**Option A: Using Anthropic API (Claude 4.0+)**

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function webSearchTool(
  query: string,
  options: {
    allowedDomains?: string[]
    blockedDomains?: string[]
  } = {},
): Promise<{ results: Array<{ title: string; url: string }> | string[] }> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        allowed_domains: options.allowedDomains,
        blocked_domains: options.blockedDomains,
      },
    ],
    messages: [{ role: 'user', content: `Search for: ${query}` }],
  })

  // Extract search results from response
  const results: Array<{ title: string; url: string }> = []
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      results.push(...block.content.map((r: any) => ({
        title: r.title,
        url: r.url,
      })))
    }
  }

  return { results }
}

// Usage:
// const result = await webSearchTool('latest TypeScript features 2026', {
//   allowedDomains: ['typescriptlang.org', 'github.com'],
// })
```

**Option B: Using third-party search API (Exa, Tavily, etc.)**

```typescript
import Exa from 'exa-js'

const exa = new Exa(process.env.EXA_API_KEY)

async function webSearchTool(
  query: string,
  options: { numResults?: number; allowedDomains?: string[] } = {},
): Promise<{ results: Array<{ title: string; url: string; text?: string }> }> {
  const response = await exa.searchAndContents(query, {
    numResults: options.numResults ?? 10,
    text: true,
    includeDomains: options.allowedDomains,
  })

  return {
    results: response.results.map((r) => ({
      title: r.title ?? '',
      url: r.url,
      text: r.text,
    })),
  }
}

// Usage:
// const result = await webSearchTool('React 19 release notes', { numResults: 5 })
```

**Dependencies:**
- Option A: `@anthropic-ai/sdk` (requires Claude 4.0+ models)
- Option B: `exa-js` or similar search SDK

---

### 5. WebFetch Tool Implementation

```typescript
import axios from 'axios'
import TurndownService from 'turndown'

const turndownService = new TurndownService()

// Simple LRU cache
const cache = new Map<string, { data: string; expires: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

async function webFetchTool(
  url: string,
  prompt: string,
): Promise<{ content: string; statusCode: number; contentType: string }> {
  // Validate URL
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are supported')
  }

  // Upgrade http to https
  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'https:'
    url = parsedUrl.toString()
  }

  // Check cache
  const cached = cache.get(url)
  if (cached && cached.expires > Date.now()) {
    return { content: cached.data, statusCode: 200, contentType: 'text/markdown' }
  }

  // Fetch content
  const response = await axios.get(url, {
    timeout: 60000,
    maxContentLength: 10 * 1024 * 1024, // 10MB
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebFetch/1.0)',
      Accept: 'text/html, text/markdown, */*',
    },
    maxRedirects: 5,
  })

  const contentType = response.headers['content-type'] ?? ''
  let content: string

  if (contentType.includes('text/html')) {
    // Convert HTML to markdown
    content = turndownService.turndown(response.data)
  } else {
    // Use raw content
    content = response.data
  }

  // Truncate if too large
  const MAX_LENGTH = 100000
  if (content.length > MAX_LENGTH) {
    content = content.slice(0, MAX_LENGTH) + '\n\n[Content truncated]'
  }

  // Cache result
  cache.set(url, {
    data: content,
    expires: Date.now() + CACHE_TTL,
  })

  return {
    content,
    statusCode: response.status,
    contentType,
  }
}

// Usage:
// const result = await webFetchTool(
//   'https://example.com/docs',
//   'Extract the API endpoints and their descriptions'
// )
```

**Dependencies:** `axios`, `turndown`

```bash
npm install axios turndown
```

---

### 6. Bash Tool Implementation

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function bashTool(
  command: string,
  options: {
    timeout?: number
    cwd?: string
    env?: Record<string, string>
    runInBackground?: boolean
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const {
    timeout = 120000, // 2 minutes default
    cwd = process.cwd(),
    env = process.env,
    runInBackground = false,
  } = options

  if (runInBackground) {
    // Run in background using spawn
    const { spawn } = await import('child_process')
    const child = spawn(command, [], {
      shell: true,
      cwd,
      env,
      detached: true,
    })
    child.unref()
    return { stdout: '', stderr: '', exitCode: 0, backgroundPid: child.pid }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      cwd,
      env,
      maxBuffer: 30 * 1024 * 1024, // 30MB
    })

    return {
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      exitCode: 0,
    }
  } catch (error: any) {
    // exec throws error on non-zero exit code
    // error contains stdout, stderr, and code
    return {
      stdout: (error.stdout ?? '').trimEnd(),
      stderr: (error.stderr ?? '').trimEnd(),
      exitCode: error.code ?? 1,
    }
  }
}

// Usage:
// const result = await bashTool('ls -la', { cwd: '/path/to/dir' })
// const result = await bashTool('npm install', { timeout: 300000 })
```

**Dependencies:** Node.js built-in `child_process`, `util`

**Security considerations:**
- Validate commands before execution
- Use sandboxing for untrusted input
- Set appropriate timeouts
- Limit output buffer size
- Never run commands with elevated privileges

---

## Complete Integration Example

Here's how to register all tools with an AI framework:

```typescript
import { z } from 'zod'

// Tool registry
const tools = {
  Read: {
    name: 'Read',
    description: 'Read a file from the filesystem',
    schema: z.object({
      file_path: z.string().describe('Absolute path to the file'),
      offset: z.number().optional().describe('Starting line number'),
      limit: z.number().optional().describe('Number of lines to read'),
    }),
    execute: readTool,
  },
  Grep: {
    name: 'Grep',
    description: 'Search file contents with regex',
    schema: z.object({
      pattern: z.string().describe('Regex pattern'),
      path: z.string().optional().describe('Search directory'),
      glob: z.string().optional().describe('File filter pattern'),
      output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
      '-i': z.boolean().optional().describe('Case insensitive'),
    }),
    execute: grepTool,
  },
  Glob: {
    name: 'Glob',
    description: 'Find files by pattern',
    schema: z.object({
      pattern: z.string().describe('Glob pattern'),
      path: z.string().optional().describe('Search directory'),
    }),
    execute: globTool,
  },
  WebSearch: {
    name: 'WebSearch',
    description: 'Search the web',
    schema: z.object({
      query: z.string().min(2).describe('Search query'),
      allowed_domains: z.array(z.string()).optional(),
      blocked_domains: z.array(z.string()).optional(),
    }),
    execute: webSearchTool,
  },
  WebFetch: {
    name: 'WebFetch',
    description: 'Fetch URL content',
    schema: z.object({
      url: z.string().url().describe('URL to fetch'),
      prompt: z.string().describe('What to extract'),
    }),
    execute: webFetchTool,
  },
  Bash: {
    name: 'Bash',
    description: 'Execute shell commands',
    schema: z.object({
      command: z.string().describe('Shell command'),
      timeout: z.number().optional().describe('Timeout in ms'),
      description: z.string().optional().describe('What this command does'),
    }),
    execute: bashTool,
  },
}

// Register with your AI framework
function registerTools(agent: any) {
  for (const tool of Object.values(tools)) {
    agent.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
      execute: tool.execute,
    })
  }
}
```

---

## Implementation Examples

### 1. Read Tool Implementation

```typescript
import { readFile, stat } from 'fs/promises'
import * as path from 'path'

async function readTool(
  filePath: string,
  offset?: number,
  limit?: number,
): Promise<{ content: string; totalLines: number; startLine: number }> {
  const absolutePath = path.resolve(filePath)

  // Validate file exists
  const stats = await stat(absolutePath)
  if (!stats.isFile()) {
    throw new Error('Path is not a file')
  }

  // Read file content
  const content = await readFile(absolutePath, 'utf-8')
  const allLines = content.split('\n')
  const totalLines = allLines.length

  // Apply offset and limit
  const startLine = offset ?? 1
  const endLine = limit ? startLine + limit - 1 : totalLines
  const slicedLines = allLines.slice(startLine - 1, endLine)

  return {
    content: slicedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n'),
    totalLines,
    startLine,
  }
}

// Usage:
// const result = await readTool('/path/to/file.ts', 1, 100)
```

**Dependencies:** `fs/promises`, `path` (Node.js built-in)

---

### 2. Grep Tool Implementation

```typescript
import { spawn } from 'child_process'

async function grepTool(
  pattern: string,
  options: {
    path?: string
    glob?: string
    outputMode?: 'content' | 'files_with_matches' | 'count'
    caseInsensitive?: boolean
    lineNumbers?: boolean
    contextLines?: number
    maxResults?: number
    signal?: AbortSignal
  } = {},
): Promise<{ files: string[]; content?: string; count?: number }> {
  const {
    path = '.',
    glob,
    outputMode = 'files_with_matches',
    caseInsensitive = false,
    lineNumbers = true,
    contextLines,
    maxResults = 250,
    signal,
  } = options

  const args: string[] = ['--hidden']

  // Exclude VCS directories
  for (const dir of ['.git', '.svn', '.hg']) {
    args.push('--glob', `!${dir}`)
  }

  if (caseInsensitive) args.push('-i')
  if (lineNumbers && outputMode === 'content') args.push('-n')
  if (outputMode === 'files_with_matches') args.push('-l')
  if (outputMode === 'count') args.push('-c')
  if (contextLines !== undefined) args.push('-C', String(contextLines))
  if (glob) args.push('--glob', glob)

  // Handle pattern starting with dash
  if (pattern.startsWith('-')) {
    args.push('-e', pattern)
  } else {
    args.push(pattern)
  }

  return new Promise((resolve, reject) => {
    const child = spawn('rg', args, { cwd: path, signal })
    let stdout = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.on('close', (code) => {
      if (code === 0 || code === 1) {
        // 0 = matches, 1 = no matches
        const lines = stdout.trim().split('\n').filter(Boolean)
        const truncated = maxResults > 0 && lines.length > maxResults
        const results = truncated ? lines.slice(0, maxResults) : lines

        resolve({
          files: outputMode === 'files_with_matches' ? results : [],
          content: outputMode === 'content' ? results.join('\n') : undefined,
          count: outputMode === 'count' ? results.length : undefined,
        })
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })

    child.on('error', reject)
  })
}

// Usage:
// const result = await grepTool('function\\s+\\w+', {
//   path: './src',
//   glob: '*.ts',
//   outputMode: 'files_with_matches',
//   maxResults: 100,
// })
```

**Dependencies:** `ripgrep` (`rg`) must be installed on the system. Install via:
- macOS: `brew install ripgrep`
- Ubuntu: `apt install ripgrep`
- Windows: `winget install BurntSushi.ripgrep.MSVC`

---

### 3. Glob Tool Implementation

```typescript
import { glob as fastGlob } from 'fast-glob'
import * as path from 'path'

async function globTool(
  pattern: string,
  searchPath: string = '.',
  limit: number = 100,
): Promise<{ files: string[]; truncated: boolean }> {
  const absolutePath = path.resolve(searchPath)

  const files = await fastGlob(pattern, {
    cwd: absolutePath,
    absolute: true,
    onlyFiles: true,
    dot: true, // Include hidden files
    followSymbolicLinks: false,
  })

  // Sort by modification time (newest first)
  const sorted = files.sort((a, b) => {
    const statA = fs.statSync(a)
    const statB = fs.statSync(b)
    return statB.mtimeMs - statA.mtimeMs
  })

  const truncated = sorted.length > limit
  return {
    files: truncated ? sorted.slice(0, limit) : sorted,
    truncated,
  }
}

// Usage:
// const result = await globTool('**/*.ts', './src', 50)
```

**Dependencies:** `fast-glob` (npm package) or use Node.js built-in `fs.glob` (Node 22+)

```bash
npm install fast-glob
```

---

### 4. WebSearch Tool Implementation

**Option A: Using Anthropic API (Claude 4.0+)**

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function webSearchTool(
  query: string,
  options: {
    allowedDomains?: string[]
    blockedDomains?: string[]
  } = {},
): Promise<{ results: Array<{ title: string; url: string }> | string[] }> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        allowed_domains: options.allowedDomains,
        blocked_domains: options.blockedDomains,
      },
    ],
    messages: [{ role: 'user', content: `Search for: ${query}` }],
  })

  // Extract search results from response
  const results: Array<{ title: string; url: string }> = []
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      results.push(...block.content.map((r: any) => ({
        title: r.title,
        url: r.url,
      })))
    }
  }

  return { results }
}

// Usage:
// const result = await webSearchTool('latest TypeScript features 2026', {
//   allowedDomains: ['typescriptlang.org', 'github.com'],
// })
```

**Option B: Using third-party search API (Exa, Tavily, etc.)**

```typescript
import Exa from 'exa-js'

const exa = new Exa(process.env.EXA_API_KEY)

async function webSearchTool(
  query: string,
  options: { numResults?: number; allowedDomains?: string[] } = {},
): Promise<{ results: Array<{ title: string; url: string; text?: string }> }> {
  const response = await exa.searchAndContents(query, {
    numResults: options.numResults ?? 10,
    text: true,
    includeDomains: options.allowedDomains,
  })

  return {
    results: response.results.map((r) => ({
      title: r.title ?? '',
      url: r.url,
      text: r.text,
    })),
  }
}

// Usage:
// const result = await webSearchTool('React 19 release notes', { numResults: 5 })
```

**Dependencies:**
- Option A: `@anthropic-ai/sdk` (requires Claude 4.0+ models)
- Option B: `exa-js` or similar search SDK

---

### 5. WebFetch Tool Implementation

```typescript
import axios from 'axios'
import TurndownService from 'turndown'

const turndownService = new TurndownService()

// Simple LRU cache
const cache = new Map<string, { data: string; expires: number }>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes

async function webFetchTool(
  url: string,
  prompt: string,
): Promise<{ content: string; statusCode: number; contentType: string }> {
  // Validate URL
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are supported')
  }

  // Upgrade http to https
  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'https:'
    url = parsedUrl.toString()
  }

  // Check cache
  const cached = cache.get(url)
  if (cached && cached.expires > Date.now()) {
    return { content: cached.data, statusCode: 200, contentType: 'text/markdown' }
  }

  // Fetch content
  const response = await axios.get(url, {
    timeout: 60000,
    maxContentLength: 10 * 1024 * 1024, // 10MB
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WebFetch/1.0)',
      Accept: 'text/html, text/markdown, */*',
    },
    maxRedirects: 5,
  })

  const contentType = response.headers['content-type'] ?? ''
  let content: string

  if (contentType.includes('text/html')) {
    // Convert HTML to markdown
    content = turndownService.turndown(response.data)
  } else {
    // Use raw content
    content = response.data
  }

  // Truncate if too large
  const MAX_LENGTH = 100000
  if (content.length > MAX_LENGTH) {
    content = content.slice(0, MAX_LENGTH) + '\n\n[Content truncated]'
  }

  // Cache result
  cache.set(url, {
    data: content,
    expires: Date.now() + CACHE_TTL,
  })

  return {
    content,
    statusCode: response.status,
    contentType,
  }
}

// Usage:
// const result = await webFetchTool(
//   'https://example.com/docs',
//   'Extract the API endpoints and their descriptions'
// )
```

**Dependencies:** `axios`, `turndown`

```bash
npm install axios turndown
```

---

### 6. Bash Tool Implementation

```typescript
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function bashTool(
  command: string,
  options: {
    timeout?: number
    cwd?: string
    env?: Record<string, string>
    runInBackground?: boolean
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const {
    timeout = 120000, // 2 minutes default
    cwd = process.cwd(),
    env = process.env,
    runInBackground = false,
  } = options

  if (runInBackground) {
    // Run in background using spawn
    const { spawn } = await import('child_process')
    const child = spawn(command, [], {
      shell: true,
      cwd,
      env,
      detached: true,
    })
    child.unref()
    return { stdout: '', stderr: '', exitCode: 0, backgroundPid: child.pid }
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      cwd,
      env,
      maxBuffer: 30 * 1024 * 1024, // 30MB
    })

    return {
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
      exitCode: 0,
    }
  } catch (error: any) {
    // exec throws error on non-zero exit code
    // error contains stdout, stderr, and code
    return {
      stdout: (error.stdout ?? '').trimEnd(),
      stderr: (error.stderr ?? '').trimEnd(),
      exitCode: error.code ?? 1,
    }
  }
}

// Usage:
// const result = await bashTool('ls -la', { cwd: '/path/to/dir' })
// const result = await bashTool('npm install', { timeout: 300000 })
```

**Dependencies:** Node.js built-in `child_process`, `util`

**Security considerations:**
- Validate commands before execution
- Use sandboxing for untrusted input
- Set appropriate timeouts
- Limit output buffer size
- Never run commands with elevated privileges

---

## Complete Integration Example

Here's how to register all tools with an AI framework:

```typescript
import { z } from 'zod'

// Tool registry
const tools = {
  Read: {
    name: 'Read',
    description: 'Read a file from the filesystem',
    schema: z.object({
      file_path: z.string().describe('Absolute path to the file'),
      offset: z.number().optional().describe('Starting line number'),
      limit: z.number().optional().describe('Number of lines to read'),
    }),
    execute: readTool,
  },
  Grep: {
    name: 'Grep',
    description: 'Search file contents with regex',
    schema: z.object({
      pattern: z.string().describe('Regex pattern'),
      path: z.string().optional().describe('Search directory'),
      glob: z.string().optional().describe('File filter pattern'),
      output_mode: z.enum(['content', 'files_with_matches', 'count']).optional(),
      '-i': z.boolean().optional().describe('Case insensitive'),
    }),
    execute: grepTool,
  },
  Glob: {
    name: 'Glob',
    description: 'Find files by pattern',
    schema: z.object({
      pattern: z.string().describe('Glob pattern'),
      path: z.string().optional().describe('Search directory'),
    }),
    execute: globTool,
  },
  WebSearch: {
    name: 'WebSearch',
    description: 'Search the web',
    schema: z.object({
      query: z.string().min(2).describe('Search query'),
      allowed_domains: z.array(z.string()).optional(),
      blocked_domains: z.array(z.string()).optional(),
    }),
    execute: webSearchTool,
  },
  WebFetch: {
    name: 'WebFetch',
    description: 'Fetch URL content',
    schema: z.object({
      url: z.string().url().describe('URL to fetch'),
      prompt: z.string().describe('What to extract'),
    }),
    execute: webFetchTool,
  },
  Bash: {
    name: 'Bash',
    description: 'Execute shell commands',
    schema: z.object({
      command: z.string().describe('Shell command'),
      timeout: z.number().optional().describe('Timeout in ms'),
      description: z.string().optional().describe('What this command does'),
    }),
    execute: bashTool,
  },
}

// Register with your AI framework
function registerTools(agent: any) {
  for (const tool of Object.values(tools)) {
    agent.addTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema,
      execute: tool.execute,
    })
  }
}
```

---

## Integration Notes

### Common Tool Interface Pattern
All tools follow this structure:

```typescript
interface ToolDef<InputSchema, Output, Progress?> {
  name: string;                    // Tool identifier
  searchHint: string;              // Short description for UI
  maxResultSizeChars: number;      // Max characters for result persistence
  inputSchema: ZodSchema;          // Input validation schema
  outputSchema: ZodSchema;         // Output validation schema
  description: (input) => string;  // Dynamic description
  prompt: () => string;           // System prompt for the tool
  call: (input, context, ...) => Promise<{ data: Output }>;  // Implementation
  checkPermissions: (input, context) => Promise<PermissionDecision>;
  isReadOnly: () => boolean;      // Whether tool modifies data
  isConcurrencySafe: () => boolean; // Safe to run concurrently
  // ... additional UI/rendering methods
}
```

### Permission System
Tools integrate with a permission system that supports:
- **allow**: Execute without prompting
- **deny**: Block execution
- **ask**: Prompt user for confirmation

### Key Dependencies
- **zod/v4**: Schema validation for input/output
- **ripgrep (rg)**: Underlying engine for Grep tool
- **glob**: File pattern matching for Glob tool
- **Anthropic SDK**: Web search requires native API support
