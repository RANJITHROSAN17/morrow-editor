import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { host: '0.0.0.0', port: 1420, strictPort: true, allowedHosts: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // Pre-bundle the on-demand worker dependency at server startup. Otherwise
  // Vite may reload an in-progress editor when preview is opened for the first time.
  optimizeDeps: { include: ['markdown-it'] },
  build: { target: ['es2022', 'chrome105'], sourcemap: false },
});
