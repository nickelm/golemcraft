import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/golemcraft/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
        visualizer: resolve(__dirname, 'visualizer.html')
      }
    }
  },
  server: {
    port: 5173,
    open: true,
  },
});