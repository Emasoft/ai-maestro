import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'
import { listArchive } from '@/lib/janitor-status-archive'

// Never statically generated: the archive gains entries at runtime, and Next's full route cache
// would freeze the listing into a build-time snapshot that permanently reports the archive empty.
export const dynamic = 'force-dynamic'

/**
 * GET /api/janitor/reports
 *
 * The preserved janitor global-status documents, newest first. Metadata only — the documents
 * themselves are served one at a time by `[name]/route.ts`, because they run to tens of megabytes
 * and nobody wants the whole archive in one response.
 *
 * Authenticated for the same reason the hibernation roster is: these documents name every running
 * claude instance on the host with its pid, project path, branch and repo. That is a map of the
 * machine, not public data.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    const entries = listArchive()
    return NextResponse.json({ entries, count: entries.length }, { status: 200 })
  } catch (error) {
    return internalError(error, 'Janitor reports GET')
  }
}
