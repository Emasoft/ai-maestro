/**
 * TRDD-U4KP0H92 — server-side ASSISTANT visibility/messaging enforcement.
 *
 * Covers the three halves the card's acceptance boxes name:
 *   1. the PURE graph branch (recipientIsProjectCollaborator allow / deny) — no fs, no registry;
 *   2. the collaboration STORE (approve / revoke / list) against a sandboxed $HOME;
 *   3. the RESOLVER (resolveAssistantSenderContext) composing registry facts into the block the
 *      send paths hand the graph — bound user, MANAGER + standing approval, unrevoked collaborators.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ── Isolation: os.homedir() → temp dir BEFORE any real module loads ──────────
// assistant-collaboration.ts captures COLLAB_FILE = statePath(...) at module load, so the homedir
// mock MUST be hoisted above the imports (vi.mock is hoisted).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-assist-collab-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => TMP_HOME, default: { ...actual, homedir: () => TMP_HOME } }
})

type CollabModule = typeof import('@/lib/assistant-collaboration')
type GraphModule = typeof import('@/lib/communication-graph')
let collab: CollabModule
let graph: GraphModule

beforeAll(async () => {
  collab = await import('@/lib/assistant-collaboration')
  graph = await import('@/lib/communication-graph')
})

beforeEach(() => {
  const p = path.join(TMP_HOME, '.aimaestro', 'assistant-collaborations.json')
  try { fs.rmSync(p, { force: true }) } catch { /* absent is fine */ }
})

// ── 1. PURE graph branch (no registry) ──────────────────────────────────────
describe('communication-graph — R39.10 project-collaborator edge', () => {
  const base = {
    recipientIsOwnUser: false,
    recipientIsManager: false,
    userPermitsManagerCollaboration: false,
    recipientIsProjectCollaborator: false,
  }

  it('ASSISTANT → an approved collaborator = allow (mutually visible, R39.10)', () => {
    const r = graph.validateMessageRoute('assistant', 'member', {
      assistantSender: { ...base, recipientIsProjectCollaborator: true },
    })
    expect(r.allowed).toBe(true)
    expect(r.edgeType).toBe('allow')
  })

  it('ASSISTANT → the SAME recipient with NO grant = deny (revocation re-closes)', () => {
    const r = graph.validateMessageRoute('assistant', 'member', { assistantSender: base })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/only message its own user and the MANAGER/i)
  })

  it('the collaborator grant does NOT open a general visibility (a non-collaborator stays denied)', () => {
    const r = graph.validateMessageRoute('assistant', 'architect', { assistantSender: base })
    expect(r.allowed).toBe(false)
  })
})

// ── 2. Collaboration store ──────────────────────────────────────────────────
describe('assistant-collaboration store — approve / revoke / list', () => {
  it('a fresh store has no collaborators (default = nobody, R39.7)', () => {
    expect(collab.getAssistantCollaborators('asst-1')).toEqual([])
  })

  it('approveCollaboration makes the collaborator visible', async () => {
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    expect(collab.getAssistantCollaborators('asst-1')).toEqual(['agent-A'])
  })

  it('approval is scoped to the assistant (another assistant is untouched)', async () => {
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    expect(collab.getAssistantCollaborators('asst-2')).toEqual([])
  })

  it('approveCollaboration is idempotent per (project, assistant, collaborator)', async () => {
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    expect(collab.getAssistantCollaborators('asst-1')).toEqual(['agent-A'])
  })

  it('revokeCollaboration removes the grant (R39.10 — the USER may stop it any time)', async () => {
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    await collab.revokeCollaboration('proj-1', 'asst-1', 'agent-A')
    expect(collab.getAssistantCollaborators('asst-1')).toEqual([])
  })

  it('revoking an unknown grant is a no-op returning null', async () => {
    expect(await collab.revokeCollaboration('proj-1', 'asst-1', 'nobody')).toBeNull()
  })

  it('re-approval after a revoke re-opens the edge (a normal USER decision)', async () => {
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    await collab.revokeCollaboration('proj-1', 'asst-1', 'agent-A')
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    expect(collab.getAssistantCollaborators('asst-1')).toEqual(['agent-A'])
  })
})

// ── 3. isBoundUserRecipient ─────────────────────────────────────────────────
describe('assistant-collaboration — isBoundUserRecipient', () => {
  it('returns false when the sender is not a bound assistant', async () => {
    expect(await collab.isBoundUserRecipient('not-an-assistant', 'someone')).toBe(false)
  })
})

// ── 4. resolveAssistantSenderContext composition ────────────────────────────
describe('assistant-collaboration — resolveAssistantSenderContext', () => {
  it('returns null for a non-assistant sender (every other title untouched, fail-closed)', async () => {
    vi.doMock('@/lib/agent-registry', () => ({
      getAgent: (id: string) => (id === 'member-1' ? { id: 'member-1', governanceTitle: 'member' } : null),
    }))
    const { resolveAssistantSenderContext } = await import('@/lib/assistant-collaboration')
    expect(await resolveAssistantSenderContext('member-1', 'agent-A')).toBeNull()
    vi.doUnmock('@/lib/agent-registry')
  })

  it('returns null when the sender has no bound user (fail-closed)', async () => {
    vi.doMock('@/lib/agent-registry', () => ({
      getAgent: (id: string) => (id === 'asst-1' ? { id: 'asst-1', governanceTitle: 'assistant' } : null),
    }))
    vi.doMock('@/lib/user-registry', () => ({ loadUsers: () => [] }))
    const { resolveAssistantSenderContext } = await import('@/lib/assistant-collaboration')
    expect(await resolveAssistantSenderContext('asst-1', 'agent-A')).toBeNull()
    vi.doUnmock('@/lib/agent-registry')
    vi.doUnmock('@/lib/user-registry')
  })

  it('composes manager + approval + collaborator flags for a bound assistant', async () => {
    vi.doMock('@/lib/agent-registry', () => ({
      getAgent: (id: string) => (id === 'asst-1' ? { id: 'asst-1', governanceTitle: 'assistant' } : null),
    }))
    vi.doMock('@/lib/user-registry', () => ({
      loadUsers: () => [
        { id: 'user-1', name: 'Alice', deletedAt: undefined, assistantAgentId: 'asst-1', managerCollaborationApproved: true },
      ],
    }))
    vi.doMock('@/lib/governance', () => ({ isManager: (id: string) => id === 'manager-1' }))
    // The store is the SAME module instance as the resolver reads, so seed it through the real
    // approveCollaboration (homedir is sandboxed) rather than mocking a module against itself.
    await collab.approveCollaboration('proj-1', 'asst-1', 'agent-A')
    const { resolveAssistantSenderContext } = await import('@/lib/assistant-collaboration')
    const toManager = await resolveAssistantSenderContext('asst-1', 'manager-1')
    expect(toManager).toMatchObject({ recipientIsManager: true, userPermitsManagerCollaboration: true })
    const toCollab = await resolveAssistantSenderContext('asst-1', 'agent-A')
    expect(toCollab).toMatchObject({ recipientIsProjectCollaborator: true })
    const toStranger = await resolveAssistantSenderContext('asst-1', 'agent-Z')
    expect(toStranger).toMatchObject({ recipientIsManager: false, recipientIsProjectCollaborator: false })
    vi.doUnmock('@/lib/agent-registry')
    vi.doUnmock('@/lib/user-registry')
    vi.doUnmock('@/lib/governance')
  })
})
