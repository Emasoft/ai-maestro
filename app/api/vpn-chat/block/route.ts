/**
 * POST   /api/vpn-chat/block — Block a user (add to local blocklist).
 * DELETE /api/vpn-chat/block — Unblock a user (remove from local blocklist).
 *
 * The blocklist is LOCAL only — never synced to mesh peers.
 * The blocked user is never notified.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addBlock, removeBlock, getBlocklist } from '@/lib/vpn-chat-log'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

const BlockSchema = z.object({
  /** The user identifier to block/unblock: `<userName>@<hostId>` */
  userId: z.string().min(1).max(256),
}).strict()

// GET /api/vpn-chat/block — List all blocked users
export async function GET(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const blocked = getBlocklist()
    return NextResponse.json({ blocked }, { status: 200 })
  } catch (error) {
    console.error('[vpn-chat/block] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to get blocklist: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}

// POST /api/vpn-chat/block — Block a user
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = BlockSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    addBlock(parsed.data.userId)
    return NextResponse.json({ ok: true, blocked: parsed.data.userId }, { status: 200 })
  } catch (error) {
    console.error('[vpn-chat/block] POST failed:', error)
    return NextResponse.json(
      { error: `Failed to block user: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}

// DELETE /api/vpn-chat/block — Unblock a user
export async function DELETE(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = BlockSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          issues: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      )
    }

    removeBlock(parsed.data.userId)
    return NextResponse.json({ ok: true, unblocked: parsed.data.userId }, { status: 200 })
  } catch (error) {
    console.error('[vpn-chat/block] DELETE failed:', error)
    return NextResponse.json(
      { error: `Failed to unblock user: ${(error as Error).message}` },
      { status: 500 },
    )
  }
}
