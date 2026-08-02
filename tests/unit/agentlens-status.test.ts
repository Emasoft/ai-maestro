import { describe, it, expect } from 'vitest'
import {
  parseAgentlensStatus,
  deriveAccountHealthy,
} from '@/lib/agentlens-status'

// Fixture = the real shape of `agentlenspro get_account_status --full` captured on a live
// Max-20x subscription machine (2026-07-16). The window %s exceed 100 with windowSource
// "calibrated" — a deliberate case: calibrated is a proven LOWER bound and must NOT mark the
// account unhealthy.
const LIVE_CALIBRATED = JSON.stringify({
  // Redacted: the captured payload carried the owner's real address here while `account.email`
  // three lines down was already anonymised. A fixture is committed and pushed, so the live
  // capture must be scrubbed on the way in, not left because "it is only a summary string".
  summary: 'e@example.com · Max 20x · 5h 150% / 7d 166% (calibrated)',
  account: {
    accountId: '80ddbe47-7ad4-4af7-a381-cf908e33c916',
    email: 'e@example.com',
    billingType: 'stripe_subscription',
    rateLimitTier: 'default_claude_max_20x',
  },
  plan: 'Max 20x',
  mode: 'subscription (within plan)',
  cacheTtl: { minutes: 60, regime: 'subscription', ttlSource: 'doc-matrix' },
  usageWindows: { fiveHourPct: 149.4, sevenDayPct: 165.76, windowSource: 'calibrated' },
})

/**
 * THE CONTRACT TEST (TRDD-Y916N7WL). Its own card names this "the load-bearing invariant" and
 * required it red "on any AgentlensPro shape drift or any token-adjacent field" — and it was never
 * written, which is why that card sat in `testing` for 17 days looking finished.
 *
 * AgentlensPro is OUT of ai-maestro's trust boundary: this module only ever READS metadata, and
 * custody + rotation stay with the OAuth manager. The guard that makes that true is not a comment,
 * it is the assertion below that a credential in the CLI's output cannot reach our surface.
 */
describe('CONTRACT — the consumed surface can never carry a credential', () => {
  // Every field name a drifting/compromised AgentlensPro could plausibly add, each carrying a
  // sentinel we can then prove absent. Nested as well as top-level: a leak that only ever appeared
  // at the root would be caught by the key-set assertion alone, and the interesting case is the
  // one that rides INSIDE a block we do read.
  const SENTINEL = 'SENTINEL-CREDENTIAL-MUST-NOT-SURFACE'
  const HOSTILE = JSON.stringify({
    summary: 'acct · Max 20x',
    account: { accountId: 'a1', email: 'e@example.com', accessToken: SENTINEL, apiKey: SENTINEL },
    accessToken: SENTINEL,
    refreshToken: SENTINEL,
    sessionKey: SENTINEL,
    authorization: `Bearer ${SENTINEL}`,
    cookie: `sessionKey=${SENTINEL}`,
    cacheTtl: { minutes: 60, secret: SENTINEL },
    usageWindows: { fiveHourPct: 10, sevenDayPct: 20, windowSource: 'cc-rate-limits', token: SENTINEL },
  })

  it('drops every token-adjacent field the CLI offers', () => {
    // POSITIVE CONTROL FIRST: without this the assertion below passes on any input that simply
    // never contained a secret, which is the vacuous shape an absence check decays into.
    expect(HOSTILE).toContain(SENTINEL)

    const s = parseAgentlensStatus(HOSTILE)
    expect(JSON.stringify(s)).not.toContain(SENTINEL)
  })

  it('surfaces EXACTLY the six declared metadata fields — a seventh is how a credential arrives', () => {
    // Keyed on the KEY SET, not on the absence of known-bad names: a leak arrives under whatever
    // name upstream chooses, so enumerating bad names can only ever catch the ones we guessed.
    // This reds on any added field, which is the only formulation drift cannot walk around.
    expect(Object.keys(parseAgentlensStatus(HOSTILE)).sort()).toEqual([
      'accountHealthy', 'available', 'cacheTtlMinutes', 'window5hPct', 'window7dPct', 'windowSource',
    ])
  })

  it('reads the CANONICAL paths — a renamed upstream field degrades to null, never to a wrong value', () => {
    // Shape drift must fail SAFE. The danger is not a crash; it is silently reading some other
    // number and reporting it as the 5h window, which a continuity monitor would act on.
    const DRIFTED = JSON.stringify({
      account: { accountId: 'a1' },
      cacheTtl: { mins: 60 },                                   // was `minutes`
      usageWindows: { fiveHour: 10, sevenDay: 20, source: 'cc-rate-limits' }, // all renamed
    })
    const s = parseAgentlensStatus(DRIFTED)
    expect(s.window5hPct).toBeNull()
    expect(s.window7dPct).toBeNull()
    expect(s.cacheTtlMinutes).toBeNull()
    expect(s.windowSource).toBeNull()
  })
})

