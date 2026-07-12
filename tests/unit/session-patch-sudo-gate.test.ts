/**
 * SECURITY REGRESSION (#54, TRDD-ED9A4VVY) — the arbitrary-`command` branch of
 * `PATCH /api/agents/[id]/session` types unconstrained text into a live agent's
 * tmux pane and must be sudo-gated, exactly like the deferred `queue` route.
 *
 * The gate is CONDITIONAL by design: only the arbitrary branch calls
 * requireSudoToken. The curated `commandKey` allowlist branch is exempt (its
 * allowlist is the security boundary) so chat keystrokes / curated controls are
 * unaffected — that is the "don't blanket-strict the route" caution.
 *
 * These handler-level tests prove the WIRING (which branch calls the guard).
 * The real guard/registry/mint-verify wiring is covered by
 * sudo-op-binding.test.ts and sudo-guard-strict-agent-coverage.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { NextResponse } from 'next/server'

const { mockRouteAuth, mockGuard, mockCore, mockCommands } = vi.hoisted(() => ({
  mockRouteAuth: { requireAuth: vi.fn(), enforceAuth: vi.fn() },
  mockGuard: { requireSudoToken: vi.fn() },
  mockCore: {
    sendAgentSessionCommand: vi.fn(),
    getAgentSessionStatus: vi.fn(),
    linkAgentSession: vi.fn(),
    unlinkOrDeleteAgentSession: vi.fn(),
  },
  mockCommands: {
    getAgentCommand: vi.fn(),
    agentCommandKeys: vi.fn(() => ['approve', 'compact']),
  },
}))

vi.mock('@/lib/route-auth', () => mockRouteAuth)
vi.mock('@/lib/sudo-guard', () => mockGuard)
vi.mock('@/services/agents-core-service', () => mockCore)
vi.mock('@/lib/agent-commands', () => mockCommands)
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: vi.fn(),
  buildAuthContext: vi.fn(),
}))
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))

import { PATCH } from '@/app/api/agents/[id]/session/route'
import { NextRequest } from 'next/server'

const AGENT = '00000000-0000-0000-0000-000000000001'

function patch(body: Record<string, unknown>) {
  const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${AGENT}/session`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } as never)
  return PATCH(req, { params: Promise.resolve({ id: AGENT }) } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Authenticated (system-owner) by default — the auth layer is not what #54 is about.
  mockRouteAuth.requireAuth.mockReturnValue({ ok: true, context: { isSystemOwner: true } })
  mockCore.sendAgentSessionCommand.mockResolvedValue({ data: { success: true } })
})

describe('#54 — the arbitrary-command branch is sudo-gated', () => {
  it('arbitrary `command` with NO sudo token is refused, and nothing is sent', async () => {
    // The real guard returns a 403 sudo_required for a USER with no token.
    mockGuard.requireSudoToken.mockReturnValue(
      NextResponse.json({ error: 'sudo_required' }, { status: 403 }),
    )
    const res = await patch({ command: 'rm -rf ~' })
    expect(res.status).toBe(403)
    // The guard was consulted for the exact route template.
    expect(mockGuard.requireSudoToken).toHaveBeenCalledWith(
      expect.anything(),
      'PATCH',
      '/api/agents/[id]/session',
    )
    // Fail closed — the dangerous primitive never ran.
    expect(mockCore.sendAgentSessionCommand).not.toHaveBeenCalled()
  })

  it('arbitrary `command` WITH a valid sudo token proceeds to the service', async () => {
    mockGuard.requireSudoToken.mockReturnValue(null) // guard passed
    const res = await patch({ command: 'ls -la' })
    expect(res.status).toBe(200)
    expect(mockGuard.requireSudoToken).toHaveBeenCalledTimes(1)
    expect(mockCore.sendAgentSessionCommand).toHaveBeenCalledTimes(1)
  })
})

describe('#54 — the curated commandKey branch stays open (no sudo)', () => {
  it('a known commandKey never calls the sudo guard and still sends', async () => {
    mockCommands.getAgentCommand.mockReturnValue({ command: '/compact', requiresIdle: true })
    const res = await patch({ commandKey: 'compact' })
    expect(res.status).toBe(200)
    // The whole point: the allowlist path is exempt from the sudo gate.
    expect(mockGuard.requireSudoToken).not.toHaveBeenCalled()
    expect(mockCore.sendAgentSessionCommand).toHaveBeenCalledTimes(1)
  })

  it('an unknown commandKey is rejected 400 BEFORE any gate or send', async () => {
    mockCommands.getAgentCommand.mockReturnValue(undefined)
    const res = await patch({ commandKey: 'nope' })
    expect(res.status).toBe(400)
    expect(mockGuard.requireSudoToken).not.toHaveBeenCalled()
    expect(mockCore.sendAgentSessionCommand).not.toHaveBeenCalled()
  })
})

describe('#54 — static wiring invariants', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'agents', '[id]', 'session', 'route.ts'),
    'utf-8',
  )
  // Strip comments so we assert on the CODE, not the explanation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the PATCH handler calls requireSudoToken for this exact route', () => {
    expect(code).toMatch(/requireSudoToken\(\s*request\s*,\s*'PATCH'\s*,\s*'\/api\/agents\/\[id\]\/session'\s*\)/)
  })

  it('the gate lives on the else (arbitrary) branch, after the commandKey check', () => {
    // Target the CALL site (`requireSudoToken(request`), not the top-of-file
    // import (`import { requireSudoToken }`).
    const keyIdx = code.indexOf('if (typeof body.commandKey')
    const sudoCallIdx = code.indexOf('requireSudoToken(request')
    expect(keyIdx).toBeGreaterThan(-1)
    expect(sudoCallIdx).toBeGreaterThan(-1)
    // The guard call appears AFTER the commandKey branch opens (it's in its else).
    expect(sudoCallIdx).toBeGreaterThan(keyIdx)
    expect(code).toContain('} else {')
  })
})
