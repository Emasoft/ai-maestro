// CJS stub for @/lib/team-registry used by the portfolio tests.
//
// WHY a .cjs stub instead of vi.mock: portfolio-issue-guard.ts reaches the
// team registry via a runtime `require('@/lib/team-registry')` (to avoid a
// module-load cycle). vitest's `resolve.alias` only rewrites ESM `import`, not
// runtime `require('@/...')`, so a `vi.mock` cannot intercept that call.
// Tests patch `Module._resolveFilename` to point `@/lib/team-registry` at this
// stub; Node's native require loads it cleanly. `__setTeams` drives membership.
let _teams = []
module.exports = {
  loadTeams: () => _teams,
  __setTeams: (t) => { _teams = t },
}
