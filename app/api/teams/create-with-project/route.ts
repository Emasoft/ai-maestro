import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createNewTeam, type CreateTeamProgress } from '@/services/teams-service'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

export const dynamic = 'force-dynamic'

const safeOwnerRepo = /^[a-zA-Z0-9_.-]+$/

const CreateWithProjectSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  // code-review F2: this route used to gate SOLELY on this in-body password
  // via verifyPassword() -- the exact "any agent that knows the governance
  // password string can create a team" bypass TRDD-1LX5LMBD closed for the
  // sibling POST /api/teams (which is strict + STRICT_AGENT_RULES
  // 'manage-team'). Kept OPTIONAL and UNVALIDATED-BUT-IGNORED (same
  // treatment as `governancePassword` in app/api/teams/route.ts) so an
  // older client that still sends it gets a normal 200/403 from the sudo
  // gate below instead of a schema-validation 400.
  password: z.string().max(256).optional(),
  githubProject: z.object({
    owner: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    // Optional: absent = org/user-level board (browse-only kanban) — ai-maestro#133.
    repo: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-').optional(),
    number: z.number().int().min(1),
  }).strict().optional(),
  chiefOfStaffId: z.string().uuid().optional(),
  orchestratorId: z.string().uuid().optional(),
}).strict()

// POST /api/teams/create-with-project
export async function POST(request: NextRequest) {
  // R28/R29/R38: forward the verified caller so createNewTeam's MANAGER-RBAC
  // gate fires. Previously enforceAuth discarded the identity, so the team was
  // created with NO requestingAgentId — the gate (which 403s a non-MANAGER
  // agent) was skipped entirely. The system owner (web UI, password-verified
  // below) passes as isSystemOwner.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  // code-review F2: strict-route gate, at parity with POST /api/teams
  // (TRDD-1LX5LMBD). For a USER/web-UI caller this requires a fresh sudo
  // token (the UI must call this route via sudoFetch); for an AGENT caller
  // it runs authorize('manage-team') -- MANAGER-only, matching R9.1. This
  // REPLACES the ad-hoc in-body `password` check below, which let ANY
  // caller who merely knew the governance password string create a team.
  const sudoErr = requireSudoToken(request, 'POST', '/api/teams/create-with-project')
  if (sudoErr) return sudoErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = CreateWithProjectSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const body = parsed.data

    // The whole create, as one closure, so the JSON path and the SSE path run
    // BYTE-IDENTICAL work and can never drift into two behaviours (TRDD-AGHPMRVI).
    // `onProgress` narrates; it never decides anything.
    const run = async (onProgress?: CreateTeamProgress): Promise<{ status: number; payload: unknown }> => {
      // Delegate to createNewTeam — the All-In-One function that handles:
      // - MANAGER existence check
      // - COS validation (must be AUTONOMOUS) or auto-creation
      // - Auto-MEMBER titling for all team agents
      // - Orchestrator assignment
      const result = await createNewTeam({
        name: body.name.trim(),
        description: body.description?.trim(),
        chiefOfStaffId: body.chiefOfStaffId,
        orchestratorId: body.orchestratorId,
        requestingAgentId: auth.agentId,
        authContext: auth.context,
      }, onProgress)

      if (result.error) {
        return { status: result.status || 500, payload: { error: result.error } }
      }

      // Guard: data must exist after error check passes (ServiceResult contract)
      if (!result.data?.team) {
        return { status: 500, payload: { error: 'Team creation returned no data' } }
      }

      const team = result.data.team

      // Post-creation: GitHub project linking (not part of createNewTeam).
      // This stage is emitted HERE and not by the service because the service is
      // never told about this route's githubProject — the linking is the route's
      // own work, so only the route can narrate it.
      if (body.githubProject) {
        onProgress?.('Linking GitHub project')
        // Zod schema already validated owner/repo/number format and shell-injection safety
        const { updateTeam } = await import('@/lib/team-registry')
        await updateTeam(team.id, { githubProject: body.githubProject })

        // Configure GitHub project template
        try {
          const { configureProjectTemplate } = await import('@/lib/github-cli')
          const fieldIds = configureProjectTemplate(
            body.githubProject.owner,
            body.githubProject.number
          )
          console.log('[create-with-project] Project template configured with field IDs:', Object.keys(fieldIds))
        } catch (err) {
          // Non-fatal — project template can be configured later
          console.warn('[create-with-project] Failed to configure project template:', err)
        }
      }

      return {
        status: 201,
        payload: { team, message: `Team "${team.name}" created successfully` },
      }
    }

    // A caller that did not ASK for a stream gets exactly the response it got
    // before this route learned to stream. Every non-browser caller (scripts,
    // tests, agents, the headless router's own path) is in this branch.
    if (!request.headers.get('accept')?.includes('text/event-stream')) {
      const { status, payload } = await run()
      return NextResponse.json(payload, { status })
    }

    // SSE path. The status line is already 200 by the time the first event is
    // written, so the OUTCOME — including a failure — rides in the final event
    // and the client reads it from there, never from `res.ok`. This is safe for
    // the sudo 403 retry loop because requireSudoToken ran above, before any
    // byte of the stream existed.
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const send = (event: unknown) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // The client went away mid-create. The create itself continues to
            // completion — abandoning it half-done is how a host ends up with
            // a team and no chief-of-staff.
            closed = true
          }
        }
        try {
          const { status, payload } = await run((s: string) => send({ stage: s }))
          send({ done: true, status, payload })
        } catch (error) {
          console.error('[create-with-project] Error (stream):', error)
          send({ done: true, status: 500, payload: { error: 'Failed to create team' } })
        } finally {
          if (!closed) { try { controller.close() } catch { /* already closed */ } }
        }
      },
    })
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        // no-transform tells any proxy not to buffer or rewrite the body —
        // without it a staged status can arrive as one lump at the end, which
        // looks exactly like the hang this card exists to remove.
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })

  } catch (error) {
    console.error('[create-with-project] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    )
  }
}
