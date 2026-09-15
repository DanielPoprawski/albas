import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// package.json is the one place a version number is written by hand; every
// other file is derived from it by scripts/version.mjs. Reading it here is what
// lets the UI show the same number without a sixth copy to keep in step.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  // The bundle is served from disk inside the WebView, so chunk size has no
  // load-time cost; splitting the vendor libs out only keeps Vite's 500 kB
  // warning quiet and makes the app chunk diff smaller between releases.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'radix-ui'],
          dates: ['date-fns', 'chrono-node', 'rrule'],
          icons: ['lucide-react'],
        },
      },
    },
  },

  // must mirror the `paths` entry in tsconfig.json (__dirname doesn't exist
  // here — this config is ESM, since package.json sets "type": "module")
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}));
