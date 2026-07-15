import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // .tsx added for React component tests (e.g. tests/unit/password-dialog.test.tsx,
    // TRDD-P7XKV3N9). Each such file sets `// @vitest-environment jsdom` itself, so the
    // default node environment above is unchanged for the .ts suite.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', '.next'],
  },
  // Automatic JSX runtime so .tsx tests need no explicit React import. Affects only files
  // containing JSX; the existing .ts tests transform identically to before.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
