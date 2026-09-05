import type { SiteFileInput } from "./sites";

export interface DesignTemplate {
  id: string;
  name: string;
  category: "Dashboard" | "Landing Page" | "Media & Player" | "Blank";
  description: string;
  previewGradient: string;
  files: SiteFileInput[];
}

const SHARED_TAILWIND_CSS = `/* Self-contained utility styling for Atlas Design Templates (zero external CDN dependencies) */
*, ::before, ::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border-width: 0;
  border-style: solid;
  border-color: #27272a;
}
:root {
  color-scheme: dark;
  --bg-dark: #09090b;
  --bg-card: #18181b;
  --border: #27272a;
  --accent: #10b981;
}
html, body {
  min-height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: #09090b;
  color: #f4f4f5;
  -webkit-font-smoothing: antialiased;
}
code, pre, .font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* Layout */
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.grid { display: grid; }
.hidden { display: none; }
.block { display: block; }
.inline { display: inline; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-1 { flex: 1 1 0%; }
.shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-start { justify-content: flex-start; }
.justify-end { justify-content: flex-end; }
.place-items-center { place-items: center; }

/* Grid columns */
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* Spacing & Gaps */
.gap-1 { gap: 0.25rem; }
.gap-1\\.5 { gap: 0.375rem; }
.gap-2 { gap: 0.5rem; }
.gap-2\\.5 { gap: 0.625rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }

.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-5 { padding: 1.25rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-2\\.5 { padding-left: 0.625rem; padding-right: 0.625rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-3\\.5 { padding-left: 0.875rem; padding-right: 0.875rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.py-0\\.5 { padding-top: 0.125rem; padding-bottom: 0.125rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-2\\.5 { padding-top: 0.625rem; padding-bottom: 0.625rem; }
.pt-1 { padding-top: 0.25rem; }
.pt-2 { padding-top: 0.5rem; }
.pt-4 { padding-top: 1rem; }
.pt-16 { padding-top: 4rem; }
.pt-20 { padding-top: 5rem; }
.pb-2 { padding-bottom: 0.5rem; }
.pb-4 { padding-bottom: 1rem; }
.pb-24 { padding-bottom: 6rem; }
.mt-0\\.5 { margin-top: 0.125rem; }
.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-4 { margin-top: 1rem; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mx-auto { margin-left: auto; margin-right: auto; }

/* Stacks */
.space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.25rem; }
.space-y-1\\.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.375rem; }
.space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
.space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: 1.5rem; }
.space-y-8 > :not([hidden]) ~ :not([hidden]) { margin-top: 2rem; }

/* Sizing */
.w-full { width: 100%; }
.h-full { height: 100%; }
.w-screen { width: 100vw; }
.h-screen { height: 100vh; }
.min-h-screen { min-height: 100vh; }
.w-1\\.5 { width: 0.375rem; }
.w-2 { width: 0.5rem; }
.h-1\\.5 { height: 0.375rem; }
.h-2 { height: 0.5rem; }
.h-3 { height: 0.75rem; }
.h-4 { height: 1rem; }
.h-5 { height: 1.25rem; }
.h-6 { height: 1.5rem; }
.h-7 { height: 1.75rem; }
.h-8 { height: 2rem; }
.w-7 { width: 1.75rem; }
.w-8 { width: 2rem; }
.w-10 { width: 2.5rem; }
.h-10 { height: 2.5rem; }
.w-12 { width: 3rem; }
.h-12 { height: 3rem; }
.h-11 { height: 2.75rem; }
.h-16 { height: 4rem; }
.h-44 { height: 11rem; }
.w-64 { width: 16rem; }
.w-3\\/4 { width: 75%; }
.w-2\\/5 { width: 40%; }
.max-w-sm { max-width: 24rem; }
.max-w-md { max-width: 28rem; }
.max-w-2xl { max-width: 42rem; }
.max-w-4xl { max-width: 56rem; }
.max-w-6xl { max-width: 72rem; }
.aspect-square { aspect-ratio: 1 / 1; }

/* Overflow & Positioning */
.overflow-hidden { overflow: hidden; }
.overflow-y-auto { overflow-y: auto; }
.overflow-x-auto { overflow-x: auto; }
.relative { position: relative; }
.absolute { position: absolute; }
.fixed { position: fixed; }
.inset-0 { inset: 0; }
.z-0 { z-index: 0; }
.z-10 { z-index: 10; }
.pointer-events-none { pointer-events: none; }
.select-none { user-select: none; }

/* Typography */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
.text-\\[10px\\] { font-size: 10px; }
.text-\\[11px\\] { font-size: 11px; }
.font-light { font-weight: 300; }
.font-normal { font-weight: 400; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.font-extrabold { font-weight: 800; }
.font-black { font-weight: 900; }
.tracking-tight { letter-spacing: -0.025em; }
.tracking-tighter { letter-spacing: -0.05em; }
.tracking-widest { letter-spacing: 0.1em; }
.leading-relaxed { line-height: 1.625; }
.leading-\\[1\\.1\\] { line-height: 1.1; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.uppercase { text-transform: uppercase; }

/* Colors */
.bg-zinc-950 { background-color: #09090b; }
.bg-zinc-900 { background-color: #18181b; }
.bg-zinc-900\\/40 { background-color: rgba(24, 24, 27, 0.4); }
.bg-zinc-900\\/50 { background-color: rgba(24, 24, 27, 0.5); }
.bg-zinc-900\\/60 { background-color: rgba(24, 24, 27, 0.6); }
.bg-zinc-900\\/80 { background-color: rgba(24, 24, 27, 0.8); }
.bg-zinc-800 { background-color: #27272a; }
.bg-zinc-800\\/40 { background-color: rgba(39, 39, 42, 0.4); }
.bg-zinc-800\\/50 { background-color: rgba(39, 39, 42, 0.5); }
.bg-zinc-800\\/80 { background-color: rgba(39, 39, 42, 0.8); }
.bg-zinc-100 { background-color: #f4f4f5; }
.bg-zinc-200 { background-color: #e4e4e7; }
.bg-white { background-color: #ffffff; }
.bg-black { background-color: #000000; }
.bg-black\\/20 { background-color: rgba(0, 0, 0, 0.2); }
.bg-emerald-400 { background-color: #34d399; }
.bg-emerald-400\\/70 { background-color: rgba(52, 211, 153, 0.7); }
.bg-emerald-400\\/80 { background-color: rgba(52, 211, 153, 0.8); }
.bg-emerald-400\\/90 { background-color: rgba(52, 211, 153, 0.9); }
.bg-emerald-500\\/10 { background-color: rgba(16, 185, 129, 0.1); }
.bg-emerald-500\\/20 { background-color: rgba(16, 185, 129, 0.2); }
.bg-amber-500\\/10 { background-color: rgba(245, 158, 11, 0.1); }

.text-zinc-100 { color: #f4f4f5; }
.text-zinc-200 { color: #e4e4e7; }
.text-zinc-300 { color: #d4d4d8; }
.text-zinc-400 { color: #a1a1aa; }
.text-zinc-500 { color: #71717a; }
.text-zinc-950 { color: #09090b; }
.text-white { color: #ffffff; }
.text-black { color: #000000; }
.text-emerald-400 { color: #34d399; }
.text-amber-400 { color: #fbbf24; }

/* Borders & Radii */
.border { border-width: 1px; }
.border-b { border-bottom-width: 1px; }
.border-r { border-right-width: 1px; }
.border-zinc-800 { border-color: #27272a; }
.border-zinc-800\\/40 { border-color: rgba(39, 39, 42, 0.4); }
.border-zinc-800\\/60 { border-color: rgba(39, 39, 42, 0.6); }
.border-zinc-800\\/80 { border-color: rgba(39, 39, 42, 0.8); }
.border-white\\/10 { border-color: rgba(255, 255, 255, 0.1); }
.border-emerald-500\\/20 { border-color: rgba(16, 185, 129, 0.2); }
.border-emerald-500\\/40 { border-color: rgba(16, 185, 129, 0.4); }

.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-3xl { border-radius: 1.5rem; }
.rounded-full { border-radius: 9999px; }

/* Shadows & Filters */
.shadow-sm { box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3); }
.shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
.shadow-white\\/10 { box-shadow: 0 10px 25px -5px rgba(255, 255, 255, 0.1); }
.shadow-inner { box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.06); }
.backdrop-blur-md { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.backdrop-blur-2xl { backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); }
.blur-3xl { filter: blur(64px); }

/* Interactivity */
.transition { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
button { cursor: pointer; }
a { text-decoration: none; color: inherit; }
.hover\\:bg-zinc-800:hover { background-color: #27272a; }
.hover\\:bg-zinc-800\\/50:hover { background-color: rgba(39, 39, 42, 0.5); }
.hover\\:bg-zinc-200:hover { background-color: #e4e4e7; }
.hover\\:text-white:hover { color: #ffffff; }
.hover\\:scale-105:hover { transform: scale(1.05); }
.group:hover .group-hover\\:opacity-100 { opacity: 1; }
.opacity-0 { opacity: 0; }

/* Responsive Media Queries */
@media (min-width: 640px) {
  .sm\\:flex { display: flex; }
  .sm\\:inline { display: inline; }
  .sm\\:flex-row { flex-direction: row; }
  .sm\\:items-center { align-items: center; }
  .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sm\\:text-6xl { font-size: 3.75rem; line-height: 1; }
  .sm\\:text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .sm\\:w-auto { width: auto; }
}
@media (min-width: 768px) {
  .md\\:flex { display: flex; }
}
@media (min-width: 1024px) {
  .lg\\:p-8 { padding: 2rem; }
}
`;

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: "dashboard",
    name: "SaaS Dashboard",
    category: "Dashboard",
    description: "Modern analytics interface with metrics cards, velocity chart, and activity ledger.",
    previewGradient: "from-emerald-950/40 via-zinc-900 to-zinc-950",
    files: [
      {
        path: "index.html",
        contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atlas SaaS Analytics</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="bg-zinc-950 text-zinc-100 min-h-screen flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
    <div class="flex-1 flex flex-col md:flex-row">
      <!-- Sidebar -->
      <aside class="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-800/80 bg-zinc-900/40 p-4 flex flex-col justify-between shrink-0">
        <div class="space-y-6">
          <div class="flex items-center gap-2.5 px-2">
            <div class="w-7 h-7 rounded-lg bg-emerald-400 flex items-center justify-center font-bold text-zinc-950 text-xs">A</div>
            <span class="font-semibold text-sm tracking-tight text-white">Atlas Core</span>
            <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 ml-auto">v1.4</span>
          </div>

          <nav class="space-y-1">
            <a href="#" class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 text-white font-medium text-xs">
              <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
              Overview
            </a>
            <a href="#" class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/40 text-xs transition">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
              Telemetry
            </a>
            <a href="#" class="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/40 text-xs transition">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              Settings
            </a>
          </nav>
        </div>

        <div class="pt-4 border-t border-zinc-800/80 flex items-center justify-between px-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400" style="box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);"></span>
            <span class="text-xs text-zinc-400">Cluster 01-US</span>
          </div>
          <span class="text-[11px] font-mono text-zinc-500">99.98%</span>
        </div>
      </aside>

      <!-- Main Content -->
      <main class="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto">
        <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-white">System Telemetry</h1>
            <p class="text-xs text-zinc-400 mt-0.5">Real-time throughput and agent health across local clusters.</p>
          </div>
          <div class="flex items-center gap-2">
            <button class="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs transition">Export CSV</button>
            <button class="px-3 py-1.5 rounded-lg bg-emerald-400 text-zinc-950 font-semibold text-xs hover:bg-emerald-300 transition">Deploy Node</button>
          </div>
        </header>

        <!-- KPI Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-zinc-400">Throughput</span>
              <span class="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">+14.2%</span>
            </div>
            <div class="text-2xl font-bold font-mono tracking-tight text-white">2.84M</div>
            <p class="text-[11px] text-zinc-500">req / 24 hrs rolling</p>
          </div>

          <div class="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-zinc-400">P99 Latency</span>
              <span class="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">-4.1ms</span>
            </div>
            <div class="text-2xl font-bold font-mono tracking-tight text-white">18.4ms</div>
            <p class="text-[11px] text-zinc-500">edge cache hit 92%</p>
          </div>

          <div class="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-zinc-400">Active Nodes</span>
              <span class="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">Scale 8x</span>
            </div>
            <div class="text-2xl font-bold font-mono tracking-tight text-white">64 / 64</div>
            <p class="text-[11px] text-zinc-500">zero degraded pods</p>
          </div>
        </div>

        <!-- Activity Chart -->
        <div class="p-5 rounded-xl border border-zinc-800/80 bg-zinc-900/50 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-sm font-semibold text-white">Cluster Velocity</h2>
              <p class="text-xs text-zinc-400">Query traffic distribution over past 12 hours</p>
            </div>
            <div class="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800/60 text-[11px]">
              <span class="px-2 py-0.5 rounded bg-zinc-800 text-white font-medium">12h</span>
              <span class="px-2 py-0.5 rounded text-zinc-400">24h</span>
              <span class="px-2 py-0.5 rounded text-zinc-400">7d</span>
            </div>
          </div>

          <div class="h-44 w-full relative flex items-end">
            <svg class="w-full h-full overflow-hidden" viewBox="0 0 500 120" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"></stop>
                  <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"></stop>
                </linearGradient>
              </defs>
              <path d="M 0,100 Q 60,30 120,60 T 240,40 T 360,70 T 500,20 L 500,120 L 0,120 Z" fill="url(#chartGrad)"></path>
              <path d="M 0,100 Q 60,30 120,60 T 240,40 T 360,70 T 500,20" fill="none" stroke="#10b981" stroke-width="2.5"></path>
            </svg>
          </div>
        </div>
      </main>
    </div>
  </body>
</html>`,
      },
      {
        path: "styles.css",
        contents: SHARED_TAILWIND_CSS,
      },
    ],
  },
  {
    id: "landing",
    name: "Marketing Hero",
    category: "Landing Page",
    description: "High-impact SaaS landing page hero with ambient gradient glow and bold display typography.",
    previewGradient: "from-purple-950/40 via-zinc-900 to-zinc-950",
    files: [
      {
        path: "index.html",
        contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atlas — The Next Stage</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="bg-zinc-950 text-zinc-100 min-h-screen flex flex-col font-sans overflow-x-hidden selection:bg-white selection:text-black">
    <!-- Navbar -->
    <header class="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-white text-black font-extrabold flex items-center justify-center text-sm">A</div>
          <span class="font-bold tracking-tight text-white">Synthetix</span>
        </div>
        <nav class="hidden md:flex items-center gap-6 text-xs text-zinc-400 font-medium">
          <a href="#" class="hover:text-white transition">Platform</a>
          <a href="#" class="hover:text-white transition">Agents</a>
          <a href="#" class="hover:text-white transition">Security</a>
          <a href="#" class="hover:text-white transition">Pricing</a>
        </nav>
        <div class="flex items-center gap-3">
          <button class="px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white transition">Sign in</button>
          <button class="px-3.5 py-1.5 rounded-lg bg-white text-zinc-950 font-semibold text-xs hover:bg-zinc-200 transition shadow-sm">Get Started</button>
        </div>
      </div>
    </header>

    <!-- Hero Content -->
    <main class="flex-1 max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-24 text-center relative">
      <!-- Glow ambient background -->
      <div class="absolute inset-0 -z-0 pointer-events-none flex items-center justify-center">
        <div class="w-3/4 h-44 bg-emerald-500/10 rounded-full blur-3xl"></div>
      </div>

      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-mono mb-6">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" style="box-shadow: 0 0 6px rgba(52, 211, 153, 0.6);"></span>
        Atlas Design v2 Architecture Live
      </div>

      <h1 class="text-4xl sm:text-6xl font-extrabold tracking-tighter text-white leading-[1.1] mb-6">
        Design interfaces that speak directly with intelligence.
      </h1>

      <p class="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-8 leading-relaxed font-light">
        A deterministic canvas built for autonomous AI agents. Inspect any node, hot-patch live designs, and deploy static artifacts in seconds.
      </p>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-white text-zinc-950 font-bold text-sm hover:bg-zinc-200 transition shadow-lg shadow-white/10">
          Start building free
        </button>
        <button class="w-full sm:w-auto px-6 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-zinc-300 font-medium text-sm hover:text-white hover:bg-zinc-800 transition">
          Browse documentation
        </button>
      </div>

      <!-- Feature cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-16 text-left">
        <div class="p-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md space-y-2">
          <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-white text-xs font-mono">01</div>
          <h3 class="text-sm font-semibold text-white">Local-First Sandbox</h3>
          <p class="text-xs text-zinc-400 leading-relaxed">No network leaks, zero tracking, complete origin isolation with hardened CSP.</p>
        </div>
        <div class="p-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md space-y-2">
          <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-white text-xs font-mono">02</div>
          <h3 class="text-sm font-semibold text-white">Responsive Frames</h3>
          <p class="text-xs text-zinc-400 leading-relaxed">1-click preview across Desktop, iPad Tablet, and iPhone 15 viewports.</p>
        </div>
        <div class="p-5 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md space-y-2">
          <div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-white text-xs font-mono">03</div>
          <h3 class="text-sm font-semibold text-white">Immutable Versions</h3>
          <p class="text-xs text-zinc-400 leading-relaxed">Every publish freezes a release snapshot with instant 1-click rollback.</p>
        </div>
      </div>
    </main>
  </body>
</html>`,
      },
      {
        path: "styles.css",
        contents: SHARED_TAILWIND_CSS,
      },
    ],
  },
  {
    id: "player",
    name: "Glassmorphic Player",
    category: "Media & Player",
    description: "Sleek dark-mode audio visualizer and playback control card with frosted glass borders.",
    previewGradient: "from-blue-950/40 via-zinc-900 to-zinc-950",
    files: [
      {
        path: "index.html",
        contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atmospheric Player</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center p-4 font-sans selection:bg-white selection:text-black">
    <div class="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-2xl shadow-2xl space-y-6 relative overflow-hidden">
      <!-- Ambient Glow Behind Album Art -->
      <div class="absolute -top-12 -left-12 w-44 h-44 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none"></div>

      <!-- Album Art / Visualizer -->
      <div class="w-full aspect-square rounded-2xl bg-zinc-950/80 border border-zinc-800 flex flex-col items-center justify-end p-6 relative overflow-hidden shadow-inner">
        <div class="flex items-end gap-1.5 h-16 w-full justify-center">
          <div class="w-1.5 h-6 bg-emerald-400/80 rounded-full"></div>
          <div class="w-1.5 h-10 bg-emerald-400 rounded-full"></div>
          <div class="w-1.5 h-16 bg-emerald-400 rounded-full"></div>
          <div class="w-1.5 h-8 bg-emerald-400/90 rounded-full"></div>
          <div class="w-1.5 h-12 bg-emerald-400 rounded-full"></div>
          <div class="w-1.5 h-5 bg-emerald-400/70 rounded-full"></div>
        </div>
      </div>

      <!-- Track Info -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <h2 class="font-bold text-base text-white tracking-tight">Solar Flares (Live Session)</h2>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-500/40 text-emerald-400 bg-emerald-500/10">FLAC 96k</span>
        </div>
        <p class="text-xs text-zinc-400">Kavinsky & Daft Punk · OutRun</p>
      </div>

      <!-- Scrubber -->
      <div class="space-y-1.5">
        <div class="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div class="h-full w-2/5 bg-white rounded-full"></div>
        </div>
        <div class="flex justify-between text-[10px] font-mono text-zinc-500">
          <span>01:42</span>
          <span>04:18</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex items-center justify-between pt-2">
        <button class="text-zinc-400 hover:text-white transition">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
        </button>
        <button class="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-lg hover:scale-105 transition">
          <svg class="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </button>
        <button class="text-zinc-400 hover:text-white transition">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
        </button>
      </div>
    </div>
  </body>
</html>`,
      },
      {
        path: "styles.css",
        contents: SHARED_TAILWIND_CSS,
      },
    ],
  },
  {
    id: "blank",
    name: "Blank Canvas",
    category: "Blank",
    description: "A clean starter canvas with embedded utility styling, ready for your custom markup.",
    previewGradient: "from-zinc-900 to-zinc-950",
    files: [
      {
        path: "index.html",
        contents: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blank Canvas</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center p-6 font-sans">
    <div class="max-w-md w-full p-8 rounded-2xl border border-zinc-800 bg-zinc-900/50 text-center space-y-4">
      <div class="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 mx-auto flex items-center justify-center text-white font-bold text-sm">
        +
      </div>
      <h1 class="text-lg font-bold text-white tracking-tight">New Atlas Design</h1>
      <p class="text-xs text-zinc-400 leading-relaxed">
        Start editing index.html or styles.css to craft your custom component, landing page, or dashboard.
      </p>
    </div>
  </body>
</html>`,
      },
      {
        path: "styles.css",
        contents: SHARED_TAILWIND_CSS,
      },
    ],
  },
];
