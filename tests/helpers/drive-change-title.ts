/**
 * Drive the REAL `ChangeTitle` pipeline against a temp home — TRDD-DQ6XN2VP.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ChangeTitle` is the LAST pipeline with a real partial-state window (every other hand-rolled one
 * was measured 2026-07-31 to be a single mutating call with nothing abortable after it, or — for
 * `InstallElement` — mutations a compensation is forbidden to reverse). Its window is wide: G10
 * calls `removeManager()` and then `blockAllTeams()`, which HIBERNATES every team agent on the
 * host; G11/G12 null out team COS/ORCH pointers; G14b/G14e revoke AID and portfolio tokens. A
 * failure anywhere after G10 leaves the host with teams blocked and the fleet asleep.
 *
 * Nothing drives that today. Eight test files call `ChangeTitle`, and all of them assert
 * authorization, ordering, or a return value — none forces a mid-pipeline failure and looks at what
 * was left behind. This helper is the missing instrument, and it is deliberately SEPARATE from the
 * retrofit: a driver is additive, commits cleanly on its own, and is what makes the restructure
 * tractable in a later session.
 *
 * THE ORDER IS NOT THE LABEL ORDER — do not "sort the gates" when using this
 * -------------------------------------------------------------------------
 * G14 (the `updateAgent({governanceTitle})` write) is at `element-management-service.ts:2685` and
 * runs BEFORE G10-G13b at :2736-2847. That is deliberate, commented at :2651-2671, and pinned by a
 * test (TRDD-EE5YX5LF): running the most failure-prone gate FIRST turns its failure into a clean
 * no-op instead of a host with NO manager and every team blocked. It defends against PROCESS DEATH,
 * which no compensation covers, so it survives the retrofit rather than being replaced by it.
 *
 * CONTAINMENT — three layers, each load-bearing, and one of them is a subprocess
 * ----------------------------------------------------------------------------
 *  1. `os.homedir()` — `element-management-service.ts` resolves `const HOME = homedir()` at MODULE
 *     LOAD and derives `agentsRoot` from it.
 *  2. `@/lib/ecosystem-constants` — G14 verifies its own write by re-reading
 *     `statePath('agents','registry.json')` with the REAL `fs` (TRDD-N7X4KDQ2 moved it onto this
 *     seam for exactly this reason). Without layer 2 that read hits the developer's real registry,
 *     the synthetic agent is absent, and EVERY ChangeTitle fails at G14 — which silently makes
 *     everything downstream untestable.
 *  3. A `claude` PATH SHIM — G16's `installPluginLocally` SPAWNS `claude plugin install` as a child
 *     process. An in-process mock cannot reach a child; the shim can, because the child inherits
 *     `process.env.PATH`. Same precedent as the R20.28 installer test.
 *
 * WHY REAL `fs`: the properties under test are FILES (registry.json, settings.local.json). With
 * `fs` mocked, G14's disk verification and G14d's settings read are unobservable and the test would
 * assert against its own stubs.
 *
 * WHAT IS DELIBERATELY *NOT* MOCKED: `@/lib/client-capabilities` and `@/lib/program-args` are pure
 * functions with no I/O — stubbing them would replace real behaviour with a guess. A `claude` agent
 * never reaches `@/lib/client-plugin-adapters` or `@/services/plugin-storage-service` (both are
 * gated on `clientType !== 'claude'`), so those are left alone too.
 *
 * USAGE — the factories are per-file and hoisted, so a test writes its own `vi.mock` lines; this
 * module supplies their BODIES. The `await import()` must stay INSIDE each factory: `vi.mock` is
 * hoisted above every top-level import.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'

export { registryMock, registryPath, seedAgent } from '@/tests/helpers/drive-delete-agent'
export type { FakeAgent, FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'

export interface FakeTeam {
  id: string
  name: string
  agentIds: string[]
  chiefOfStaffId?: string | null
  orchestratorId?: string | null
  blocked?: boolean
}

/**
 * Everything the governance half of the pipeline reads or writes, in one observable object.
 *
 * It is a WORLD rather than a pile of `vi.fn()`s because the assertion this harness exists for is
 * "what state was left behind" — which is a question about the stores as a whole, not about
 * whether a particular spy was called. `calls` is kept alongside because ORDER is the other half:
 * a rollback is only correct if it unwinds in reverse.
 */
