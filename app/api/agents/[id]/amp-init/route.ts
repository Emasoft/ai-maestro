/**
 * POST /api/agents/[id]/amp-init
 *
 * Re-run `amp-init.sh --force` for an existing agent to (re)provision its
 * AMP identity (Ed25519 keypair + per-agent AMP home directory). Intended as
 * the recovery path when CreateAgent G12 failed (ampIdentityMissing flag set)
 * or when the user manually rotates the agent's identity.
 *
 * Identity auth only — the caller must be the system owner or the MANAGER.
 * Per-agent self-init is rejected to prevent agents from re-minting their own
 * identity and impersonating siblings.
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

    // Authorization: only user (no agentId) or MANAGER can re-init another
    // agent's AMP identity. Regular agents cannot re-mint keys for anyone.
    if (auth.agentId && auth.agentId !== id) {
      const callerIsManager = isManager(auth.agentId)
      if (!callerIsManager) {
        return NextResponse.json(
          { error: 'Only the system owner or MANAGER can re-initialize an agent\'s AMP identity' },
          { status: 403 },
        )
      }
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

      // Success: clear the ampIdentityMissing flag
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
