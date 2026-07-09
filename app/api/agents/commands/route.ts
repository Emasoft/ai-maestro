import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { AGENT_COMMANDS } from '@/lib/agent-commands'

/**
 * GET /api/agents/commands — the curated slash-command allowlist that
 * `PATCH /api/agents/[id]/session` accepts as `{commandKey}`.
 *
 * Exists so a caller can DISCOVER the contract instead of probing for it. Before
 * this route the only way to learn the allowed keys was to send a deliberately
 * bogus key and parse the 400's "Allowed: …" message — a script that has to
 * provoke an error to read a constant is a script that breaks the day the error
 * text is reworded.
 *
 * Read-only over a compile-time constant ⇒ non-strict; any authenticated caller
 * may list it. A static segment shadows `[id]` in Next.js routing, which is safe
 * here because agent ids are UUIDs and can never be the literal "commands".
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  return NextResponse.json({
    count: AGENT_COMMANDS.length,
    commands: AGENT_COMMANDS.map((c) => ({
      key: c.key,
      label: c.label,
      command: c.command,
      description: c.description,
      requiresIdle: c.requiresIdle,
    })),
  })
}