describe('parseAgentlensStatus', () => {
  it('maps the four observable fields from the live payload', () => {
    const s = parseAgentlensStatus(LIVE_CALIBRATED)
    expect(s.window5hPct).toBe(149.4)
    expect(s.window7dPct).toBe(165.76)
    expect(s.cacheTtlMinutes).toBe(60)
    expect(s.windowSource).toBe('calibrated')
    expect(s.available).toBe(true)
  })

  it('keeps accountHealthy true on a calibrated overage (>100% is a lower-bound estimate)', () => {
    // 5h 149% / 7d 166% but source is "calibrated" — not authoritative enough to declare dead.
    expect(parseAgentlensStatus(LIVE_CALIBRATED).accountHealthy).toBe(true)
  })

  it('marks accountHealthy false only when CC rate_limits shows a window exhausted', () => {
    const raw = JSON.stringify({
      account: { accountId: 'x' },
      cacheTtl: { minutes: 60 },
      usageWindows: { fiveHourPct: 100, sevenDayPct: 40, windowSource: 'cc-rate-limits' },
    })
    expect(parseAgentlensStatus(raw).accountHealthy).toBe(false)
  })

  it('reports unknown windows as null, never as 0', () => {
    const raw = JSON.stringify({
      account: { accountId: 'x' },
      cacheTtl: { minutes: 5 },
      usageWindows: { fiveHourPct: null, sevenDayPct: null, windowSource: 'none' },
    })
    const s = parseAgentlensStatus(raw)
    expect(s.window5hPct).toBeNull()
    expect(s.window7dPct).toBeNull()
    expect(s.cacheTtlMinutes).toBe(5)
    // account present, source not authoritative → still healthy
    expect(s.accountHealthy).toBe(true)
  })

  it('handles a missing usageWindows / cacheTtl block without throwing', () => {
    const s = parseAgentlensStatus(JSON.stringify({ account: { accountId: 'x' } }))
    expect(s.window5hPct).toBeNull()
    expect(s.window7dPct).toBeNull()
    expect(s.cacheTtlMinutes).toBeNull()
    expect(s.windowSource).toBeNull()
    expect(s.accountHealthy).toBe(true)
    expect(s.available).toBe(true)
  })

  it('marks accountHealthy false when no account is identified', () => {
    const raw = JSON.stringify({ usageWindows: { fiveHourPct: 10, windowSource: 'cc-rate-limits' } })
    expect(parseAgentlensStatus(raw).accountHealthy).toBe(false)
  })

  it('throws on malformed JSON (a real contract break, not an expected absence)', () => {
    expect(() => parseAgentlensStatus('not json {')).toThrow()
  })
})

describe('deriveAccountHealthy', () => {
  it('false when no account is identified', () => {
    expect(deriveAccountHealthy(false, 10, 10, 'cc-rate-limits')).toBe(false)
  })

  it('false only for cc-rate-limits with a window at/over 100%', () => {
    expect(deriveAccountHealthy(true, 100, 0, 'cc-rate-limits')).toBe(false)
    expect(deriveAccountHealthy(true, 0, 100, 'cc-rate-limits')).toBe(false)
    expect(deriveAccountHealthy(true, 99.9, 99.9, 'cc-rate-limits')).toBe(true)
  })

  it('true for a calibrated overage (lower-bound estimate never declares dead)', () => {
    expect(deriveAccountHealthy(true, 150, 166, 'calibrated')).toBe(true)
  })

  it('true for none/null window source (unknown is not unhealthy)', () => {
    expect(deriveAccountHealthy(true, null, null, 'none')).toBe(true)
    expect(deriveAccountHealthy(true, 200, 200, 'none')).toBe(true)
    expect(deriveAccountHealthy(true, null, null, null)).toBe(true)
  })

  it('true when cc-rate-limits pct is null (present source, unknown value)', () => {
    expect(deriveAccountHealthy(true, null, null, 'cc-rate-limits')).toBe(true)
  })
})
