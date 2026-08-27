import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin SPA is served by the Worker under /__admin/, so every asset URL
// must be prefixed accordingly. `wrangler dev` (port 8787) backs the API while
// `vite` runs the panel with HMR.
export default defineConfig({
  root: 'web',
  base: '/__admin/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/__api': 'http://127.0.0.1:8787',
      '/m': 'http://127.0.0.1:8787',
    },
  },
});
