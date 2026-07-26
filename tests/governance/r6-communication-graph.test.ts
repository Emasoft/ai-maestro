/**
 * Governance drift tests — R6 (title-based communication graph).
 *
 * Pins the 13 R6 sub-rules that docs/GOVERNANCE-ENFORCEMENT-MAP.md marks
 * ENFORCED-with-a-real-guard but which no test had ever watched refuse
 * anything: R6.1, R6.2, R6.3, R6.4, R6.5, R6.5a, R6.5b, R6.6, R6.7, R6.8,
 * R6.9, R6.10, R6.13.
 *
 * ACCEPTANCE CRITERION for every test here: delete the guard → the test
 * fails. Tests are written against the REAL exported guard, never a
 * re-implementation, and they assert the REFUSAL (verdict + reason +
 * routing suggestion + HTTP shape), not merely that a happy path works.
 *
 * Mocking policy in this file:
 *   - Sections 1 and 2 (the pure graph) mock NOTHING. `lib/communication-graph.ts`
 *     imports only types, so the guard is exercised exactly as production runs it.
 *   - Section 3 (AMP wiring) mocks ENVIRONMENT only: $HOME-derived state paths,
 *     the API-key store, the Ed25519 key FILE (the crypto itself stays real and
 *     every message is genuinely signed), host config, inbox delivery, relay
 *     queue. `lib/agent-registry.ts` is NOT mocked — it reads a real registry.json
 *     written into a temp state dir, which is also what Section 4 exercises.
 *   - ONE non-environment mock, declared loudly: `@/lib/message-filter`'s
 *     checkMessageAllowed (AMP "layer 2", a DIFFERENT guard that runs AFTER the
 *     R6 graph check at amp-service.ts:1305). It is forced to allow so the
 *     positive control proves the GRAPH let the message through. Every negative
 *     assertion additionally pins the graph-specific error code
 *     `title_communication_forbidden`, which layer 2 never emits (it emits
 *     `message_blocked`), so the negatives do not depend on that mock at all.
 *
 * MAP CITATION CORRECTIONS discovered while writing this file (reported, not
 * edited into the map — the orchestrator folds them in):
 *   - R6.9  :: map says services/amp-service.ts:797-802 → that range is the
 *     GENERIC `if (!auth.authenticated)` 401 gate, not a subagent guard. The
 *     direct R6.9 guard is lib/communication-graph.ts:322-327 (`options.isSubagent`).
 *     Both are pinned below; see the report.
 *   - R6.13 :: map says lib/agent-registry.ts:316-325 → 316-323 is the
 *     hostId-SCOPED branch; the default-host resolution R6.13 actually describes
 *     is lines 325-331. Correct range for the whole guard: 312-332.
 *   - R6.8 :: layers 2 and 3 of "three layers of enforcement" (role-plugin .md
 *     recipient lists; sub-agents forbidden from AMP) are PROMPT-level, live in
 *     other repos, and have no server surface. Only layer 1 is pinned here.
 *   - UNMAPPED second enforcement site: services/amp-service.ts:1112-1124 — a
 *     remote-delivery pre-check that 403s `title_communication_forbidden` when
 *     getAllowedRecipients(senderTitle) is empty. Pinned in Section 2.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import crypto from 'crypto'

import {
  ALL_NODES,
  ALL_ROLES,
  getEdgeType,
  canSendMessage,
  getAllowedRecipients,
  isValidRole,
  isValidNode,
  validateMessageRoute,
  type GraphNode,
  type EdgeType,
} from '@/lib/communication-graph'
import { VALID_GOVERNANCE_TITLES, type AgentRole } from '@/types/agent'

// services/amp-service.ts pulls in a large transitive graph (registry, ledger,
// crypto, delivery). The FIRST dynamic import pays the whole transform cost,
// which can exceed vitest's 5s default on a cold vite cache. The beforeAll
// below pays it ONCE in a hook so no individual test carries it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// ============================================================================
// Hoisted temp state dir + fixture registry (0-IMPACT).
//
// lib/agent-registry.ts evaluates `const AIMAESTRO_DIR = getStateDir()` at
// MODULE level, so the ecosystem-constants override must be installed before
// that module is first imported. vi.hoisted() runs before vi.mock() factories
// AND before this file's static imports.
// ============================================================================
const FIXTURE = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const root = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r6-graph-state-'))
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r6-graph-home-'))
  fsSync.mkdirSync(pathSync.join(root, 'agents'), { recursive: true })

  const SELF_HOST = 'host-alpha'
  const PEER_HOST = 'host-beta'

  const mk = (id: string, name: string, hostId: string, title: string | null, extra: any = {}) => ({
    id,
    name,
    label: name,
    hostId,
    governanceTitle: title,
    role: title,
    status: 'active',
    sessions: [],
    workingDirectory: pathSync.join(home, 'agents', name),
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: { amp: { address: `${name}@default.local` } },
    ...extra,
  })

  // Registry serves BOTH the AMP wiring tests (section 3) and the default-host
  // resolution tests (section 4).
  const agents = [
    // Senders / recipients for the AMP wiring tests, all on the self host.
    mk('id-mgr', 'mgr', SELF_HOST, 'manager'),
    mk('id-cos', 'cos', SELF_HOST, 'chief-of-staff'),
    mk('id-mem', 'mem', SELF_HOST, 'member'),
    mk('id-orch', 'orch', SELF_HOST, 'orchestrator'),
    // R6.13 fixture: SAME name on two hosts.
    mk('id-peer-alpha', 'peer', SELF_HOST, 'member'),
    mk('id-peer-beta', 'peer', PEER_HOST, 'member'),
    // R6.13 fixture: exists ONLY on the peer host.
    mk('id-only-beta', 'onlybeta', PEER_HOST, 'member'),
    // R6.13 fixture: soft-deleted on the self host.
    mk('id-tombstone', 'tombstone', SELF_HOST, 'member', { deletedAt: '2026-02-02T00:00:00.000Z' }),
  ]
  fsSync.writeFileSync(
    pathSync.join(root, 'agents', 'registry.json'),
    JSON.stringify(agents, null, 2),
    'utf-8',
  )

  return { root, home, SELF_HOST, PEER_HOST }
})

// A real Ed25519 keypair. The KEY FILE is mocked away (environment); the
// signing and verification are genuinely performed by node:crypto, so
// amp-service's mandatory-signature policy is satisfied honestly rather than
// by stubbing out a security check.
const KEYS = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c = require('crypto')
  const { privateKey, publicKey } = c.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const der = c.createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
  return {
    privatePem: privateKey as string,
    publicPem: publicKey as string,
    publicHex: (der as Buffer).subarray(12).toString('hex'),
  }
})

// ---------------------------------------------------------------------------
// 0-IMPACT. lib/ecosystem-constants.ts resolves homedir() through a runtime
// require('os') INSIDE function bodies, which vi.mock('os', ...) does not
// intercept. Overriding the PATH FUNCTIONS closes the gap regardless of how
// homedir() is reached internally. Everything else stays real via ...actual.
// ---------------------------------------------------------------------------
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const p = await import('path')
  const agentsBase = p.join(FIXTURE.home, 'agents')
  return {
    ...actual,
    getStateDir: () => FIXTURE.root,
    statePath: (...segments: string[]) => p.join(FIXTURE.root, ...segments),
    getCustomPluginsContainerPath: () => p.join(agentsBase, 'custom-plugins'),
    getRolePluginsContainerPath: () => p.join(agentsBase, 'role-plugins'),
    getCorePluginsContainerPath: () => p.join(agentsBase, 'core-plugins'),
    getLocalMarketplacePath: () => p.join(agentsBase, 'role-plugins'),
    getCustomMarketplacePath: () => p.join(agentsBase, 'custom-plugins'),
  }
})

// ---------------------------------------------------------------------------
// Environment mocks. NONE of these modules contains a guard pinned in this file.
// ---------------------------------------------------------------------------
const {
  mockAuthResult,
  mockDeliverCalls,
  mockQueueCalls,
  mockFilterAllowed,
} = vi.hoisted((): any => ({
  mockAuthResult: { current: null as any },
  mockDeliverCalls: [] as any[],
  mockQueueCalls: [] as any[],
  mockFilterAllowed: { current: true },
}))

// Host config — two flavors of the same data. lib/agent-registry.ts imports
// from '@/lib/hosts-config'; services/amp-service.ts imports from the .mjs
// server variant. Both are pure environment.
vi.mock('@/lib/hosts-config', async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({}))
  return {
    ...actual,
    getSelfHostId: () => FIXTURE.SELF_HOST,
    getSelfHost: () => ({ id: FIXTURE.SELF_HOST, name: FIXTURE.SELF_HOST, url: 'http://127.0.0.1:23000' }),
    getPeerHosts: () => [],
    getHostById: (id: string) =>
      id === FIXTURE.SELF_HOST ? { id, name: id, url: 'http://127.0.0.1:23000' } : null,
    isSelf: (id: string) => id === FIXTURE.SELF_HOST,
    getOrganization: () => 'default',
  }
})

vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: () => FIXTURE.SELF_HOST,
  getSelfHost: () => ({ id: FIXTURE.SELF_HOST, name: FIXTURE.SELF_HOST, url: 'http://127.0.0.1:23000' }),
  getHostById: (id: string) =>
    id === FIXTURE.SELF_HOST ? { id, name: id, url: 'http://127.0.0.1:23000' } : null,
  isSelf: (id: string) => id === FIXTURE.SELF_HOST,
  getOrganization: () => 'default',
  getHosts: () => [{ id: FIXTURE.SELF_HOST, name: FIXTURE.SELF_HOST, url: 'http://127.0.0.1:23000' }],
}))

// API-key store (fs) — the ONLY thing overridden. Everything else in amp-auth,
// including the guarantor logic, stays real.
vi.mock('@/lib/amp-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/amp-auth')>()
  return {
    ...actual,
    authenticateRequest: (authHeader: string | null) => {
      if (!authHeader) {
        return { authenticated: false, error: 'unauthorized', message: 'Missing or invalid Authorization header' }
      }
      return mockAuthResult.current
    },
  }
})

// Ed25519 key FILE only. verifySignature / signMessage stay REAL.
vi.mock('@/lib/amp-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/amp-keys')>()
  return {
    ...actual,
    loadKeyPair: () => ({
      privatePem: KEYS.privatePem,
      publicPem: KEYS.publicPem,
      publicHex: KEYS.publicHex,
      fingerprint: 'SHA256:test',
    }),
    saveKeyPair: () => undefined,
  }
})

// Inbox write + relay queue — pure side effects on disk.
vi.mock('@/lib/message-delivery', () => ({
  deliver: vi.fn(async (opts: any) => { mockDeliverCalls.push(opts) }),
}))
vi.mock('@/lib/amp-relay', () => ({
  queueMessage: vi.fn((...args: any[]) => { mockQueueCalls.push(args) }),
  getPendingMessages: vi.fn(() => []),
  acknowledgeMessage: vi.fn(() => true),
  acknowledgeMessages: vi.fn(() => ({ acknowledged: 0 })),
  cleanupAllExpiredMessages: vi.fn(() => 0),
}))
vi.mock('@/lib/amp-websocket', () => ({ deliverViaWebSocket: vi.fn(() => false) }))
vi.mock('@/lib/amp-inbox-writer', () => ({
  renameInIndex: vi.fn(),
  removeFromIndex: vi.fn(),
}))
// tmux — never touched by the read paths under test, mocked so importing the
// registry can never shell out.
vi.mock('@/lib/agent-runtime', () => ({
  sessionExistsSync: vi.fn(() => false),
  killSessionSync: vi.fn(() => true),
  renameSessionSync: vi.fn(() => true),
}))

// Governance store (fs).
vi.mock('@/lib/governance', async (importOriginal) => {
  const actual = await importOriginal<any>().catch(() => ({}))
  return {
    ...actual,
    isManager: () => false,
    isChiefOfStaffAnywhere: () => false,
    isUserAuthorityModelEnabled: () => false,
  }
})

// AMP "layer 2" — a DIFFERENT guard that runs AFTER the R6 graph check.
// Forced open so the positive control proves the GRAPH allowed delivery.
// Negative assertions pin `title_communication_forbidden`, which this module
// never emits, so they are independent of this mock.
vi.mock('@/lib/message-filter', () => ({
  checkMessageAllowed: vi.fn(() => ({ allowed: mockFilterAllowed.current, reason: 'layer-2 stub' })),
}))

// ============================================================================
// The adjacency matrix from docs/GOVERNANCE-RULES.md §R6 — the AUTHORITY.
// Transcribed by hand from the published table so that the test and the code
// have independent sources. 'Y' = allow, '1' = reply-only, '' = deny.
// ============================================================================
type Cell = 'Y' | '1' | ''
const GOV_NODES = [
  'human', 'manager', 'chief-of-staff', 'orchestrator',
  'architect', 'integrator', 'member', 'maintainer', 'autonomous',
] as const satisfies readonly GraphNode[]

//                        H    M    C    O    A    I    E    T    U
const DOC_MATRIX: Record<(typeof GOV_NODES)[number], readonly Cell[]> = {
  'human':          ['Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'],
  'manager':        ['Y', 'Y', 'Y', '',  '',  '',  '',  'Y', 'Y'],
  'chief-of-staff': ['1', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', '',  '' ],
  'orchestrator':   ['1', '',  'Y', '',  'Y', 'Y', 'Y', '',  '' ],
  'architect':      ['1', '',  'Y', 'Y', '',  '',  '',  '',  '' ],
  'integrator':     ['1', '',  'Y', 'Y', '',  '',  '',  '',  '' ],
  'member':         ['1', '',  'Y', 'Y', '',  '',  '',  '',  '' ],
  'maintainer':     ['Y', 'Y', '',  '',  '',  '',  '',  '',  '' ],
  'autonomous':     ['Y', 'Y', '',  '',  '',  '',  '',  '',  'Y'],
}

const CELL_TO_EDGE: Record<Cell, EdgeType> = { 'Y': 'allow', '1': 'reply-only', '': 'deny' }

/** Titles that sit INSIDE a closed team and are not the gateway (R6.3). */
const IN_TEAM_NON_COS: readonly AgentRole[] = ['orchestrator', 'architect', 'integrator', 'member']
/** Titles that live OUTSIDE any team (R6.3 — must not reach a team role directly). */
const OUT_OF_TEAM: readonly AgentRole[] = ['manager', 'maintainer', 'autonomous']
/** The five titles whose edge to the human user is reply-only (R6.6). */
const REPLY_ONLY_TO_HUMAN: readonly AgentRole[] = [
  'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member',
]
/** The three governance-layer titles that may INITIATE to the human user (R6.6). */
const ALLOW_TO_HUMAN: readonly AgentRole[] = ['manager', 'maintainer', 'autonomous']

