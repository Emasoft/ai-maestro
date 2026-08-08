/**
 * The statusline observation feed — OUR type, not Claude Code's and not AgentlensPro's.
 *
 * TRDD-D8OYFG35. Claude Code hands its `statusLine` command a JSON payload on stdin that already
 * contains the 5-hour and 7-day rate-limit windows, at ZERO API cost ("The status line runs locally
 * and does not consume API tokens"). We were making up to 420 calls/hour to `/api/oauth/usage` for
 * numbers that arrive free on a pipe. This module defines what we keep.
 *
 * WHY OUR OWN TYPE AND NOT A THIRD PARTY'S SHAPE. An earlier draft of the card proposed feeding
 * `lib/agentlens-status.ts`'s shape. The USER dropped it (2026-08-01: "agentlens also has hooks
 * that monitor everything, ignore them"), and the reason generalises: coupling fleet-wide telemetry
 * to a third-party plugin's interface makes that plugin's hooks a dependency of ours. Nothing here
 * reads, writes, or imports any agentlens contract.
 *
 * WHY `source` IS ON THE WINDOW AND NOT ONLY ON THE RECORD. The 5h/7d windows can arrive from two
 * places with different freshness and different cost — this feed (free, every few seconds) and
 * `/api/oauth/usage` (an API call, and the ONLY source of the model-scoped weekly windows,
 * `severity`, `is_active`). A consumer that cannot tell them apart cannot decide whether it is
 * looking at a number worth re-fetching. So the discriminator travels WITH the number.
 */

/** Which feed produced a rate-limit number. */
export type StatuslineWindowSource = 'statusline' | 'endpoint' | 'agentlens'

/**
 * One rate-limit window.
 *
 * ⚠ `resetsAtMs` IS EPOCH MILLISECONDS, ALWAYS. The wire formats disagree — this feed sends UNIX
 * EPOCH SECONDS (`1738425600`) while `/api/oauth/usage` sends ISO 8601
 * (`2026-08-05T16:00:00.517432+00:00`), and Claude Code itself CHANGED this field from ISO to epoch
 * in v2.1.138. Normalisation happens ONCE, at the ingest boundary
 * (`lib/statusline-normalize.ts::toEpochMs`), so that no consumer ever has to ask which format it
 * is holding. A store that accepts both formats is a store whose timestamps cannot be compared.
 */
export interface StatuslineRateWindow {
  /** 0-100. Percentage of the window consumed. */
  usedPercentage: number
  /** Epoch MILLISECONDS when the window resets; null when the feed omitted or malformed it. */
  resetsAtMs: number | null
  source: StatuslineWindowSource
}

/**
 * The two windows this feed carries — and ONLY these two.
 *
 * The model-scoped weekly windows (the separate Fable 5 limit) are NOT in the statusline payload
 * (`grep -ic "weekly_scoped|model-scoped|seven_day_opus"` → 0). They remain endpoint-only. Do not
 * add fields here for numbers this feed cannot supply: a null that is structurally unreachable
 * reads to the next author as "we lost it", not "it was never offered".
 */
export interface StatuslineRateLimits {
  fiveHour: StatuslineRateWindow | null
  sevenDay: StatuslineRateWindow | null
}

/** Repository identity, parsed by Claude Code from the `origin` remote. */
export interface StatuslineRepo {
  host: string | null
  owner: string | null
  name: string | null
}

/** The open pull request Claude Code has associated with the session, if any. */
export interface StatuslinePr {
  number: number | null
  url: string | null
  reviewState: string | null
}

/**
 * Per-session facts the fleet has no other cheap source for. Every field is nullable because the
 * payload is a MOVING TARGET: fields have been added and changed across Claude Code versions, and a
 * required field is how one absent key turns a whole observation into a rejected one.
 */
export interface StatuslineSessionFacts {
  modelId: string | null
  modelDisplayName: string | null
  /** Set only when the session runs under `--agent`; this is how a snapshot maps to a fleet agent. */
  agentName: string | null
  sessionName: string | null
  version: string | null
  /** `low` | `medium` | `high` | `xhigh` | `max` — kept as a string; the enum is Claude Code's. */
  effortLevel: string | null
  fastMode: boolean | null
  outputStyle: string | null
  cwd: string | null
  projectDir: string | null
  gitWorktree: string | null
  repo: StatuslineRepo | null
  transcriptPath: string | null
  pr: StatuslinePr | null
}

