/**
 * THE BOUNDARY. Claude Code's statusline payload in, our `StatuslineSnapshot` out.
 *
 * TRDD-D8OYFG35. Everything that knows the wire shape lives here, so the store, the routes and
 * every consumer downstream see exactly one vocabulary. Two properties are load-bearing:
 *
 * 1. **`resets_at` IS NORMALISED ONCE, HERE.** This feed sends UNIX EPOCH SECONDS
 *    (`1738425600`); `/api/oauth/usage` sends ISO 8601 (`2026-08-05T16:00:00.517432+00:00`); and
 *    Claude Code itself changed this field from ISO to epoch in v2.1.138, so a host mid-upgrade can
 *    genuinely emit either. If normalisation happened at each call site instead, the shared cache
 *    would silently hold two incompatible time formats and every comparison between them would be
 *    wrong by a factor of 1000 — a reset 20 minutes away would read as 55 years away.
 *
 * 2. **NOTHING HERE THROWS ON A MALFORMED FIELD.** The payload is a moving target across Claude
 *    Code versions. A normaliser that rejects the whole observation because one field changed shape
 *    turns a cosmetic upstream change into a total loss of telemetry. Every field degrades to
 *    `null` on its own; only a missing/invalid `session_id` — the KEY, without which the record
 *    cannot be stored or found — rejects the payload.
 */
import type {
  StatuslineContextWindow,
  StatuslineCost,
  StatuslinePr,
  StatuslineRateLimits,
  StatuslineRateWindow,
  StatuslineRepo,
  StatuslineSessionFacts,
  StatuslineSnapshot,
  StatuslineWindowSource,
} from '@/types/statusline'

/**
 * The seconds-vs-milliseconds discriminator.
 *
 * 1e11 SECONDS is the year 5138; 1e11 MILLISECONDS is 1973-03-03. So any plausible timestamp below
 * this threshold is seconds and any above it is milliseconds, and the two ranges cannot overlap for
 * a value that means "some time near now". Chosen rather than a digit count because a digit count
 * silently mis-classifies the moment the epoch gains a digit (2286-11-20 for seconds).
 */
export const EPOCH_SECONDS_MAX = 1e11

/**
 * A session id that is safe to use as a FILENAME.
 *
 * Deliberately excludes `.`, which makes `..` and any extension-smuggling structurally impossible
 * rather than merely filtered — this value becomes `~/.aimaestro/statusline-state/<id>.json` and a
 * traversal here is an arbitrary-file write. Claude Code session ids are UUIDs, so this is not a
 * narrowing anyone will notice.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function isValidStatuslineSessionId(v: unknown): v is string {
  return typeof v === 'string' && SESSION_ID_RE.test(v)
}

/**
 * Any of {epoch seconds, epoch ms, ISO 8601, numeric string} → epoch MILLISECONDS.
 *
 * Returns null for anything it cannot read, INCLUDING 0 and negative values: a rate-limit window
 * that resets at the epoch is not a time, it is a field the sender did not fill in, and passing it
 * through as `0` would make "resets in 56 years ago" a number consumers have to special-case.
 */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return value < EPOCH_SECONDS_MAX ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    // A bare numeric string is the same quantity as the number form — route it through the same
    // rule rather than through Date.parse, which reads "1738425600" as a YEAR in some engines.
    if (/^\d+(\.\d+)?$/.test(trimmed)) return toEpochMs(Number(trimmed))
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

/* ── small readers: each answers "is this field usable?" and never throws ────────────────────── */

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

/**
 * One `rate_limits.<window>` object → our window.
 *
 * `usedPercentage` is REQUIRED (a window with no percentage carries no information and would read
 * as 0% used — the most dangerous possible default for a limit gauge), and is clamped to 0-100
 * because a gauge is the one place an out-of-range number silently becomes a UI defect.
 */
