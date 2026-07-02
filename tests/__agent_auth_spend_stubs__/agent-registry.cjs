// CJS stub for the RUNTIME `require('./agent-registry')` in
// lib/agent-auth.ts::findAgentBySessionSecret / resolveGovernanceContext, used
// by tests/agent-auth-spend-gate.test.ts.
//
// WHY a .cjs stub (not vi.mock): vitest does NOT resolve a bare relative
// `require('./agent-registry')` to its .ts, and vi.mock cannot intercept a
// runtime require — it only rewrites ESM `import`. The test patches
// Module._resolveFilename to point the RUNTIME specifier `./agent-registry` here.
// (The STATIC `import { getAgent } from './agent-registry'` in agent-auth is
// resolved by vite, so it is covered by the test's separate vi.mock — the two
// resolution mechanisms are disjoint.) Both read the SAME globalThis record so
// the static-import path and the runtime-require path see one agent.
function rec() {
  return globalThis.__SPEND_AGENT || { id: 'agent-1', name: 'alpha', metadata: { sessionSecretHash: 'hash', amp: { fingerprint: 'SHA256:fp-1' } } }
}
module.exports = {
  loadAgents: () => [rec()],
  getAgent: () => rec(),
}
