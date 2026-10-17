import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    // three.js alone is ~600 kB minified (~150 kB gzip).
    chunkSizeWarningLimit: 800,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
