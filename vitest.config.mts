import { defineConfig } from 'vitest/config';

// Default environment is node (server/indexer). UI tests opt in with `// @vitest-environment jsdom`.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('0.0.0-test'), __UPDATE_REPO__: JSON.stringify('test/repo') },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    // Set-up hooks build a real index (pdftotext) or bundle the downloader: slow when the suite runs in parallel.
    hookTimeout: 60000,
  },
});
