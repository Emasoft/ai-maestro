/**
 * 0-IMPACT containment for any test that touches the ecosystem path helpers.
 *
 * WHY THIS EXISTS
 * ---------------
 * `lib/ecosystem-constants.ts` resolves `homedir()` through a RUNTIME `require('os')`
 * INSIDE each function body. `vi.mock('os', …)` only intercepts STATIC imports, so it does
 * NOT reliably contain those functions — and a test that believes it is sandboxed will
 * happily create real directories under the developer's own `~/agents/`. That is not
 * hypothetical: governance batch 1 did exactly that before catching itself.
 *
 * The containment that actually works is overriding the PATH FUNCTIONS themselves, so it
 * holds regardless of how `homedir()` is resolved internally. Every other export — the
 * naming builders and constant maps that the guards under test actually read — stays REAL
 * via the `...actual` spread, because mocking those would test the mock instead of the code.
 *
 * This idiom was hand-rolled in 8 separate test files before this helper existed. Each copy
 * was a chance to omit one override and silently write to the real home.
 *
 * USAGE — the `await import()` must stay INSIDE the factory. `vi.mock` is hoisted above all
 * top-level imports, so a static import of this module would not be initialised in time.
 * `FAKE_HOME` / `FAKE_STATE` must come from `vi.hoisted()` for the same reason.
 *
 *   const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => { … mkdtempSync … })
 *
 *   vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
 *     const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
 *     return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
 *   })
 *
 * Mock `os.homedir` alongside it (layer 1) for the services that DO resolve $HOME through a
 * static import; this helper is layer 2 and closes what layer 1 cannot reach.
 */
import { join, resolve, sep } from 'path'

type Ecosystem = typeof import('@/lib/ecosystem-constants')

/**
 * Temp roots, resolved WITHOUT importing `os`.
 *
 * This helper is loaded by tests that mock `os` (layer 1 of the same containment), so a
 * static `import { tmpdir } from 'os'` here resolves to the MOCK — and the spread in those
 * factories does not reliably carry `tmpdir` through, which made it `undefined` and threw
 * "tmpdir is not a function" at setup. A validator must never depend on the module it is
 * validating containment for. `process.env` is not mocked, so it is safe.
 */
const TEMP_ROOTS = [
  process.env.TMPDIR,
  '/tmp',
  '/private/tmp',
  '/var/tmp',
  '/private/var/tmp',
].filter((p): p is string => Boolean(p))

/**
 * Refuse a containment root that is not under the OS temp dir.
 *
 * A silent no-op is the worst outcome available here: the suite passes, and the damage
 * lands in the developer's real home where nothing reports it. Throwing means a
 * mis-wired test fails loudly at setup instead of quietly writing outside the sandbox.
 */
function assertSandboxed(label: string, dir: string): string {
  const real = resolve(dir)
  // macOS reports /var/folders/... while realpath yields /private/var/folders/... — accept
  // either, but require a genuine path-segment prefix so `/tmpfoo` cannot pass for `/tmp`.
  const ok = TEMP_ROOTS.map(p => resolve(p)).some(
    p => real === p || real.startsWith(p + sep),
  )
  if (!ok) {
    throw new Error(
      `fakeEcosystemPaths: ${label} must be a temp directory (got "${real}").\n` +
        `Create it with fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-')). Pointing ` +
        `containment at a real path would let the suite write to the developer's home.`,
    )
  }
  return real
}

/**
 * Build the partial-mock object for `@/lib/ecosystem-constants`, with every container path
 * redirected under `fakeHome` and all state under `fakeState`.
 */
export function fakeEcosystemPaths(
  actual: Ecosystem,
  fakeHome: string,
  fakeState: string,
): Ecosystem {
  const home = assertSandboxed('fakeHome', fakeHome)
  const state = assertSandboxed('fakeState', fakeState)
  const agentsBase = join(home, 'agents')

  return {
    ...actual,
    getStateDir: () => state,
    statePath: (...segments: string[]) => join(state, ...segments),
    getCustomPluginsContainerPath: () => join(agentsBase, 'custom-plugins'),
    getRolePluginsContainerPath: () => join(agentsBase, 'role-plugins'),
    getCorePluginsContainerPath: () => join(agentsBase, 'core-plugins'),
    getCustomAbstractDir: () => join(agentsBase, 'custom-plugins', '.abstract'),
    getRoleAbstractDir: () => join(agentsBase, 'role-plugins', '.abstract'),
    getCoreAbstractDir: () => join(agentsBase, 'core-plugins', '.abstract'),
    getCustomMarketplacePathForClient: (client: string) =>
      join(agentsBase, 'custom-plugins', actual.customMarketplaceDirName(client)),
    getRoleMarketplacePathForClient: (client: string) =>
      join(agentsBase, 'role-plugins', actual.rolesMarketplaceDirName(client)),
    getCoreMarketplacePathForClient: (client: string) =>
      join(agentsBase, 'core-plugins', actual.coreMarketplaceDirName(client)),
    getLocalMarketplacePath: () => join(agentsBase, 'role-plugins'),
    getCustomMarketplacePath: () => join(agentsBase, 'custom-plugins'),
  }
}
