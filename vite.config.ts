import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: { host: '0.0.0.0', port: 1420, strictPort: true, allowedHosts: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: ['es2022', 'chrome105'], sourcemap: false },
});
