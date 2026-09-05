// TRDD-10J18FZX — surveyAlternates must SURVEY the live account (read-only), while
// keepaliveRefresh must keep excluding it (a write path). Before this fix, `surveyAlternates`
// carried the SAME `if (email === state.live_email) continue` as keepaliveRefresh, so a live
// account whose refresh is dead AND whose token is locally expired was invisible to the survey —
// it never landed in `refreshDead`, and `nextAction` fell through to `stuck: all-maxed` (wait for
// a window) instead of `reauth-needed` (fetch a human) — the "two opposite instructions from one
// status file" the card's Problem section names.
//
// WHAT IS MOCKED, AND WHY THAT IS NOT MOCKING THE GUARD: nothing beyond the containment contract
// every oauth-rotator test in this suite shares (HOME + the janitor global-state dir point at a
// temp dir, `CLAUDE_SAFE_STORAGE_BACKEND=none` so `security` is never spawned). `surveyAlternates`,
// `keepaliveRefresh` and `runTick` all run for real; only the network usage probe is a stub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { surveyAlternates, keepaliveRefresh, runTick } from '@/lib/oauth-rotator/tick'
import { loadState, saveState, writeSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob } from '@/lib/oauth-rotator/live'

// Same containment contract as oauth-rotator-tick.test.ts: HOME + the janitor global-state dir
// both point at a temp dir, and the safe-storage backend is forced off, so no real credential is
// read or written and the developer's own denied-latch is neither read nor set.
const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA', 'JANITOR_GLOBAL_STATE_DIR'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-survey-live-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
  delete process.env.CLAUDE_PLUGIN_DATA
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

/** Seed the LIVE account with a blob that is ALSO registered as its own slot, with a dead refresh
 *  (empty refresh token) and a locally-expired access token. `surveyAlternates` and
 *  `keepaliveRefresh` both loop over `Object.keys(state.slots)`, so the live email must be a KEY
 *  there to be visited at all — the live blob file (`writeLiveBlob`) and the slot file
 *  (`writeSlot`) are separate stores, exactly as `keepaliveRefresh`'s own self-heal comment
 *  (tick.ts ~:838-849) documents for the alternate case. */
function seedDeadLiveSlot(email: string): void {
  const deadBlob = blob('LIVE-DEAD', Date.now() - 1000, '')
  writeLiveBlob(deadBlob)
  writeSlot(email, deadBlob)
  const st: RotatorState = loadState()
  st.live_email = email
  st.live_fp = fingerprint(deadBlob)
  st.slots = { ...(st.slots ?? {}), [email]: { captured_at: 'now', fp: fingerprint(deadBlob), expires_at: null, via: 'test' } }
  saveState(st)
}

const stubFetch = (async () => ({
  ok: true,
  status: 200,
  json: async () => ({ five_hour: { utilization: 20, resets_at: null }, seven_day: { utilization: 20, resets_at: null } }),
  text: async () => '',
})) as unknown as typeof fetch

describe('surveyAlternates surveys the live account (read-only) — TRDD-10J18FZX', () => {
  it('a live account with a dead refresh AND an expired token surfaces in refreshDead, so nextAction is reauth-needed', async () => {
    seedDeadLiveSlot('live@x')

    const survey = surveyAlternates()
    expect(survey.refreshDead).toEqual(['live@x'])
    expect(survey.unreadable).toEqual([])

    const res = await runTick({ fetchImpl: stubFetch })
    expect(res.nextAction).toBe('reauth-needed')
    expect(res.reason).toBe('refresh-dead')
    expect(res.identities).toEqual({ unreadable: [], refreshDead: ['live@x'] })
  })

  // The control this card's Verification section requires: `keepaliveRefresh`'s OWN, deliberate
  // live-account exclusion (tick.ts ~:838, "never refresh the live account out from under Claude")
  // is untouched by this fix and must still hold under the EXACT same fixture — a live account
  // whose only registered slot is itself, dead-refresh and expired. If a later edit ever
  // conflated the two exclusions, this is the test that would catch it.
  //
  // NEUTER (documented, not executed by CI): re-adding
  // `if (email === state.live_email) continue` inside `surveyAlternates` reds ONLY the test
  // above — `refreshDead` reverts to `[]` and `nextAction` falls through to `stuck` — while this
  // test stays green, because it drives a wholly different function whose own exclusion this fix
  // never touched.
  it('keepaliveRefresh still never refreshes the live account (its own, deliberate exclusion, untouched by this fix)', async () => {
    seedDeadLiveSlot('live@x')

    const refreshed = await keepaliveRefresh()
    expect(refreshed).toEqual([])
  })
})
