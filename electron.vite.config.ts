import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: 'chunks/[name]-[hash].cjs'
        }
      }
    }
  },
  preload: {
    build: {
      sourcemap: true,
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
    plugins: [react(), tailwindcss()],
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
