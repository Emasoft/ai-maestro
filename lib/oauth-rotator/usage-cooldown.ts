// 429 back-off + TTL cache for the /usage probe (TRDD-W4T70Y3R, recipe credited to
// `Emasoft/ai-maestro#94` — AgentlensPro's measured rotation findings).
//
// WHY THIS EXISTS. `usageRequest` reads 429 as "this account is maxed" — a deliberate design,
// because that is what a quota 429 means for a rotation decision. The tick beats every 60 s, so
// a rate-limited account was re-asked ~60 times an hour, and #94 MEASURED that re-knocking
// RE-ARMS the lockout rather than queueing. Composed, those two facts make a transient throttle
// self-sustaining AND mislabel it: it presents not as a rate limit but as the account being full.
// `network.ts:22-26` already records the extreme version (a UA-banned 429 makes the live account
// look maxed and every alternate look unsafe in the same instant — nothing rotatable, nothing
// actually wrong).
//
// ⚠ THE TRAP THIS MODULE MUST NOT FALL INTO. A back-off that simply withholds the reading
// re-creates the very deadlock it fixes: if a cooling-down account reports "unknown", the tick
// cannot evaluate it and rotation stalls for a different reason. That is why the TTL CACHE is not
// a performance nicety but a correctness requirement — during a cooldown we serve the LAST KNOWN
// reading (flagged stale) so rotation keeps deciding on truth rather than going blind. #94 pairs
// the two for exactly this reason; do not keep one without the other.
//
// FAIL-OPEN, ALWAYS. Every read here is best-effort: an unreadable, corrupt, or absent state file
// means "no cooldown known" and the probe proceeds. This is a pure CACHE of regeneratable data —
// no knowledge lives here — so replacing a corrupt one loses nothing, which is what makes the
// usual "never overwrite a file you could not parse" rule inapplicable to this particular file.

import fs from 'node:fs'
import path from 'node:path'

import { globalStateDir } from './global-state'
import { withServerLock } from '../server-lockfile'

/** Distinct from the tick lock's name ON PURPOSE — a probe runs INSIDE a tick, which already
 *  holds `oauth-rotator-server-tick.lock`, so sharing the name would deadlock the tick against
 *  itself. */
const PROBE_LOCK_NAME = 'oauth-usage-probe.lock'

/** A probe is one HTTP call with a 20 s timeout. A lock held past this is a crashed holder. */
const PROBE_LOCK_STALE_MS = 60_000

/** #94's measured TTL. A reading older than this is not served even during a cooldown — at that
 *  age "unknown" is more honest than a stale utilization percent. */
export const USAGE_TTL_MS = 10 * 60_000

/** First back-off step, and the doubling cap. #94: 10 min → 2 h. */
export const BACKOFF_BASE_MS = 10 * 60_000
export const BACKOFF_CAP_MS = 2 * 60 * 60_000

/** Why a usage reading resolved the way it did. #94 recommends reporting this rather than
 *  re-deriving it downstream, which is what keeps a throttle from being read as an exhausted
 *  account after the fact. */
export type UsageReason =
  | 'fresh' // a live 200
  | 'cached' // served from the TTL cache while cooling down or contended
  | 'cooldown' // in back-off with no usable cache → unknown
  | 'quota_429' // a 429 we judge to mean the account really is maxed
  | 'throttle_429' // a 429 we judge to mean we asked too often / with a bad UA
  | 'lock_contended' // another process is probing; no usable cache
  | 'error' // network / parse / no token

export interface CooldownEntry {
  /** Consecutive 429s. Reset to 0 by any 200. Drives the exponential step. */
  consecutive429: number
  /** Epoch ms before which we must not probe again. */
  cooldownUntilMs: number
  /**
   * WHICH KIND of 429 armed this cooldown — and therefore what to report while it holds.
   *
   * ⚠ THIS FIELD IS LOAD-BEARING AND WAS ADDED BECAUSE A TEST CAUGHT ITS ABSENCE. Suppressing
   * the probe is not the same as suppressing the ANSWER. `autoRotate` requires TWO consecutive
   * 429s on the LIVE account before rotating away (`live_429_streak`), so a cooldown that
   * reported "unknown" for the second one meant the streak never reached 2 and the rotator could
   * never rotate off a maxed account — reintroducing the very deadlock this module exists to
   * remove, by a different route. A quota 429 is a STABLE FACT until the window resets, so while
   * cooling down we keep answering 429 from state WITHOUT re-hitting the network: the hammering
   * stops (the measured harm) and the rotation signal survives.
   */
  lastKind?: 'quota_429' | 'throttle_429'
  /** The last GOOD reading and when it was taken (epoch ms). */
  cachedAtMs?: number
  cachedData?: unknown
}

type CooldownFile = Record<string, CooldownEntry>

function statePath(): string {
  return path.join(globalStateDir(), 'oauth-usage-cooldown.json')
}

/** Best-effort read. Any failure ⇒ `{}` ⇒ no cooldown known ⇒ the probe proceeds (fail open). */
export function readCooldowns(): CooldownFile {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as unknown
    // `JSON.parse` succeeds for `42`, `null`, `[]` and `"str"` — none of which is a record, and
    // spreading one of those would produce a nonsense map. Check the SHAPE, not just the parse.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw as CooldownFile
  } catch {
    return {}
  }
}

/** Best-effort atomic-ish write. A failure is swallowed: losing the cooldown record degrades us
 *  to today's behaviour (probe every tick), which is strictly no worse than before this module. */
