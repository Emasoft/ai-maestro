/**
 * Archive authority reads the card's column FROM DISK (TRDD-MQE5D28T D3, test T9b).
 *
 * The owner may archive its own tasked card, but not a FAILED one — owner rulings R1/R3
 * give that definitive act to MANAGER or the assignee's team CHIEF-OF-STAFF. The archive
 * route passes a TARGET state (`cancelled`, …) to the store inside the authorised write,
 * so the only thing standing between an owner and "archive my failed card as cancelled"
 * is that authorization judges the column ON DISK, read inside the document lock. This
 * file drives the real `withAuthorizedTrdd` over a real card to pin exactly that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const MEMBER_ID = '44444444-4444-4444-8444-444444444444'

// resolveActor() turns the card's `assignee:` into an agent id through the registry.
// Only MEMBER_ID resolves, so ownership is decided by the card, not by a stub.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string) => (id === MEMBER_ID ? { id } : null),
  getAgentByNameAnyHost: () => null,
}))
vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))

import { withAuthorizedTrdd } from '@/lib/trdd-authz'
import type { AgentAuthResult } from '@/lib/agent-auth'

const OWNER: AgentAuthResult = { agentId: MEMBER_ID, governanceTitle: 'member' }
const MANAGER: AgentAuthResult = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }

const card = (id: string, column: string): string =>
  [
    '---',
    `trdd-id: ${id}`,
    'status: tasked',
    'title: archive authority fixture',
    `column: ${column}`,
    `assignee: ${MEMBER_ID}`,
    `created-by: ${MEMBER_ID}`,
    'min-approval-requirement: none',
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    '---',
    '',
    `# TRDD-${id} — archive authority fixture`,
    '',
  ].join('\n')

describe('archive authority judges the column on disk (TRDD-MQE5D28T D3)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-archive-authz-'))
    for (const z of ['proposals', 'tasks', 'archived']) fs.mkdirSync(path.join(dir, z), { recursive: true })
    fs.writeFileSync(path.join(dir, 'tasks', 'TRDD-20260101_000000+0100-DEVCARD1-x.md'), card('DEVCARD1', 'dev'))
    fs.writeFileSync(path.join(dir, 'tasks', 'TRDD-20260101_000000+0100-FAILCRD1-x.md'), card('FAILCRD1', 'failed'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('POSITIVE CONTROL: the owner may archive its own NON-failed card (the assignee resolves)', async () => {
    // Without this, the refusal below is also what an unresolved assignee would produce.
    const write = vi.fn(() => 'archived')
    const outcome = await withAuthorizedTrdd(OWNER, dir, 'DEVCARD1', 'archive', write)
    expect(outcome.denied).toBeNull()
    expect(write).toHaveBeenCalledOnce()
  })

  it('T9b: the owner may NOT archive its own FAILED card, whatever target state it would ask for', async () => {
    // The target state (`cancelled`) lives only inside `write`, which must never run.
    const write = vi.fn(() => 'archived as cancelled')
    const outcome = await withAuthorizedTrdd(OWNER, dir, 'FAILCRD1', 'archive', write)
    expect(outcome.denied?.status).toBe(403)
    const body = await outcome.denied!.json()
    expect(body.message).toMatch(/failed TRDD makes it definitive/)
    expect(write).not.toHaveBeenCalled()
  })

  it('MANAGER may archive the same failed card', async () => {
    const write = vi.fn(() => 'archived')
    const outcome = await withAuthorizedTrdd(MANAGER, dir, 'FAILCRD1', 'archive', write)
    expect(outcome.denied).toBeNull()
    expect(write).toHaveBeenCalledOnce()
  })

  // 920d4361d pinned "an archived card cannot be archived again" only through a HAND-BUILT
  // context. This drives the real withAuthorizedTrdd over a card that is really in archived/,
  // so it also proves the zone read from disk reaches authorize().
  it('an ON-DISK archived card (even failed) cannot be archived again — MANAGER and owner both denied', async () => {
    fs.writeFileSync(
      path.join(dir, 'archived', 'TRDD-20260101_000000+0100-ARCFAIL1-x.md'),
      card('ARCFAIL1', 'failed').replace('status: tasked', 'status: archived'),
    )
    for (const who of [MANAGER, OWNER]) {
      const write = vi.fn(() => 'rewritten')
      const outcome = await withAuthorizedTrdd(who, dir, 'ARCFAIL1', 'archive', write)
      expect(outcome.denied?.status).toBe(403)
      const body = await outcome.denied!.json()
      expect(body.message).toMatch(/Archived cards are immutable/)
      expect(write).not.toHaveBeenCalled()
    }
  })
})
