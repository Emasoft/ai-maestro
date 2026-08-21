/**
 * `defaultContinuityDeps.captureFrame` — the empty case must say WHICH empty (TRDD-7UWQ92WK).
 *
 * The continuity leg logged 556 consecutive `not actuated (empty-frame)` lines across two weeks and
 * nobody could tell whether that was 556 quiet agents or 556 total failures: `capturePane` swallows
 * its own errors and returns '', so a session that cannot be read and a genuinely blank pane arrived
 * here as the SAME value and rendered as the same benign-sounding skip. `captureFrame` now re-asks
 * tmux directly on the empty path and lets the error propagate — the tick turns a throw into an
 * `error: …` skip, which a human can tell apart from a quiet agent at a glance.
 *
 * REAL tmux, no mock of it — including a real, really-blank session for the other direction, which
 * is the control that stops "reject whenever the pane is empty" from passing. The only fake is the
 * runtime seam (`setRuntime`), because WHICH empty arrives is the test's INPUT, not its subject.
 *
 * NEUTER RUNS (2026-08-21 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
 * A COMPLEMENTARY PAIR: the two failure directions cannot be reached by one mutation, and a
 * discriminator needs both — "always reject on empty" would satisfy the first neuter alone while
 * classifying nothing.
 *
 *   s|await execFileAsync\('tmux'|… && (async()=>'')('tmux'|          (the probe made inert)
 *   → 1 red / 2 green:
 *       REJECTS with a message when the pane reads empty and tmux cannot read the session
 *
 *   s|await execFileAsync\('tmux', \[|throw new Error(…) \|\| await …|   (degenerate: always reject)
 *   → 1 red / 2 green:
 *       resolves to "" — an honest empty-frame — when the session is REAL and its pane is blank
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { getRuntime, setRuntime, type AgentRuntime } from '@/lib/agent-runtime'
import { defaultContinuityDeps } from '@/lib/fleet-continuity'

/** A name tmux cannot resolve, so the direct probe MUST fail on it. */
const NO_SUCH = 'aim-test-no-such-session-7uwq92wk'

/** A runtime whose `capturePane` hands back exactly `frame` — the real one's swallowing behaviour,
 *  with the outcome chosen by the test instead of by whatever the machine's fleet is doing. */
const withCapture = (frame: string) => ({ capturePane: async () => frame }) as unknown as AgentRuntime

/** The dep under test. The episode store and clock are irrelevant to capture, so they are empty. */
const captureFrame = () => defaultContinuityDeps(new Map(), 0).captureFrame

let real: AgentRuntime
beforeEach(() => {
  real = getRuntime()
})
afterEach(() => {
  setRuntime(real)
})

describe('captureFrame — a readable pane is passed straight through', () => {
  it('returns a non-empty pane untouched and never runs the second capture', async () => {
    setRuntime(withCapture('  retrying in 3s ... attempt 12/300  '))
    // The session name is one tmux cannot resolve, so the probe would REJECT if it ran at all.
    // Resolving with the frame is therefore proof that the happy path costs no extra exec.
    await expect(captureFrame()(NO_SUCH)).resolves.toBe('  retrying in 3s ... attempt 12/300  ')
  })
})

describe('captureFrame — an empty pane is classified, not shrugged off', () => {
  it('REJECTS with a message when the pane reads empty and tmux cannot read the session', async () => {
    setRuntime(withCapture(''))
    const err = await captureFrame()(NO_SUCH).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    // The tick renders this as `error: ${err.message}`, so an empty message would put the leg
    // straight back where it started — a skip line that says nothing about why.
    expect(String(err?.message ?? '')).not.toBe('')
  })

  it('resolves to "" — an honest empty-frame — when the session is REAL and its pane is blank', async () => {
    const name = `aim-test-blank-pane-${process.pid}`
    execFileSync('tmux', ['new-session', '-d', '-s', name, 'sleep 30'])
    try {
      setRuntime(withCapture(''))
      await expect(captureFrame()(name)).resolves.toBe('')
    } finally {
      execFileSync('tmux', ['kill-session', '-t', name])
    }
  })
})
