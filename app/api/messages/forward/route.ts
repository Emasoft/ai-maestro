import { NextRequest, NextResponse } from 'next/server'
import { forwardMessage } from '@/services/messages-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

// CC-P1-412: Wrap request.json() in try/catch for malformed JSON
export async function POST(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  try {
    const result = await forwardMessage(body)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Forward] Error:', error)
    return NextResponse.json({ error: 'Failed to forward message' }, { status: 500 })
  }
}
