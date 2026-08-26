import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { getExportJobStatus, deleteExportJob } from '@/services/config-service'

// Force dynamic -- reads runtime job state
export const dynamic = 'force-dynamic'

/**
 * GET /api/export/jobs/[jobId]
 * Get status of a specific export job.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // TRDD-R268J32X: the GET had NO auth while its own DELETE sibling below did, so an
  // unauthenticated caller who guessed a job id learned agentId / agentName / sessionId and the
  // on-disk `filePath` of the export. Same class as the `sessions/restore` GET (fixed in
  // d6f78e2b, "unauthenticated in BOTH modes"). Authenticate the READ too: a status payload
  // naming agents and disk paths is not public data.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { jobId } = await params

    const result = getExportJobStatus(jobId)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[ExportJobs] GET error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/export/jobs/[jobId]
 * Cancel or delete an export job.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { jobId } = await params

    const result = deleteExportJob(jobId)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[ExportJobs] DELETE error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
