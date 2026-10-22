import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:8787', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  optimizeDeps: { include: ['three'] },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
