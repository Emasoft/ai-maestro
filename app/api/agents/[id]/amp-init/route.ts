/**
 * POST /api/agents/[id]/amp-init
 *
 * Re-run `amp-init.sh --force` for an existing agent to (re)provision its
 * AMP identity (Ed25519 keypair + per-agent AMP home directory). Intended as
 * the recovery path when CreateAgent G12 failed (ampIdentityMissing flag set)
 * or when the user manually rotates the agent's identity.
 *
 * The caller must be the system owner, or the MANAGER acting on ANOTHER
 * agent. Self-init is rejected for every title, MANAGER included: an agent's
 * Ed25519 keypair is the sharpest piece of configuration it has (re-minting
 * silently invalidates every signature its peers trust), and under
 * TRDD-D3RP7KQZ an agent may drive its own surface but never reconfigure
 * itself. This comment used to CLAIM self-init was rejected while the guard
 * below only fired for cross-agent callers — TRDD-YEE33F3A closed that gap.
 *
 * On success: clears ampIdentityMissing flag in the registry and returns
 * 200 with the new fingerprint. On failure: returns 500 with the amp-init
 * stderr slice and leaves the flag as-is.
 */

import { NextRequest, NextResponse } from 'next/server'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { getAgent, updateAgent } from '@/lib/agent-registry'
import { isManager } from '@/lib/governance'
import type { UpdateAgentRequest } from '@/types/agent'

const execFileAsync = promisify(execFile)

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    // Authorization in two tighten-only steps (TRDD-YEE33F3A Part 2).
    //
    // Step 1 — the matrix. `authorize('modify-agent')` supplies three denials
    // the previous hand-rolled `isManager` check silently lacked:
    //   - SELF: `modify-agent` is not self-drive, so an agent re-minting its
    //     OWN keys is refused — the old guard only fired when
    //     `auth.agentId !== id`, inverting this route's documented contract.
    //   - a model-ON non-maestro USER principal ({ userId, no agentId }) is
    //     denied by the M1/U1 branch — the old guard skipped it entirely,
    //     letting an ordinary user re-mint any agent's keys.
    //   - fail-closed on an errored auth result.
    const decision = authorize(auth, 'modify-agent', id)
    if (!decision.allowed) {
      return NextResponse.json(
        { error: decision.reason || 'Not authorized to re-initialize this agent\'s AMP identity' },
        { status: 403 },
      )
    }
    // Step 2 — narrow the matrix. `modify-agent` would also grant the
    // target's own COS; this route stays system-owner-or-MANAGER because key
    // rotation invalidates every signature the fleet trusts from this agent —
    // an identity operation, not team coordination (same reasoning that made
    // `export-agent` owner-only). This branch can only DENY, never widen.
    if (auth.agentId && !isManager(auth.agentId)) {
      return NextResponse.json(
        { error: 'Only the system owner or MANAGER can re-initialize an agent\'s AMP identity' },
        { status: 403 },
      )
    }

    const agent = getAgent(id)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const HOME = process.env.HOME || ''
    const ampInitPath = join(HOME, '.local', 'bin', 'amp-init.sh')
    if (!existsSync(ampInitPath)) {
      return NextResponse.json(
        {
          error: `amp-init.sh not found at ${ampInitPath}. Install the AMP CLI via ./install-messaging.sh first.`,
        },
        { status: 500 },
      )
    }

    const tenant = process.env.AIMAESTRO_ORG || 'default'
    const ampEnvDir = join(HOME, '.agent-messaging', 'agents', agent.name)
    const args = ['--force', '--name', agent.name, '--tenant', tenant]

    try {
      const { stdout, stderr } = await execFileAsync(ampInitPath, args, {
        timeout: 30000,
        cwd: agent.workingDirectory || HOME,
        env: { ...process.env, AMP_DIR: ampEnvDir },
      })

      // Success: clear the ampIdentityMissing flag.
      //
      // Below the AIO line (R21.4 documentation): single boolean flag flip
      // on a derived/diagnostic field. ampIdentityMissing is set by the
      // server itself when an agent's AMP folder is missing on disk; this
      // route is the recovery path that runs `amp-init`, so clearing the
      // flag here mirrors a state observation, not a governance-relevant
      // mutation. A dedicated ChangeAMPIdentity AIO would wrap this in a
      // proper gate sequence — tracked as out-of-scope follow-up in
      // TRDD-ef0c6c0a.
      try {
        await updateAgent(id, { ampIdentityMissing: false } as UpdateAgentRequest)
      } catch (regErr) {
        // Non-fatal — the init succeeded even if the registry update failed.
        console.warn('[amp-init route] Failed to clear ampIdentityMissing flag:', regErr)
      }

      return NextResponse.json({
        success: true,
        agentId: id,
        name: agent.name,
        tenant,
        stdout: stdout.slice(0, 1000),
        stderr: stderr ? stderr.slice(0, 500) : undefined,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stderr = typeof err === 'object' && err !== null && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr)
        : ''
      return NextResponse.json(
        {
          error: `amp-init failed: ${msg.slice(0, 300)}`,
          stderr: stderr.slice(0, 500),
        },
        { status: 500 },
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Unexpected error: ${msg}` }, { status: 500 })
  }
}
