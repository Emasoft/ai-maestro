/**
 * SECURITY REGRESSION — POST /api/agents/[id]/element-inventory let any
 * authenticated agent forge another agent's audit history.
 *
 * The route called `enforceAuth`, which authenticates and DISCARDS the identity
 * (it returns `NextResponse | null`, never the caller). The path `id` alone
 * selected the ledger, so one valid agent token could append arbitrary snapshots
 * to any agent's append-only JSONL at
 * `~/.aimaestro/element-inventory/<agentId>.jsonl` — the file the JSONL Session
 * Browser presents as "what Claude actually saw at this message".
 *
 * WHY OWNERSHIP AND NOT `modify-agent`, the action the TRDD guessed. Two
 * reasons, the second decisive:
 *
 *  1. Appending to an audit ledger is not reconfiguring an agent.
 *  2. `modify-agent` is NOT in `SELF_DRIVE_ACTIONS`, so the universal
 *     self-target ban (TRDD-D3RP7KQZ) would deny an agent acting on itself —
 *     and the only caller this endpoint has ever been written for is an agent's
 *     own SessionStart hook, posting its own inventory. `modify-agent` would
 *     have shipped a permanently uncallable endpoint. The proposed action was
 *     not merely imprecise; it was inverted.
 *
 * The endpoint is UNFINISHED, not dead: nothing in this repo, in `scripts/`, in
 * the headless router, or in the installed `ai-maestro-plugin` (v2.8.0) posts
 * here yet, though the route's doc comment claimed otherwise. But the reader
 * half IS live (`getLatestInventoryAtOrBefore`, used by the Session Browser), so
 * it is authorized rather than deleted — unlike `triggerSubconsciousAction`,
 * which could never succeed for any input.
 *
 * Exact match on the bare id: the reader keys the ledger on the UUID from
 * `deriveAgentIdFromCwd`, so an agent writes exactly `<uuid>.jsonl`. Accepting a
 * qualified `uuid@host` from an agent caller would create a second, orphaned
 * ledger the reader never reads.
 *
 * THE DENIAL ASSERTION IS THAT NOTHING IS WRITTEN. `appendFile` is mocked and
 * must never be called on a refusal — a 403 returned after the line hit the
 * ledger is not a refusal.
 *
 * FALSIFIED per layer (two guards that both yield 403 cover for each other, so a
 * suite driving only HTTP keeps passing as they are deleted one at a time):
 * route guard off → the route-layer test fails; service guard off → the
 * service-layer and direct-call tests fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRouteAuth, mockFs } = vi.hoisted(() => ({
  mockRouteAuth: { requireAuth: vi.fn(), enforceAuth: vi.fn() },
  mockFs: { mkdir: vi.fn(), appendFile: vi.fn(), readFile: vi.fn() },
}))

vi.mock('@/lib/route-auth', () => mockRouteAuth)
vi.mock('node:fs', () => ({ promises: mockFs, default: { promises: mockFs } }))
// The ledger service is REAL — it carries the defence-in-depth half.

import { POST } from '@/app/api/agents/[id]/element-inventory/route'
import {
  appendInventorySnapshot,
  ForeignLedgerError,
} from '@/services/element-inventory-ledger'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const TARGET = 'agent-target-1'

const VALID_ELEMENT = { name: 'CLAUDE.md', tokens: 120, scope: 'project', bucket: 'memory' }
const VALID_BODY = { trigger: 'session_start', elements: [VALID_ELEMENT] }

function asAgent(agentId?: string) {
  mockRouteAuth.requireAuth.mockReturnValue({
    ok: true,
    agentId,
    context: { agentId, isSystemOwner: !agentId },
  })
}

const post = (id: string, body: unknown = VALID_BODY) =>
  POST(
    new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/element-inventory`), {
      method: 'POST',
      body: JSON.stringify(body),
    } as never),
    { params: Promise.resolve({ id }) },
  )

/** The write primitive. A denial that still appended is not a denial. */
function ledgerUntouched() {
  expect(mockFs.appendFile).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFs.mkdir.mockResolvedValue(undefined)
  mockFs.appendFile.mockResolvedValue(undefined)
})

