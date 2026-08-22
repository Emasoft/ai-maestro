import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-R268J32X — POST /api/settings/global-elements/convert-skill is SYSTEM-OWNER only.
 *
 * It shipped with `enforceAuth`, whose own docstring is for mutations where "any authenticated
 * caller can call this". Traced end to end, that policy let any authenticated agent of any title:
 *
 *   • name a GitHub URL as `source` — `convertElements`
 *     (`services/cross-client-conversion-service.ts:26`) parses it and calls
 *     `downloadGitHubRepo(...)`, so the SERVER fetches a repo the CALLER chose;
 *   • pass `scope: 'user'` — `lib/converter/convert.ts:209-212` returns `process.env.HOME` as the
 *     write root, and `:171` writes the converted files under it;
 *   • pass `force` to overwrite, and an arbitrary `projectDir` for the project scope.
 *
 * Converted skills/agents/instructions are PROMPT CONTENT that Claude Code loads, so the
 * composition is: remote content → the owner's home directory → loaded as instructions.
 *
 * WHY enforceSystemOwner RATHER THAN A NEW authorize() ACTION. Every other mutating route under
 * `app/api/settings/**` is already `enforceSystemOwner` or `requireSudoToken` — including the
 * sibling in the SAME directory, `global-elements/install-skill`. Installing a skill globally
 * required the owner while CONVERTING one into the same place did not: the TRDD-DQVPODKW shape,
 * where siblings hold the strong guard and the one reaching furthest got the weak one. Matching
 * the subtree needs no new governance vocabulary; `authorize()` has no verb for this and adding
 * one would be a governance change rather than a fix.
 *
 * SAFE FOR THE UI, VERIFIED RATHER THAN ASSUMED. `components/settings/ConvertButton.tsx` calls
 * this with a plain same-origin fetch and no Bearer header. The positive control is empirical:
 * `components/settings/GlobalElementsSection.tsx` — the same settings UI — already calls
 * `settings/global-plugins` (enforceSystemOwner) and `settings/marketplaces` (enforceSystemOwner
 * + requireSudoToken) successfully, because a cookie session resolves to the system owner
 * (`lib/agent-auth`: "Valid session cookie (aim_session) → system owner (web UI)").
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The conversion service must never be reached on a refused call — a 403 returned after the
// server has already fetched a repo and written under $HOME is not a refusal.
const mockConvert = vi.fn()
vi.mock('@/services/cross-client-conversion-service', () => ({
  convertElements: (...a: unknown[]) => mockConvert(...a),
  getConversionCapabilities: vi.fn(async () => ({ supportedElements: [], warnings: [] })),
}))

function req(body: unknown) {
  return new Request('http://localhost/api/settings/global-elements/convert-skill', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  }) as never
}

// A payload that would be accepted on the far side of the gate: a remote source, user scope, force.
const HOSTILE = {
  source: 'https://github.com/someone/whatever',
  targetClient: 'codex',
  scope: 'user',
  force: true,
}

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

describe('TRDD-R268J32X — convert-skill is owner-only', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockConvert.mockReset()
    mockConvert.mockResolvedValue({ ok: true, files: [] })
  })

  it('refuses a MEMBER — an authenticated agent may not write converted elements under $HOME', async () => {
    /** Validates that authentication no longer stands in for owner authority on a $HOME-writing route */
    mockAuthenticate.mockReturnValue(MEMBER)
    const { POST } = await import('@/app/api/settings/global-elements/convert-skill/route')
    const res = await POST(req(HOSTILE))

    expect(res.status).toBe(403)
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('refuses even a MANAGER — this is owner authority, not a governance title', async () => {
    /** Validates the guard is enforceSystemOwner and not a title check, which would still admit agents */
    mockAuthenticate.mockReturnValue(MANAGER)
    const { POST } = await import('@/app/api/settings/global-elements/convert-skill/route')
    const res = await POST(req(HOSTILE))

    expect(res.status).toBe(403)
    expect(mockConvert).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the system owner is NOT refused by the gate', async () => {
    /** Validates the gate can say yes, so the refusals above are a decision and not a blanket 403 */
    mockAuthenticate.mockReturnValue(OWNER)
    const { POST } = await import('@/app/api/settings/global-elements/convert-skill/route')
    const res = await POST(req(HOSTILE))

    // What happens after the gate is not this file's subject; being stopped BY it is.
    expect(res.status).not.toBe(403)
  })
})

/**
 * NEUTER RUN (2026-08-22 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(authErr\) return authErr/if (false) return authErr/ if $. == 52
 *   → 2 red / 1 green:
 *       refuses a MEMBER — an authenticated agent may not write converted elements under $HOME
 *       refuses even a MANAGER — this is owner authority, not a governance title
 *
 * Predicted 2, observed 2, and the POSITIVE CONTROL correctly stayed green — which is the half
 * that matters here. A gate that refuses everyone would satisfy both denials, so without a control
 * proving the owner still gets through, "2 red" would be equally consistent with having broken the
 * route for its only legitimate caller.
 *
 * The line anchor is required: this file spells `if (authErr) return authErr` in both POST and GET,
 * so an unanchored mutation would disable the GET guard too and the red count would be about code
 * these three tests do not exercise.
 */
