// CJS stub for @/lib/governance, used ONLY by sudo-guard-model-on.test.ts.
//
// WHY: lib/sudo-guard.ts reads the model flag via a runtime `require('./governance')`
// (line ~150), which neither resolve.alias nor vi.mock intercepts. The test patches
// Module._resolveFilename to point './governance' / '@/lib/governance' here for the
// runtime-require seam. lib/sudo-auth.ts's STATIC `import ... from './governance'` is a
// separate seam handled by vi.mock in the test; both read the SAME globalThis flag so the
// model is consistent across the mint (sudo-auth) and the consume (sudo-guard).
//
// loadGovernance() returns a stub global hash so sudo-auth's model-OFF mint branch works
// if it is ever consulted through this seam.
const g = globalThis
module.exports = {
  isUserAuthorityModelEnabled: () => g.__sudoGuardModelOnFlag === true,
  loadGovernance: () => ({ passwordHash: 'argon2$stub' }),
}
