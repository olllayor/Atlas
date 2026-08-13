import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

/**
 * Standalone renderer preview server.
 *
 * Runs `src/renderer` in a plain browser (no Electron) so UI work can be
 * screenshotted and diffed. The IPC bridge (`window.atlasChat`) is stubbed by
 * `scripts/uiPreview/bridgeStub.ts`, injected via Playwright init script.
 */
export default defineConfig({
  root: path.join(repoRoot, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(repoRoot, 'src/renderer')
    }
  },
  define: {
    'import.meta.env.POSTHOG_API_KEY': JSON.stringify(''),
    'import.meta.env.POSTHOG_HOST': JSON.stringify('https://us.i.posthog.com')
  },
  server: {
    port: 5181,
    strictPort: true
  }
});
