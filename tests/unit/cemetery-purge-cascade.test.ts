/**
 * TRDD-3Q4G9ZK6 — purging a cemetery archive must complete the deletion it is the last
 * step of, and must NEVER resolve the archive to a LIVE agent.
 *
 * The card's own approved "Proposed fix" said to look up "a registry tombstone for that
 * agent NAME". That is unsafe, and it is why this file leads with the same-name test:
 * `getAgentByNameAnyHost` filters `!a.deletedAt` (lib/agent-registry.ts), so the obvious
 * name helper returns the LIVE agent and never the tombstone the archive belongs to — and
 * a tombstone and a live agent can share a name AND a workdir (TRDD-HNJ3T3W0, reproduced).
 * Following the card literally would delete a running agent's folder.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listAgents: vi.fn(),
  DeleteAgent: vi.fn(),
  unlinkSync: vi.fn(),
  requireSudoToken: vi.fn(() => null),
  authenticateFromRequest: vi.fn(() => ({ agentId: null })),
  buildAuthContext: vi.fn(() => ({ isSystemOwner: true })),
}))

// Direct references, not `(...a) => mock(...a)` forwarders: these are RESET per test
// (`mockReset`) rather than reassigned, so nothing needs restoring — and the forwarder
// form does not typecheck against a `vi.fn()` with no declared parameters.
vi.mock('@/lib/agent-registry', () => ({ listAgents: h.listAgents }))
vi.mock('@/services/element-management-service', () => ({ DeleteAgent: h.DeleteAgent }))
vi.mock('@/lib/sudo-guard', () => ({ requireSudoToken: h.requireSudoToken }))
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: h.authenticateFromRequest,
  buildAuthContext: h.buildAuthContext,
}))
vi.mock('fs', async (orig) => {
  const real = (await orig()) as typeof import('fs')
  return { ...real, default: { ...real, unlinkSync: h.unlinkSync } }
})

const ARCHIVE = 'probe-agent-export-2026-08-27T10-00-00.zip'
const req = (body: unknown) =>
  ({ json: async () => body, headers: new Headers() }) as unknown as import('next/server').NextRequest

async function purge(body: unknown) {
  const { DELETE } = await import('@/app/api/agents/cemetery/route')
  const res = await DELETE(req(body))
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.resetModules()
  h.listAgents.mockReset(); h.DeleteAgent.mockReset(); h.unlinkSync.mockReset()
  h.requireSudoToken.mockReturnValue(null)
  h.authenticateFromRequest.mockReturnValue({ agentId: null })
  h.buildAuthContext.mockReturnValue({ isSystemOwner: true })
  h.DeleteAgent.mockResolvedValue({ success: true })
})

describe('cemetery purge cascade', () => {
  it('resolves to the TOMBSTONE and never to a LIVE agent of the same name', async () => {
    // The HNJ3T3W0 state, seeded: one tombstoned entry and one live entry, same name.
    h.listAgents.mockReturnValue([
      { id: 'live-1', name: 'probe-agent', deletedAt: null },
      { id: 'dead-1', name: 'probe-agent', deletedAt: '2026-08-26T10:00:00+0200' },
    ])
    const { json } = await purge({ filename: ARCHIVE, deleteFolder: true })
    expect(h.DeleteAgent).toHaveBeenCalledTimes(1)
    expect(h.DeleteAgent.mock.calls[0][0]).toBe('dead-1')
    // The assertion the whole card turns on: the LIVE agent is untouched.
    expect(h.DeleteAgent.mock.calls[0][0]).not.toBe('live-1')
    expect(json.deleted).toBe('dead-1')
  })

  it('REFUSES when several tombstones share the name — and SAYS what it left', async () => {
    h.listAgents.mockReturnValue([
      { id: 'dead-1', name: 'probe-agent', deletedAt: '2026-08-26T10:00:00+0200' },
      { id: 'dead-2', name: 'probe-agent', deletedAt: '2026-08-25T10:00:00+0200' },
    ])
    const { json } = await purge({ filename: ARCHIVE })
    expect(h.DeleteAgent).not.toHaveBeenCalled()
    expect(h.unlinkSync).toHaveBeenCalledTimes(1)   // the zip still goes
    // A SILENT partial purge is the defect this card exists to fix, so the refusal must
    // report rather than merely decline.
    expect(String(json.left)).toMatch(/2 tombstoned entries/)
  })

  it('REFUSES when no tombstone matches, and still reports', async () => {
    h.listAgents.mockReturnValue([{ id: 'live-1', name: 'probe-agent', deletedAt: null }])
    const { json } = await purge({ filename: ARCHIVE })
    expect(h.DeleteAgent).not.toHaveBeenCalled()
    expect(String(json.left)).toMatch(/no tombstoned registry entry/)
  })

  it('passes deleteFolder ONLY when the caller asked — it is never implied by the purge', async () => {
    h.listAgents.mockReturnValue([{ id: 'dead-1', name: 'probe-agent', deletedAt: '2026-08-26T10:00:00+0200' }])
    await purge({ filename: ARCHIVE })
    expect(h.DeleteAgent.mock.calls[0][1]).toMatchObject({ hard: true, deleteFolder: false })
    h.DeleteAgent.mockClear()
    await purge({ filename: ARCHIVE, deleteFolder: true })
    expect(h.DeleteAgent.mock.calls[0][1]).toMatchObject({ deleteFolder: true })
  })

  it('does NOT cascade for a .json tombstone file — that agent is already fully deleted', async () => {
    h.listAgents.mockReturnValue([{ id: 'dead-1', name: 'probe-agent', deletedAt: '2026-08-26T10:00:00+0200' }])
    const { json } = await purge({ filename: 'probe-agent-tombstone-2026-08-27.json' })
    expect(h.DeleteAgent).not.toHaveBeenCalled()
    expect(json.left).toBeUndefined()   // nothing was left behind; there was nothing to leave
    expect(json.success).toBe(true)
  })

  it('reports a FAILED cascade instead of claiming success', async () => {
    h.listAgents.mockReturnValue([{ id: 'dead-1', name: 'probe-agent', deletedAt: '2026-08-26T10:00:00+0200' }])
    h.DeleteAgent.mockResolvedValue({ success: false, error: 'tmux session busy' })
    const { json } = await purge({ filename: ARCHIVE })
    expect(String(json.left)).toMatch(/tmux session busy/)
    expect(json.deleted).toBeUndefined()
  })
})
