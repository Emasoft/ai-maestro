import { describe, it, expect } from 'vitest'
import {
  classify,
  cascadePlan,
  cascadeSummaryLine,
  CascadeLeg,
  DEFAULT_KEEPALIVE_AHEAD_H,
  DEFAULT_LOGIN_GRACE_DAYS,
  DEFAULT_MAX_REFRESH_FAILURES,
  type AccountState,
} from '@/lib/oauth-rotator/cascade'

// Faithful-port parity tests: each case pins one branch of the janitor
// cascade.py `classify`, at the exact boundaries, so a future edit that
// diverges from the Python SSOT is caught.

const base: AccountState = {
  email: 'a@x.com',
  isLive: false,
  hasRefresh: false,
  tokenExpiresH: null,
  hasSessionCookie: false,
}

describe('classify — live account', () => {
  it('a live account is always HEALTHY regardless of other fields', () => {
    // ROTATE owns the live account; the RENEW/REAUTH legs never touch it.
    expect(
      classify({ ...base, isLive: true, hasRefresh: false, tokenExpiresH: 0.01, refreshFailures: 99 }),
    ).toBe(CascadeLeg.HEALTHY)
  })
})

describe('classify — has refresh token', () => {
  it('dead refresh (failures >= max) WITH a session cookie → RENEW_COOKIE', () => {
    expect(
      classify({ ...base, hasRefresh: true, refreshFailures: 3, hasSessionCookie: true }),
    ).toBe(CascadeLeg.RENEW_COOKIE)
  })

  it('dead refresh (failures >= max) WITHOUT a cookie → REAUTH_NUDGE', () => {
    expect(
      classify({ ...base, hasRefresh: true, refreshFailures: 3, hasSessionCookie: false }),
    ).toBe(CascadeLeg.REAUTH_NUDGE)
  })

  it('failures exactly at max is the escalation boundary (>=)', () => {
    expect(classify({ ...base, hasRefresh: true, refreshFailures: 2, tokenExpiresH: 100 })).toBe(
      CascadeLeg.HEALTHY,
    )
    expect(classify({ ...base, hasRefresh: true, refreshFailures: 3, tokenExpiresH: 100 })).toBe(
      CascadeLeg.REAUTH_NUDGE,
    )
  })

  it('live refresh within the keepalive window → RENEW_REFRESH (<= boundary)', () => {
    expect(
      classify({ ...base, hasRefresh: true, tokenExpiresH: DEFAULT_KEEPALIVE_AHEAD_H }),
    ).toBe(CascadeLeg.RENEW_REFRESH)
    expect(classify({ ...base, hasRefresh: true, tokenExpiresH: 0.5 })).toBe(
      CascadeLeg.RENEW_REFRESH,
    )
  })

  it('live refresh with ample runway → HEALTHY', () => {
    expect(classify({ ...base, hasRefresh: true, tokenExpiresH: 100 })).toBe(CascadeLeg.HEALTHY)
  })

  it('live refresh with an undatable expiry (null) → HEALTHY (not within any window)', () => {
    expect(classify({ ...base, hasRefresh: true, tokenExpiresH: null })).toBe(CascadeLeg.HEALTHY)
  })

  it('refreshFailures defaults to 0 when omitted', () => {
    expect(classify({ ...base, hasRefresh: true, tokenExpiresH: 100 })).toBe(CascadeLeg.HEALTHY)
  })
})

describe('classify — no refresh token', () => {
  it('a live session cookie → RENEW_COOKIE (bootstrap can mint a slot)', () => {
    expect(classify({ ...base, hasRefresh: false, hasSessionCookie: true })).toBe(
      CascadeLeg.RENEW_COOKIE,
    )
  })

  it('no cookie + undatable token → REAUTH_NUDGE', () => {
    expect(classify({ ...base, tokenExpiresH: null })).toBe(CascadeLeg.REAUTH_NUDGE)
  })

  it('no cookie + token within login grace (days boundary) → REAUTH_NUDGE', () => {
    // tokenExpiresH 24h = 1.0 day == DEFAULT_LOGIN_GRACE_DAYS → nudge (<= boundary).
    expect(classify({ ...base, tokenExpiresH: 24 })).toBe(CascadeLeg.REAUTH_NUDGE)
  })

  it('no cookie + setup-token with runway beyond grace → WAIT_SETUP_TOKEN', () => {
    // 48h = 2.0 days > 1.0 grace → benign wait, never nudge.
    expect(classify({ ...base, tokenExpiresH: 48 })).toBe(CascadeLeg.WAIT_SETUP_TOKEN)
  })
})

