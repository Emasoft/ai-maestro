/**
 * The consent drive, over the injected `run` seam (TRDD-CVQJNW3A).
 *
 * Everything here runs without a browser, which is the only way this state machine gets tested at
 * all — `driveConsent` has never been run end to end, and the live page needs the owner present.
 * The seam records the exact argv, so the claims that matter are checkable as facts about the
 * command line rather than as prose in a comment: that no browser is NAMED on the autodetect path,
 * that `--headed` is never omitted, and that the session is closed however the attempt ends.
 */
import { describe, expect, it, vi } from 'vitest'
import { driveConsent, type BrowserProfile, type RunResult } from '@/lib/oauth-rotator/reauth-drive'

const STATE = 'q7Fh2LmXzR4tN8vB1cD6eG0jK5pS9wY3'
const AUTHORIZE = `https://claude.ai/oauth/authorize?client_id=abc&code_challenge=xyz&state=${STATE}`
const CODE = 'aBcDeF0123456789xyz'

const CONSENT = `[e0] RootWebArea "Authorize"
  [e1] main
    [e2] heading "Claude Code wants access"
    [e3] button "Authorize"
    [e4] button "Deny"`

const SIGNIN = `[e0] RootWebArea "Sign in"
  [e1] main
    [e2] textbox "Email"
    [e3] button "Continue"`

const CHALLENGE = `[e0] RootWebArea "Just a moment..."
  [e1] generic`

const UNRANKABLE = `[e0] RootWebArea "Idhinisha"
  [e1] button "Ruhusu ombi"
  [e2] button "Kataa ombi"`

/** What one navigation attempt should pretend to find. */
interface PageSpec {
  snap: string
  /** Text `act go` returns WITH the navigation — measured to come free, so the drive must not pay
   *  for a separate `eval text` before the click. */
  goText?: string
  /** Text `eval text` returns AFTER the click. */
  afterClick?: string
  cookies?: number
  /** Omit a session id to simulate a launch that never opened one. */
  noSession?: boolean
}

function makeRun(pages: PageSpec[]) {
  const calls: string[][] = []
  let attempt = -1
  const run = vi.fn(async (args: string[]): Promise<RunResult> => {
    calls.push(args)
    const at = () => pages[Math.min(attempt, pages.length - 1)]
    const verb = `${args[0]} ${args[1]}`
    if (verb === 'act go') {
      attempt += 1
      const p = at()
      if (p.noSession) return { stdout: '', stderr: 'chrome failed to start', code: 1 }
      return {
        // The real CLI prints human `[auth] …` lines before its JSON, so the parser has to skip a
        // preamble — reproduced here because taking the first `{` of the stream is what makes it work.
        stdout: `[auth] extracted 6 cookies for claude.ai from Chrome user data\n${JSON.stringify({
          ok: true,
          session_id: `sess-${attempt}`,
          cookies_injected: p.cookies ?? 6,
          page: { text: p.goText ?? '' },
        })}`,
        stderr: '',
        code: 0,
      }
    }
    if (verb === 'eval snap') return { stdout: at().snap, stderr: '', code: 0 }
    if (verb === 'eval text') return { stdout: at().afterClick ?? '', stderr: '', code: 0 }
    return { stdout: '{"ok":true}', stderr: '', code: 0 }
  })
  return { run, calls }
}

const noProfiles = () => [] as BrowserProfile[]
const goArgs = (calls: string[][]) => calls.filter((c) => c[0] === 'act' && c[1] === 'go')
const closes = (calls: string[][]) => calls.filter((c) => c[0] === 'act' && c[1] === 'close')
const detailOf = (r: unknown) => (r as { detail: string }).detail

