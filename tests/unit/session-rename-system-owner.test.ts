import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-OYNUJRSB — PATCH /api/sessions/[id]/rename is SYSTEM-OWNER only.
 *
 * It shipped with `enforceAuth`, which authenticates and stops there. `renameSession`
 * (`services/sessions-service.ts:1259`) takes the session name straight from the URL and has
 * **no authContext parameter, no agentId comparison, no authorize() call, no ownership check of
 * any kind** — so any agent holding a valid AID token, of any governance title, on any team,
 * could rename the tmux session of any OTHER agent on the host. A session name is that agent's
 * runtime identity: renaming it orphans the agent from its dashboard binding. Denial of service
 * against a peer, reachable by every authenticated caller.
 *
 * WHY OWNER-ONLY RATHER THAN A PER-CALLER OWNERSHIP CHECK. The card asked for a ruling between
 * the two rather than whichever was easier to code. Three facts decided it, all measured:
 *
 *   • the route is `@deprecated` in its own docstring, with a documented replacement —
 *     `PATCH /api/agents/[id]` — which is already properly gated (it builds an authContext and
 *     passes it to `updateAgentById`). So no caller NEEDS this route;
 *   • it is PAST its own stated removal target: the docstring says "Removal target: v0.28.0" and
 *     `package.json` reads 0.29.0. The long-run answer is deletion, and owner-only is the
 *     strictly-safe interim that cannot be wrong in the direction that matters;
 *   • an ownership check needs a session→agent lookup that the sibling `sessions/activity/update`
 *     explicitly REJECTED on perf grounds, naming the cost in its own comment. Building that
 *     lookup for a route scheduled for deletion pays for infrastructure on a corpse.
 *
 * Owner-only also matches the peer route the card itself names: `teams/[id]/batch-create-agents`
 * hand-rolls exactly this (`if (auth.agentId) return 403`). Here it is the shared primitive
 * `enforceSystemOwner`, so no new governance vocabulary is invented — `authorize()` has no
 * session verb at all, and adding one would have been a governance change, not a fix.
 *
 * SAFE FOR THE UI, VERIFIED RATHER THAN ASSUMED: no browser code calls this route. Grepping
 * `components/ app/page.tsx hooks/` for it returns nothing, and the positive control on the same
 * grep — `api/agents/`, which IS called from the browser — returns MobileWorkTree, AgentBadge and
 * TerminalView. So the surface is CLI/agent callers only, and any agent reaching it was using the
 * ungated hole rather than a supported flow.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// renameSession must never be REACHED on a refused call. A 403 returned after the tmux session
// has already been renamed is not a refusal — the peer is already orphaned.
const mockRename = vi.fn()
vi.mock('@/services/sessions-service', () => ({
  renameSession: (...a: unknown[]) => mockRename(...a),
}))

function req(newName: string) {
  return new Request('http://localhost/api/sessions/victim-agent/rename', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify({ newName }),
  }) as never
}

const PARAMS = { params: { id: 'victim-agent' } } as never

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

describe('TRDD-OYNUJRSB — session rename is owner-only (Next.js mode)', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockRename.mockReset()
    mockRename.mockResolvedValue({ status: 200, data: { success: true, oldName: 'victim-agent', newName: 'hijacked' } })
  })

  it('refuses a MEMBER renaming another agent\'s session, and names the REASON', async () => {
    /** Validates that authentication no longer stands in for authority on a route with zero ownership checks */
    mockAuthenticate.mockReturnValue(MEMBER)
    const { PATCH } = await import('@/app/api/sessions/[id]/rename/route')
    const res = await PATCH(req('hijacked'), PARAMS)

    expect(res.status).toBe(403)
    // The reason matters, not merely the non-200: a thin or malformed body already yields 400
    // from this route's own validation, so a status-only assertion would pass with the gate
    // deleted for the wrong reason.
    expect((await res.json()).error).toMatch(/system owner only/i)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('refuses even a MANAGER — this is owner authority, not a governance title', async () => {
    /** Validates the guard is enforceSystemOwner and not a title check, which would still admit agents */
    mockAuthenticate.mockReturnValue(MANAGER)
    const { PATCH } = await import('@/app/api/sessions/[id]/rename/route')
    const res = await PATCH(req('hijacked'), PARAMS)

    expect(res.status).toBe(403)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the system owner still renames', async () => {
    /** Validates the gate can say yes, so the refusals above are a decision and not a blanket 403 */
    mockAuthenticate.mockReturnValue(OWNER)
    const { PATCH } = await import('@/app/api/sessions/[id]/rename/route')
    const res = await PATCH(req('renamed-by-owner'), PARAMS)

    expect(res.status).toBe(200)
    expect(mockRename).toHaveBeenCalledWith('victim-agent', 'renamed-by-owner')
  })
})