describe('an agent may append only to its own ledger', () => {
  it('appending to another agent is 403 and writes nothing', async () => {
    asAgent(MEMBER)
    const res = await post(TARGET)
    expect(res.status).toBe(403)
    ledgerUntouched()
  })

  it('MANAGER is not exempt — an audit ledger is owned, not governed', async () => {
    asAgent(MANAGER)
    expect((await post(TARGET)).status).toBe(403)
    ledgerUntouched()
  })

  it('an agent appending to its OWN ledger succeeds — the SessionStart hook case', async () => {
    // The case `modify-agent` would have denied. If this ever 403s, the endpoint
    // is uncallable by the only caller it exists for.
    asAgent(MEMBER)
    const res = await post(MEMBER)
    expect(res.status).toBe(200)
    expect(mockFs.appendFile).toHaveBeenCalledTimes(1)
    const [file, line] = mockFs.appendFile.mock.calls[0]
    expect(String(file)).toContain(`${MEMBER}.jsonl`)
    expect(JSON.parse(String(line))).toMatchObject({ agentId: MEMBER, trigger: 'session_start' })
  })

  it('the system owner may append anywhere — the `manual` debugging trigger', async () => {
    asAgent(undefined)
    expect((await post(TARGET, { ...VALID_BODY, trigger: 'manual' })).status).toBe(200)
    expect(String(mockFs.appendFile.mock.calls[0][0])).toContain(`${TARGET}.jsonl`)
  })

  it('a qualified `uuid@host` from an agent caller is refused, not silently split', async () => {
    // It would resolve to a second ledger file the reader never reads.
    asAgent(MEMBER)
    expect((await post(`${MEMBER}@otherhost`)).status).toBe(403)
    ledgerUntouched()
  })

  it('an unauthenticated request never reaches the ledger', async () => {
    mockRouteAuth.requireAuth.mockReturnValue({
      ok: false,
      error: new Response(null, { status: 401 }),
    })
    expect((await post(TARGET)).status).toBe(401)
    ledgerUntouched()
  })
})

describe('layer isolation — each guard refuses on its own (fault injection)', () => {
  /** Inconsistent contexts, unreachable in production, so exactly one guard fires. */
  function withSplitIdentity(routeAgentId: string | undefined, ctx: Record<string, unknown>) {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: true, agentId: routeAgentId, context: ctx })
  }

  it('the ROUTE guard alone refuses when the service guard is disarmed', async () => {
    withSplitIdentity(MEMBER, { agentId: MEMBER, isSystemOwner: true })
    expect((await post(TARGET)).status).toBe(403)
    ledgerUntouched()
  })

  it('the SERVICE guard alone refuses when the route guard is disarmed', async () => {
    withSplitIdentity(undefined, { agentId: MEMBER, isSystemOwner: false })
    // Reaches the service, which throws ForeignLedgerError; the route must map
    // that to 403 and not swallow it into its generic 500 branch.
    expect((await post(TARGET)).status).toBe(403)
    ledgerUntouched()
  })
})

describe('defence-in-depth: the SERVICE refuses even if a route forgets', () => {
  const snapshot = { trigger: 'session_start' as const, agentId: TARGET, elements: [] }

  it('a foreign agentId throws ForeignLedgerError and writes nothing', async () => {
    await expect(
      appendInventorySnapshot(snapshot, { agentId: MEMBER, isSystemOwner: false }),
    ).rejects.toBeInstanceOf(ForeignLedgerError)
    ledgerUntouched()
  })

  it('an authenticated caller with no resolvable identity owns no ledger', async () => {
    await expect(
      appendInventorySnapshot(snapshot, { isSystemOwner: false }),
    ).rejects.toBeInstanceOf(ForeignLedgerError)
    ledgerUntouched()
  })

  it('no authContext = internal caller; the route guard is authoritative', async () => {
    await appendInventorySnapshot(snapshot)
    expect(mockFs.appendFile).toHaveBeenCalledTimes(1)
  })

  it('the refusal is a distinct type, so a route cannot report it as a 500', async () => {
    // A generic Error would land in the route's `catch` and become "Internal
    // server error" — a denial indistinguishable from a full disk.
    const err = await appendInventorySnapshot(snapshot, { agentId: MEMBER, isSystemOwner: false })
      .catch((e) => e)
    expect(err).toBeInstanceOf(ForeignLedgerError)
    expect(err.name).toBe('ForeignLedgerError')
  })
})
