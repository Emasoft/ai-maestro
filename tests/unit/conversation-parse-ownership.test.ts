import { describe, it, expect, vi, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'
import { conversationSlug } from '@/lib/claude-conversation'

/**
 * TRDD-RC33OAFQ — POST /api/conversations/parse disclosed ANY agent's transcript.
 *
 * The route's only gate was `enforceAuth`, and that admits AGENTS, not just the operator:
 * `lib/agent-auth.ts::authenticateFromRequest` returns `{ agentId }` for a valid AID token. The
 * path allowlist (API2-MAJ-14) was correct and is exactly the boundary being abused — it confines
 * the read to `~/.claude/projects/`, which holds every session's full transcript: every message,
 * every tool output, every thinking block, plus the absolute `cwd`.
 *
 * The fix is a property of PARSING A TRANSCRIPT, so it lives in `parseConversationFile` and not in
 * the route: `services/headless-router.ts` delegates to the same Next handler
 * (`delegateNextRoute`), so a route-only guard would have covered one of two server modes.
 *
 * The ownership rule: a SYSTEM OWNER (web UI, no agentId) may read any transcript — it drives the
 * whole fleet and impersonates no one. An AGENT may read only its OWN, resolved through the SAME
 * slug derivation Claude Code itself uses (`conversationSlug(workingDirectory)`).
 *
 * NEUTER RUN — recorded at the bottom of this file.
 */

const mockGetAgent = vi.fn()
vi.mock('@/lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-registry')>()
  return { ...actual, getAgent: (...a: unknown[]) => mockGetAgent(...a) }
})

const mockParse = vi.fn()
vi.mock('@/services/config-service', () => ({
  parseConversationFile: (...a: unknown[]) => mockParse(...a),
}))

const mockAuthenticate = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

const AGENT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const AGENT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const WD_A = '/Users/host/agents/alice'
const WD_B = '/Users/host/agents/bob'

/** A transcript path under the real allowlist root, built WITHOUT touching the filesystem. */
const transcriptFor = (workingDirectory: string) =>
  path.join(
    os.homedir(),
    '.claude',
    'projects',
    conversationSlug(workingDirectory),
    'session.jsonl',
  )

describe('TRDD-RC33OAFQ — an agent may read only its OWN transcript (service-level guard)', () => {
  beforeEach(() => {
    mockGetAgent.mockReset()
    mockGetAgent.mockImplementation((id: string) =>
      id === AGENT_A
        ? { id: AGENT_A, workingDirectory: WD_A }
        : id === AGENT_B
          ? { id: AGENT_B, workingDirectory: WD_B }
          : null,
    )
  })

  it('REFUSES agent A reading agent B\'s transcript, and names the OWNERSHIP reason', async () => {
    /** Validates that a valid agent token is no longer authority over another agent's transcript */
    const { parseConversationFile } = await vi.importActual<
      typeof import('@/services/config-service')
    >('@/services/config-service')
    const result = parseConversationFile(transcriptFor(WD_B), AGENT_A)

    expect(result.status).toBe(403)
    // The REASON, not merely the non-200: a missing file yields 404 and a bad path 403 too, so a
    // status-only assertion would pass for the wrong reason with the ownership gate deleted.
    expect(result.error).toMatch(/only its own conversation transcript/i)
  })

  it('FAILS CLOSED when the requester cannot be resolved at all', async () => {
    /** Validates that an unknown agentId is refused, never treated as "no agentId, therefore owner" */
    const { parseConversationFile } = await vi.importActual<
      typeof import('@/services/config-service')
    >('@/services/config-service')
    const result = parseConversationFile(transcriptFor(WD_B), 'ffffffff-9999-4999-8999-ffffffffffff')

    expect(result.status).toBe(403)
    expect(result.error).toMatch(/only its own conversation transcript/i)
  })

  it('POSITIVE CONTROL — an agent reading its OWN slug passes the ownership gate', async () => {
    /** Validates the gate discriminates by owner rather than refusing every agent outright */
    const { parseConversationFile } = await vi.importActual<
      typeof import('@/services/config-service')
    >('@/services/config-service')
    // The file does not exist on disk, so the call proceeds PAST the ownership gate and stops at
    // the 404. That is the discrimination: a 404 here can only mean the gate said yes.
    const result = parseConversationFile(transcriptFor(WD_A), AGENT_A)

    expect(result.status).toBe(404)
    expect(result.error).toMatch(/not found/i)
    expect(result.error).not.toMatch(/only its own conversation transcript/i)
  })

  it('POSITIVE CONTROL — the system owner (no agentId) may read any transcript', async () => {
    /** Validates the dashboard/web-UI path still works, so the fix is a scoping and not a removal */
    const { parseConversationFile } = await vi.importActual<
      typeof import('@/services/config-service')
    >('@/services/config-service')
    const result = parseConversationFile(transcriptFor(WD_B), undefined)

    expect(result.status).toBe(404)
    expect(result.error).not.toMatch(/only its own conversation transcript/i)
  })
})

