/**
 * Tests for the consent-drive leg (TRDD-CVQJNW3A) — `lib/oauth-rotator/reauth-drive.ts`.
 *
 * The `run` seam is injected, so the whole state machine is exercised with NO browser: these pin
 * the ordering, the parsing and the cleanup, which is everything that can be wrong without a live
 * site. What they deliberately do NOT prove is that a real taught route replays past Cloudflare —
 * that is a live-run question and is recorded as open on the card rather than faked here.
 *
 * The page fixtures are VERBATIM fragments of what the live site actually rendered on 2026-07-31
 * (Italian, because that is what it served), so a regex tuned to an imagined English-only page
 * would fail here rather than in production.
 */
import { describe, it, expect } from 'vitest'

import { driveConsent, findAuthorizeRef, extractCode, type RunResult } from '@/lib/oauth-rotator/reauth-drive'

/** What `act go` prints: human `[auth]` lines, THEN the JSON. Reproduced because the parser has to
 *  skip the preamble — taking the first `{` of the whole stream is what makes that work. */
function goOutput(sessionId: string): string {
  return [
    '[auth] act go: using isolated Chrome profile clone (Default)',
    '[auth] act go: injected 24 cookie(s) for claude.ai, re-navigated authenticated',
    JSON.stringify({ ok: true, subcommand: 'act go', session_id: sessionId, url: 'https://claude.ai/' }),
  ].join('\n')
}

/** The live Cloudflare interstitial, as served (Italian) — with the Ray ID line that made it
 *  identifiable as a WALL rather than a check in progress. */
const CLOUDFLARE_PAGE = `claude.ai
Esecuzione della verifica di sicurezza

Questo sito web utilizza un servizio di sicurezza per la protezione dai bot dannosi.

Ray ID: a23dc4655d41ee61
Prestazioni e sicurezza di Cloudflare`

/** The live logged-OUT landing page, as served. */
const LOGGED_OUT_PAGE = `Interrogati su
cosa viene dopo
Il tuo partner di pensiero per grandi ambizioni
Continua con Google

OPPURE

Continua con email
Continua con SSO`

const CONSENT_SNAPSHOT = `[e0] RootWebArea "Authorize Claude Code"
  [e3] button "Autorizza"
  [e4] button "Annulla"`

const CALLBACK_PAGE = `Authorization code

abc123DEF456ghi789JKL#state-token-xyz

Copy this code and paste it into Claude Code.`

interface Recorder {
  calls: string[][]
  run: (args: string[], timeoutMs: number) => Promise<RunResult>
}

/**
 * A fake `unbrowse` that dispatches on the subcommand. `pages` is consumed in order by successive
 * `eval text` calls, so a test can make the page BEFORE and AFTER the click differ — which is the
 * only way to exercise the happy path and `code_not_found` with the same harness.
 */
