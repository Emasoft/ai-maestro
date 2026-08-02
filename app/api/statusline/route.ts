/**
 * GET /api/statusline — the fleet-wide roll-up.
 *
 * TRDD-D8OYFG35. "How close is this host to its 5-hour limit?" is the question every agent actually
 * has, and no single session can answer it: each one observes the same shared account at a
 * different instant. This aggregates them.
 *
 * ⚠ THE ROLL-UP TAKES THE MAXIMUM, NOT THE NEWEST. Every session on this host bills one account, so
 * in principle they agree; they are sampled at different moments, so in practice they do not. When
 * two snapshots disagree the SAFE reading is the higher percentage — it is the one that says "you
 * are closer to the limit than you thought". Taking the newest instead would let one idle session's
 * stale-but-recently-written record understate a limit that a busy session had already seen climb.
 *
 * The aggregation itself — and the two ⚠ rules above, in full — lives in `lib/statusline-rollup.ts`,
 * because a Next.js route module may not export a non-config symbol (it fails `yarn build`, which
 * `tsc` does not catch). This file is the HTTP shell: auth, read, serialize.
 */
import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { listStatuslineSnapshots } from '@/lib/statusline-store'
import { rollUp } from '@/lib/statusline-rollup'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr
  return NextResponse.json(rollUp(await listStatuslineSnapshots()))
}
