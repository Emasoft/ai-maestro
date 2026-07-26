/**
 * R50 ratchet — one operation, one all-in-one function.
 *
 * "THERE MUST BE ONLY ONE FUNCTION FOR EACH OPERATION, AND THAT FUNCTION MUST BE AN ALL-IN-ONE."
 * (USER, 2026-07-25.)
 *
 * The store primitives in lib/agent-registry.ts are implementation details of the pipeline that
 * owns them. A service calling one directly performs the operation while skipping every gate —
 * no cemetery archive, no team-slot clearing, no credential revocation, no session unpersist, no
 * post-condition. That is not a hypothetical: the PersistedSession row that outlived every deleted
 * agent and kept resurrecting its workdir survived because one store had no owner in the pipeline.
 *
 * This test does NOT demand zero bypasses today — 11 exist, and converging them is real work
 * (TRDD-YB4T4RTL). It is a RATCHET: the known set is pinned, so the list can only SHRINK. A new
 * bypass fails the build with the exact file and symbol, at the moment it is introduced, which is
 * the only time it is cheap to avoid.
 *
 * Removing an entry here when you converge a call site is the intended edit. ADDING one is not:
 * if you believe a new bypass is justified, it needs an R50 exception in docs/GOVERNANCE-RULES.md
 * first, because the next reader will otherwise copy it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { globSync } from 'glob'

/**
 * The guarded stores.
 *
 * This started as ONE store (agent-registry) and five primitives — which meant the ratchet watched
 * a single door while teams, groups, persisted sessions, tasks and governance tokens had none.
 * R50 is not scoped to agents: it says one function per SENSITIVE MUTATION, and every store below
 * holds state whose partial mutation leaves the system invalid in exactly the same way (the
 * PersistedSession row that outlived every deleted agent is the worked example — it lived in a
 * store nothing was watching).
 *
 * `owners` is deliberately MINIMAL: the module that DEFINES the primitive, plus the all-in-one
 * pipeline that owns the operation. Everything else is a bypass and gets pinned. A service is not
 * added to `owners` because it currently calls the primitive — that would bless the bypass and
 * silently redefine the rule to match the code. Convergence removes pins; it does not add owners.
 */
interface StoreGuard {
  /** Short label used in the failure message. */
  store: string
  /** Exported mutators only the owner may call. Read-only accessors are NOT listed. */
  primitives: string[]
  /** Defining module + owning all-in-one. Minimal by construction — see above. */
  owners: string[]
}

const AIO = 'services/element-management-service.ts'

const GUARDS: StoreGuard[] = [
  {
    store: 'agent-registry',
    primitives: ['createAgent', 'deleteAgentBySession', 'renameAgent', 'renameAgentSession', 'saveAgents'],
    owners: [AIO, 'lib/agent-registry.ts'],
  },
  {
    store: 'team-registry',
    primitives: ['createTeam', 'deleteTeam', 'saveTeams', 'updateTeam'],
    owners: [AIO, 'lib/team-registry.ts'],
  },
  {
    store: 'group-registry',
    primitives: ['createGroup', 'deleteGroup', 'saveGroups', 'updateGroup', 'addSubscriber', 'removeSubscriber'],
    owners: [AIO, 'lib/group-registry.ts'],
  },
  {
    store: 'session-persistence',
    // The store whose unwatched write survived every DeleteAgent and resurrected agent workdirs
    // until G05b was added. It is listed first among the lessons, not last.
    primitives: ['persistSession', 'unpersistSession', 'savePersistedSessions', 'clearPersistedSessions'],
    owners: [AIO, 'lib/session-persistence.ts'],
  },
  {
    store: 'task-registry',
    primitives: ['createTask', 'deleteTask', 'saveTasks', 'updateTask'],
    owners: [AIO, 'lib/task-registry.ts'],
  },
  {
    store: 'aid-token',
    primitives: ['issueGovernanceToken', 'issueUserGovernanceToken', 'revokeTokensForAgent'],
    owners: [AIO, 'lib/aid-token.ts'],
  },
]

/**
 * KNOWN non-AIO mutation sites as of 2026-07-26. Convergence: TRDD-YB4T4RTL. May only SHRINK.
 *
 * TWO CATEGORIES live in this list, and they need different fixes — so do not treat a long list as
 * one backlog:
 *
 *   (a) SECOND PATH — an operation that HAS an all-in-one, performed outside it. Every
 *       agent-registry entry is this: `CreateAgent`/`DeleteAgent`/`ChangeName` exist, and these
 *       call sites go around them. Fix = route the call through the pipeline; the pin then goes.
 *
 *   (b) UNGATED SOLE PATH — the only way the operation is performed, but the performer is not an
 *       all-in-one. `groups-service`, `teams-service` and the task/team API routes are this. R50
 *       is violated differently here: not "two paths" but "the one path is not a pipeline". Fix =
 *       build the AIO (ChangeGroup / ChangeTeam / ChangeTask), then move the call into it.
 *
 * Naming them apart matters because (b) reads as harmless — "it's the owner, of course it writes"
 * — right up until a second caller appears and turns it into (a) with no gate anywhere in between.
 *
 * WHY THE LIST GREW 11 → 37: the guard watched ONE store (agent-registry). Teams, groups,
 * persisted sessions, tasks and governance tokens had no guard at all, so 26 sensitive-mutation
 * sites were invisible — including `session-persistence`, whose unwatched write outlived every
 * DeleteAgent and kept resurrecting agent workdirs until G05b. That bug is the argument for this
 * list's existence, and it lived for months in a store nothing was scanning.
 */