export function normalizeWindow(raw: unknown, source: StatuslineWindowSource): StatuslineRateWindow | null {
  const o = obj(raw)
  if (!o) return null
  const used = num(o.used_percentage ?? o.usedPercentage)
  if (used === null) return null
  return {
    usedPercentage: Math.min(100, Math.max(0, used)),
    resetsAtMs: toEpochMs(o.resets_at ?? o.resetsAt),
    source,
  }
}

function normalizeRateLimits(raw: unknown, source: StatuslineWindowSource): StatuslineRateLimits {
  const o = obj(raw)
  return {
    fiveHour: normalizeWindow(o?.five_hour, source),
    sevenDay: normalizeWindow(o?.seven_day, source),
  }
}

function normalizeRepo(raw: unknown): StatuslineRepo | null {
  const o = obj(raw)
  if (!o) return null
  const repo = { host: str(o.host), owner: str(o.owner), name: str(o.name) }
  return repo.host || repo.owner || repo.name ? repo : null
}

function normalizePr(raw: unknown): StatuslinePr | null {
  const o = obj(raw)
  if (!o) return null
  const pr = { number: num(o.number), url: str(o.url), reviewState: str(o.review_state) }
  return pr.number !== null || pr.url ? pr : null
}

function normalizeSession(p: Record<string, unknown>): StatuslineSessionFacts {
  const model = obj(p.model)
  const workspace = obj(p.workspace)
  return {
    modelId: str(model?.id),
    modelDisplayName: str(model?.display_name),
    agentName: str(obj(p.agent)?.name),
    sessionName: str(p.session_name),
    version: str(p.version),
    effortLevel: str(obj(p.effort)?.level),
    fastMode: bool(p.fast_mode),
    outputStyle: str(obj(p.output_style)?.name),
    // `cwd` and `workspace.current_dir` carry the same value; prefer the top-level one and fall
    // back, so a payload from either side of the field's introduction still yields a directory.
    cwd: str(p.cwd) ?? str(workspace?.current_dir),
    projectDir: str(workspace?.project_dir),
    gitWorktree: str(workspace?.git_worktree),
    repo: normalizeRepo(workspace?.repo),
    transcriptPath: str(p.transcript_path),
    pr: normalizePr(p.pr),
  }
}

function normalizeContext(raw: unknown, exceeds: unknown): StatuslineContextWindow | null {
  const o = obj(raw)
  if (!o) return null
  return {
    contextWindowSize: num(o.context_window_size),
    usedPercentage: num(o.used_percentage),
    remainingPercentage: num(o.remaining_percentage),
    totalInputTokens: num(o.total_input_tokens),
    totalOutputTokens: num(o.total_output_tokens),
    exceeds200kTokens: bool(exceeds),
  }
}

function normalizeCost(raw: unknown): StatuslineCost | null {
  const o = obj(raw)
  if (!o) return null
  return {
    totalCostUsd: num(o.total_cost_usd),
    totalDurationMs: num(o.total_duration_ms),
    totalApiDurationMs: num(o.total_api_duration_ms),
    totalLinesAdded: num(o.total_lines_added),
    totalLinesRemoved: num(o.total_lines_removed),
  }
}

/**
 * The whole payload → a storable snapshot, or null when there is no usable `session_id`.
 *
 * Null is the ONLY rejection, and the caller turns it into a 400. Everything else degrades: see the
 * module header for why a strict normaliser is the wrong shape for a payload we do not own.
 */
export function normalizeStatuslinePayload(
  raw: unknown,
  opts: { now?: number; source?: StatuslineWindowSource } = {},
): StatuslineSnapshot | null {
  const p = obj(raw)
  if (!p) return null
  if (!isValidStatuslineSessionId(p.session_id)) return null

  const source = opts.source ?? 'statusline'
  return {
    sessionId: p.session_id,
    capturedAt: opts.now ?? Date.now(),
    source,
    rateLimits: normalizeRateLimits(p.rate_limits, source),
    session: normalizeSession(p),
    context: normalizeContext(p.context_window, p.exceeds_200k_tokens),
    cost: normalizeCost(p.cost),
  }
}