/** Context-window occupancy, pre-computed by Claude Code. */
export interface StatuslineContextWindow {
  contextWindowSize: number | null
  usedPercentage: number | null
  remainingPercentage: number | null
  totalInputTokens: number | null
  totalOutputTokens: number | null
  exceeds200kTokens: boolean | null
}

/** Session cost + duration, computed client-side by Claude Code. */
export interface StatuslineCost {
  totalCostUsd: number | null
  totalDurationMs: number | null
  totalApiDurationMs: number | null
  totalLinesAdded: number | null
  totalLinesRemoved: number | null
}

/**
 * One stored observation, keyed by `sessionId`.
 *
 * ⚠ THE TOP-LEVEL KEY SET IS FIXED, AND THAT IS LOAD-BEARING. The store writes through
 * `lib/json-io.ts::updateJson`, whose key-loss tripwire refuses a mutation that drops a TOP-LEVEL
 * key. Nesting the optional parts (`context`, `cost`, `session`) under always-present keys means a
 * payload that omits a whole section writes `null` rather than deleting a key — so an ingest can
 * never be refused for the crime of describing a session that has no PR. `STATUSLINE_SNAPSHOT_KEYS`
 * below pins the set so a future field addition is a deliberate act.
 */
export interface StatuslineSnapshot {
  sessionId: string
  /** Epoch ms at which the SERVER received this observation (not when Claude Code produced it). */
  capturedAt: number
  source: StatuslineWindowSource
  rateLimits: StatuslineRateLimits
  session: StatuslineSessionFacts
  context: StatuslineContextWindow | null
  cost: StatuslineCost | null
  /**
   * WHICH ACCOUNT WAS LIVE WHEN THIS OBSERVATION ARRIVED — the rotator's `state.live_fp`, stamped
   * SERVER-SIDE at ingest. Null when no rotator state exists, or when it could not be read.
   *
   * ⚠ READ THAT SENTENCE LITERALLY. It is *not* "which account produced this report", and the
   * difference decides what the guard in `lib/statusline-admissible.ts` can honestly claim. The
   * payload carries no account identity (`grep -c 'account\|email\|token'` over the statusline
   * fields → nothing usable), and there is no way to learn one: a Claude Code session holds its
   * credential in memory and never tells us which. So the strongest true statement the server can
   * make is about ITS OWN clock — who was live at arrival.
   *
   * That is enough for the failure this exists to prevent (TRDD-SIV45HOG): reports that arrived
   * BEFORE a switch carry the OLD fingerprint, so the rotator can discard them instead of
   * attributing an exhausted account's ~98% to the fresh one and rotating straight back out — a
   * loop that burns every remaining account in minutes while the log reads like healthy rotation.
   *
   * It is NOT enough for the residual case, and pretending otherwise is how a vacuous guard ships:
   * a session still running on the OLD credential immediately after a switch posts a report that
   * arrives AFTER the switch, so it is stamped with the NEW fingerprint and passes both guards.
   * That window is bounded (the session picks up the new credential or its token expires) and is
   * the honest limit of a server-side stamp.
   */
  liveFp: string | null
}

/**
 * The eight top-level keys of a stored snapshot, in write order.
 *
 * Exported so the store's test can assert that every one is written on EVERY write — the property
 * that keeps `updateJson`'s key-loss tripwire from ever firing on a legitimate payload. Adding a
 * field to the interface WITHOUT adding it here writes a snapshot the store silently drops; adding
 * it here without writing it trips the tripwire. The pair is deliberate friction.
 */
export const STATUSLINE_SNAPSHOT_KEYS = [
  'sessionId',
  'capturedAt',
  'source',
  'rateLimits',
  'session',
  'context',
  'cost',
  'liveFp',
] as const

/** The fleet-wide roll-up served by `GET /api/statusline`. */
export interface StatuslineRollup {
  /** How many snapshots were considered FRESH enough to contribute to `rateLimits`. */
  freshSessions: number
  totalSessions: number
  /**
   * The TIGHTEST window across the fresh snapshots (highest `usedPercentage`).
   *
   * Every session on this host bills the same account, so in principle they agree. They are sampled
   * at different instants, so in practice they do not — and when they disagree the SAFE reading is
   * the highest, because it is the one that says "you are closer to the limit than you think".
   */
  rateLimits: StatuslineRateLimits
  sessions: StatuslineSnapshot[]
}
