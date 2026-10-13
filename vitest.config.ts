import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // In the app, Vite bundles mammoth's browser build. Its Node build cannot read the
      // arrayBuffer that fileExtractor.ts passes, so the tests load the browser build too.
      { find: /^mammoth$/, replacement: 'mammoth/mammoth.browser.js' },
    ],
  },
  test: {
    environment: 'node',
  },
});
