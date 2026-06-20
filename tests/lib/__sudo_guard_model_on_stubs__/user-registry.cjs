// CJS stub for @/lib/user-registry, used ONLY by sudo-guard-model-on.test.ts.
//
// WHY a .cjs stub instead of vi.mock: BOTH lib/sudo-auth.ts (resolveSudoPasswordHash)
// and lib/sudo-guard.ts reach the user registry via a runtime `require('./user-registry')`
// (deliberate, to avoid a static import cycle). vitest's resolve.alias / vi.mock do NOT
// intercept a runtime require — the test patches Module._resolveFilename to point the
// './user-registry' / '@/lib/user-registry' specifiers here.
//
// State is driven through globalThis so the single test file controls it per-test
// without re-requiring the stub. This mirrors tests/unit/__sudo_auth_stubs__/user-registry.cjs
// but additionally exports getActiveMaestroUserId (the accessor the guard's L2 fix widens with).
const g = globalThis
function state() {
  if (!g.__sudoGuardModelOnUR) g.__sudoGuardModelOnUR = { users: [], activeMaestroId: null }
  return g.__sudoGuardModelOnUR
}
module.exports = {
  // Used by sudo-auth.resolveSudoPasswordHash under the model.
  getUser: (id) => state().users.find((u) => u.id === id && !u.deletedAt) || null,
  // Used by the sudo-guard L2 fix to widen the accepted-subject set under the model.
  getActiveMaestroUserId: () => state().activeMaestroId,
}
