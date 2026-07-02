// CJS stub for @/lib/agent-registry used by the portfolio tests.
//
// WHY a .cjs stub instead of vi.mock: the portfolio source modules reach the
// registry via a runtime `require('@/lib/agent-registry')` (so the import does
// not pull the whole agent graph at module-load). vitest's `resolve.alias`
// only rewrites ESM `import`, NOT runtime `require('@/...')`, so a `vi.mock`
// never intercepts that call — the require fails to resolve. Tests instead
// patch `Module._resolveFilename` to point `@/lib/agent-registry` at this
// stub, which Node's native require loads cleanly. `__setAgents` drives what
// issuerStillValid sees.
let _agents = []
module.exports = {
  loadAgents: () => _agents,
  getAgentBySession: () => undefined,
  getAgent: () => undefined,
  __setAgents: (a) => { _agents = a },
}
