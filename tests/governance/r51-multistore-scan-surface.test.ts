/**
 * TRDD-4EBVIYBA — the R51 coverage ratchet's SCAN SURFACE, widened past one file.
 *
 * WHY THIS EXISTS. `tests/governance/aio-txn-10-runner-coverage.test.ts` proves 19/19 pipelines
 * are wrapped and reports a confident green — over a scan surface of exactly ONE file
 * (`services/element-management-service.ts`). TRDD-LMAZO2ET was a genuine uncompensated
 * FIVE-store sequence that the ratchet could not see BY CONSTRUCTION, because it lived in
 * `app/api/` and called a different service. A check whose scope is narrower than the invariant
 * it guards reports clean and could never have caught the thing it exists for.
 *
 * So this sweeps `app/api/**\/route.ts` + `services/*.ts` for files that write to ≥2 independent
 * stores WITHOUT routing through a transaction runner, and ratchets that count DOWNWARD.
 *
 * TWO MEASUREMENT DECISIONS, both load-bearing, both learned the hard way:
 *
 *  1. The runner is matched as a BARE IDENTIFIER, never `runGateSequence(`. A generic call site
 *     (`runGateSequence<RemoveCtx>(`) drops out of the paren form — the A2 survey measured 19 vs
 *     20 on exactly that, i.e. the paren form silently under-reports coverage and therefore
 *     OVER-reports violations.
 *  2. The store vocabulary had to be WIDENED before this detector was worth anything. Seeded
 *     with only the six `all-in-one-single-path` guards, it could not see LMAZO2ET's own service
 *     at all (one matching store out of six), which would have made it narrower than the
 *     invariant in the very same way as the file-scoped ratchet it replaces. With keypair /
 *     amp-registration / aid-ledger / foreign-approval / agent-import added, the census doubled
 *     (4 → 8 multi-store files) and `foreign-approval-service.ts` appears with all six of its
 *     stores, WRAPPED — which is what proves this detector can see the shape it was built for.
 *
 * WHAT IT DOES NOT MEASURE, stated so the number is not read as more than it is: the granularity
 * is a FILE, not a call sequence. A router that writes store A in one handler and store B in an
 * unrelated handler counts here, and that is not one multi-store transaction. The allowlist is
 * where that judgment is recorded, per entry, with its reason.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import path from 'path'

const repoRoot = path.resolve(__dirname, '..', '..')

/**
 * Store → its exported WRITE primitives. The first six mirror `all-in-one-single-path.test.ts`'s
 * `GUARDS` (one vocabulary, not two that drift); the rest were added by TRDD-4EBVIYBA because
 * the LMAZO2ET sequence lives entirely in them. Read-only accessors are deliberately absent —
 * this asks "who MUTATES", and listing a getter would flag every reader.
 */
const STORE_WRITES: Record<string, string[]> = {
  'agent-registry': ['createAgent', 'deleteAgentBySession', 'renameAgent', 'renameAgentSession', 'saveAgents'],
  'team-registry': ['createTeam', 'deleteTeam', 'saveTeams', 'updateTeam'],
  'group-registry': ['createGroup', 'deleteGroup', 'saveGroups', 'updateGroup', 'addSubscriber', 'removeSubscriber'],
  'session-persistence': ['persistSession', 'unpersistSession', 'savePersistedSessions', 'clearPersistedSessions'],
  'task-registry': ['createTask', 'deleteTask', 'saveTasks', 'updateTask'],
  'aid-token': ['issueGovernanceToken', 'issueUserGovernanceToken', 'revokeTokensForAgent'],
  'agent-import': ['importAgent'],
  keypair: ['generateKeyPair', 'deleteKeyPair'],
  'amp-registration': ['markAgentAsAMPRegistered', 'deregisterAgent'],
  'aid-ledger': [
    'recordAidReissue',
    'recordAidRevocation',
    'recordAidAssociate',
    'recordForeignApproval',
    'revokeFreshFingerprintOnce',
  ],
  'foreign-approval': ['updateForeignApproval'],
}

/** Both transaction runners, matched BARE — see measurement decision 1 in the header. */
const RUNNERS = ['runGateSequence', 'runAioPipeline']

export interface ScanRow {
  file: string
  stores: string[]
  wrapped: boolean
}

/** PURE, so the positive control can feed it a synthetic file instead of trusting the tree. */
export function scanSource(file: string, src: string): ScanRow {
  // Strip comments: this file's own prose names every primitive it hunts, and a detector that
  // counts documentation is the self-match trap one layer up.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const stores = Object.entries(STORE_WRITES)
    .filter(([, prims]) => prims.some((p) => new RegExp(`\\b${p}\\s*\\(`).test(code)))
    .map(([store]) => store)
  return { file, stores, wrapped: RUNNERS.some((r) => new RegExp(`\\b${r}\\b`).test(code)) }
}

