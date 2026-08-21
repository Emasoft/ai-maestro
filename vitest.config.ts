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
    // No timeout was set here, so all 441 files ran at vitest's 5_000 default — while FIFTY of
    // them spawn a real subprocess (`spawnSync`/`execFileSync`/`spawn`), several against their own
    // 60_000-120_000 guards. The outer budget was thus shorter than the inner one in every such
    // file, so the subprocess guard could never bind and CPU load decided the verdict.
    //
    // Measured 2026-08-21 across four consecutive full runs on this box: wall time drifted 37s →
    // 53s → 97s under a load average of 28-34, and each run failed a DIFFERENT small set — five
    // failures in the last one, every single one reading "Test timed out in 5000ms" with ZERO
    // assertions, all green in isolation. An unstable failure SET is contention's signature; a
    // real regression fails the same test every time. Fifteen files had already worked around this
    // one at a time with their own `vi.setConfig`, which is the same defect being paid for fifty
    // times.
    //
    // 30_000 is the floor, not a ceiling: a file whose subprocess guard is higher still raises its
    // own (aimaestro-settings-cli 150_000, the pillar CLI suites 60_000). This hides no failure —
    // a timeout is not an assertion, and a genuinely hung test now surfaces in 30s instead of 5s.
    testTimeout: 30_000,
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
