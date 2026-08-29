// TRDD-MFTDMSJY — the THIRD member of a triplet whose other two live in
// `oauth-rotator-tick.test.ts`. All three seed the SAME registered-but-unreadable slot and differ
// in exactly one precondition:
//
//   1. keychain answered, slot genuinely gone   → reauth-needed: slot-unreadable   (a human acts)
//   2. denied-latch set, nothing spawned        → stuck: keychain-latched          (self-clears)
//   3. latch UNSET, a read DID NOT COMPLETE ←HERE → stuck: keychain-read-failed    (retry next beat)
//
// Case 3 is the gap `bda75f7d` left open, and it is not hypothetical: MEASURED 2026-08-29T15:10:12
// on this box, a 13916 ms TIMED OUT `find-generic-password` produced
// `reauth-needed: 1 alternate slot(s) UNREADABLE` with the latch unset — the false call for a human
// re-login this card exists to kill, arriving by a path the earlier fix never covered.
//
// WHY IT ESCAPES THE LATCH: `runSecurity` latches only at TIMEOUT_LATCH_THRESHOLD (3) CONSECUTIVE
// timeouts, and resets that counter on ANY answered op — including a fast one, which is below
// SLOW_SECURITY_LOG_MS and so never even appears in the log. A real stall is interleaved (26 of 29
// slow ops recovered), so the run never reaches 3 while every individual timeout still contributes
// a phantom `unreadable`.
//
// WHAT IS MOCKED, AND WHY THAT IS NOT MOCKING THE GUARD: only `securityFailureCount`, the counter
// `runSecurity` bumps. The guard under test — `surveyAlternates` comparing it across the sweep, and
// the verdict branch that reads the flag — is the real code. Mocking it is forced, not chosen:
// these tests run with `CLAUDE_SAFE_STORAGE_BACKEND=none`, so `security` is never spawned and a
// genuine timeout cannot be provoked without spawning a real blocked keychain process.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// The counter's value for the NEXT read. `surveyAlternates` reads it twice — once before its loop,
// once after — so a change BETWEEN those two reads is what "a read failed during this sweep" means.
// A queue models that honestly; a constant could not express "it moved".
let failureReadings: number[] = []
vi.mock('@/lib/oauth-rotator/safe-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth-rotator/safe-storage')>()
  return {
    ...actual,
    securityFailureCount: () => (failureReadings.length > 1 ? (failureReadings.shift() as number) : (failureReadings[0] ?? 0)),
  }
})

import { runTick, surveyAlternates } from '@/lib/oauth-rotator/tick'
import { keychainDeniedLatched } from '@/lib/oauth-rotator/safe-storage'
import { loadState, saveState, writeSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob } from '@/lib/oauth-rotator/live'

// Same containment contract as oauth-rotator-tick.test.ts: HOME and the janitor global-state dir
// both point at a temp dir, and the safe-storage backend is forced off, so no real credential is
// read or written and the developer's own denied-latch is neither read nor set.
const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA', 'JANITOR_GLOBAL_STATE_DIR'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-survey-timeout-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
  delete process.env.CLAUDE_PLUGIN_DATA
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
  failureReadings = [0]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

const H8 = () => Date.now() + 8 * 3600 * 1000
const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

function seedLive(email: string, liveBlob: ReturnType<typeof blob>): void {
  writeLiveBlob(liveBlob)
  const st: RotatorState = loadState()
  st.live_email = email
  st.live_fp = fingerprint(liveBlob)
  st.slots = st.slots ?? {}
  saveState(st)
}

/** Register a slot in state WITHOUT storing a readable blob — `readSlot` returns null, which is
 *  exactly what a timed-out read looks like from the survey's side. */
function registerGhostSlot(email: string): void {
  const st = loadState()
  st.slots = { ...(st.slots ?? {}), [email]: { captured_at: 'now', fp: 'deadbeef', expires_at: null, via: 'test' } }
  saveState(st)
}

function addSlot(email: string, slotBlob: ReturnType<typeof blob>): void {
  writeSlot(email, slotBlob)
  const st = loadState()
  st.slots = st.slots ?? {}
  st.slots[email] = { captured_at: 'now', fp: fingerprint(slotBlob), expires_at: null, via: 'test' }
  saveState(st)
}

const stubFetch = ((async () => ({
  ok: true,
  status: 200,
  json: async () => ({ five_hour: { utilization: 20, resets_at: null }, seven_day: { utilization: 20, resets_at: null } }),
  text: async () => '',
})) as unknown) as typeof fetch

describe('surveyAlternates — a read that did NOT COMPLETE is not evidence a slot is gone (TRDD-MFTDMSJY)', () => {
  it('empties `unreadable` and flags readFailed when the failure counter moved during the sweep', () => {
    seedLive('live@x', blob('LIVE', H8()))
    registerGhostSlot('ghost@x')
    expect(keychainDeniedLatched()).toBe(false) // THE precondition that separates this from the latch case

    failureReadings = [0, 1] // before the loop / after it — one `security` op failed in between
    const survey = surveyAlternates()

    expect(survey.readFailed).toBe(true)
    expect(survey.probeSuppressed).toBe(false) // NOT the latch path — some reads did happen
    expect(survey.unreadable).toEqual([]) // we could not ask about this one, so we claim nothing
  })

  it('still reports `unreadable` when the counter did NOT move — the positive control', () => {
    seedLive('live@x', blob('LIVE', H8()))
    registerGhostSlot('ghost@x')

    failureReadings = [7, 7] // non-zero, and UNCHANGED: a prior failure must not poison this sweep
    const survey = surveyAlternates()

    expect(survey.readFailed).toBe(false)
    expect(survey.unreadable).toEqual(['ghost@x'])
  })

  it('a failed-read sweep verdicts `stuck: keychain-read-failed`, never a call for a human re-login', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    registerGhostSlot('ghost@x')

    failureReadings = [0, 1]
    const res = await runTick({ fetchImpl: stubFetch })

    expect(res.nextAction).toBe('stuck')
    expect(res.stuck).toBe('keychain-read-failed')
    expect(res.reason).toBeUndefined() // NOT slot-unreadable
    expect(res.decision).not.toContain('reauth')
    expect(res.decision).not.toContain('no action needed') // a partial sweep must not read as health
    // The wording is part of the contract, not incidental: this assertion is what stops the
    // banner drifting back to naming a cause the branch does not observe (it said "TIMED OUT"
    // for one commit, and the branch fires on EACCES too — measured).
    expect(res.decision).toContain('did NOT COMPLETE')
    expect(res.decision).not.toContain('TIMED OUT')
  })

  it('keeps a READ dead-refresh actionable even when another read timed out', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('dead@x', blob('DEAD', Date.now() - 1000, '')) // no refresh token AND expired
    registerGhostSlot('ghost@x')

    failureReadings = [0, 1]
    const res = await runTick({ fetchImpl: stubFetch })

    // `refreshDead` came from a blob that actually came back, so it survives the timeout and
    // outranks the retry-next-beat verdict — a human CAN fix this one right now.
    expect(res.nextAction).toBe('reauth-needed')
    expect(res.reason).toBe('refresh-dead')
  })
})