export interface ChangeTitleWorld {
  managerId: string | null
  teams: FakeTeam[]
  /** Agent ids `blockAllTeams()` reports it hibernated. Seeded by the test. */
  hibernatable: string[]
  /**
   * Agent ids currently LIVE. `blockAllTeams` removes the hibernatable ones and `wakeAgent` puts
   * them back, so "the fleet is asleep" and "the fleet was woken again" are observations rather
   * than inferences from a spy count.
   *
   * Without this, `blockAllTeams` would report ids it never took down and G10's undo would "wake"
   * an agent that was never asleep — the assertion would pass over a pair of no-ops.
   */
  awake: string[]
  /** Every mocked mutation, in call order — `['removeManager', 'blockAllTeams', …]`. */
  calls: string[]
  /** Tokens each revocation reports. Non-zero proves the gate actually ran. */
  aidTokens: number
  portfolioTokens: number
  /**
   * Failure injection: `{ updateTeam: 2 }` throws on the SECOND `updateTeam` call.
   * This is how a mid-pipeline failure is forced at a chosen gate.
   */
  failOn: Record<string, number>
  /**
   * Side-effect injection: `{ revokeTokensFromIssuer: fn }` runs `fn` AFTER that call succeeds.
   *
   * `failOn` forces a gate to FAIL; this makes a gate SUCCEED and then perturbs the world behind
   * the pipeline's back — which is the only way to reach a POST-CONDITION gate. G22 verifies the
   * title landed, so it can only be driven by letting the write succeed and corrupting the stores
   * afterwards; every fixture that fails earlier never reaches it, and its assertions then pass
   * for the wrong reason.
   *
   * It fires only on success (a `failOn` throw happens first), so "the hook ran" also proves the
   * call it is anchored to ran — which is what makes the injection point an observation rather
   * than an assumption.
   */
  after: Record<string, () => void>
}

export function newWorld(over: Partial<ChangeTitleWorld> = {}): ChangeTitleWorld {
  return {
    managerId: null,
    teams: [],
    hibernatable: [],
    awake: [],
    calls: [],
    aidTokens: 0,
    portfolioTokens: 0,
    failOn: {},
    after: {},
    ...over,
  }
}

/**
 * Record the call and throw when this is the nth one the test armed.
 *
 * Counting from `calls` rather than a separate tally is deliberate: the call log IS the counter, so
 * a mutation can never be recorded without being counted or counted without being recorded.
 */
function step(world: ChangeTitleWorld, name: string): void {
  world.calls.push(name)
  const nth = world.calls.filter(c => c === name).length
  if (world.failOn[name] === nth) {
    throw new Error(`[drive-change-title] injected failure: ${name} call #${nth}`)
  }
  // AFTER the failOn check, so an injected side effect never runs on a call that threw.
  world.after?.[name]?.()
}

/** `@/lib/governance` — ACTIVE, unlike the DeleteAgent harness's inert stub, because G10/G13 are
 *  the gates under test and an `isManager: () => false` stub skips both. */
export function governanceMock(world: ChangeTitleWorld) {
  return {
    isManager: (id: string) => world.managerId === id,
    getManagerId: () => world.managerId,
    isChiefOfStaffAnywhere: (id: string) => world.teams.some(t => t.chiefOfStaffId === id),
    removeManager: async () => { step(world, 'removeManager'); world.managerId = null },
    setManager: async (id: string) => { step(world, 'setManager'); world.managerId = id },
    loadGovernance: () => ({ managerId: world.managerId, chiefsOfStaff: {} }),
    saveGovernance: () => undefined,
  }
}

/** `@/lib/team-registry` — the store G10/G11/G12/G13b mutate. `blockAllTeams` returns the
 *  hibernated ids because ChangeTitle reads `.length`, and because that return value IS the
 *  snapshot a future compensation needs in order to wake them again (R51.4). */
export function teamRegistryMock(world: ChangeTitleWorld) {
  return {
    loadTeams: () => world.teams,
    getTeam: (id: string) => world.teams.find(t => t.id === id),
    getTeamsForAgent: (id: string) => world.teams.filter(t => t.agentIds.includes(id)),
    isAgentInAnyTeam: (id: string) => world.teams.some(t => t.agentIds.includes(id)),
    saveTeams: () => undefined,
    updateTeam: async (id: string, patch: Partial<FakeTeam>) => {
      step(world, 'updateTeam')
      const team = world.teams.find(t => t.id === id)
      if (team) Object.assign(team, patch)
      return team
    },
    blockAllTeams: async () => {
      step(world, 'blockAllTeams')
      for (const t of world.teams) t.blocked = true
      // Actually take them down. The real one hibernates every team agent, and a double that only
      // REPORTS ids it did not touch makes G10's compensating re-wake unobservable: `awake` would
      // already contain them, so "the fleet was woken again" would pass with the wake deleted.
      world.awake = world.awake.filter(id => !world.hibernatable.includes(id))
      return [...world.hibernatable]
    },
    unblockAllTeams: async () => {
      step(world, 'unblockAllTeams')
      for (const t of world.teams) t.blocked = false
      return world.teams.length
    },
    deleteTeam: async () => undefined,
    addTeam: async () => undefined,
  }
}

