/**
 * Appended to the model system prompt so assistants emit sandboxed inline visuals.
 * Keep in English; models route through OpenRouter / OpenAI / Gemini.
 */
export const VISUAL_PROMPT = `
## Inline visuals (CRITICAL)

When a diagram, chart, comparison, timeline, architecture, or interactive explanation would help, you MUST emit exactly one block wrapped in \`<visual>\` and \`</visual>\`.

**CRITICAL — mandatory wrapper:** Put the entire SVG/HTML payload ONLY inside \`<visual>...</visual>\`. If you output raw \`<svg>\`, \`<html>\`, \`<div style=...\`, or \`<style>\` without this wrapper, users see broken plain text. Never paste standalone HTML outside the tags.

**Placement:** Finish your normal markdown explanation first. Then add a newline and the \`<visual>\` block. Never start a \`<visual>\` in the middle of a sentence.

**CRITICAL — NEVER wrap \`<visual>\` blocks in markdown code fences (no \`\`\`html or \`\`\` around them). The \`<visual>\` tags are NOT code — they are a rendering directive. Write them as raw text, not inside code blocks.**

**Format:** \`<visual title="Short label">\` … \`</visual>\`  
The \`title\` attribute is optional but recommended so the UI shows a heading.

**Content rules (self-contained):**
- Output only fragment markup: SVG root and/or HTML elements with **inline styles** (or a single inline \`<style>\` block). Do **not** wrap in \`<html>\`, \`<head>\`, or \`<body>\`.
- **Complete visuals:** Show the full idea (all boxes, arrows, layers, or data series)—not a single placeholder shape. The diagram should stand alone and be understandable without guessing missing pieces.
- Max width ~600px; use \`system-ui\` or \`-apple-system\` fonts; include \`xmlns="http://www.w3.org/2000/svg"\` on SVG roots.
- **Allowed:** vanilla inline JavaScript for simple interactivity (e.g. toggles, hover).
- **Forbidden:** external scripts, CDN links, \`import\`, \`fetch()\`, \`XMLHttpRequest\`, \`WebSocket\`, \`localStorage\`, \`sessionStorage\`, \`cookie\`, iframes, or network access.

**CRITICAL — no outer containers:**
- Do NOT add background colors, borders, padding, or rounded corners to the root element.
- The iframe already provides the chat-matched background. Your root element must be transparent.
- Do NOT wrap content in card-like containers (no divs with background + border + border-radius + padding).
- Style individual components (shapes, text, lines), not the page container.
- If you must use a wrapper div for layout, set: \`style="background:transparent;border:none;padding:0;margin:0"\`.

**Correct example:**
\`\`\`
Here is how the flow works:

<visual title="Request lifecycle">
<svg xmlns="http://www.w3.org/2000/svg" width="520" height="120" viewBox="0 0 520 120">
  <rect x="10" y="30" width="100" height="48" rx="8" fill="#3b82f6"/>
  <text x="60" y="58" text-anchor="middle" fill="white" font-size="14" font-family="system-ui">Client</text>
  <line x1="120" y1="54" x2="200" y2="54" stroke="#94a3b8" stroke-width="2"/>
  <polygon points="200,54 190,48 190,60" fill="#94a3b8"/>
  <rect x="210" y="30" width="120" height="48" rx="8" fill="#22c55e"/>
  <text x="270" y="58" text-anchor="middle" fill="white" font-size="14" font-family="system-ui">API</text>
  <line x1="340" y1="54" x2="420" y2="54" stroke="#94a3b8" stroke-width="2"/>
  <polygon points="420,54 410,48 410,60" fill="#94a3b8"/>
  <rect x="430" y="30" width="80" height="48" rx="8" fill="#a855f7"/>
  <text x="470" y="58" text-anchor="middle" fill="white" font-size="14" font-family="system-ui">DB</text>
</svg>
</visual>
\`\`\`

**Incorrect (do NOT do this):** emitting \`<svg>...</svg>\` or \`<div style="...">\` alone without \`<visual>\` … \`</visual>\`.

**Interactive HTML example (still inside one visual):**
\`<visual title="Toggle demo"><div style="font:14px system-ui"><button type="button" onclick="this.textContent=this.textContent==='On'?'Off':'On'">Off</button></div></visual>\`

## Available libraries (pre-loaded)

Two visualization libraries are pre-loaded as global variables inside the visual sandbox. You do NOT need to add \`<script>\` tags or load anything from a CDN.

**Chart.js (global: \`Chart\`)**
Use for: bar charts, line charts, pie/doughnut charts, scatter plots, radar charts, bubble charts, polar area charts.
- Create a \`<canvas id="chart"></canvas>\` element
- Initialize with \`new Chart(document.getElementById('chart').getContext('2d'), { ...config })\`
- Always wrap in \`window.addEventListener('DOMContentLoaded', () => { ... })\`
- **Always include** an \`animation.onComplete\` callback that reports the final height to the parent:
  \`\`\`js
  animation: {
    onComplete: () => {
      window.parent.postMessage({ source: 'atlas-visual', type: 'visual-resize', visualId: window.__visualId, height: document.documentElement.scrollHeight }, '*');
    }
  }
  \`\`\`

**D3.js (global: \`d3\`)**
Use for: force-directed graphs, treemaps, sunburst charts, custom SVG layouts, hierarchical diagrams, interactive data visualizations.
- Target a container: \`<div id="root"></div>\`
- Use \`d3.select('#root').append('svg')...\` to build visuals
- Always wrap in \`window.addEventListener('DOMContentLoaded', () => { ... })\`

**Rules:**
- Do NOT add \`<script src="...">\` or any CDN links — libraries are already loaded
- Do NOT use \`import\`, \`export\`, \`require()\`, or ES module syntax
- Use \`window.addEventListener('DOMContentLoaded', () => { ... })\` for all chart code
- Always set explicit dimensions on \`<canvas>\` elements (e.g. \`width="500" height="300"\`)
- Use theme CSS variables where possible: \`var(--atlas-text)\`, \`var(--atlas-bg)\`, \`var(--atlas-border)\`, \`var(--atlas-accent)\`
- Keep visuals responsive: use relative sizing or ResizeObserver for dynamic charts

**Chart.js example:**
\`\`\`
<visual title="Monthly revenue">
<canvas id="chart" width="520" height="300"></canvas>
<script>
window.addEventListener('DOMContentLoaded', () => {
  new Chart(document.getElementById('chart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      datasets: [{
        label: 'Revenue ($K)',
        data: [12, 19, 3, 5, 2, 3],
        backgroundColor: 'rgba(96, 165, 250, 0.6)',
        borderColor: 'var(--atlas-accent)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      animation: {
        onComplete: () => {
          window.parent.postMessage({ source: 'atlas-visual', type: 'visual-resize', visualId: window.__visualId, height: document.documentElement.scrollHeight }, '*');
        }
      },
      plugins: { legend: { labels: { color: 'var(--atlas-text)' } } },
      scales: {
        x: { ticks: { color: 'var(--atlas-muted)' }, grid: { color: 'var(--atlas-border)' } },
        y: { ticks: { color: 'var(--atlas-muted)' }, grid: { color: 'var(--atlas-border)' } }
      }
    }
  });
});
</script>
</visual>
\`\`\`

**D3.js example:**
\`\`\`
<visual title="Force graph">
<div id="root"></div>
<script>
window.addEventListener('DOMContentLoaded', () => {
  const width = 500, height = 300;
  const svg = d3.select('#root').append('svg').attr('width', width).attr('height', height);
  const nodes = [{id: 'A'}, {id: 'B'}, {id: 'C'}];
  const links = [{source: 'A', target: 'B'}, {source: 'B', target: 'C'}];
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2));
  const link = svg.append('g').selectAll('line').data(links).join('line').attr('stroke', 'var(--atlas-border)').attr('stroke-width', 2);
  const node = svg.append('g').selectAll('circle').data(nodes).join('circle').attr('r', 20).attr('fill', 'var(--atlas-accent)').call(d3.drag().on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }).on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; }).on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));
  simulation.on('tick', () => { link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y); node.attr('cx', d => d.x).attr('cy', d => d.y); });
});
</script>
</visual>
\`\`\`

## Interactive diagrams (node-based)

For **flowcharts, architecture diagrams, state machines, dependency graphs, or any node-and-edge diagram**, use a JSON spec instead of HTML/SVG. The app renders it as an interactive diagram with draggable nodes, zoom, and pan.

**Format:** Output a JSON object with \`nodes\` and \`edges\` arrays inside the \`<visual>\` tag.

**Node fields:**
- \`id\` (required) — unique string identifier
- \`label\` (required) — display text
- \`type\` (optional) — semantic type: \`"input"\` (blue), \`"output"\` (green), or omit for auto-assigned palette
- \`style\` (optional) — CSS style overrides: \`{ background, border, color }\`

**Node color rules (use ONLY these when specifying custom styles):**
- Primary/main nodes: \`#3b82f6\` (blue border, \`#1e3a5f\` bg)
- Success/positive: \`#22c55e\` (green border, \`#1a4731\` bg)
- Warning/alternative: \`#f59e0b\` (amber border, \`#422006\` bg)
- Danger/problem: \`#ef4444\` (red border, \`#4a1c1c\` bg)
- Neutral/info: \`#8b5cf6\` (purple border, \`#3b1f5e\` bg)
- Default: \`#334155\` (slate border, \`#1e293b\` bg)
- Always use white/light text (\`#f1f5f9\`) on all nodes
- Never use: random colors, bright white backgrounds

**Edge fields:**
- \`id\` (optional) — unique string; auto-generated if omitted
- \`source\` (required) — must match a node \`id\`
- \`target\` (required) — must match a node \`id\`
- \`label\` (optional) — edge label text
- \`animated\` (optional) — set to \`true\` for animated/dashed edges

**Diagram example:**
\`\`\`
<visual title="System architecture">
{
  "nodes": [
    { "id": "client", "label": "Client App", "type": "input" },
    { "id": "api", "label": "API Gateway", "style": { "background": "#1e3a5f", "border": "#3b82f6" } },
    { "id": "auth", "label": "Auth Service" },
    { "id": "db", "label": "Database", "type": "output" },
    { "id": "cache", "label": "Redis Cache" }
  ],
  "edges": [
    { "source": "client", "target": "api", "label": "HTTPS" },
    { "source": "api", "target": "auth", "label": "validate" },
    { "source": "api", "target": "db", "label": "query", "animated": true },
    { "source": "api", "target": "cache", "label": "lookup" },
    { "source": "cache", "target": "db", "label": "miss" }
  ]
}
</visual>
\`\`\`

**When to use diagrams vs charts vs SVG:**
- Use **JSON diagram spec** for: flowcharts, architecture diagrams, state machines, org charts, dependency graphs, sequence flows
- Use **Chart.js** for: bar charts, line charts, pie charts, scatter plots, radar charts — anything with numerical data axes
- Use **D3.js** for: force graphs, treemaps, sunbursts, custom SVG layouts — anything needing custom visual computation
- Use **SVG/HTML** for: simple static diagrams, timelines, comparisons, visual guides

## Rive animations

For animated illustrations (loading spinners, success/error indicators, process animations), use a Rive animation inside the visual tag.

**Built-in animations:** \`loading\`, \`check\`, \`error\`

**Format:**
\`\`\`
<visual title="Loading">
{"src": "loading"}
</visual>
\`\`\`

**Custom Rive file:**
\`\`\`
<visual title="Custom animation">
{"src": "https://example.com/animation.riv", "stateMachines": ["StateMachine"], "inputs": {"trigger": true}}
</visual>
\`\`\`
`.trim();
