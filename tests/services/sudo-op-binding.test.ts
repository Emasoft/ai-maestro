/**
 * TRDD-XTIOLWJH — regression test for op-bound sudo tokens on every strict
 * route reached via sudoFetch.
 *
 * SCEN-016 BUG-001: op-bound sudo tokens permanently 403'd
 * `PATCH /api/agents/[id]` because the dispatcher route passed a "logical
 * tag" (`/api/agents/[id]/title`) to `requireSudoToken` that DIFFERED from
 * the template the client's real request URL (`/api/agents/<id>`) normalizes
 * to at mint time (`matchedEntryKey`). Unbound tokens skip the op-check
 * entirely, so pre-existing tests all passed; nothing exercised the
 * op-bound mint -> verify round-trip against these routes.
 *
 * The invariant under test: `mint-time-normalized-template ===
 * verify-time-checked-template`. For every (method, guardTemplate) pair a
 * real route passes to `requireSudoToken`, this:
 *   1. Builds a representative literal browser URL for that route (the
 *      shape `sudoFetch`'s `deriveOperation()` would send to the mint
 *      route).
 *   2. Mirrors the mint route's own normalization
 *      (`app/api/auth/sudo-password/route.ts`): resolve the literal URL to
 *      its registry entry via `matchedEntryKey`, strip the `METHOD_` prefix
 *      to get the bound template, and mint a token bound to it.
 *   3. Consumes that token against the EXACT (method, template) the route's
 *      own `requireSudoToken(request, method, template)` call site uses.
 *
 * A regression (e.g. re-introducing a mismatched logical tag on any of
 * these routes) fails this test with `operation_mismatch` — the precise
 * BUG-001 signature — before it ever reaches a live 403 in the UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (declared before importing the module under test) ──────────────────
// Mirrors tests/lib/sudo-auth.test.ts — issueSudoToken verifies the
// governance password via argon2 + loadGovernance; stub both so the test
// doesn't need a real password hash on disk.
const mockVerifyPasswordAuto = vi.fn<(hash: string, pw: string) => Promise<boolean>>()
vi.mock('@/lib/argon2', () => ({
  verifyPasswordAuto: (...args: [string, string]) => mockVerifyPasswordAuto(...args),
}))

const mockLoadGovernance = vi.fn<() => { passwordHash?: string }>()
vi.mock('@/lib/governance', () => ({
  loadGovernance: () => mockLoadGovernance(),
  isUserAuthorityModelEnabled: () => false,
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ sessionAuth: { sudoTokenTtlSeconds: 60, sessionTtlDays: 7 } }),
}))

import { issueSudoToken, verifyAndConsumeSudoToken } from '@/lib/sudo-auth'
import { matchedEntryKey } from '@/lib/security-registry'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadGovernance.mockReturnValue({ passwordHash: 'argon2$stub' })
  mockVerifyPasswordAuto.mockResolvedValue(true)
})

/**
 * The real (method, guardTemplate) pairs every strict route passes to
 * `requireSudoToken` — verified against the live call sites in app/api/.
 * `literalPath` is the representative literal browser URL sudoFetch's
 * deriveOperation() would send for that route (dynamic [id] segments
 * replaced with a concrete example id).
 */
