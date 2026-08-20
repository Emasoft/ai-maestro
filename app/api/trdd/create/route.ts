/**
 * POST /api/trdd/create   (TRDD-40DYBI4T)
 *
 * Server-side TRDD minting — the highest-frequency board mutation, previously
 * hand-rolled by every plugin agent (wrong id alphabets, `ls`-glob collision
 * checks, typed timestamps: each a recorded fleet failure mode).
 *
 * NOT strict: authoring is Tier-0 EXEMPT intake (manager-approval-defaults §B).
 * The gate that matters is structural and lives in lib/trdd-create: a card whose
 * `min-approval-requirement` exceeds the AUTHENTICATED caller's authority lands in
 * proposals/ as `column: proposal` — the mandate rule enforced at mint, from the
 * VERIFIED title, never from a body field the caller could inflate.
 *
 * Body: { title, taskType, column?, minApproval?, parent?, npt?, eht?, body?, agentId? }
 * `agentId` selects WHICH project's design/ (default: the server's own repo),
 * exactly like GET /api/trdd.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { resolveDesignDir } from '@/lib/trdd-design-dir'
import { createTrdd } from '@/lib/trdd-create'
import { AUTHORITY_RANK } from '@/lib/trdd-vocabulary'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  const ctx = auth.context

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The author's authority comes from the VERIFIED identity — owner = 'user';
  // an agent's title maps onto the ladder, and any title without approval
  // authority (member, architect, integrator, …) is 'none'.
  const title = typeof ctx.governanceTitle === 'string' ? ctx.governanceTitle : ''
  const authorAuthority = ctx.isSystemOwner ? 'user' : (title in AUTHORITY_RANK ? title : 'none')
  let author = 'user'
  if (ctx.agentId) {
    const { getAgent } = await import('@/lib/agent-registry')
    author = getAgent(ctx.agentId)?.name ?? ctx.agentId
  }

  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined)
  const list = (k: string) => (Array.isArray(body[k]) ? (body[k] as unknown[]).filter((x): x is string => typeof x === 'string') : undefined)

  try {
    const designDir = resolveDesignDir(str('agentId') ?? null)
    const result = createTrdd(designDir, {
      title: str('title') ?? '',
      taskType: str('taskType') ?? '',
      column: str('column'),
      minApproval: str('minApproval'),
      authorAuthority,
      author,
      parent: str('parent'),
      npt: list('npt'),
      eht: list('eht'),
      body: str('body'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    // createTrdd throws only on caller mistakes (bad title/type/column) and the
    // one loud RNG backstop — 400 is right for all of them; nothing was written.
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 })
  }
}