describe('driveConsent — refuses before opening anything when the request is unusable', () => {
  it('rejects an authorize URL with no state, and NEVER launches a browser', async () => {
    const { run } = makeRun([{ snap: CONSENT }])
    const res = await driveConsent(
      { authorizeUrl: 'https://claude.ai/oauth/authorize?client_id=abc' },
      { run, discoverProfiles: noProfiles },
    )
    expect(res).toEqual({
      ok: false,
      reason: 'bad_authorize_url',
      detail: 'authorize URL carries no state parameter',
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('driveConsent — the browser is AUTODETECTED, never named', () => {
  it('passes no --browser and no --browser-profile on the autodetect attempt', async () => {
    const { run, calls } = makeRun([{ snap: CONSENT, afterClick: `${CODE}#${STATE}` }])
    const res = await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })

    expect(res).toEqual({ ok: true, code: CODE, via: null })
    // Naming a browser NARROWS unbrowse's own sweep, which already covers every installed one.
    expect(goArgs(calls)[0]).not.toContain('--browser')
    expect(goArgs(calls)[0]).not.toContain('--browser-profile')
  })

  it('always passes --headed, because headless is served a stuck interstitial', async () => {
    const { run, calls } = makeRun([{ snap: CONSENT, afterClick: `${CODE}#${STATE}` }])
    await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    expect(goArgs(calls)[0]).toContain('--headed')
  })

  it('uses the page text `act go` already returned — no `eval text` before the click', async () => {
    const { run, calls } = makeRun([{ snap: CONSENT, afterClick: `${CODE}#${STATE}` }])
    await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })

    const order = calls.map((c) => `${c[0]} ${c[1]}`)
    const firstClick = order.indexOf('act click')
    const firstText = order.indexOf('eval text')
    expect(firstClick).toBeGreaterThan(-1)
    // The only `eval text` is the one AFTER the click; a read before it would be a wasted trip.
    expect(firstText).toBeGreaterThan(firstClick)
  })
})

describe('driveConsent — one cause per failure', () => {
  it('reports launch_failed when no session id comes back', async () => {
    // Proceeding with an undefined --session would drive whatever session is newest, which could
    // belong to another account entirely.
    const { run, calls } = makeRun([{ snap: CONSENT, noSession: true }])
    const res = await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    expect(res).toMatchObject({ ok: false, reason: 'launch_failed' })
    expect(calls.some((c) => c[1] === 'snap')).toBe(false)
  })

  it('reports cloudflare_challenge and does NOT try other profiles', async () => {
    const { run, calls } = makeRun([{ snap: CHALLENGE }])
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE },
      { run, discoverProfiles: () => [{ browser: 'brave', profile: 'Default' }] },
    )
    expect(res).toMatchObject({ ok: false, reason: 'cloudflare_challenge' })
    // Retrying a bot wall on another profile only opens another window to be walled.
    expect(goArgs(calls)).toHaveLength(1)
  })

  it('REFUSES rather than guessing when several controls cannot be ranked', async () => {
    const { run } = makeRun([{ snap: UNRANKABLE }])
    const res = await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })

    expect(res).toMatchObject({ ok: false, reason: 'consent_ambiguous' })
    // The names go in the detail so the operator can extend the hint list rather than re-derive
    // the page from scratch.
    expect(detailOf(res)).toContain('Ruhusu ombi')
    expect(detailOf(res)).toContain('Kataa ombi')
  })

  it('never clicks anything on an unrankable page — a wrong click here is "deny"', async () => {
    const { run, calls } = makeRun([{ snap: UNRANKABLE }])
    await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    expect(calls.some((c) => c[1] === 'click')).toBe(false)
  })

  it('reports consent_not_found when the page has structure but nothing activatable', async () => {
    const inert = ['[e0] RootWebArea "x"', ...Array.from({ length: 60 }, (_, i) => `  [e${i + 1}] StaticText "t"`)].join('\n')
    const { run } = makeRun([{ snap: inert }])
    const res = await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    expect(res).toMatchObject({ ok: false, reason: 'consent_not_found' })
  })

  it('takes the code straight off the landing page when consent was already granted', async () => {
    const { run, calls } = makeRun([{ snap: CHALLENGE, goText: `${CODE}#${STATE}` }])
    const res = await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })

    expect(res).toEqual({ ok: true, code: CODE, via: null })
    // Nothing was clicked: the code was already there. And note the snapshot is the SPARSE one —
    // a callback page looks structurally like an interstitial, so the code check has to come first.
    expect(calls.some((c) => c[1] === 'click')).toBe(false)
  })
})

