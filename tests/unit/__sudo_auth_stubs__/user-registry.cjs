// CJS stub for @/lib/user-registry used by the per-user sudo tests.
//
// WHY a .cjs stub instead of vi.mock: resolveSudoPasswordHash() reaches the
// user registry via a runtime `require('./user-registry')` (to avoid a static
// import cycle), and vitest's resolve.alias / vi.mock do NOT intercept a
// runtime require. Tests patch Module._resolveFilename to point the specifier
// here. `__setUsers` drives what getUser sees.
let _users = []
module.exports = {
  getUser: (id) => _users.find((u) => u.id === id && !u.deletedAt) || null,
  __setUsers: (u) => { _users = u },
  __reset: () => { _users = [] },
}