/** The two token stores G14b/G14e revoke. Both report a non-zero count so the gate is provably
 *  reached — a stub returning 0 makes "did it revoke?" and "was it skipped?" the same observation.
 *
 *  EVERY variant records its OWN name. The compensable forms used to be silent stubs — present so
 *  a destructure would not throw, absent from the ledger — which made them decorative: when
 *  ChangeTitle switched to them for R51, the parity assertions saw no revocation at all and the
 *  `after` hook keyed on the count-only name never fired, so three post-condition tests passed for
 *  the wrong reason. Recording the SPECIFIC name (not a shared operation label) is also what lets a
 *  test pin WHICH form the pipeline calls: reverting to the count-only wrapper reds a named test.
 *
 *  THE COUNTERS ARE STATE, NOT A RETURN VALUE — the same trap one level down. `restore()` used to
 *  be `async () => world.aidTokens`: it handed back a number and MUTATED NOTHING, so the world was
 *  identical whether the undo ran or not and no assertion about restoration could ever be
 *  non-vacuous. Revoking now DRAINS the counter and `restore()` puts the exact drained count back,
 *  which is what makes "the demoted manager's tokens came back" an observation. */
export function aidTokenMock(world: ChangeTitleWorld) {
  return {
    revokeTokensForAgent: async () => {
      step(world, 'revokeTokensForAgent')
      const taken = world.aidTokens
      world.aidTokens = 0
      return taken
    },
    revokeTokensForAgentCompensable: async () => {
      step(world, 'revokeTokensForAgentCompensable')
      const taken = world.aidTokens
      world.aidTokens = 0
      return { count: taken, restore: async () => { world.aidTokens = taken; return taken } }
    },
    countTokensForAgent: () => world.aidTokens,
  }
}

export function portfolioStoreMock(world: ChangeTitleWorld) {
  return {
    revokeTokensFromIssuer: async () => {
      step(world, 'revokeTokensFromIssuer')
      const taken = world.portfolioTokens
      world.portfolioTokens = 0
      return taken
    },
    revokeTokensFromIssuerCompensable: async () => {
      step(world, 'revokeTokensFromIssuerCompensable')
      const taken = world.portfolioTokens
      world.portfolioTokens = 0
      return { count: taken, restore: async () => { world.portfolioTokens = taken; return taken } }
    },
  }
}

/** The inert collaborators — reached, but with nothing worth observing for THIS window. */
export const stubs = {
  governanceRequests: () => ({
    loadGovernanceRequests: () => ({ requests: [] }),
    rejectGovernanceRequest: async () => undefined,
    approveGovernanceRequest: async () => undefined,
    createGovernanceRequest: async () => undefined,
    saveGovernanceRequests: () => undefined,
  }),
  governanceSync: () => ({ broadcastGovernanceSync: async () => undefined }),
  sharedState: () => ({ broadcastGovernanceUpdate: () => undefined }),
  ledgerEmit: () => ({ emitAgentOp: async () => undefined }),
  portfolioLedger: () => ({ emitPortfolioOp: async () => undefined }),
  /**
   * `checkIbctScope` returns `string | null` — an ERROR STRING, or null when authorized. It is NOT
   * an `{allowed}` verdict, and getting that backwards is silent: G0b does
   * `if (scopeErr) { result.error = scopeErr; return result }`, so a truthy `{allowed: true}`
   * became the error and every ChangeTitle died at gate 0b with a *successful* verdict as its
   * failure reason. Caught only because the first caller asserted `result.error`, not `success`.
   */
  ibctScopeCheck: () => ({ checkIbctScope: (): string | null => null }),
}

/**
 * `@/services/agents-core-service` — BOTH halves, because two compensations read the second one.
 *
 * `hibernateAgent` is G17's last resort; `wakeAgent` is what G10's and G17's undos call to put the
 * fleet back. A stub carrying only `hibernateAgent` is the DECORATIVE-STUB trap one level up: the
 * destructure `const { wakeAgent } = await import(...)` throws on a mocked module that does not
 * export it, the undo catches that as a "problem", and the rollback reports R51.5 CRITICAL — a
 * harness defect that reads exactly like a production one.
 *
 * `wakeAgent` returns the `{ data: { woken } }` shape ChangeTitle checks, and mutates `awake` so
 * the restoration is a state change rather than a spy call.
 */
