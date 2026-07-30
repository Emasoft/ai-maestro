// R17 + R20.21 — every marketplace the fleet needs is registered at server boot.
//
// WHY THIS FILE EXISTS: this ran inline in `server.mjs::startServer`, which binds
// sockets on import, so no test could observe it. And its contract is precisely the
// kind that CANNOT be checked any other way: every call is individually wrapped so
// an "already registered" / "not found" exit at boot cannot block startup — which
// means a genuine failure and a normal no-op are indistinguishable to the caller BY
// DESIGN. The only way to know the right calls are still being made is to watch them
// being made.
//
// DEPENDENCY INJECTION, not module mocking: server.mjs imports the AIOs LAZILY,
// inside the try block, so a module-level mock would have to intercept a dynamic
// import — the same trap that made an earlier test batch write real directories
// under ~/agents/ (`vi.mock('os')` does not intercept a runtime `import('os')`
// inside a function body). Passing the functions in sidesteps the whole class.
//
// R21.4: dispatch through the AIO surface rather than `execSync`-ing the Claude CLI,
// so each operation runs its own G00..G06 gate pipeline (auth, input validation,
// ledger emission, the R21.6 delete cascade) — one piece of code per concern.

/**
 * Register the remote marketplace + the two Claude local containers, and remove the
 * stale core-marketplace name. Best-effort per call; never throws for a failed
 * registration. Returns the labels attempted, in order — the observable that proves
 * one failure did not swallow the rest.
 *
 * @param deps {{ CreateMarketplace, UpdateMarketplace, DeleteMarketplace, homedir, log? }}
 */
export async function ensureMarketplacesRegistered(deps) {
  const { CreateMarketplace, UpdateMarketplace, DeleteMarketplace, homedir, log = console.log } = deps
  const sysAuth = { isSystemOwner: true }
  const attempted = []

  const tryCall = async (label, fn) => {
    attempted.push(label)
    try {
      const r = await fn()
      if (r && r.success === false && r.error) {
        // Idempotent/already-exists/not-found are NORMAL on reboot; debug level only.
        log(`[Startup/${label}] noop:`, r.error.slice(0, 80))
      }
    } catch (e) {
      log(`[Startup/${label}] threw:`, (e?.message || String(e)).slice(0, 80))
    }
  }

  // Remote GitHub marketplace (Emasoft/ai-maestro-plugins)
  await tryCall('add-remote', () =>
    CreateMarketplace({ name: 'ai-maestro-plugins', source: { repo: 'Emasoft/ai-maestro-plugins' } }, sysAuth))

  // Local role-plugins container
  const rolesDir = homedir() + '/agents/role-plugins'
  await tryCall('add-roles', () =>
    CreateMarketplace({ name: 'ai-maestro-local-roles-marketplace', source: { path: rolesDir } }, sysAuth))
  await tryCall('update-roles', () =>
    UpdateMarketplace({ name: 'ai-maestro-local-roles-marketplace' }, sysAuth))

  // Local custom-plugins container
  const customDir = homedir() + '/agents/custom-plugins'
  await tryCall('add-custom', () =>
    CreateMarketplace({ name: 'ai-maestro-local-custom-marketplace', source: { path: customDir } }, sysAuth))
  await tryCall('update-custom', () =>
    UpdateMarketplace({ name: 'ai-maestro-local-custom-marketplace' }, sysAuth))

  // R20.25 (clarified 2026-04-16): Claude installs the core plugin from the REMOTE
  // marketplace — there is NO local Claude core marketplace. Non-Claude clients
  // install via a per-client adapter copying straight from <client>-core-marketplace/,
  // so the core-plugins container needs no Claude CLI registration. Cleanup: remove
  // the stale name if a previous server run created it. DeleteMarketplace cascades
  // through UninstallPlugin per plugin (R21.6) — if an agent held a plugin from this
  // deprecated marketplace, the cascade unblocks the agent (those plugins pointed at
  // an already-broken registration).
  await tryCall('remove-stale-core', () =>
    DeleteMarketplace({ name: 'ai-maestro-local-core-marketplace' }, sysAuth))

  log('[Startup] Marketplaces registered via AIOs (remote + 2 Claude containers; per-client core via adapters)')
  return attempted
}