// ============================================================================
// SECTION 1 — R6.1: the graph is an EXHAUSTIVE, explicit truth table.
// Guard: lib/communication-graph.ts:94-144 (ALLOW_EDGES + REPLY_ONLY_EDGES).
// ============================================================================
describe('R6.1 — every (sender, recipient) pair is explicitly listed with its edge type', () => {
  it('every AgentRole in the type system is a node in the graph (a title with no row silently denies everything)', () => {
    // getEdgeType uses `ALLOW_EDGES[sender]?.has(...)` — a MISSING row does not
    // throw, it silently resolves to 'deny'. So the only way to detect an
    // unlisted title is to compare the graph's node set against an INDEPENDENT
    // source of truth: the governance-title enum in types/agent.ts.
    for (const title of VALID_GOVERNANCE_TITLES) {
      expect(ALL_NODES, `AgentRole '${title}' has no row in the communication graph`).toContain(title)
      expect(isValidRole(title)).toBe(true)
    }
    expect(ALL_NODES).toContain('human')
    expect(isValidNode('human')).toBe(true)
    expect(isValidRole('human')).toBe(false)
    // ALL_ROLES is ALL_NODES minus the human pseudo-node.
    expect([...ALL_ROLES].sort()).toEqual([...VALID_GOVERNANCE_TITLES].sort())
  })

  it('the full 9x9 edge matrix matches docs/GOVERNANCE-RULES.md §R6 cell for cell', () => {
    const mismatches: string[] = []
    for (const sender of GOV_NODES) {
      DOC_MATRIX[sender].forEach((cell, i) => {
        const recipient = GOV_NODES[i]
        const expected = CELL_TO_EDGE[cell]
        const actual = getEdgeType(sender, recipient)
        if (actual !== expected) {
          mismatches.push(`${sender}->${recipient}: doc says '${expected}', code says '${actual}'`)
        }
      })
    }
    expect(mismatches, `communication graph drifted from the published matrix:\n${mismatches.join('\n')}`).toEqual([])
  })

  it('every ordered pair over ALL_NODES resolves to a defined edge type — no undefined, no throw', () => {
    let pairs = 0
    for (const sender of ALL_NODES) {
      for (const recipient of ALL_NODES) {
        const edge = getEdgeType(sender, recipient)
        expect(['allow', 'deny', 'reply-only'], `${sender}->${recipient}`).toContain(edge)
        pairs++
      }
    }
    // Non-vacuity floor: with 10 nodes (9 governance + assistant) this must be
    // 100 pairs. A shrunken node list would otherwise pass this loop trivially.
    expect(pairs).toBe(ALL_NODES.length * ALL_NODES.length)
    expect(ALL_NODES.length).toBeGreaterThanOrEqual(10)
  })

  it('the matrix is genuinely mixed — it is neither all-allow nor all-deny', () => {
    // Guards against a "refuses everything" or "allows everything" regression
    // that the per-rule tests below could each individually miss.
    const counts: Record<EdgeType, number> = { allow: 0, deny: 0, 'reply-only': 0 }
    for (const s of GOV_NODES) for (const r of GOV_NODES) counts[getEdgeType(s, r)]++
    expect(counts.allow).toBeGreaterThan(0)
    expect(counts.deny).toBeGreaterThan(0)
    expect(counts['reply-only']).toBe(REPLY_ONLY_TO_HUMAN.length)
    expect(counts.allow + counts.deny + counts['reply-only']).toBe(GOV_NODES.length ** 2)
  })

  it('canSendMessage is strictly the allow-edge projection (reply-only is NOT "can send")', () => {
    for (const s of ALL_ROLES) {
      for (const r of ALL_ROLES) {
        expect(canSendMessage(s, r)).toBe(getEdgeType(s, r) === 'allow')
      }
    }
    // reply-only must NOT read as sendable — this is what stops a caller from
    // treating a team agent's H-edge as free initiation.
    expect(getEdgeType('member', 'human')).toBe('reply-only')
    expect(canSendMessage('member', 'human' as AgentRole)).toBe(false)
  })
})

