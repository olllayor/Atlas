import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';
import path from 'node:path';
import dotenv from 'dotenv';
import { visualizer } from 'rollup-plugin-visualizer';

dotenv.config();

// Bundle stats only when explicitly requested; otherwise no stats.html lands in
// out/renderer (and therefore never in a package).
const isAnalyze = process.env.ANALYZE === '1' || process.env.ANALYZE === 'true';

export default defineConfig({
  main: {
    build: {
      // Production packages must not ship maps (also excluded via package.json
      // build.files). Dev debugging uses electron-vite dev, not out/.
      sourcemap: false,
      externalizeDeps: {
        exclude: ['@opencode-ai/sdk']
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs'
        }
      }
    },
    define: {
      'process.env.POSTHOG_API_KEY': JSON.stringify(process.env.POSTHOG_API_KEY ?? ''),
      'process.env.POSTHOG_HOST': JSON.stringify(process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com')
    }
  },
  preload: {
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      react(),
      tailwindcss(),
      ...(isAnalyze
        ? [visualizer({ filename: 'out/renderer/stats.html', open: false, gzipSize: true })]
        : [])
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer')
      }
    },
    define: {
      'import.meta.env.POSTHOG_API_KEY': JSON.stringify(process.env.POSTHOG_API_KEY ?? ''),
      'import.meta.env.POSTHOG_HOST': JSON.stringify(process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com')
    }
  }
});