export function agentsCoreMock(world: ChangeTitleWorld) {
  return {
    hibernateAgent: async (id: string) => {
      step(world, 'hibernateAgent')
      world.awake = world.awake.filter(a => a !== id)
      return { data: { success: true } }
    },
    wakeAgent: async (id: string) => {
      step(world, 'wakeAgent')
      if (!world.awake.includes(id)) world.awake.push(id)
      return { data: { woken: true } }
    },
  }
}

/**
 * `@/lib/agent-runtime` — G10's undo asks which sessions are ALREADY live before waking anything,
 * so it never re-wakes an agent a human restarted in the meantime. Unmocked, that call shells out
 * to tmux: slow, machine-dependent, and its failure is swallowed (correctly — an unreadable runtime
 * is not proof an agent is awake), which would silently turn the skip-check into a no-op.
 */
export function agentRuntimeMock(world: ChangeTitleWorld) {
  return {
    getRuntime: () => ({
      listSessions: async () => world.awake.map(name => ({ name })),
    }),
  }
}

/**
 * Install a `claude` shim on PATH and return the restore function.
 *
 * G16's `installPluginLocally` SPAWNS `claude plugin install`. Without this the child either fails
 * (noisy, and the pipeline then takes its G17 repair path for the wrong reason) or — far worse on a
 * developer machine — reaches the REAL CLI and mutates the real
 * `~/.claude/plugins/installed_plugins.json`, which no in-process mock can prevent.
 *
 * IT IS NOT A NO-OP, AND THAT IS THE WHOLE POINT. Since TRDD-0GCIMQ9F the CLI is the ONLY writer
 * of `<agentDir>/.claude/settings.local.json` — `installPluginLocally` no longer hand-writes the
 * `enabledPlugins` key afterwards. G17 then READS that file back to enforce R9.13. So a shim that
 * merely exits 0 makes every install look successful to G16 and leave zero trace for G17, which
 * dutifully "recovers" a healthy agent into `roleMissing: true` + hibernated. The double must model
 * the ONE side effect the code reads back, or the test exercises the repair path on every run and
 * calls it the happy path.
 *
 * It also appends its argv to `<dir>/claude-calls.log`, so "did G16 actually shell out?" is an
 * observation rather than an inference.
 */
export function installClaudeShim(dir: string): () => void {
  mkdirSync(dir, { recursive: true })
  const shim = join(dir, 'claude')
  // `cwd` is the agent's working directory (installPluginLocally passes it), so the settings file
  // is resolved relative to it exactly as the real CLI resolves a --scope local install.
  writeFileSync(shim, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(join(dir, 'claude-calls.log'))}
[ "$1" = "plugin" ] || exit 0
case "$2" in install|uninstall) ;; *) exit 0 ;; esac
# A NOMINATED INSTALL CAN BE MADE TO FAIL. G17's R9.13 quarantine — the only branch that sets
# roleMissing and hibernates — is reachable ONLY when the install leaves zero role-plugins active,
# so without this the gate's undo is unreachable and untestable. Uninstall is deliberately never
# failed: a rollback has to be able to put the old plugin back.
if [ "$2" = "install" ] && [ -n "$AIM_SHIM_FAIL_INSTALL" ] && [ "$3" = "$AIM_SHIM_FAIL_INSTALL" ]; then
  echo "shim: refusing to install $3" >&2
  exit 1
fi
exec python3 - "$2" "$3" "$4" <<'PY'
import json, os, sys
verb, name, marketplace = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(os.getcwd(), '.claude', 'settings.local.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path) as fh:
        data = json.load(fh)
except Exception:
    data = {}
enabled = data.setdefault('enabledPlugins', {})
key = '%s@%s' % (name, marketplace)
if verb == 'install':
    enabled[key] = True
else:
    enabled.pop(key, None)
with open(path, 'w') as fh:
    json.dump(data, fh, indent=2)
PY
`, 'utf-8')
  chmodSync(shim, 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous ?? ''}`
  return () => { process.env.PATH = previous }
}

/**
 * Call the real pipeline as the system owner (`isSystemOwner` short-circuits the auth gate — the
 * same seam every internal caller uses). Imported dynamically so the mocks are all in place first.
 */
export async function driveChangeTitle(
  agentId: string,
  newTitle: string | null,
  /** Extra ChangeTitle options — `githubRepo` is what makes the MAINTAINER path (G9a) reachable. */
  extra: Record<string, unknown> = {},
) {
  const { ChangeTitle } = await import('@/services/element-management-service')
  return ChangeTitle(agentId, newTitle, { authContext: { isSystemOwner: true }, ...extra })
}
