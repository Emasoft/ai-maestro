import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW item 10 — `POST /api/agents/role-plugins/sync-defaults` is
 * system-owner only.
 *
 * THE RULING: "any authenticated caller may re-assert defaults" is NOT intended.
 * `syncDefaultRolePlugins` → `migrateDefaultPluginSettings` executes with implicit
 * system authority — it passes `{isSystemOwner: true}` into DeleteMarketplace and
 * rewrites the user's global settings plus EVERY agent's settings.local.json — and
 * its own docstring says "Authority: implicit system-owner". Its claimed
 * server-startup caller does not exist (measured 2026-08-26): the route and its
 * headless twin are the only invokers, so the gate at the route is what makes the
 * service's authority model true instead of forged.
 *
 * WHY NON-SYSTEM-OWNER FIXTURES: buildAuthContext derives isSystemOwner from
 * `!agentId` (legacy semantics), so the MEMBER fixture carries an agentId and the
 * positive control carries none.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The service must never run on a denied call — it registers a marketplace via
// the claude CLI and rewrites settings on disk.
const mockSync = vi.fn()
vi.mock('@/services/role-plugin-service', () => ({
  syncDefaultRolePlugins: (...a: unknown[]) => mockSync(...a),
}))

function req() {
  // Plain Request lacks NextRequest's `nextUrl`; the handler reads ?force off it
  // after the gate, so the positive control needs it present.
  const r = new Request('http://localhost/api/agents/role-plugins/sync-defaults', {
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
  })
  return Object.assign(r, { nextUrl: new URL(r.url) }) as never
}

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const WEB_OWNER = { userId: 'user-1' } // no agentId ⇒ system owner under legacy semantics

describe('TRDD-DQVPODKW — sync-defaults is system-owner only', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockSync.mockReset()
    mockSync.mockResolvedValue({ synced: [], skipped: [], errors: [], available: [] })
  })

  it('refuses an authenticated AGENT — the fleet-wide settings rewrite is not agent-callable', async () => {
    /** Validates the implicit-system-authority service is unreachable by any agent token */
    mockAuthenticate.mockReturnValue(MEMBER)
    const { POST } = await import('@/app/api/agents/role-plugins/sync-defaults/route')
    const res = await POST(req() as never)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(String(body.error)).toMatch(/system owner only/i)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the system-owner web session is NOT refused', async () => {
    /** Validates the gate can say yes, so the denial above is a decision and not a blanket refusal */
    mockAuthenticate.mockReturnValue(WEB_OWNER)
    const { POST } = await import('@/app/api/agents/role-plugins/sync-defaults/route')
    const res = await POST(req() as never)

    expect(res.status).not.toBe(403)
    expect(mockSync).toHaveBeenCalled()
  })
})

/**
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(authErr\) return authErr/if (false) return authErr/   [sync-defaults/route.ts]
 *   → 1 red / 1 green, exactly as predicted:
 *       RED: refuses an authenticated AGENT — the fleet-wide settings rewrite is not agent-callable
 *       green: the positive control (a disabled gate refuses nobody)
 */