// ============================================================================
// SECTION 2 — the per-title rows (R6.2 … R6.6) and the pure-function guards
// R6.7 (suggestions), R6.9 (subagent), R6.10 (reply-only).
// ============================================================================
describe('R6.2 — MANAGER may not directly contact in-team non-COS agents', () => {
  it.each(IN_TEAM_NON_COS)('manager -> %s is REFUSED and routed through the COS', (target) => {
    const v = validateMessageRoute('manager', target)
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('deny')
    expect(v.reason).toBe(`MANAGER cannot send messages to ${target.toUpperCase()}`)
    expect(v.suggestion).toBe('Route through chief-of-staff (COS is the sole team gateway)')
  })

  it('manager CAN still reach COS, peer MANAGERs, MAINTAINER, AUTONOMOUS and the human user', () => {
    // Non-vacuity control: a guard that refused everything would fail here.
    for (const target of ['chief-of-staff', 'manager', 'maintainer', 'autonomous'] as AgentRole[]) {
      const v = validateMessageRoute('manager', target)
      expect(v.allowed, `manager->${target} should be allowed`).toBe(true)
      expect(v.edgeType).toBe('allow')
    }
    const toHuman = validateMessageRoute('manager', 'human', { recipientIsHuman: true })
    expect(toHuman.allowed).toBe(true)
    expect(toHuman.edgeType).toBe('allow')
  })

  it("manager's allow-set is EXACTLY the five documented recipients", () => {
    expect([...getAllowedRecipients('manager')].sort())
      .toEqual(['autonomous', 'chief-of-staff', 'maintainer', 'manager'])
    // ('human' is filtered out of getAllowedRecipients by design — it returns
    //  AgentRole[] only. The H-edge is asserted separately above.)
    expect(getEdgeType('manager', 'human')).toBe('allow')
  })
})

