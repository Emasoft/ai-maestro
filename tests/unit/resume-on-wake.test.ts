/**
 * Tests for the wake-path resume decision (TRDD-NIU5RQ1S).
 *
 * This is the load-bearing half of the USER's crash/blackout mandate — "all agents must resume
 * their work exactly from where they left it". Before this, a boot-restored agent came back alive,
 * in the right repo, and having forgotten everything: restarted, not resumed.
 *
 * The two failure directions are NOT symmetric, and the tests below pin that asymmetry:
 *   - failing to resume  → a cold start. Wasteful, but the agent still runs.
 *   - resuming WRONGLY   → an invalid launch command. The agent does not run at all.
 * So every uncertain case must fall to the cold start, never to a speculative resume.
 *
 * 0-IMPACT: `decideResume` takes the filesystem probe as a thunk, so nothing here touches disk.
 */
import { describe, it, expect, vi } from 'vitest'
import { decideResume } from '@/lib/claude-conversation'

const hasTranscript = () => Promise.resolve(true)
const noTranscript = () => Promise.resolve(false)

describe('resume-on-wake — the resuming case', () => {
  it("appends claude's --continue when a transcript exists", async () => {
    expect(await decideResume('--continue', hasTranscript)).toEqual({ resume: true, verb: '--continue' })
  })

  it('accepts any FLAG-form verb, including a multi-token one like gemini -r latest', async () => {
    expect(await decideResume('-r latest', hasTranscript)).toEqual({ resume: true, verb: '-r latest' })
  })

  it('trims surrounding whitespace so a padded capability value still resumes', async () => {
    expect(await decideResume('  --continue  ', hasTranscript)).toEqual({ resume: true, verb: '--continue' })
  })
})

describe('resume-on-wake — every non-resuming case falls to a COLD START', () => {
  it('a client with no resume verb at all', async () => {
    expect(await decideResume(undefined, hasTranscript)).toEqual({ resume: false, reason: 'no-verb' })
    expect(await decideResume(null, hasTranscript)).toEqual({ resume: false, reason: 'no-verb' })
    expect(await decideResume('   ', hasTranscript)).toEqual({ resume: false, reason: 'no-verb' })
  })

  it('a first-ever launch — no transcript to resume', async () => {
    expect(await decideResume('--continue', noTranscript)).toEqual({ resume: false, reason: 'no-transcript' })
  })

})

describe('resume-on-wake — a client with no transcript probe still resumes (contract changed)', () => {
  // SUPERSEDED: a null probe used to mean reason:'unverified-client' — a cold start. USER
  // 2026-07-25 ruled the opposite: ALWAYS include the resume verb, because the one case with
  // nothing to resume is a brand-new agent's first launch, and that is known by the CALLER
  // (createSession, which has no resume concept at all) rather than by guessing at five different
  // clients' transcript stores. Claude keeps its probe as belt-and-braces only.
  it('resumes when the client has a verb and no probe', async () => {
    expect(await decideResume('resume --last', null)).toEqual({ resume: true, verb: 'resume --last' })
  })
})

describe('resume-on-wake — subcommand verbs are ACCEPTED (contract changed)', () => {
  // SUPERSEDED: this used to return reason:'subcommand', refusing codex/kiro outright, because
  // appending their verb after the args builds a command that does not run. That was a WORKAROUND
  // for a composition bug, not a property of those clients — `composeLaunchWithResume` now places
  // the verb after the binary where a subcommand belongs, so the refusal is gone and the clients
  // resume like any other. Placement is pinned in tests/unit/cross-client-resume.test.ts.
  it('codex', async () => {
    expect(await decideResume('resume --last', hasTranscript)).toEqual({ resume: true, verb: 'resume --last' })
  })

  it('kiro', async () => {
    expect(await decideResume('chat --resume', hasTranscript)).toEqual({ resume: true, verb: 'chat --resume' })
  })
})

describe('resume-on-wake — the transcript probe is only paid when it can matter', () => {
  it('is never called for a client that has no resume verb at all', async () => {
    // The probe walks the transcript store; running it for a client we are about to refuse is pure
    // waste on every boot-restore of a non-resuming fleet.
    const probe = vi.fn(hasTranscript)
    await decideResume(undefined, probe)
    await decideResume('', probe)
    expect(probe).not.toHaveBeenCalled()
  })

  it('is called exactly once when the verb is usable', async () => {
    const probe = vi.fn(hasTranscript)
    await decideResume('--continue', probe)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