describe('TRDD-RC33OAFQ — the route forwards the VERIFIED identity, never a parameter', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockParse.mockReset()
    // parseConversationFile is SYNCHRONOUS — a mockResolvedValue here returns a Promise, so the
    // route's `result.data` would be undefined and the test would exercise a shape the real
    // function never returns.
    mockParse.mockReturnValue({ data: { success: true, messages: [] }, status: 200 })
  })

  function req(body: Record<string, unknown>) {
    return new Request('http://localhost/api/conversations/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify(body),
    }) as never
  }

  const transcript = transcriptFor(WD_B)

  it('hands the resolved agentId from the credential to the service', async () => {
    /** Validates the guard receives identity from the CREDENTIAL — the parameter decides nothing */
    mockAuthenticate.mockReturnValue({ agentId: AGENT_A })
    const { POST } = await import('@/app/api/conversations/parse/route')
    await POST(req({ conversationFile: transcript }))

    expect(mockParse).toHaveBeenCalledWith(path.resolve(transcript), AGENT_A)
  })

  it('a caller naming a DIFFERENT agentId in the body cannot change who is forwarded', async () => {
    /** Validates that a body-supplied agentId is inert, since it is not read at all */
    mockAuthenticate.mockReturnValue({ agentId: AGENT_A })
    const { POST } = await import('@/app/api/conversations/parse/route')
    await POST(req({ conversationFile: transcript, agentId: AGENT_B }))

    expect(mockParse).toHaveBeenCalledWith(path.resolve(transcript), AGENT_A)
  })

  it('a forged credential never reaches the transcript reader', async () => {
    /** Validates the authentication half: the handler, not the structural gate, refuses */
    mockAuthenticate.mockReturnValue({ error: 'Invalid or expired token', status: 401 })
    const { POST } = await import('@/app/api/conversations/parse/route')
    const res = await POST(req({ conversationFile: transcript }))

    expect(res.status).toBe(401)
    expect(mockParse).not.toHaveBeenCalled()
  })
})
/**
 * NEUTER RUN — 2026-10-04, OBSERVED via scripts/dev/neuter's method (the helper refuses a dirty
 * tree, so the blob was copied, mutated in place, run, and restored; the restore was verified by
 * sha1, not by intent). TWO mutations, aimed at the two halves, and each reddened a DIFFERENT and
 * EXACT set:
 *
 *   1. services/config-service.ts
 *      s/if \(!ownSlug \|\| requestedSlug !== ownSlug\)/if (false && (...))/  (1 line)
 *      → 2 red / 5 green: "REFUSES agent A reading agent B's transcript" and "FAILS CLOSED when the
 *        requester cannot be resolved". Exactly the two refusal tests, and BOTH positive controls
 *        stayed green — so the guard discriminates by owner rather than refusing everything.
 *
 *   2. app/api/conversations/parse/route.ts
 *      s/parseConversationFile\(resolved, auth\.agentId\)/parseConversationFile(resolved, undefined)/  (1 line)
 *      → 2 red / 5 green: the two route-level forwarding tests. This is the mutation that proves
 *        the ownership test above is NOT pinned by the route alone: with the identity dropped the
 *        service sees no requester and exempts the caller as a system owner, so only an assertion
 *        on the FORWARDED ARGUMENT can see it.
 *
 * The two mutations are independent by construction — the service tests never call the route, and
 * the route tests mock the service — so one run attributes each, and neither neuter can cover the
 * other's failure.
 */
