# Atlas

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/olllayor/Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/olllayor/Atlas/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/olllayor/Atlas)](https://github.com/olllayor/Atlas/releases/latest)

> **Atlas** is a local-first, privacy-focused desktop AI workspace and agent studio. Bring Your Own Key (BYOK), connect to any model provider, run MCP tools, orchestrate autonomous agent workflows, and render live interactive visual artifacts — all stored securely on your own machine.

---

## 🎯 Purpose & Vision

Modern AI workflows shouldn't be trapped behind walled gardens, expensive monthly subscriptions, or opaque proprietary servers. **Atlas** is built from the ground up to give developers, researchers, and power users full sovereignty over their AI environment.

### Core Principles

- 🔑 **True BYOK Freedom** — Bring your own API keys directly to OpenRouter, Anthropic, OpenAI, Google Gemini/GLM, or local models (Ollama, LM Studio, vLLM). Pay only for what you consume at provider rates, with zero middleman markups.
- 🔒 **Privacy & Local-First Architecture** — Your conversations, prompts, workspace state, and model catalogs remain on your local disk in SQLite. All API keys are encrypted in your operating system's native keychain (`keytar`).
- 🤖 **Agentic Workflow & Extensibility** — Move seamlessly between standard chat, planning, and autonomous execution modes with built-in Model Context Protocol (MCP) support, custom plugins, and safety-gated tool execution.
- 🎨 **Rich Visual Artifacts** — Beyond plain text: stream and interact with live sandboxed HTML/UI documents, Mermaid diagrams, React Flow node graphs, LaTeX math formulas, and code diffs.
- ⚡ **Desktop-Native Craft** — Engineered with a refined warm minimalism aesthetic, command palette (`cmdk`), deep keyboard navigation, integrated terminal, and smooth view transitions.

---

## ✨ Key Features

### 🌐 Universal Provider Ecosystem
- **OpenRouter Integration** — Real-time model catalog synchronization with free-tier model discovery and parameter controls.
- **Major Model Providers** — Anthropic Claude, OpenAI, and Google Gemini / GLM.
- **Custom & Local Endpoints** — Connect any OpenAI-compatible provider, including Ollama, vLLM, LM Studio, or self-hosted inference servers.
- **OpenCode (Beta)** — Hand a turn to the [OpenCode](https://opencode.ai) agent: it runs its own tools and holds its own credentials, Atlas streams the result into the same transcript. See [docs/opencode.md](docs/opencode.md).
- **Reasoning & Thinking Tokens** — Real-time streaming and inspectable thought traces for reasoning models (DeepSeek-R1, Claude 3.7 Sonnet, OpenAI o1/o3-mini, Gemini Thinking).

### 🛠️ Agent Studio & Execution Modes
- **Multiple Workspace Modes**:
  - **Chat Mode** — Clean, conversational interface for rapid Q&A, writing, and brainstorming.
  - **Plan Mode** — Structured step-by-step reasoning and architectural planning before code execution.
  - **Agent / Act Mode** — Autonomous agent execution with tool calling, self-correction, and progress reporting.
  - **Review Mode** — Review diffs, verify tool actions, and inspect command execution safely.
- **Safety-First Tool Execution** — Local tools for file reading, grep search, glob matching, web search/fetch, and bash execution with user approval checkpoints.
- **Context Injection & `@mentions`** — Reference files, workspace directories, plugins, and MCP resources directly inside your prompt.

### 🔌 Model Context Protocol (MCP) & Plugin Engine
- **First-Class MCP Client** — Connect to any MCP server via Stdio or SSE to equip models with custom tools, resources, and prompt templates.
- **Extensible Plugin System** — Load and manage plugins with automated security audits, connector verification, and marketplace discovery.
- **Integrated Terminal** — Embedded terminal sessions powered by `@xterm/xterm` and `node-pty` for local debugging.

### 📊 Interactive Visual Artifacts & Rendering
- **Sandboxed Visual Documents** — Inline live rendering for HTML, web applications, and UI components with full-screen expansion.
- **Interactive Diagrams** — Native support for Mermaid diagrams and Dagre / React Flow node-link graphs.
- **Code Highlighting & Diffs** — Shiki-powered syntax highlighting with copy buttons, language tags, and diff views.
- **LaTeX Math Equations** — Formatted mathematical notation via KaTeX.
- **Token & Cost Intelligence** — Built-in token lens for real-time prompt token estimation and per-session cost tracking.

---

## 🏗️ Technical Stack

- **Framework**: Electron + React 19 + TypeScript + Vite (`electron-vite`)
- **AI Core**: Vercel AI SDK (`ai`), OpenRouter Provider, Anthropic, Google, and OpenAI adapters
- **State Management**: Zustand
- **Styling & UI**: Tailwind CSS v4, Motion (Framer Motion), Radix UI primitives, Lucide icons, `cmdk`
- **Database & Storage**: `better-sqlite3` (with WAL mode), OS Keychain via `keytar`
- **Terminal & Editor**: `@xterm/xterm`, `node-pty`, Shiki
- **Protocols & Standards**: Model Context Protocol (`@modelcontextprotocol/sdk`)

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `>= 10.0.0`
- **Native Build Tools**: Python 3 and C++ build tools (required by `better-sqlite3`, `keytar`, and `node-pty`).
  - **macOS**: `xcode-select --install`
  - **Linux**: `build-essential libsecret-1-dev`
  - **Windows**: Visual Studio C++ Build Tools

### Installation

```bash
# Clone the repository
git clone https://github.com/olllayor/Atlas.git
cd Atlas

# Install dependencies and build native addons
pnpm install
```

### Development

```bash
# Start Atlas in development mode with HMR
pnpm dev
```

*Note for macOS developers:* `pnpm dev` creates a rebranded app launcher with an isolated development bundle ID (`com.olllayor.atlaschat.dev`) so test keychain entries don't collide with production. Set `ATLAS_SKIP_DEV_LAUNCHER=1` to bypass the dev launcher.

### Production Build

```bash
# Type check and bundle for production
pnpm build

# Package desktop installer (DMG, ZIP, etc.)
pnpm package
```

---

## 🍏 Installing on macOS

Atlas is distributed as an unsigned DMG via GitHub Releases. macOS Gatekeeper may show a security prompt upon initial launch because the binary is built without an Apple Developer certificate.

### Download

1. Visit [GitHub Releases](https://github.com/olllayor/Atlas/releases/latest).
2. Download the DMG corresponding to your architecture:
   - **Apple Silicon (M1/M2/M3/M4)**: `Atlas-*-arm64.dmg`
   - **Intel Macs**: `Atlas-*-x64.dmg`
3. Drag **Atlas** into your `/Applications` folder.

### Bypassing Gatekeeper

If macOS displays *"Atlas can't be opened because it is from an unidentified developer"* or *"Atlas is damaged"*:

**Option A — System Settings (Recommended):**
1. Open **System Settings** → **Privacy & Security**.
2. Scroll down to the **Security** section.
3. Click **Open Anyway** next to the Atlas notice.

**Option B — Terminal:**
```bash
xattr -d com.apple.quarantine /Applications/Atlas.app
```

---

## 🔒 Security Architecture

Atlas is engineered with security and privacy as core design tenets:

1. **Process Isolation**: The renderer process executes in a sandboxed context without direct Node.js access. All OS APIs, database access, and network requests are mediated by a strictly typed preload bridge.
2. **Key Security**: API keys are never stored in plain text or SQLite files. They are saved directly into the OS credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service).
3. **Local Privacy**: Conversations, system prompts, attachments, and settings never leave your computer, except for direct HTTPS requests made to your chosen AI providers.
4. **Execution Safeguards**: Terminal commands, file mutations, and tool invocations feature explicit user approval gates before running.

---

## 🗺️ Roadmap & Milestones

- [x] **Multi-Provider BYOK Engine** (OpenRouter, Claude, OpenAI, Google Gemini/GLM, Ollama/Custom)
- [x] **OS Keychain Key Storage** & Local SQLite Database
- [x] **Model Context Protocol (MCP)** Client (Stdio & SSE)
- [x] **Reasoning / Thinking Token Streaming** & Visualizer
- [x] **Local Tool Calling & Approvals** (Bash, File I/O, Search, Web)
- [x] **Live Visual Documents & Artifacts** (HTML sandboxes, Mermaid, React Flow diagrams, LaTeX)
- [x] **Workspace & Directory Binding** with `@mention` context injection
- [x] **Integrated Terminal** (`node-pty` + `xterm.js`)
- [x] **Custom Plugin System & Auditing**
- [ ] **Full-Text Conversation Search** across message history
- [ ] **Conversation Branching & Forking**
- [ ] **Local Vector Embeddings & Long-Term Memory**
- [ ] **Automated Multi-Provider Fallbacks & Health Routing**
- [ ] **Conversation Export & Import** (Markdown, JSON, PDF)

---

## 🤝 Contributing

Contributions from the community are welcome! Please check out [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflows, code standards, and submission guidelines.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
