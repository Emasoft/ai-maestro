import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AGENTLENS_NPM_PKG } from '@/lib/ecosystem-constants'

const execFileAsync = promisify(execFile)

// The observe-only metadata source for the continuity `status` verb (TRDD-Y916N7WL, NPT of
// TRDD-KCRMSNL7). AgentlensPro is OUT of the R16 trust boundary (TRDD-H24DF6ZC): it emits NO
// OAuth token material — `accountInfo.ts:10-13` routes the keychain blob through the
// `parseSubscriptionType` choke-point that extracts only the plan string and drops the token,
// and it has no rotation capability at all. So this reader can never surface a credential; it
// consumes account/window/cache METADATA only, mapped to four of the five `status` fields.
// The 5th field — `next_action` — is computed by the OAuth manager (TRDD-1GGQ4HWY) from the
// cascade state, NOT here.

/** The four OBSERVABLE fields of the continuity `status` contract (the 5th, `next_action`,
 *  belongs to the OAuth manager). Field names/paths are pinned by AgentlensPro's CI-locked
 *  contract (AgentlensPro#3 / #2). */
export interface AgentlensStatusMetadata {
  /** true when an account is identified AND not definitively rate-limited per Claude Code's
   *  OWN rate_limits snapshot. A `calibrated` or `none` window source can never mark the
   *  account unhealthy — calibrated is a proven LOWER bound (it legitimately reads >100%
   *  without the account being dead) and `none` is unknown. The definitive switch trigger is
   *  429 detection (TRDD-9ZIF82HI), not this coarse observable. */
  accountHealthy: boolean
  /** 5-hour rate-limit window utilization %, or null when unknown. Per the contract a null is
   *  NEVER presented as 0 — an unknown window and a fresh window are different facts. */
  window5hPct: number | null
  /** 7-day rate-limit window utilization %, or null when unknown. */
  window7dPct: number | null
  /** prompt-cache TTL in minutes the MAIN session actually rides (60 on a subscription,
   *  5 on usage-credits/API), or null when unknown. */
  cacheTtlMinutes: number | null
  /** provenance of the window %s: `cc-rate-limits` (CC's own snapshot — authoritative),
   *  `calibrated` (AgentlensPro lower-bound estimate), or `none`/null (unknown). */
  windowSource: string | null
  /** false when the AgentlensPro CLI is not installed or did not answer this tick. The
   *  installer is fail-soft, and the CLI is explicitly fail-open, so absence is an EXPECTED,
   *  non-fatal state for a continuity monitor — we report honest nulls, never fake values and
   *  never a crash. */
  available: boolean
}

const UNAVAILABLE: AgentlensStatusMetadata = {
  accountHealthy: false,
  window5hPct: null,
  window7dPct: null,
  cacheTtlMinutes: null,
  windowSource: null,
  available: false,
}

const CLI_TIMEOUT_MS = 10_000
const CLI_MAX_BUFFER = 4 * 1024 * 1024

// Only Claude Code's own rate_limits snapshot is authoritative enough to declare an account
// exhausted. Kept as a separate pure export so the health rule is unit-testable in isolation
// and there is ONE place that decides it.
export function deriveAccountHealthy(
  hasAccount: boolean,
  window5hPct: number | null,
  window7dPct: number | null,
  windowSource: string | null,
): boolean {
  if (!hasAccount) return false
  if (windowSource === 'cc-rate-limits') {
    const fiveExhausted = window5hPct !== null && window5hPct >= 100
    const sevenExhausted = window7dPct !== null && window7dPct >= 100
    if (fiveExhausted || sevenExhausted) return false
  }
  return true
}

// Pure parse of the raw `get_account_status --full` JSON into the four status fields. Kept
// separate from the exec so it is unit-testable from a fixture with no CLI/network. Throws on
// malformed JSON: AgentlensPro's payload shape is CI-locked on their side, so a parse failure
// is a REAL contract break to surface (fail-fast on the unexpected), not the expected-absent
// case that `readAgentlensStatus` handles by returning `available: false`.
export function parseAgentlensStatus(raw: string): AgentlensStatusMetadata {
  const data = JSON.parse(raw) as {
    account?: { accountId?: string } | null
    cacheTtl?: { minutes?: number | null } | null
    usageWindows?: {
      fiveHourPct?: number | null
      sevenDayPct?: number | null
      windowSource?: string | null
    } | null
  }

  const win = data.usageWindows ?? {}
  const window5hPct = typeof win.fiveHourPct === 'number' ? win.fiveHourPct : null
  const window7dPct = typeof win.sevenDayPct === 'number' ? win.sevenDayPct : null
  const windowSource = typeof win.windowSource === 'string' ? win.windowSource : null
  const cacheTtlMinutes =
    typeof data.cacheTtl?.minutes === 'number' ? data.cacheTtl.minutes : null
  const hasAccount = Boolean(data.account?.accountId)

  return {
    accountHealthy: deriveAccountHealthy(hasAccount, window5hPct, window7dPct, windowSource),
    window5hPct,
    window7dPct,
    cacheTtlMinutes,
    windowSource,
    available: true,
  }
}

// Read the four observable continuity-status fields from the AgentlensPro CLI. `--full` prints
// the unshaped payload as pure JSON on stdout (no digest text, no token material — R16). A
// missing CLI (ENOENT), a timeout, or a non-zero exit all resolve to UNAVAILABLE rather than
// throwing: a continuity monitor must degrade to "observability unavailable this tick", not
// crash the server, when its fail-open observability dependency hiccups. A malformed payload
// from a PRESENT CLI still throws (via parseAgentlensStatus) because that is a real contract
// break, not an expected absence.
export async function readAgentlensStatus(): Promise<AgentlensStatusMetadata> {
  let stdout: string
  try {
    const result = await execFileAsync(AGENTLENS_NPM_PKG, ['get_account_status', '--full'], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_BUFFER,
    })
    stdout = result.stdout
  } catch {
    return UNAVAILABLE
  }
  return parseAgentlensStatus(stdout)
}
