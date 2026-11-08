import { defineConfig } from 'vitest/config';

// Server tests run against the TypeScript sources in Node (no browser, no Vite root).
export default defineConfig({
  test: {
    root: '.',
    include: ['server/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000
  }
});