const KNOWN_BYPASSES = [
  // ── (a) second path — an all-in-one exists and these go around it ──
  'services/agents-core-service.ts::createAgent',
  'services/agents-docker-service.ts::createAgent',
  'services/agents-docker-service.ts::saveAgents',
  'services/agents-repos-service.ts::saveAgents',
  'services/agents-transfer-service.ts::saveAgents',
  'services/amp-service.ts::createAgent',
  'services/creation-helper-service.ts::createAgent',
  'services/help-service.ts::createAgent',
  'services/sessions-service.ts::createAgent',
  'services/sessions-service.ts::deleteAgentBySession',
  'services/sessions-service.ts::renameAgentSession',

  // ── (b) ungated sole path — team-registry. Three of these are API ROUTES writing the store
  //        directly, which is the shape R50.2/R50.3 exist to forbid: the button's endpoint IS
  //        supposed to be the pipeline, not a hand-rolled write next to it.
  'app/api/governance/transfers/[id]/resolve/route.ts::saveTeams',
  'app/api/teams/[id]/chief-of-staff/route.ts::updateTeam',
  'app/api/teams/create-with-project/route.ts::updateTeam',
  'services/cross-host-governance-service.ts::saveTeams',
  'services/governance-service.ts::saveTeams',
  'services/headless-router.ts::updateTeam',
  'services/teams-service.ts::createTeam',
  'services/teams-service.ts::deleteTeam',
  'services/teams-service.ts::updateTeam',

  // ── (b) ungated sole path — group-registry. No ChangeGroup pipeline exists yet.
  'services/groups-service.ts::addSubscriber',
  'services/groups-service.ts::createGroup',
  'services/groups-service.ts::deleteGroup',
  'services/groups-service.ts::removeSubscriber',
  'services/groups-service.ts::updateGroup',

  // ── (b) session-persistence. DeleteAgent's G05b is the ONE gated writer; these are not.
  'services/agents-core-service.ts::persistSession',
  'services/agents-core-service.ts::unpersistSession',
  'services/session-reconcile-service.ts::savePersistedSessions',
  'services/sessions-service.ts::persistSession',
  'services/sessions-service.ts::unpersistSession',

  // ── (b) task-registry. github-project.ts mirrors the board; teams-service owns the writes.
  'lib/github-project.ts::createTask',
  'lib/github-project.ts::deleteTask',
  'lib/github-project.ts::updateTask',
  'services/teams-service.ts::createTask',
  'services/teams-service.ts::deleteTask',
  'services/teams-service.ts::updateTask',

  // ── (b) aid-token. A route MINTING a governance token outside any pipeline — the highest-value
  //        single row here, because the thing it hands out is authority.
  'app/api/v1/auth/token/route.ts::issueGovernanceToken',
]

function scanBypasses(): string[] {
  const root = join(__dirname, '..', '..')
  const files = [
    ...globSync('services/**/*.ts', { cwd: root }),
    ...globSync('app/api/**/*.ts', { cwd: root }),
    ...globSync('lib/**/*.ts', { cwd: root }),
  ]
  const found = new Set<string>()
  for (const rel of files) {
    if (rel.endsWith('.externbak')) continue
    const src = readFileSync(join(root, rel), 'utf8')
    // Drop comment lines so a symbol NAMED in prose is not counted as a call site.
    const code = src
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
      })
      .join('\n')
    for (const guard of GUARDS) {
      // Ownership is PER STORE: element-management owns every pipeline, but lib/team-registry.ts
      // is an owner only of its own primitives — otherwise one store's defining module would be
      // licensed to reach into another's, which is the same bypass wearing a different name.
      if (guard.owners.includes(rel)) continue
      for (const sym of guard.primitives) {
        if (new RegExp(`(?<![A-Za-z0-9_])${sym}\\s*\\(`).test(code)) found.add(`${rel}::${sym}`)
      }
    }
  }
  return [...found].sort()
}

describe('R50 — one operation, one all-in-one function', () => {
  it('introduces NO new store-primitive bypass', () => {
    const actual = scanBypasses()
    const added = actual.filter((x) => !KNOWN_BYPASSES.includes(x))
    // A new bypass is a new way to leave the system invalid. Route the operation through its
    // all-in-one (CreateAgent / DeleteAgent / ChangeName / …) instead of touching the store.
    expect(added).toEqual([])
  })

  it('the known-bypass list may only shrink — remove entries as you converge them', () => {
    const actual = scanBypasses()
    const stale = KNOWN_BYPASSES.filter((x) => !actual.includes(x))
    // Not a failure to celebrate silently: a converged call site must be deleted from the pin, or
    // the ratchet quietly loosens by one notch and the next bypass slips in unnoticed.
    expect(stale, `converged — delete these from KNOWN_BYPASSES: ${stale.join(', ')}`).toEqual([])
  })

  it('pins the current count so convergence progress is visible', () => {
    expect(scanBypasses().length).toBe(KNOWN_BYPASSES.length)
  })
})