describe('R6.3 — CHIEF-OF-STAFF is the SOLE inbound and outbound team gateway', () => {
  it('COS can reach MANAGER, COS peers, and all four team roles', () => {
    for (const target of ['manager', 'chief-of-staff', ...IN_TEAM_NON_COS] as AgentRole[]) {
      expect(validateMessageRoute('chief-of-staff', target).allowed, `cos->${target}`).toBe(true)
    }
  })

  it.each(['maintainer', 'autonomous'] as AgentRole[])(
    'COS cannot initiate to %s — it is a team gateway, not a cross-layer one',
    (target) => {
      const v = validateMessageRoute('chief-of-staff', target)
      expect(v.allowed).toBe(false)
      expect(v.edgeType).toBe('deny')
      expect(v.suggestion).toBe(target === 'maintainer' ? 'Route through manager' : 'Route through manager')
    },
  )

  it('COS cannot initiate to the human user — the H-edge is reply-only', () => {
    expect(getEdgeType('chief-of-staff', 'human')).toBe('reply-only')
    const v = validateMessageRoute('chief-of-staff', 'human', { recipientIsHuman: true })
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('reply-only')
  })

  it('INBOUND: no out-of-team title other than COS can reach any team role', () => {
    // This is the "SOLE inbound gateway" property, asserted exhaustively.
    for (const sender of OUT_OF_TEAM) {
      for (const target of IN_TEAM_NON_COS) {
        const v = validateMessageRoute(sender, target)
        expect(v.allowed, `${sender}->${target} must be denied (COS is the sole inbound gateway)`).toBe(false)
        expect(v.suggestion, `${sender}->${target} must carry a routing suggestion`).toBeTruthy()
      }
      // ...while COS itself reaches every team role.
      for (const target of IN_TEAM_NON_COS) {
        expect(validateMessageRoute('chief-of-staff', target).allowed).toBe(true)
      }
    }
  })

  it('OUTBOUND: no team role can reach any out-of-team title directly, and every one of them can reach COS', () => {
    // The "SOLE outbound gateway" property.
    for (const sender of IN_TEAM_NON_COS) {
      const allowed = getAllowedRecipients(sender)
      for (const outsider of OUT_OF_TEAM) {
        expect(allowed, `${sender} must not reach ${outsider} directly`).not.toContain(outsider)
      }
      expect(allowed, `${sender} must be able to reach its COS`).toContain('chief-of-staff')
    }
  })
})

describe('R6.4 — ORCHESTRATOR row', () => {
  it('may message COS, ARCHITECT, INTEGRATOR, MEMBER', () => {
    for (const target of ['chief-of-staff', 'architect', 'integrator', 'member'] as AgentRole[]) {
      expect(validateMessageRoute('orchestrator', target).allowed, `orch->${target}`).toBe(true)
    }
    expect([...getAllowedRecipients('orchestrator')].sort())
      .toEqual(['architect', 'chief-of-staff', 'integrator', 'member'])
  })

  it('cannot initiate to MANAGER — must go through the COS', () => {
    const v = validateMessageRoute('orchestrator', 'manager')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('ORCHESTRATOR cannot send messages to MANAGER')
    expect(v.suggestion).toBe('Route through chief-of-staff')
  })

  it.each(['maintainer', 'autonomous'] as AgentRole[])('cannot initiate to %s', (target) => {
    const v = validateMessageRoute('orchestrator', target)
    expect(v.allowed).toBe(false)
    expect(v.suggestion).toBe('Route through manager')
  })

  it('cannot reach a peer ORCHESTRATOR (cross-team coordination goes through COS)', () => {
    const v = validateMessageRoute('orchestrator', 'orchestrator')
    expect(v.allowed).toBe(false)
    expect(v.suggestion).toBe('Route through chief-of-staff for cross-team coordination')
  })

  it('cannot initiate to the human user — the H-edge is reply-only', () => {
    expect(getEdgeType('orchestrator', 'human')).toBe('reply-only')
    expect(validateMessageRoute('orchestrator', 'human', { recipientIsHuman: true }).allowed).toBe(false)
  })
})