const STRICT_ROUTE_PAIRS: { method: string; guardTemplate: string; literalPath: string }[] = [
  { method: 'PATCH', guardTemplate: '/api/settings/auto-update', literalPath: '/api/settings/auto-update' },
  { method: 'POST', guardTemplate: '/api/settings/auto-update/run', literalPath: '/api/settings/auto-update/run' },
  { method: 'PATCH', guardTemplate: '/api/settings/security', literalPath: '/api/settings/security' },
  { method: 'DELETE', guardTemplate: '/api/settings/marketplaces', literalPath: '/api/settings/marketplaces' },
  { method: 'POST', guardTemplate: '/api/agents/role-plugins/install', literalPath: '/api/agents/role-plugins/install' },
  { method: 'DELETE', guardTemplate: '/api/agents/role-plugins/install', literalPath: '/api/agents/role-plugins/install' },
  { method: 'DELETE', guardTemplate: '/api/agents/role-plugins', literalPath: '/api/agents/role-plugins' },
  { method: 'POST', guardTemplate: '/api/agents/cemetery', literalPath: '/api/agents/cemetery' },
  { method: 'DELETE', guardTemplate: '/api/agents/cemetery', literalPath: '/api/agents/cemetery' },
  // TRDD-XTIOLWJH's own named priority routes:
  { method: 'POST', guardTemplate: '/api/agents/[id]/transfer', literalPath: '/api/agents/abc12345/transfer' },
  { method: 'PATCH', guardTemplate: '/api/agents/[id]', literalPath: '/api/agents/abc12345' },
  { method: 'DELETE', guardTemplate: '/api/agents/[id]', literalPath: '/api/agents/abc12345' },
  { method: 'POST', guardTemplate: '/api/agents/[id]/ensure-core', literalPath: '/api/agents/abc12345/ensure-core' },
  { method: 'DELETE', guardTemplate: '/api/agents/[id]/session', literalPath: '/api/agents/abc12345/session' },
  { method: 'POST', guardTemplate: '/api/agents/import', literalPath: '/api/agents/import' },
  { method: 'POST', guardTemplate: '/api/agents/foreign-approvals/[id]/reject', literalPath: '/api/agents/foreign-approvals/abc12345/reject' },
  { method: 'POST', guardTemplate: '/api/agents/foreign-approvals/[id]/approve', literalPath: '/api/agents/foreign-approvals/abc12345/approve' },
  { method: 'POST', guardTemplate: '/api/system/aid-recover', literalPath: '/api/system/aid-recover' },
  { method: 'POST', guardTemplate: '/api/sessions/[id]/stop', literalPath: '/api/sessions/my-agent/stop' },
  { method: 'POST', guardTemplate: '/api/sessions/[id]/restart', literalPath: '/api/sessions/my-agent/restart' },
  { method: 'POST', guardTemplate: '/api/sessions/[id]/kill', literalPath: '/api/sessions/my-agent/kill' },
  { method: 'DELETE', guardTemplate: '/api/sessions/[id]', literalPath: '/api/sessions/my-agent' },
  { method: 'PUT', guardTemplate: '/api/teams/[id]', literalPath: '/api/teams/abc12345' },
  { method: 'DELETE', guardTemplate: '/api/teams/[id]', literalPath: '/api/teams/abc12345' },
  { method: 'PUT', guardTemplate: '/api/teams/[id]/orchestrator', literalPath: '/api/teams/abc12345/orchestrator' },
  { method: 'DELETE', guardTemplate: '/api/teams/[id]/orchestrator', literalPath: '/api/teams/abc12345/orchestrator' },
  { method: 'POST', guardTemplate: '/api/governance/password', literalPath: '/api/governance/password' },
  { method: 'POST', guardTemplate: '/api/governance/maestro-delegate', literalPath: '/api/governance/maestro-delegate' },
  { method: 'DELETE', guardTemplate: '/api/governance/maestro-delegate', literalPath: '/api/governance/maestro-delegate' },
]

describe('TRDD-XTIOLWJH — sudo op-binding mint->verify round-trip', () => {
  it.each(STRICT_ROUTE_PAIRS)(
    '$method $literalPath mints and verifies against guard template $guardTemplate',
    async ({ method, guardTemplate, literalPath }) => {
      // Step 1+2: mirror app/api/auth/sudo-password/route.ts's own
      // normalization of the literal browser URL sudoFetch sends.
      const key = matchedEntryKey(method, literalPath)
      expect(key, `matchedEntryKey(${method}, ${literalPath}) resolved to no strict entry`).not.toBeNull()
      const mintedTemplate = key!.slice(method.toUpperCase().length + 1)

      // Assertion (1): the registry's matched entry's stripped template must
      // equal the template the route itself passes to requireSudoToken.
      expect(mintedTemplate).toBe(guardTemplate)

      const { token } = await issueSudoToken('pw', 'system-owner', { method, path: mintedTemplate })

      // Step 3: consume exactly as the route's own requireSudoToken call
      // would — against ITS hard-coded (method, guardTemplate).
      const result = verifyAndConsumeSudoToken(token, {
        operation: { method, path: guardTemplate },
        acceptSubject: () => true,
      })

      // Assertion (2): must NOT be the BUG-001 signature.
      if (!result.ok) {
        expect(result.reason).not.toBe('operation_mismatch')
      }
      expect(result.ok).toBe(true)
    }
  )
})
