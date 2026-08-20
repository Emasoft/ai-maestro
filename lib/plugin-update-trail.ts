/**
 * Per-invocation plugin-update trail (TRDD-MNN0VAS6).
 *
 * The janitor attributes interrupted extractions from a last-run-only summary, which
 * cannot see earlier fires — this store records ONE ROW PER `claude plugin update`
 * INVOCATION: {target, scope, project, start_epoch, end_epoch, ok, detail}. Rows are
 * appended per EVENT (never per poll — a polled bounded log evicts its own signal;
 * an event log only grows when something happened, so the cap holds real history).
 *
 * Single writer by construction: the only appender runs inside withMarketplaceLock,
 * so a plain append + occasional rewrite-trim needs no second lock. Reader is
 * lenient PER ROW (a torn tail line is skipped, never the whole file discarded) —
 * but the WRITE path never rebuilds from a blind read, so corruption cannot cascade.
 */
import fs from 'fs'
import path from 'path'
import { statePath } from '@/lib/ecosystem-constants'

export interface UpdateTrailRow {
  target: string
  scope: string
  project: string
  start_epoch: number
  end_epoch: number
  ok: boolean
  detail: string
  by: string
}

const TRAIL_FILE = () => statePath('plugin-update-trail.jsonl')
const MAX_LINES = 1000
const TRIM_TO = 500

export function appendUpdateTrailRow(row: UpdateTrailRow): void {
  const file = TRAIL_FILE()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    if (lines.length > MAX_LINES) {
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, lines.slice(-TRIM_TO).join('\n') + '\n', 'utf8')
      fs.renameSync(tmp, file)
    }
  } catch {
    // Trim is best-effort; the append already landed. Never let housekeeping
    // convert a recorded event into a lost one.
  }
}

/** Newest-first. `target` filters exactly on the plugin id. */
export function readUpdateTrail(opts: { limit?: number; target?: string } = {}): UpdateTrailRow[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, TRIM_TO))
  let raw: string
  try {
    raw = fs.readFileSync(TRAIL_FILE(), 'utf8')
  } catch {
    return [] // legal absence — no sweep has recorded yet
  }
  const rows: UpdateTrailRow[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r.target === 'string') rows.push(r)
    } catch {
      // torn tail line from a crash mid-append — skip the ROW, keep the file
    }
  }
  const filtered = opts.target ? rows.filter((r) => r.target === opts.target) : rows
  return filtered.slice(-limit).reverse()
}