describe('R6.5 — ARCHITECT / INTEGRATOR / MEMBER may only freely message COS and ORCHESTRATOR', () => {
  const WORKERS: readonly AgentRole[] = ['architect', 'integrator', 'member']

  it.each(WORKERS)('%s allow-set is EXACTLY [chief-of-staff, orchestrator]', (worker) => {
    expect([...getAllowedRecipients(worker)].sort()).toEqual(['chief-of-staff', 'orchestrator'])
  })

  it.each(WORKERS)('%s is refused for every other title, each with a routing suggestion', (worker) => {
    const forbidden = ALL_ROLES.filter(
      r => r !== 'chief-of-staff' && r !== 'orchestrator' && r !== 'assistant',
    )
    expect(forbidden.length).toBeGreaterThanOrEqual(6) // non-vacuity floor
    for (const target of forbidden) {
      const v = validateMessageRoute(worker, target)
      expect(v.allowed, `${worker}->${target} must be denied`).toBe(false)
      expect(v.edgeType).toBe('deny')
      expect(v.reason).toBe(`${worker.toUpperCase()} cannot send messages to ${target.toUpperCase()}`)
      expect(v.suggestion, `${worker}->${target} must carry a routing suggestion`).toBeTruthy()
    }
  })

  it.each(WORKERS)('%s cannot initiate to the human user — the H-edge is reply-only', (worker) => {
    expect(getEdgeType(worker, 'human')).toBe('reply-only')
    const v = validateMessageRoute(worker, 'human', { recipientIsHuman: true })
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('reply-only')
  })
})

describe('R6.5a — AUTONOMOUS may reach MANAGER, peer AUTONOMOUS, and the human user', () => {
  it('allow-set is exactly [autonomous, manager] plus a full (non-reply-only) H-edge', () => {
    expect([...getAllowedRecipients('autonomous')].sort()).toEqual(['autonomous', 'manager'])
    expect(getEdgeType('autonomous', 'human')).toBe('allow')
  })

  it('may INITIATE to the human user with no inReplyToMessageId — this is what separates it from a team title', () => {
    const v = validateMessageRoute('autonomous', 'human', { recipientIsHuman: true })
    expect(v.allowed).toBe(true)
    expect(v.edgeType).toBe('allow')
    // Contrast control: the same call from a team title is refused.
    expect(validateMessageRoute('member', 'human', { recipientIsHuman: true }).allowed).toBe(false)
  })

  it.each(['chief-of-staff', ...IN_TEAM_NON_COS, 'maintainer'] as AgentRole[])(
    'cannot reach %s — cross-layer traffic goes through MANAGER',
    (target) => {
      const v = validateMessageRoute('autonomous', target)
      expect(v.allowed).toBe(false)
      expect(v.edgeType).toBe('deny')
      expect(v.suggestion).toBe('Contact manager instead')
    },
  )
})

describe('R6.5b — MAINTAINER may reach MANAGER and the human user only', () => {
  it('allow-set is exactly [manager] plus a full (non-reply-only) H-edge', () => {
    expect([...getAllowedRecipients('maintainer')]).toEqual(['manager'])
    expect(getEdgeType('maintainer', 'human')).toBe('allow')
  })

  it('may INITIATE to the human user with no inReplyToMessageId', () => {
    const v = validateMessageRoute('maintainer', 'human', { recipientIsHuman: true })
    expect(v.allowed).toBe(true)
    expect(v.edgeType).toBe('allow')
  })

  it('cannot reach a peer MAINTAINER — MAINTAINER-to-MAINTAINER routes through MANAGER', () => {
    const v = validateMessageRoute('maintainer', 'maintainer')
    expect(v.allowed).toBe(false)
    expect(v.suggestion).toBe(
      'Contact manager instead (MAINTAINER-to-MAINTAINER coordination routes through MANAGER)',
    )
  })

  it.each(['chief-of-staff', ...IN_TEAM_NON_COS, 'autonomous'] as AgentRole[])(
    'cannot reach %s',
    (target) => {
      const v = validateMessageRoute('maintainer', target)
      expect(v.allowed).toBe(false)
      expect(v.suggestion).toBe('Contact manager instead')
    },
  )
})

describe('R6.6 — the HUMAN user is a first-class node', () => {
  it('the static H row is full-Y outbound to every governance node, including another human', () => {
    for (const target of GOV_NODES) {
      expect(getEdgeType('human', target), `human->${target}`).toBe('allow')
    }
    // H -> H specifically (user-to-user messaging).
    expect(getEdgeType('human', 'human')).toBe('allow')
  })

  it('inbound to H: the five team titles are reply-only, the three governance titles are allow', () => {
    for (const t of REPLY_ONLY_TO_HUMAN) {
      expect(getEdgeType(t, 'human'), `${t}->human`).toBe('reply-only')
    }
    for (const t of ALLOW_TO_HUMAN) {
      expect(getEdgeType(t, 'human'), `${t}->human`).toBe('allow')
    }
    // Non-vacuity: the two sets partition the eight non-assistant titles.
    expect(REPLY_ONLY_TO_HUMAN.length + ALLOW_TO_HUMAN.length).toBe(8)
  })

  it('a human sender is routed once the caller RESOLVES its context (legacy flag or R38.2 block)', () => {
    for (const target of GOV_NODES) {
      // Legacy path (user-authority model OFF).
      expect(validateMessageRoute('human', target, { isUserMessage: true }).allowed, `legacy human->${target}`).toBe(true)
      // R38.2 path (model ON) — the acting MAESTRO is the admin.
      const asMaestro = validateMessageRoute('human', target, {
        userSender: {
          userTitle: 'maestro' as any,
          isActiveMaestro: true,
          recipientIsOwnAssistant: false,
          recipientIsOwnTeamCos: false,
          recipientIsManager: false,
          recipientIsUser: target === 'human',
        },
      })
      expect(asMaestro.allowed, `maestro human->${target}`).toBe(true)
    }
  })

  it('FAIL-CLOSED: an UNRESOLVED human sender is refused rather than granted the old blanket allow', () => {
    // R6.6 says H is unconditional-Y; R38.2 qualified that by requiring the
    // CALLER to resolve which human it is. This pins the actual code: the
    // static row alone does not authorise a send.
    const v = validateMessageRoute('human', 'member')
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('deny')
    expect(v.reason).toContain('user sender context unresolved')
  })
})

