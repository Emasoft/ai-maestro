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
    // Redirects $JANITOR_CONTROL_DIR to a throwaway so no test can write the developer's real
    // `~/.claude/janitor-control/`. The absorbed chores stamp that dir from inside their own code
    // path (TRDD-14HI8ZPR), so containment cannot live at the call sites — one test file already
    // leaked a real stamp before this existed. See the file header for the measurement.
    // The second entry is the same lesson one file over: a tripwire that must be CALLED protected
    // 6 of 385 suites, and the write it was built to catch arrived through one of the other 379.
    // A guard against an UNEXPECTED write is worth only what its adoption rate is, so it is global.
    setupFiles: [
      'tests/setup/janitor-control-containment.ts',
      'tests/setup/real-user-settings-untouched.ts',
    ],
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
