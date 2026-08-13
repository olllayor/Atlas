import type { VisualThemeTokens } from './contracts';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildAugmentationHead({ visualId, theme }: { visualId: string; theme: VisualThemeTokens }) {
  return `
<meta charset="utf-8" />
<meta name="color-scheme" content="${theme.colorScheme}" />
<style>
:root{
  color-scheme:${theme.colorScheme};
  --atlas-bg:${theme.background};
  --atlas-panel:${theme.panel};
  --atlas-text:${theme.text};
  --atlas-muted:${theme.mutedText};
  --atlas-border:${theme.border};
  --atlas-accent:${theme.accent};
  --atlas-error-bg:${theme.errorBackground};
  --atlas-error-border:${theme.errorBorder};
  --atlas-error-text:${theme.errorText};
}
*{box-sizing:border-box}
html,body{
  margin:0;
  min-height:100%;
  background:transparent !important;
  color:var(--atlas-text);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
}
body{
  padding:0;
  margin:0;
  overflow-x:hidden;
  overflow-y:visible;
}
svg{display:block;max-width:100%;height:auto}
a{color:var(--atlas-accent)}
</style>
<script>
(() => {
  const visualId = ${JSON.stringify(visualId)};
  window.__visualId = visualId;
  const post = (type, payload = {}) => {
    try {
      window.parent.postMessage({ source: 'atlas-visual', type, visualId, ...payload }, '*');
    } catch {}
  };
  const toMessage = (value, fallback) => {
    if (value instanceof Error && value.message) return value.message;
    if (typeof value === 'string' && value.trim()) return value;
    try {
      const text = JSON.stringify(value);
      return text && text !== 'null' ? text : fallback;
    } catch {
      return fallback;
    }
  };
  const reportSize = () => {
    const body = document.body;
    const root = document.documentElement;
    const height = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    );
    post('visual-resize', { height });
  };
  window.addEventListener('error', (event) => {
    const detail = [
      event.message || 'Unknown error',
      event.filename ? ' at ' + event.filename + ':' + (event.lineno || '?') : '',
      event.error && event.error.stack ? '\\n' + event.error.stack : '',
    ].join('');
    post('visual-error', { message: detail });
  });
  window.addEventListener('unhandledrejection', (event) => {
    post('visual-error', { message: toMessage(event.reason, 'The visual failed to render.') });
  });
  window.addEventListener('load', () => {
    // Only observe the actual content element, NOT body or documentElement
    // Observing body creates a loop: parent resizes iframe → body size changes → ResizeObserver fires → parent resizes again
    const contentEl = document.getElementById('root')
      || document.querySelector('canvas')
      || document.querySelector('svg')
      || document.body.firstElementChild;

    if ('ResizeObserver' in window && contentEl) {
      const observer = new ResizeObserver(() => {
        const h = contentEl.getBoundingClientRect().height;
        post('visual-resize', { height: h + 32 });
      });
      observer.observe(contentEl);
    }
    if ('MutationObserver' in window) {
      const mutObs = new MutationObserver(() => {
        const h = contentEl ? contentEl.getBoundingClientRect().height : 0;
        post('visual-resize', { height: h + 32 });
      });
      mutObs.observe(document.body, { childList: true, subtree: true, attributes: true });
    }
    reportSize();
    requestAnimationFrame(reportSize);
    setTimeout(reportSize, 60);
    setTimeout(reportSize, 200);
    post('visual-ready');
  });
})();
</script>`.trim();
}

function looksLikeFullHtmlDocument(content: string) {
  return /<\s*(?:!doctype|html|head|body)\b/i.test(content);
}

function buildLibraryScripts(libraries: string[]): string {
  if (libraries.length === 0) return '';
  return libraries
    .map((script) => `<script>\n${script}\n</script>`)
    .join('\n');
}

export function buildVisualSrcDoc({
  visualId,
  content,
  theme,
  libraries = [],
}: {
  visualId: string;
  content: string;
  theme: VisualThemeTokens;
  libraries?: string[];
}) {
  const augmentationHead = buildAugmentationHead({ visualId, theme });
  const libraryScripts = buildLibraryScripts(libraries);

  if (looksLikeFullHtmlDocument(content)) {
    if (/<head[\s>]/i.test(content)) {
      return content.replace(/<head([^>]*)>/i, `<head$1>\n${libraryScripts}\n${augmentationHead}\n`);
    }

    if (/<html[\s>]/i.test(content)) {
      return content.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${libraryScripts}\n${augmentationHead}\n</head>\n`);
    }

    return `${libraryScripts}\n${augmentationHead}\n${content}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
${libraryScripts}
${augmentationHead}
</head>
<body>
${content}
</body>
</html>`;
}

export function buildStandaloneVisualWindowHtml({
  title,
  srcdoc,
  theme,
}: {
  title?: string;
  srcdoc: string;
  theme: VisualThemeTokens;
}) {
  const safeTitle = title?.trim() || 'Inline Visual';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="${theme.colorScheme}" />
  <title>${escapeHtml(safeTitle)}</title>
  <style>
    :root{
      color-scheme:${theme.colorScheme};
      --atlas-bg:${theme.background};
      --atlas-panel:${theme.panel};
      --atlas-text:${theme.text};
      --atlas-muted:${theme.mutedText};
      --atlas-border:${theme.border};
    }
    *{box-sizing:border-box}
    html,body{margin:0;height:100%;background:var(--atlas-bg);color:var(--atlas-text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif}
    body{display:flex;flex-direction:column}
    header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--atlas-border);background:var(--atlas-panel)}
    h1{margin:0;font-size:13px;font-weight:600;letter-spacing:0.01em}
    span{font-size:12px;color:var(--atlas-muted)}
    iframe{flex:1;width:100%;border:0;background:var(--atlas-bg)}
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(safeTitle)}</h1>
    <span>Sandboxed visual</span>
  </header>
  <iframe sandbox="allow-scripts" srcdoc="${escapeAttribute(srcdoc)}" title="${escapeAttribute(safeTitle)}"></iframe>
</body>
</html>`;
}