describe('R6.7 — a blocked message always carries a routing suggestion', () => {
  it('EVERY denied agent-to-agent route returns a non-empty suggestion', () => {
    let denied = 0
    for (const sender of ALL_ROLES) {
      if (sender === 'assistant') continue // R39.7 — its own rule, denied before the suggestion table
      for (const recipient of ALL_ROLES) {
        if (recipient === 'assistant') continue
        const v = validateMessageRoute(sender, recipient)
        if (v.allowed) continue
        denied++
        expect(typeof v.suggestion, `${sender}->${recipient} suggestion type`).toBe('string')
        expect((v.suggestion ?? '').length, `${sender}->${recipient} has an empty suggestion`).toBeGreaterThan(0)
        expect(v.reason, `${sender}->${recipient} has no reason`).toBeTruthy()
      }
    }
    // Non-vacuity floor. 8 governance titles => 64 ordered agent-to-agent
    // pairs. The published matrix allows 23 of them (manager 4, cos 6, orch 4,
    // arch 2, int 2, member 2, autonomous 2, maintainer 1 — the H column is not
    // an agent recipient), so exactly 41 must be denied. A graph that allowed
    // everything would pass a zero-iteration loop; this pins the count.
    expect(denied).toBe(41)
  })

  it('the documented cross-layer suggestions are the exact published strings', () => {
    const expected: Record<string, string> = {
      'manager->member': 'Route through chief-of-staff (COS is the sole team gateway)',
      'member->manager': 'Route through chief-of-staff',
      'member->member': 'Route through orchestrator',
      'architect->integrator': 'Route through orchestrator',
      'member->maintainer': 'Route through manager',
      'chief-of-staff->autonomous': 'Route through manager',
      'autonomous->member': 'Contact manager instead',
      'maintainer->autonomous': 'Contact manager instead',
      'orchestrator->orchestrator': 'Route through chief-of-staff for cross-team coordination',
    }
    for (const [key, suggestion] of Object.entries(expected)) {
      const [s, r] = key.split('->')
      expect(validateMessageRoute(s, r).suggestion, key).toBe(suggestion)
    }
  })

  it('the suggestion table is COMPLETE — not one denied pair falls through to the generic fallback', () => {
    // The fallback string in communication-graph.ts:541 (`|| 'Check the
    // communication graph for allowed routes'`) is a safety net, not a
    // working answer: it tells an agent nothing about where to route instead.
    // Today every one of the 41 denied agent-to-agent pairs has a real,
    // specific entry in ROUTING_SUGGESTIONS. Deleting any row makes that pair
    // fall through to the useless generic string, and this test catches it.
    const GENERIC = 'Check the communication graph for allowed routes'
    const fellThrough: string[] = []
    for (const sender of ALL_ROLES) {
      if (sender === 'assistant') continue
      for (const recipient of ALL_ROLES) {
        if (recipient === 'assistant') continue
        const v = validateMessageRoute(sender, recipient)
        if (!v.allowed && v.suggestion === GENERIC) fellThrough.push(`${sender}->${recipient}`)
      }
    }
    expect(fellThrough, `these denied pairs lost their routing suggestion: ${fellThrough.join(', ')}`).toEqual([])
  })
})

describe('R6.8 (layer 1, pure part) — validateMessageRoute is the single decision point', () => {
  it('fails closed on a missing sender title', () => {
    const v = validateMessageRoute(null, 'member')
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('no governance title')
  })

  it('fails closed on an unknown sender or recipient title', () => {
    expect(validateMessageRoute('overlord', 'member').allowed).toBe(false)
    expect(validateMessageRoute('overlord', 'member').reason).toContain('Unknown sender role')
    expect(validateMessageRoute('member', 'overlord').allowed).toBe(false)
    expect(validateMessageRoute('member', 'overlord').reason).toContain('Unknown recipient role')
  })

  it('an untitled RECIPIENT is treated as the most-restricted title (MEMBER), not as open', () => {
    // AUTH-MIN-05 deliberate default. COS/ORCH can reach MEMBER, so they pass;
    // MAINTAINER/AUTONOMOUS cannot, so they are refused.
    expect(validateMessageRoute('chief-of-staff', null).allowed).toBe(true)
    expect(validateMessageRoute('orchestrator', null).allowed).toBe(true)
    const denied = validateMessageRoute('maintainer', null)
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('agents without a governance title')
    expect(denied.suggestion).toBeTruthy()
    expect(validateMessageRoute('autonomous', null).allowed).toBe(false)
    // MANAGER also cannot, since manager->member is denied post-v3.
    expect(validateMessageRoute('manager', null).allowed).toBe(false)
  })

  it('UNMAPPED SITE (amp-service.ts:1112-1124): every real title has a non-empty allow-set, so the remote-delivery pre-check never falsely blocks one', () => {
    for (const title of ALL_ROLES) {
      if (title === 'assistant') continue // R39.7: intentionally empty (invisible)
      expect(getAllowedRecipients(title).length, `${title} has no allowed recipients`).toBeGreaterThan(0)
    }
    // And the pre-check's trigger condition is genuinely reachable — 'assistant'
    // is the one title with an empty set, which is why this pre-check exists.
    expect(getAllowedRecipients('assistant')).toEqual([])
  })
})

