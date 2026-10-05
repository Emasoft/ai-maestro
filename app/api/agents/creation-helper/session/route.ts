/**
 * Creation Helper Session API
 *
 * POST   /api/agents/creation-helper/session - Start creation helper agent
 * DELETE /api/agents/creation-helper/session - Kill creation helper agent
 * GET    /api/agents/creation-helper/session - Check creation helper status
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  createCreationHelper,
  deleteCreationHelper,
  getCreationHelperStatus,
} from '@/services/creation-helper-service'
import { enforceSystemOwner } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Owner's wizard: its chat and raw-materials are already owner-only, so starting/stopping/probing it is too.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const result = await createCreationHelper()
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[CreationHelper] POST session error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  // Owner's wizard: its chat and raw-materials are already owner-only, so starting/stopping/probing it is too.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const result = await deleteCreationHelper()
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[CreationHelper] DELETE session error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  // Owner's wizard: its chat and raw-materials are already owner-only, so starting/stopping/probing it is too.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const result = await getCreationHelperStatus()
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[CreationHelper] GET session error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
