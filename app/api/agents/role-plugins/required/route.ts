import { NextRequest, NextResponse } from 'next/server'
import { getRequiredPluginForTitle } from '@/services/role-plugin-service'

// Force dynamic rendering — governance data can change at any time
export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/role-plugins/required?title=manager
 * Returns the required role-plugin for a governance title, or null if any is allowed.
 */
export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get('title')
  if (!title) {
    return NextResponse.json({ error: 'title parameter required' }, { status: 400 })
  }

  try {
    const required = await getRequiredPluginForTitle(title)
    return NextResponse.json({ title, requiredPlugin: required })
  } catch (error) {
    console.error('[role-plugins/required] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
