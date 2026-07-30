// R9.9 — at server startup, if no MANAGER is detected, team blocking + agent
// hibernation runs as a startup task.
//
// WHY THIS FILE EXISTS: same reason as its two neighbours (startup-marketplaces,
// startup-user-scope-guard) — it ran inline in `server.mjs::startServer`, which binds
// sockets on import, so the guard was ENFORCED and unobservable. R9 is the
// manager-gated governance cascade: with no MANAGER on the host, every team is
// blocked and its agents hibernated. A guard that big should not be un-driveable.
//
// DEPENDENCY INJECTION rather than module mocking: server.mjs imports `getManagerId`
// and `blockAllTeams` lazily inside the try block, and a module-level mock cannot
// intercept a dynamic import from inside a function body.
//
// NO DEFENSIVE HANDLING, deliberately: `blockAllTeams()` returning a non-array is a
// broken registry, not a condition to paper over — it throws, server.mjs's own
// try/catch logs it, and boot continues. That is the behaviour being preserved.

/**
 * Run the startup MANAGER gate. Returns what it did so a caller (or a test) can see
 * it, rather than only inferring it from a log line.
 *
 * @param deps {{ getManagerId, blockAllTeams, log? }}
 * @returns {Promise<{blocked: boolean, hibernated: number}>}
 */
export async function enforceStartupManagerGate(deps) {
  const { getManagerId, blockAllTeams, log = console.log } = deps
  if (getManagerId()) return { blocked: false, hibernated: 0 }

  const hibernated = await blockAllTeams()
  if (hibernated.length > 0) {
    log(`[Startup] No MANAGER detected — blocked all teams, hibernated ${hibernated.length} team agent(s)`)
  } else {
    log(`[Startup] No MANAGER detected — all teams blocked (no active team agents to hibernate)`)
  }
  return { blocked: true, hibernated: hibernated.length }
}
