import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/desktop/src/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'apps/desktop/src/shared'),
      '@main': resolve(__dirname, 'apps/desktop/src/main')
    }
  }
});