function recorder(opts: { sessionId?: string | null; pages?: string[]; snapshot?: string }): Recorder {
  const calls: string[][] = []
  const pages = [...(opts.pages ?? [])]
  return {
    calls,
    run: async (args: string[]): Promise<RunResult> => {
      calls.push(args)
      const verb = `${args[0]} ${args[1]}`
      if (verb === 'act go') {
        const sid = opts.sessionId === undefined ? 'sess-1' : opts.sessionId
        return { stdout: sid === null ? 'boom: no session' : goOutput(sid), stderr: '', code: sid === null ? 1 : 0 }
      }
      if (verb === 'eval text') return { stdout: pages.shift() ?? '', stderr: '', code: 0 }
      if (verb === 'eval snap') return { stdout: opts.snapshot ?? '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    },
  }
}

const OPTS = { authorizeUrl: 'https://claude.ai/oauth/authorize?x=1', chromeProfile: 'Profile 2' }

function closes(calls: string[][]): string[][] {
  return calls.filter((c) => c[0] === 'act' && c[1] === 'close')
}

describe('reauth-drive — the measured browser constraints are encoded, not left to the caller', () => {
  it('always passes --headed: headless is served a STUCK Cloudflare interstitial (same Ray ID x3)', async () => {
    const r = recorder({ pages: [CALLBACK_PAGE, CALLBACK_PAGE], snapshot: CONSENT_SNAPSHOT })
    await driveConsent(OPTS, { run: r.run })
    const go = r.calls.find((c) => c[1] === 'go')!
    expect(go).toContain('--headed')
  })

  it('selects the account by CHROME PROFILE — unbrowse own store is per-DOMAIN and cannot hold 3 identities', async () => {
    const r = recorder({ pages: [CALLBACK_PAGE, CALLBACK_PAGE], snapshot: CONSENT_SNAPSHOT })
    await driveConsent(OPTS, { run: r.run })
    const go = r.calls.find((c) => c[1] === 'go')!
    expect(go).toContain('--browser-profile')
    expect(go[go.indexOf('--browser-profile') + 1]).toBe('Profile 2')
  })

  it('always clones the profile, so the owner live browser session is never driven or locked', async () => {
    const r = recorder({ pages: [CALLBACK_PAGE, CALLBACK_PAGE], snapshot: CONSENT_SNAPSHOT })
    await driveConsent(OPTS, { run: r.run })
    expect(r.calls.find((c) => c[1] === 'go')!).toContain('--share-accounts')
  })
})

describe('reauth-drive — one failure value per CAUSE, and the ORDER is what keeps them distinct', () => {
  it('reports cloudflare_challenge, NOT consent_not_found, on the interstitial', async () => {
    // THE ORDERING TEST. A Cloudflare wall has no authorize control either, so a version that
    // looked for the control first would call this consent_not_found and send the operator to
    // hunt a moved selector instead of a bot block. Neuter: move the CLOUDFLARE_MARKERS check
    // below the snap → this test reds and the next one does not.
    const r = recorder({ pages: [CLOUDFLARE_PAGE], snapshot: '' })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'cloudflare_challenge' }))
  })

  it('reports not_logged_in on the landing page, and does NOT claim the profile has no session', async () => {
    // The claim would be an inference: an ABSENT cookie and an UNDECRYPTABLE one render the same
    // page (Playwright --use-mock-keychain → macOS OSCrypt mock key), and they need opposite
    // repairs. So the detail must name the symptom, never the cause.
    const r = recorder({ pages: [LOGGED_OUT_PAGE], snapshot: '' })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'not_logged_in' }))
    if (res.ok) throw new Error('unreachable')
    // Assert NON-COMMITTAL-ness, which is the actual requirement — both causes offered, neither
    // asserted. The first version of this banned the substring "has no claude.ai session", which
    // the honest message legitimately contains inside its "either … or …"; that assertion would
    // have forced the message to DROP a real possibility in order to pass.
    expect(res.detail).toMatch(/either/i)
    expect(res.detail).toMatch(/no claude\.ai session/i)
    expect(res.detail).toMatch(/could not be decrypted/i)
  })

  it('names a control only when a CONTROL carries the name — the page TITLE must not win', () => {
    // The consent page is titled "Authorize Claude Code", so a whole-line match returns the
    // document `[e0]`. Clicking the document does nothing and the drive then blames the callback
    // page for a missing code. Neuter: match the whole line instead of the parsed name → reds.
    expect(findAuthorizeRef('[e0] RootWebArea "Authorize Claude Code"\n  [e3] button "Autorizza"')).toBe('[e3]')
    expect(findAuthorizeRef('[e0] RootWebArea "Authorize Claude Code"')).toBeNull()
    expect(findAuthorizeRef('[e2] StaticText "Click Authorize to continue"')).toBeNull()
  })

  it('reports consent_not_found when the page IS the consent page but the control moved', async () => {
    const r = recorder({ pages: ['Authorize Claude Code'], snapshot: '[e0] RootWebArea "x"\n  [e9] button "Annulla"' })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'consent_not_found' }))
  })

  it('reports code_not_found when consent was clicked but the callback rendered no code', async () => {
    const r = recorder({ pages: ['Authorize Claude Code', 'Something went wrong.'], snapshot: CONSENT_SNAPSHOT })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'code_not_found' }))
  })

  it('reports launch_failed when no session id came back — never proceeds against "most-recent"', async () => {
    // Proceeding with an undefined --session would drive whatever session happens to be newest,
    // which could belong to another account entirely.
    const r = recorder({ sessionId: null })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual(expect.objectContaining({ ok: false, reason: 'launch_failed' }))
    expect(r.calls.filter((c) => c[1] === 'text')).toHaveLength(0)
  })
})

