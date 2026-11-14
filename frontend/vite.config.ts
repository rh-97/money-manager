import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.MM_API_TARGET ?? 'http://localhost:8787', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
