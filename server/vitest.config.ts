import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
