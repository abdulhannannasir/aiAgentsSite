import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The React app lives in client/ and builds into public/, which the Express server (and Vercel's CDN) serves.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
