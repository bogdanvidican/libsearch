import { defineConfig } from 'vitest/config';

// Default environment is node (server/indexer). UI tests opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test') },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
  },
});