describe('R6.9 — sub-agents have no AMP identity and cannot send', () => {
  it('isSubagent REFUSES even on an otherwise-allowed edge', () => {
    // Positive control first: without the flag, this exact pair is allowed.
    expect(validateMessageRoute('chief-of-staff', 'member').allowed).toBe(true)
    const v = validateMessageRoute('chief-of-staff', 'member', { isSubagent: true })
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe(
      'Subagents cannot send messages. Only the main agent with an AMP identity can communicate.',
    )
  })

  it('the subagent check precedes EVERY other branch — even a resolved MAESTRO human sender', () => {
    const v = validateMessageRoute('human', 'manager', {
      isSubagent: true,
      isUserMessage: true,
      userSender: {
        userTitle: 'maestro' as any,
        isActiveMaestro: true,
        recipientIsOwnAssistant: false,
        recipientIsOwnTeamCos: false,
        recipientIsManager: true,
        recipientIsUser: false,
      },
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toContain('Subagents cannot send messages')
  })

  it.each(ALL_ROLES.filter(r => r !== 'assistant'))('%s is blocked as a subagent regardless of its row', (sender) => {
    for (const recipient of getAllowedRecipients(sender)) {
      const v = validateMessageRoute(sender, recipient, { isSubagent: true })
      expect(v.allowed, `subagent ${sender}->${recipient}`).toBe(false)
    }
  })
})

describe('R6.10 — reply-only edges require inReplyToMessageId', () => {
  it.each(REPLY_ONLY_TO_HUMAN)('%s -> human with NO reply id is refused with an amp-reply suggestion', (sender) => {
    const v = validateMessageRoute(sender, 'human', { recipientIsHuman: true })
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('reply-only')
    expect(v.reason).toBe(
      `${sender.toUpperCase()} cannot initiate messages to the human user — may only reply to an inbound user message`,
    )
    expect(v.suggestion).toBe(
      'Use amp-reply with the original user message ID to answer (one reply per inbound user message).',
    )
  })

  it.each(REPLY_ONLY_TO_HUMAN)('%s -> human WITH a reply id is allowed on the reply-only edge', (sender) => {
    const v = validateMessageRoute(sender, 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: 'msg-abc123',
    })
    expect(v.allowed).toBe(true)
    expect(v.edgeType).toBe('reply-only')
  })

  it('an EMPTY-STRING reply id does not unlock the edge (the `|| ""` caller bug)', () => {
    const v = validateMessageRoute('member', 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: '',
    })
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('reply-only')
    // '' is falsy, so the FIRST branch fires — the "cannot initiate" message.
    expect(v.reason).toContain('cannot initiate messages to the human user')
  })

  it('a WHITESPACE-ONLY reply id is caught by the defensive trim check', () => {
    const v = validateMessageRoute('member', 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: '   ',
    })
    expect(v.allowed).toBe(false)
    expect(v.edgeType).toBe('reply-only')
    expect(v.reason).toBe('MEMBER reply-only edge requires a non-empty inReplyToMessageId')
    expect(v.suggestion).toBe('Pass the original inbound message id when calling amp-reply.')
  })

  it('KNOWN GAP (AUTH-MAJ-02 / TRDD-80557822): ANY truthy id unlocks the edge — the graph does not load or verify the referenced message', () => {
    // This pins the CURRENT contract, deliberately. The rule text itself says
    // the graph layer only requires a truthy string; it does NOT load the
    // message, check its sender/recipient pair, or prevent replay. Asserting
    // the stronger behaviour here would fail, and "fixing" production to match
    // would be a silent governance change. The gap is reported, not patched.
    const forged = validateMessageRoute('member', 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: 'this-message-id-does-not-exist-anywhere',
    })
    expect(forged.allowed).toBe(true)
    expect(forged.edgeType).toBe('reply-only')
    // The same forged id is accepted repeatedly — no one-reply-per-inbound.
    expect(validateMessageRoute('member', 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: 'this-message-id-does-not-exist-anywhere',
    }).allowed).toBe(true)
  })

  it('a reply id does NOT rescue a fully-denied H-edge (only reply-only edges are unlocked)', () => {
    // Non-vacuity: proves the id is gated on the EDGE TYPE, not accepted blindly.
    // 'assistant' has no edge to human at all.
    const v = validateMessageRoute('assistant', 'human', {
      recipientIsHuman: true,
      inReplyToMessageId: 'msg-abc123',
    })
    expect(v.allowed).toBe(false)
  })

  it('the ALLOW-edge titles do not need a reply id at all', () => {
    for (const sender of ALLOW_TO_HUMAN) {
      expect(validateMessageRoute(sender, 'human', { recipientIsHuman: true }).allowed, sender).toBe(true)
    }
  })
})