describe('classify — option overrides', () => {
  it('honors a custom keepaliveAheadH', () => {
    expect(classify({ ...base, hasRefresh: true, tokenExpiresH: 5 }, { keepaliveAheadH: 6 })).toBe(
      CascadeLeg.RENEW_REFRESH,
    )
  })
  it('honors a custom loginGraceDays (a wider grace nudges sooner)', () => {
    // 48h = 2 days. At the default grace (1d) this WAITs; widen the grace to 3d
    // and the same token now falls within the nudge window (2.0 <= 3 → nudge).
    expect(classify({ ...base, tokenExpiresH: 48 })).toBe(CascadeLeg.WAIT_SETUP_TOKEN)
    expect(classify({ ...base, tokenExpiresH: 48 }, { loginGraceDays: 3 })).toBe(
      CascadeLeg.REAUTH_NUDGE,
    )
  })
  it('honors a custom maxRefreshFailures', () => {
    expect(
      classify(
        { ...base, hasRefresh: true, refreshFailures: 3, tokenExpiresH: 100 },
        { maxRefreshFailures: 5 },
      ),
    ).toBe(CascadeLeg.HEALTHY)
  })
})

describe('advisory defaults', () => {
  it('match the janitor cascade.py values', () => {
    expect(DEFAULT_KEEPALIVE_AHEAD_H).toBe(2.0)
    expect(DEFAULT_LOGIN_GRACE_DAYS).toBe(1.0)
    expect(DEFAULT_MAX_REFRESH_FAILURES).toBe(3)
  })
})

describe('cascadePlan', () => {
  it('buckets alternates by leg and sorts each bucket stably', () => {
    const plan = cascadePlan([
      { ...base, email: 'live@x.com', isLive: true },
      { ...base, email: 'z@x.com', hasRefresh: true, tokenExpiresH: 1 }, // renew_refresh
      { ...base, email: 'a@x.com', hasRefresh: true, tokenExpiresH: 1 }, // renew_refresh
      { ...base, email: 'cook@x.com', hasSessionCookie: true }, // renew_cookie
      { ...base, email: 'dead@x.com', tokenExpiresH: null }, // reauth_nudge
      { ...base, email: 'wait@x.com', tokenExpiresH: 48 }, // wait
    ])
    expect(plan.renewRefresh).toEqual(['a@x.com', 'z@x.com'])
    expect(plan.renewCookie).toEqual(['cook@x.com'])
    expect(plan.reauthNudge).toEqual(['dead@x.com'])
    expect(plan.waiting).toEqual(['wait@x.com'])
    expect(plan.healthy).toEqual(['live@x.com'])
  })
})

describe('cascadeSummaryLine', () => {
  it('names only the non-empty fallback legs', () => {
    const line = cascadeSummaryLine({
      renewRefresh: ['a@x.com'],
      renewCookie: [],
      reauthNudge: ['b@x.com', 'c@x.com'],
      waiting: [],
      healthy: ['live@x.com'],
    })
    expect(line).toBe('cascade: renew-refresh=a@x.com reauth-nudge=b@x.com,c@x.com')
  })

  it('reports all-healthy when every fallback bucket is empty', () => {
    expect(
      cascadeSummaryLine({
        renewRefresh: [],
        renewCookie: [],
        reauthNudge: [],
        waiting: [],
        healthy: ['live@x.com'],
      }),
    ).toBe('cascade: all alternates healthy')
  })
})