export function writeCooldowns(data: CooldownFile): void {
  try {
    const p = statePath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmp = `${p}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, p)
  } catch {
    // Non-fatal by design — see the module header's fail-open contract.
  }
}

/**
 * Parse `Retry-After`, which RFC 9110 allows in TWO encodings and servers use both of:
 * delta-seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`).
 * Returns an absolute epoch-ms deadline, or null when absent/unparseable.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  // Delta-seconds first: an all-digits value is unambiguous, and `Date.parse('120')` would
  // otherwise "succeed" by reading it as the YEAR 120.
  if (/^\d+$/.test(s)) return nowMs + Number(s) * 1000
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/**
 * Parse one `anthropic-ratelimit-*-reset` header, which is emitted as EITHER epoch seconds
 * (`"1793000000"`) or ISO 8601 (`"2026-08-05T10:00:00Z"`). Returns an epoch-ms instant.
 *
 * The all-digits branch is again load-bearing and for the same reason as above, plus one more:
 * these are epoch SECONDS, so a bare `Date.parse` would be wrong by a factor of 1000 even when
 * it parsed. Values are sanity-bounded — a plausible epoch-seconds reset is within a year — so a
 * millisecond value pasted into a seconds field cannot silently become a reset in the year 58000.
 */
export function parseResetHeader(value: string | null | undefined, nowMs: number): number | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const secs = Number(s)
    const asMs = secs * 1000
    const yearMs = 365 * 24 * 60 * 60_000
    if (asMs < nowMs - yearMs || asMs > nowMs + yearMs) return null
    return asMs
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

/** The reset headers #94 names, in their stated precedence. */
const RESET_HEADERS = [
  'anthropic-ratelimit-unified-reset',
  'anthropic-ratelimit-unified-5h-reset',
  'anthropic-ratelimit-requests-reset',
  'anthropic-ratelimit-tokens-reset',
]

/**
 * When the SERVER told us to come back. `Retry-After` wins, then the reset headers in order.
 * Returns null when the response named no instant — the caller then falls back to exponential.
 */
export function serverRetryAtMs(
  headers: Record<string, string> | undefined,
  nowMs: number,
): number | null {
  if (!headers) return null
  const ra = parseRetryAfter(headers['retry-after'], nowMs)
  if (ra !== null) return ra
  for (const h of RESET_HEADERS) {
    const t = parseResetHeader(headers[h], nowMs)
    if (t !== null) return t
  }
  return null
}

/** Exponential step for the Nth CONSECUTIVE 429 (1-based), doubling from base, capped. */
export function backoffMs(consecutive: number): number {
  const n = Math.max(1, consecutive)
  // 2**30 overflows nothing here but the cap makes large n irrelevant; clamp the exponent anyway
  // so a corrupted counter cannot produce Infinity and a permanent cooldown.
  const exp = Math.min(n - 1, 20)
  return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_CAP_MS)
}

/**
 * Decide what a 429 MEANS. This is the split the whole card exists for: collapsing the two is
 * what makes today's behaviour wrong, and a fix that adds back-off while keeping one
 * interpretation would still report a throttle as an exhausted account.
 *
 * The rule is deliberately CONSERVATIVE — it preserves today's meaning for the case the current
 * design was built for, and only reclassifies on positive evidence of throttling:
 *
 *   • the response NAMED a retry instant (`Retry-After` / a `*-reset` header) ⇒ the server is
 *     telling us to slow down. That is a throttle statement, not a quota statement;
 *   • we were ALREADY throttling and are still being 429'd ⇒ still a throttle;
 *   • otherwise ⇒ quota, i.e. today's meaning, unchanged.
 *
 * ⚠ A BARE REPEAT IS NOT EVIDENCE OF THROTTLING, and an earlier draft of this rule got that
 * wrong by escalating on `consecutiveBefore >= 1`. An account that is maxed STAYS maxed, so its
 * second header-less 429 is the same fact reported twice — reading that as a throttle would make
 * a genuinely exhausted account report "unknown", which is the precise mislabel inverted. The
 * only bare-repeat that escalates is one that FOLLOWS a throttle.
 *
 * What this rule deliberately does NOT do is guess a quota-vs-throttle discriminator from the
 * payload. Which 429s Anthropic emits for exhaustion versus rate limiting is an empirical
 * question about their API, and inventing a heuristic for it would be exactly the kind of
 * unobserved fix the two-UA note at the top of `network.ts` warns against. So a header-less
 * UA-ban 429 (janitor#117) still reads as "maxed" — what changes is that we stop RE-KNOCKING it
 * 60 times an hour, which is the harm #94 actually measured. The lockout then drains instead of
 * being continuously re-armed, rather than being correctly labelled by a guess.
 */
export function classify429(
  headers: Record<string, string> | undefined,
  prev: { lastKind?: 'quota_429' | 'throttle_429' } | undefined,
): 'quota_429' | 'throttle_429' {
  if (serverRetryAtMs(headers, Date.now()) !== null) return 'throttle_429'
  if (prev?.lastKind === 'throttle_429') return 'throttle_429'
  return 'quota_429'
}

/** Run `fn` under the cross-process probe lock. Returns null when another process holds it —
 *  the caller must then NOT fetch (that is the whole point of the lock). */
export async function withProbeLock<T>(fn: () => Promise<T>): Promise<T | null> {
  return withServerLock(PROBE_LOCK_NAME, PROBE_LOCK_STALE_MS, fn)
}
