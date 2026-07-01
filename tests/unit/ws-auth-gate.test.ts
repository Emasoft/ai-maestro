import { describe, it, expect } from 'vitest'
import { isWsRequestAuthorized } from '@/lib/ws-auth-gate'

// Real authenticator, no mocks. A forged-shape bearer / cookie MUST be rejected
// at the /term WS gate (SF3 / TRDD-f1d89143) — this is what closes the
// forged-bearer-reaches-terminal-RW hole. validateGovernanceToken is a pure
// read (verified), so these rejections do not consume any one-shot AID token.

describe('isWsRequestAuthorized (/term WS deep-validate)', () => {
  it('rejects when headers are absent or empty', async () => {
    expect(await isWsRequestAuthorized(null)).toBe(false)
    expect(await isWsRequestAuthorized(undefined)).toBe(false)
    expect(await isWsRequestAuthorized({})).toBe(false)
  })

  it('rejects a forged-shape AID bearer (aim_tk_ not backed by an issued token)', async () => {
    const headers = { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }
    expect(await isWsRequestAuthorized(headers)).toBe(false)
  })

  it('rejects garbage bearers and garbage session cookies', async () => {
    expect(await isWsRequestAuthorized({ authorization: 'Bearer not-a-real-token' })).toBe(false)
    expect(await isWsRequestAuthorized({ authorization: 'Bearer amp_live_sk_deadbeef' })).toBe(false)
    expect(await isWsRequestAuthorized({ cookie: 'aim_session=forged.session.value' })).toBe(false)
  })

  it('rejects an empty / bearer-only authorization header', async () => {
    expect(await isWsRequestAuthorized({ authorization: '' })).toBe(false)
    expect(await isWsRequestAuthorized({ authorization: 'Bearer ' })).toBe(false)
  })
})
