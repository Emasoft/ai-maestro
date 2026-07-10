import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { resolveDesignDir } from '@/lib/trdd-design-dir'
import { getKanbanIndex, KANBAN_INDEX_COLUMNS, UNKNOWN_COLUMN } from '@/lib/kanban-index'

/**
 * GET /api/trdd/kanban — the kanban index buffer for a project's TRDD corpus.
 *
 * The TRDDs ARE the kanban: a card is a TRDD, its column is that TRDD's `column:`,
 * its owner is that TRDD's `assignee:`. This serves a regenerable CACHE of that,
 * rebuilt whenever the corpus moves. There is deliberately no POST/PATCH here: a
 * card moves by editing its TRDD (and `git mv`-ing its folder), never by writing to
 * a mirror. Plan from this response; ACT from `row.filePath`.
 *
 * The response carries `generatedAt` and `fingerprint` rather than a `stale` flag —
 * a flag computed at response time is always `false` and tells the caller nothing.
 * The snapshot is true as of `generatedAt`; anything irreversible re-reads the file.
 *
 * No `fresh` parameter either: the buffer is bypassed automatically whenever the
 * corpus fingerprint moved, so forcing a rebuild could only ever return the same
 * bytes at the cost of a second scan.
 *
 * Query params: `agentId` — whose project's `design/` to index; default = the
 * server's own repo. Read-only ⇒ non-strict; any authenticated caller may read
 * (fleet-monitor surface).
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const designDir = resolveDesignDir(request.nextUrl.searchParams.get('agentId'))
  const index = getKanbanIndex(designDir, new Date().toISOString())

  return NextResponse.json({
    ...index,
    columns: KANBAN_INDEX_COLUMNS,
    unknownColumn: UNKNOWN_COLUMN,
  })
}
