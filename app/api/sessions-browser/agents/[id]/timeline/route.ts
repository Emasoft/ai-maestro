import { NextResponse } from 'next/server'
import { z } from 'zod'

import { hasValidSession } from '@/services/sessions-browser-service'
import { openTimeline } from '@/services/sessions-timeline-service'

export const dynamic = 'force-dynamic'

// Phase 6 — cross-file timeline manifest for the agent. Backwards
// compatible with the existing `/agents/:id/sessions` route — both live
// side-by-side through the dark-launch period.

const TimelineFileSchema = z.object({
  absPath: z.string(),
  sessionId: z.string(),
  kind: z.enum(['main', 'subagent', 'worktree-main', 'worktree-subagent']),
  laneId: z.string(),
  parentSessionId: z.string().nullable(),
  agentId: z.string().nullable(),
  slug: z.string().nullable(),
  size: z.number().int().nonnegative(),
  lastModified: z.string(),
})

const LaneSchema = z.object({
  laneId: z.string(),
  fileIndexes: z.array(z.number().int().nonnegative()),
  firstTimestampIso: z.string(),
  lastTimestampIso: z.string(),
  lineCount: z.number().int().nonnegative(),
})

const ManifestSchema = z.object({
  timelineId: z.string(),
  agentId: z.string(),
  files: z.array(TimelineFileSchema),
  totalLines: z.number().int().nonnegative(),
  projectDirs: z.array(z.string()),
  generatedAt: z.string(),
  lanes: z.array(LaneSchema),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasValidSession(request.headers.get('cookie'))) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const result = await openTimeline(id)
  if (!result.ok || !result.data) {
    return NextResponse.json(
      { error: result.error ?? 'internal_error' },
      { status: result.status ?? 500 },
    )
  }
  const validated = ManifestSchema.parse(result.data)
  return NextResponse.json(validated)
}