describe('driveConsent — a dead session escalates to real profiles, and only that', () => {
  it('tries discovered profiles after the default sweep lands on a sign-in page', async () => {
    const { run, calls } = makeRun([
      { snap: SIGNIN }, // auto sweep: the default profile is logged out
      { snap: CONSENT, afterClick: `${CODE}#${STATE}` }, // the first real profile holds the session
    ])
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE },
      { run, discoverProfiles: () => [{ browser: 'chrome', profile: 'Profile 2' }] },
    )

    expect(res).toEqual({ ok: true, code: CODE, via: { browser: 'chrome', profile: 'Profile 2' } })
    const go = goArgs(calls)
    expect(go).toHaveLength(2)
    expect(go[1]).toEqual(expect.arrayContaining(['--browser', 'chrome', '--browser-profile', 'Profile 2']))
  })

  it('escalates when a click produced no code — the sign-in page structure cannot be told apart', async () => {
    // page-classify is explicit that a buttons-only consent screen and a buttons-only
    // "continue with Google" screen have the same shape. So the click is a hypothesis, and its
    // OUTCOME is what decides — not a guess made beforehand.
    const { run, calls } = makeRun([
      { snap: CONSENT, afterClick: 'took us to a provider login' },
      { snap: CONSENT, afterClick: `${CODE}#${STATE}` },
    ])
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE },
      { run, discoverProfiles: () => [{ browser: 'arc', profile: 'Default' }] },
    )
    expect(res).toEqual({ ok: true, code: CODE, via: { browser: 'arc', profile: 'Default' } })
    expect(goArgs(calls)).toHaveLength(2)
  })

  it('bounds the sweep, so seven browsers do not carpet the screen with windows', async () => {
    const { run, calls } = makeRun([{ snap: SIGNIN }])
    const many: BrowserProfile[] = Array.from({ length: 7 }, (_, i) => ({
      browser: 'chrome',
      profile: `Profile ${i + 1}`,
    }))
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE, maxProfileAttempts: 2 },
      { run, discoverProfiles: () => many },
    )

    expect(res).toMatchObject({ ok: false, reason: 'not_logged_in' })
    expect(goArgs(calls)).toHaveLength(3) // the auto sweep + exactly 2 profiles
  })

  it('names every profile it tried, so the operator knows where to log in', async () => {
    const { run } = makeRun([{ snap: SIGNIN }])
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE },
      { run, discoverProfiles: () => [{ browser: 'brave', profile: 'Default' }] },
    )
    expect(detailOf(res)).toContain('auto')
    expect(detailOf(res)).toContain('brave/Default')
  })

  it('a caller that PINNED a profile gets exactly that, with no sweep behind its back', async () => {
    const { run, calls } = makeRun([{ snap: SIGNIN }])
    const res = await driveConsent(
      { authorizeUrl: AUTHORIZE, via: { browser: 'edge', profile: 'Profile 1' } },
      { run, discoverProfiles: () => [{ browser: 'chrome', profile: 'Default' }] },
    )

    expect(res).toMatchObject({ ok: false, reason: 'not_logged_in' })
    expect(goArgs(calls)).toHaveLength(1)
    expect(goArgs(calls)[0]).toEqual(expect.arrayContaining(['--browser', 'edge', '--browser-profile', 'Profile 1']))
  })
})

describe('driveConsent — the session is closed on EVERY path', () => {
  const paths: Array<[name: string, pages: PageSpec[]]> = [
    ['happy path', [{ snap: CONSENT, afterClick: `${CODE}#${STATE}` }]],
    ['cloudflare', [{ snap: CHALLENGE }]],
    ['sign-in page', [{ snap: SIGNIN }]],
    ['ambiguous controls', [{ snap: UNRANKABLE }]],
    ['clicked, but no code came back', [{ snap: CONSENT, afterClick: 'still nothing' }]],
  ]

  it.each(paths)('closes the session — %s', async (_name, pages) => {
    const { run, calls } = makeRun(pages)
    await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    // A leaked session holds a cloned profile directory AND a browser process, and this runs
    // unattended on a loop — one leak per failed repair accumulates until the host runs out.
    expect(closes(calls)).toHaveLength(goArgs(calls).length)
  })

  it('closes EACH session when the sweep opens several', async () => {
    const { run, calls } = makeRun([{ snap: SIGNIN }, { snap: SIGNIN }])
    await driveConsent(
      { authorizeUrl: AUTHORIZE },
      { run, discoverProfiles: () => [{ browser: 'chrome', profile: 'Default' }] },
    )
    expect(goArgs(calls)).toHaveLength(2)
    expect(closes(calls).map((c) => c[3])).toEqual(['sess-0', 'sess-1'])
  })

  it('does not attempt a close when there was never a session to close', async () => {
    const { run, calls } = makeRun([{ snap: CONSENT, noSession: true }])
    await driveConsent({ authorizeUrl: AUTHORIZE }, { run, discoverProfiles: noProfiles })
    expect(closes(calls)).toHaveLength(0)
  })
})