describe('reauth-drive — the session is closed on EVERY path', () => {
  // A leaked session holds a cloned profile dir AND a Chrome process. This runs unattended on a
  // loop, so one leak per failed repair accumulates silently until the host runs out of something.
  // Neuter: delete the `finally` → every case below reds at once.
  it.each([
    ['happy path', { pages: ['Authorize', CALLBACK_PAGE], snapshot: CONSENT_SNAPSHOT }],
    ['cloudflare', { pages: [CLOUDFLARE_PAGE], snapshot: '' }],
    ['logged out', { pages: [LOGGED_OUT_PAGE], snapshot: '' }],
    ['consent missing', { pages: ['Authorize'], snapshot: 'nothing here' }],
    ['code missing', { pages: ['Authorize', 'no code'], snapshot: CONSENT_SNAPSHOT }],
  ])('closes the session — %s', async (_name, cfg) => {
    const r = recorder(cfg)
    await driveConsent(OPTS, { run: r.run })
    expect(closes(r.calls)).toHaveLength(1)
    expect(closes(r.calls)[0]).toEqual(['act', 'close', '--session', 'sess-1'])
  })

  it('does not attempt a close when there was never a session to close', async () => {
    const r = recorder({ sessionId: null })
    await driveConsent(OPTS, { run: r.run })
    expect(closes(r.calls)).toHaveLength(0)
  })
})

describe('reauth-drive — parsing, against what the live pages actually render', () => {
  it('finds the authorize control by ACCESSIBLE NAME, in Italian as served', () => {
    // CSS has no text predicate (the janitor used Playwright `button:has-text`), so the AX name is
    // what we match — and that is also what makes the Italian rendering work with one selector.
    expect(findAuthorizeRef(CONSENT_SNAPSHOT)).toBe('[e3]')
  })

  it('finds it in English too', () => {
    expect(findAuthorizeRef('[e0] RootWebArea "x"\n  [e7] button "Authorize"')).toBe('[e7]')
  })

  it('returns null rather than guessing when no control matches', () => {
    expect(findAuthorizeRef('[e0] RootWebArea "x"\n  [e1] button "Annulla"')).toBeNull()
  })

  it('extracts code#state off the callback page', () => {
    expect(extractCode(CALLBACK_PAGE)).toBe('abc123DEF456ghi789JKL#state-token-xyz')
  })

  it('accepts a bare code — that page rendering has varied and refusing would kill the repair path', () => {
    expect(extractCode('Authorization code\n\nabc123DEF456ghi789JKL\n')).toBe('abc123DEF456ghi789JKL')
  })

  it('does NOT mistake ordinary prose for a code', () => {
    // A wrong match here is the silent failure that matters: it files a garbage code AND burns the
    // flow, so the operator sees an exchange error rather than "the page had no code".
    expect(extractCode(LOGGED_OUT_PAGE)).toBeNull()
    expect(extractCode('Copy this code and paste it into Claude Code.')).toBeNull()
  })

  it('returns the code on the happy path', async () => {
    const r = recorder({ pages: ['Authorize Claude Code', CALLBACK_PAGE], snapshot: CONSENT_SNAPSHOT })
    const res = await driveConsent(OPTS, { run: r.run })
    expect(res).toEqual({ ok: true, pastedCode: 'abc123DEF456ghi789JKL#state-token-xyz' })
  })
})
