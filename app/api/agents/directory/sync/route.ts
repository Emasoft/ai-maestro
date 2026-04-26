/**
 * Agent Directory Sync API
 *
 * POST /api/agents/directory/sync
 *   Triggers a directory sync with peer hosts
 *
 * Thin wrapper — business logic in services/agents-directory-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { syncDirectory } from '@/services/agents-directory-service'

export async function POST(request: NextRequest) {
  // #114: System-owner only — blocks agent tokens.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const result = await syncDirectory()
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status ?? 500 })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-017: Outer try-catch for unhandled service throws
    console.error('[Directory Sync POST] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