function scanSurface(): string[] {
  const out = execFileSync(
    'bash',
    ['-c', "find app/api -name 'route.ts' -type f; find services -maxdepth 1 -name '*.ts' -type f"],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  return out.trim().split('\n').filter(Boolean)
}

function multiStoreRows(): ScanRow[] {
  return scanSurface()
    .map((f) => scanSource(f, readFileSync(path.join(repoRoot, f), 'utf8')))
    .filter((r) => r.stores.length >= 2)
    .sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Files that touch ≥2 stores and are NOT wrapped, each with the reason it is acceptable — or,
 * where it is not yet judged, an honest `UNREVIEWED`. A reason is MANDATORY: an allowlist whose
 * entries carry no why becomes a list nobody can ever shrink, because no one can tell which
 * entries were decided and which were merely tolerated.
 *
 * THE RATCHET IS THE COUNT BELOW, and it may only go DOWN.
 */
const KNOWN_UNWRAPPED: Record<string, string> = {
  'services/agents-core-service.ts':
    'UNREVIEWED (census 2026-08-15) — agent-registry + session-persistence. Needs the per-call-sequence read before it can be called benign or filed as a gap.',
  'services/agents-transfer-service.ts':
    'UNREVIEWED (census 2026-08-15) — agent-registry + agent-import + keypair. Transfer is the shape most likely to be a genuine multi-store sequence; read it first.',
  'services/amp-service.ts':
    'UNREVIEWED (census 2026-08-15) — agent-registry + keypair + amp-registration.',
  'services/headless-router.ts':
    'UNREVIEWED (census 2026-08-15) — team-registry + agent-import, but verified to be SEPARATE handlers (importAgent at one route, updateTeam at another), so the file-granular signal is coarse here rather than a single sequence.',
  'services/sessions-service.ts':
    'UNREVIEWED (census 2026-08-15) — agent-registry + session-persistence.',
  'services/teams-service.ts':
    'UNREVIEWED (census 2026-08-15) — team-registry + task-registry.',
}

/** Ratchet. DOWN ONLY: lower it as entries are judged benign (and documented) or genuinely
 *  wrapped. Raising it is how a detector becomes a rubber stamp. */
const MAX_UNWRAPPED = 6

describe('R51 scan surface — multi-store writers outside a transaction (TRDD-4EBVIYBA)', () => {
  it('NON-VACUITY — the scan surface is real and substantial', () => {
    const files = scanSurface()
    // A broken find (wrong cwd, renamed dir) returns few or no files and every assertion below
    // then passes by measuring nothing. Measured 297 on 2026-08-15.
    expect(files.length).toBeGreaterThan(200)
    expect(files.some((f) => f.startsWith('app/api/'))).toBe(true)
    expect(files.some((f) => f.startsWith('services/'))).toBe(true)
  })

  it('POSITIVE CONTROL — a seeded two-store writer IS found, and wrapping it clears it', () => {
    const seeded = `
      import { saveAgents } from '@/lib/agent-registry'
      import { saveTeams } from '@/lib/team-registry'
      export async function doTwoThings() { await saveAgents([]); await saveTeams([]) }
    `
    const row = scanSource('services/__seeded__.ts', seeded)
    expect(row.stores.sort()).toEqual(['agent-registry', 'team-registry'])
    expect(row.wrapped).toBe(false) // ← would be reported as a violation

    // The same file routed through the runner is NOT a violation. Deliberately the GENERIC call
    // form, because that is the one the paren-matching version of this detector missed.
    const wrapped = scanSource('services/__seeded__.ts', `${seeded}\nawait runGateSequence<Ctx>(ops)`)
    expect(wrapped.wrapped).toBe(true)
  })

  it('CONTROL — prose naming a primitive is not a call (this file would flag itself otherwise)', () => {
    const row = scanSource('x.ts', '// we used to call saveAgents() and saveTeams() here\nexport const x = 1')
    expect(row.stores).toEqual([])
  })

  it('sees the LMAZO2ET shape: foreign-approval-service is multi-store AND wrapped', () => {
    // The reason the vocabulary was widened. If this file ever reads as <2 stores, the detector
    // has gone narrower than the invariant again and the whole sweep is worth less than it looks.
    const rows = multiStoreRows()
    const fa = rows.find((r) => r.file === 'services/foreign-approval-service.ts')
    expect(fa, 'foreign-approval-service must be visible as a multi-store writer').toBeDefined()
    expect(fa!.stores.length).toBeGreaterThanOrEqual(4)
    expect(fa!.wrapped).toBe(true) // wrapped by TRDD-LMAZO2ET (a084a1d5) — so it is not a finding
  })

  it('every unwrapped multi-store writer is DECLARED, and the count only goes down', () => {
    const unwrapped = multiStoreRows().filter((r) => !r.wrapped)
    const undeclared = unwrapped.filter((r) => !(r.file in KNOWN_UNWRAPPED))

    expect(
      undeclared.map((r) => `${r.file} [${r.stores.join(', ')}]`),
      'New multi-store writers outside a transaction runner. Route them through runGateSequence, ' +
        'or declare them in KNOWN_UNWRAPPED with the REASON they are safe:',
    ).toEqual([])

    expect(
      unwrapped.length,
      `MAX_UNWRAPPED is a DOWNWARD ratchet (${MAX_UNWRAPPED}). It rose to ${unwrapped.length} — ` +
        'lower it when an entry is fixed; never raise it to make this pass.',
    ).toBeLessThanOrEqual(MAX_UNWRAPPED)
  })

  it('every allowlist entry is a REAL current finding and carries a reason', () => {
    const unwrapped = new Set(multiStoreRows().filter((r) => !r.wrapped).map((r) => r.file))
    for (const [file, reason] of Object.entries(KNOWN_UNWRAPPED)) {
      // A stale entry is worse than no entry: it silently reserves a ratchet slot for a file that
      // no longer violates, so the count can never actually fall.
      expect(unwrapped.has(file), `${file} is allowlisted but is no longer a finding — remove it and lower MAX_UNWRAPPED`).toBe(true)
      expect(reason.length, `${file} needs a REASON`).toBeGreaterThan(20)
    }
  })
})
