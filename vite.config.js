import { defineConfig } from 'vite';

export default defineConfig({
  base: '/golemcraft/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});