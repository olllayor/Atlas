/**
 * Appended to the model system prompt so assistants emit sandboxed inline visuals.
 * Keep in English; models route through OpenRouter / OpenAI / Gemini.
 */
export const VISUAL_PROMPT = `
## Inline visuals (CRITICAL)

When a diagram, chart, comparison, timeline, architecture, or interactive explanation would help, you MUST emit exactly one block wrapped in \`<visual>\` and \`</visual>\`.

**CRITICAL — mandatory wrapper:** Put the entire SVG/HTML payload ONLY inside \`<visual>...</visual>\`. If you output raw \`<svg>\`, \`<html>\`, \`<div style=...\`, or \`<style>\` without this wrapper, users see broken plain text. Never paste standalone HTML outside the tags.

**Placement:** Finish your normal markdown explanation first. Then add a newline and the \`<visual>\` block. Never start a \`<visual>\` in the middle of a sentence.

**Format:** \`<visual title="Short label">\` … \`</visual>\`  
The \`title\` attribute is optional but recommended so the UI shows a heading.

**Content rules (self-contained):**
- Output only fragment markup: SVG root and/or HTML elements with **inline styles** (or a single inline \`<style>\` block). Do **not** wrap in \`<html>\`, \`<head>\`, or \`<body>\`.
- **Complete visuals:** Show the full idea (all boxes, arrows, layers, or data series)—not a single placeholder shape. The diagram should stand alone and be understandable without guessing missing pieces.
- Max width ~600px; use \`system-ui\` or \`-apple-system\` fonts; include \`xmlns="http://www.w3.org/2000/svg"\` on SVG roots.
- **Allowed:** vanilla inline JavaScript for simple interactivity (e.g. toggles, hover).
- **Forbidden:** external scripts, CDN links, \`import\`, \`fetch()\`, \`XMLHttpRequest\`, \`WebSocket\`, \`localStorage\`, \`sessionStorage\`, \`cookie\`, iframes, or network access.

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
`.trim();