// ============================================================================
// SECTION 3 — R6.7 / R6.8 / R6.9 as WIRED into the AMP route handler.
// Guards: services/amp-service.ts:1286 (the validateMessageRoute call),
//         services/amp-service.ts:1294-1300 (the 403 + suggestion composition),
//         services/amp-service.ts:797-802 (the unauthenticated 401 gate).
// ============================================================================
describe('R6.7 / R6.8 / R6.9 — enforcement wired into POST /api/v1/route', () => {
  let routeMessage: typeof import('@/services/amp-service').routeMessage

  beforeAll(async () => {
    // Sequential import: concurrent Promise.all imports race the partial-mock
    // factories and can silently un-spy a module.
    const svc = await import('@/services/amp-service')
    routeMessage = svc.routeMessage
  })

  /** Build a genuinely Ed25519-signed AMP route body for the given sender. */
  function signedBody(opts: {
    fromAddress: string
    to: string
    subject?: string
    message?: string
    inReplyTo?: string
  }) {
    const payload = { type: 'text', message: opts.message ?? 'hello' }
    const subject = opts.subject ?? 'subject'
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('base64')
    const signatureData = [
      opts.fromAddress, opts.to, subject, 'normal', opts.inReplyTo ?? '', payloadHash,
    ].join('|')
    const signature = crypto
      .sign(null, Buffer.from(signatureData), crypto.createPrivateKey(KEYS.privatePem))
      .toString('base64')
    return { to: opts.to, subject, payload, signature, ...(opts.inReplyTo ? { in_reply_to: opts.inReplyTo } : {}) } as any
  }

  function authAs(agentId: string, name: string) {
    mockAuthResult.current = {
      authenticated: true,
      agentId,
      tenantId: 'default',
      address: `${name}@default.local`,
    }
  }

  it('R6.8 — a FORBIDDEN route (manager -> member) is refused with HTTP 403 title_communication_forbidden', async () => {
    authAs('id-mgr', 'mgr')
    mockDeliverCalls.length = 0
    const res = await routeMessage(signedBody({ fromAddress: 'mgr@default.local', to: 'mem' }), 'Bearer k', null, null, null, null)
    expect(res.status).toBe(403)
    expect((res.data as any).error).toBe('title_communication_forbidden')
    // The message was NOT delivered — the guard ran BEFORE delivery.
    expect(mockDeliverCalls.length).toBe(0)
  })

  it('R6.7 — the 403 body carries the ROUTING SUGGESTION appended to the reason', async () => {
    authAs('id-mgr', 'mgr')
    const res = await routeMessage(signedBody({ fromAddress: 'mgr@default.local', to: 'mem' }), 'Bearer k', null, null, null, null)
    const msg = (res.data as any).message as string
    expect(msg).toContain('MANAGER cannot send messages to MEMBER')
    expect(msg).toContain('Route through chief-of-staff (COS is the sole team gateway)')
    // Composition detail from amp-service.ts:1295 — " <suggestion>." with a
    // leading space and a trailing period.
    expect(msg).toBe(
      'MANAGER cannot send messages to MEMBER Route through chief-of-staff (COS is the sole team gateway).',
    )
  })

  it('R6.8 positive control — an ALLOWED route (cos -> member) is delivered with HTTP 200', async () => {
    // Without this, a guard that refused EVERYTHING would pass the tests above.
    authAs('id-cos', 'cos')
    mockDeliverCalls.length = 0
    const res = await routeMessage(signedBody({ fromAddress: 'cos@default.local', to: 'mem' }), 'Bearer k', null, null, null, null)
    expect(res.status).toBe(200)
    expect((res.data as any).status).toBe('delivered')
    expect(mockDeliverCalls.length).toBe(1)
  })

  it('R6.8 — the refusal follows the GRAPH, not the sender: the same recipient flips on the sender title', async () => {
    // orchestrator -> member : allowed.  member -> orchestrator : allowed.
    // member -> manager      : denied with the COS suggestion.
    authAs('id-orch', 'orch')
    const ok = await routeMessage(signedBody({ fromAddress: 'orch@default.local', to: 'mem' }), 'Bearer k', null, null, null, null)
    expect(ok.status).toBe(200)

    authAs('id-mem', 'mem')
    const denied = await routeMessage(signedBody({ fromAddress: 'mem@default.local', to: 'mgr' }), 'Bearer k', null, null, null, null)
    expect(denied.status).toBe(403)
    expect((denied.data as any).error).toBe('title_communication_forbidden')
    expect((denied.data as any).message).toContain('Route through chief-of-staff')
  })

  it('R6.9 — an unauthenticated caller (no AMP identity, as a subagent has) is refused 401 before any routing', async () => {
    mockDeliverCalls.length = 0
    const res = await routeMessage(signedBody({ fromAddress: 'mem@default.local', to: 'cos' }), null, null, null, null, null)
    expect(res.status).toBe(401)
    expect((res.data as any).error).toBe('unauthorized')
    expect(mockDeliverCalls.length).toBe(0)
  })
})

// ============================================================================
// SECTION 4 — R6.13: default-host resolution.
// Guard: lib/agent-registry.ts:312-332 (getAgentByName). NOTE: the map's
// 316-325 covers the hostId-SCOPED branch; the default-host resolution this
// rule describes is at 325-331.
// ============================================================================
describe('R6.13 — an address with no host defaults to the writer\'s host', () => {
  let getAgentByName: typeof import('@/lib/agent-registry').getAgentByName

  beforeAll(async () => {
    const reg = await import('@/lib/agent-registry')
    getAgentByName = reg.getAgentByName
  })

  it('a BARE name resolves on the self host, never on a peer host', () => {
    const a = getAgentByName('peer')
    expect(a).not.toBeNull()
    expect(a!.id).toBe('id-peer-alpha')
    expect(a!.hostId).toBe(FIXTURE.SELF_HOST)
  })

  it('REFUSAL: a bare name cannot reach an agent that exists only on a peer host', () => {
    // This is the sharp edge of R6.13 — "an agent on host A cannot accidentally
    // reach an agent on host B by typing a bare id".
    expect(getAgentByName('onlybeta')).toBeNull()
    // ...and the same name WITH the explicit host resolves.
    const explicit = getAgentByName('onlybeta', FIXTURE.PEER_HOST)
    expect(explicit).not.toBeNull()
    expect(explicit!.id).toBe('id-only-beta')
  })

  it('an EXPLICIT host selects that host\'s agent even when the name collides across hosts', () => {
    expect(getAgentByName('peer', FIXTURE.PEER_HOST)!.id).toBe('id-peer-beta')
    expect(getAgentByName('peer', FIXTURE.SELF_HOST)!.id).toBe('id-peer-alpha')
  })

  it('host and name matching are case-insensitive', () => {
    expect(getAgentByName('PEER', FIXTURE.PEER_HOST.toUpperCase())!.id).toBe('id-peer-beta')
    expect(getAgentByName('Peer')!.id).toBe('id-peer-alpha')
  })

  it('soft-deleted agents are excluded from both the default-host and explicit-host lookups', () => {
    expect(getAgentByName('tombstone')).toBeNull()
    expect(getAgentByName('tombstone', FIXTURE.SELF_HOST)).toBeNull()
  })

  it('an unknown name resolves to null on either path', () => {
    expect(getAgentByName('nobody')).toBeNull()
    expect(getAgentByName('nobody', FIXTURE.PEER_HOST)).toBeNull()
  })
})
