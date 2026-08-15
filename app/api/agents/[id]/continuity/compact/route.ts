import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'
import { getAgent } from '@/lib/agent-registry'
import { runExternalCompaction } from '@/lib/external-compaction'

/**
 * POST /api/agents/[id]/continuity/compact — externalized compaction for ONE agent
 * (TRDD-DSQUWKVI; USER directive 2026-08-15).
 *
 * Runs the janitor's ZERO-TURN shrink against that agent's workdir: a handoff composed from
 * on-disk facts (no model turn anywhere), then `/clear` plus the verified bootstrap chain typed
 * into the agent's own recorded pane. The sibling path — injecting
 * `/janitor-externalized-compaction` as a curated command — needs the agent's REPL to be
 * responsive to consume the keystroke; THIS one does not, which is the whole reason it exists:
 * a wedged agent is exactly when a shrink is needed.
 *
 * SUDO, unconditionally. The chain ends in `/clear`, and the composed handoff makes the session
 * RECOVERABLE, which is not the same as the clear being reversible. That is the same bar the
 * `clear` command key is held to (`PATCH /api/agents/[id]/session` gates every
 * `destructive: true` key), so the two ways to wipe an agent's context cannot disagree about
 * how hard it is to ask for.
 *
 * R42 self-only, matching the `ensure-resume` sibling: an AGENT may compact only ITSELF; the
 * human system owner may compact any agent (fleet management). Server-internal cross-agent
 * continuity work does not come through this verb.
 *
 * Body (all optional): `{ onResume?: boolean, dryRun?: boolean }`. There is deliberately no
 * `force`: `--force` relaxes two TRIGGER terms and cannot pass a safety veto, so exposing it
 * would advertise an override that does not exist.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // R42: agents act only on themselves; the human owner is exempt.
  if (!auth.context.isSystemOwner && auth.context.agentId !== id) {
    return NextResponse.json(
      { error: 'forbidden: an agent may compact only itself (R42)' },
      { status: 403 },
    )
  }

  const guard = requireSudoToken(request, 'POST', '/api/agents/[id]/continuity/compact')
  if (guard) return guard

  const agent = getAgent(id)
  if (!agent) {
    return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  }
  // The workdir IS the `--project-root`: it is where that agent's transcript, its
  // `.janitor/state/` (handoff + resume markers) and its recorded pane breadcrumb all live.
  // Without one there is nothing to compose a handoff FROM and nowhere to type the clear.
  const projectRoot = agent.workingDirectory
  if (!projectRoot) {
    return NextResponse.json(
      { error: 'agent has no workingDirectory — nothing to compact against' },
      { status: 409 },
    )
  }

  let body: { onResume?: unknown; dryRun?: unknown } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // An empty body is the common case (compact with defaults) — not an error.
  }

  const outcome = await runExternalCompaction({
    projectRoot,
    onResume: body.onResume === true,
    dryRun: body.dryRun === true,
  })

  // 200 for every VERDICT the script can legitimately reach, including its refusals: a HOLD on
  // `active-waiting` means a resume or a background agent is in flight, which is the design
  // WORKING. Returning 5xx there would get a correct refusal logged as an incident and retried.
  // Only a genuine inability to ask (no cached script, no stable interpreter, a spawn failure)
  // is a server-side fault.
  const status = outcome.status === 'unavailable' || outcome.status === 'error' ? 503 : 200
  return NextResponse.json(
    {
      fired: outcome.fired,
      status: outcome.status,
      ...(outcome.why ? { why: outcome.why } : {}),
      detail: outcome.line,
      agentId: id,
    },
    { status },
  )
}
