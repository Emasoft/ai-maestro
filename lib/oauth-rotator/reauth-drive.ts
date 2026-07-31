/**
 * Drive the OAuth consent page for ONE account and return the code `completeReauth` consumes — the
 * only leg of the re-login a human still had to perform (TRDD-CVQJNW3A).
 *
 * WHERE THIS SITS. The repair pipeline is four steps and three of them already run today:
 *
 *     a. tick detects reauth-needed for account X      tick.ts
 *     b. mint PKCE + authorize URL for X               reauth-flow.ts::startReauth
 *     c. drive the consent, return the code            ← THIS FILE
 *     d. exchange the code, file the slot              reauth-flow.ts::completeReauth
 *
 * WHY A BROWSER AT ALL, when ROTATE and REFRESH need none. ROTATE is a local keychain write and
 * REFRESH is a plain `grant_type=refresh_token` POST — but both are useless once a slot's refresh
 * token is DEAD, and a fleet left unattended long enough to need rotating is exactly the fleet whose
 * alternates have expired. So this leg sits on the critical path of every rotation that actually
 * matters, even though it is the rarest one.
 *
 * TWO DESIGN RULES, both from the owner, both load-bearing:
 *
 *   1. UNBROWSE IS THE ONLY INSTRUMENT. Not the browser's debug port, not a driver of our own.
 *      Reaching past unbrowse would couple this file to how unbrowse happens to manage Chrome today,
 *      which is precisely the thing a stable tool boundary exists to prevent.
 *   2. NOTHING IS DECIDED BY READING WORDS. The previous version matched Italian and English copy;
 *      every other locale silently misread, and the misreading pointed the operator at the wrong
 *      component. Structure decides — see `page-classify.ts` for the measurements behind that.
 *
 * MEASURED CONSTRAINTS (2026-07-31, live — do not "simplify" these away):
 *
 *   - HEADED IS MANDATORY. A headless run — real browser, real cookies — is served Cloudflare's
 *     interstitial and STAYS there: the same `Ray ID` came back on three consecutive reads, so it is
 *     a wall, not a check in progress. The same navigation with `--headed` renders the real page.
 *     This is why `headed` is not a caller option: a caller who omitted it would get a stuck page
 *     and a confusing timeout.
 *   - THE BROWSER DOES NOT NEED NAMING. `act go` with NO `--browser` flag harvests cookies from
 *     every installed browser by itself — observed sweeping Chrome, Chromium AND Firefox in one
 *     call, then re-navigating authenticated. Verified end-to-end: `github.com/login` rendered the
 *     logged-IN dashboard. So autodetection is unbrowse's job and we simply stop overriding it; the
 *     old `--browser chrome` was narrowing a sweep that was already wider than it.
 *   - `act go` RETURNS THE PAGE TEXT. A separate `eval text` for the first read is a wasted round
 *     trip, which the previous version paid on every drive.
 *   - PROFILE STILL MATTERS FOR *WHICH ACCOUNT*. The auto-sweep takes each browser's default
 *     profile, and the owner's default was logged out while `Profile 2` held the session. So the
 *     profile is an ESCALATION, entered only when the default lands on a sign-in page — never a
 *     required input.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO. It never inspects, stores or logs a token, a cookie or
 * the PKCE verifier — it returns the opaque code and nothing else. The verifier stays in
 * `reauth-flow`'s server-side map, which is what keeps PKCE meaningful; and the account finally
 * filed is decided by `completeReauth` from /roles, not from the profile we drove. That last point
 * matters: the janitor's Python capture was asked for one account, found the ambient profile logged
 * in as another, and filed under the wrong one. Here a mis-aimed profile cannot mis-file anything —
 * at worst it yields a code for the wrong account, which `completeReauth` files under whoever it
 * actually belongs to.
 */
import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  classifyPage,
  extractCode,
  extractState,
  findConsentCandidates,
  parseAxTree,
} from './page-classify'

/** Every distinct way the drive can fail, ONE cause per value — because "a bot wall", "nobody is
 *  logged in", "the control moved" and "two controls and no way to tell them apart" need four
 *  different repairs, and a single `drive_failed` would make the operator guess which. */
export type DriveFailure =
  | 'bad_authorize_url' // no `state` in it — a caller bug, refused before any browser opens
  | 'launch_failed' // unbrowse could not open a session at all
  | 'cloudflare_challenge' // the bot interstitial — the headless signature; retrying is NOT the fix
  | 'not_logged_in' // no profile we tried holds a usable session
  | 'consent_not_found' // page rendered, but no activatable control in the tree
  | 'consent_ambiguous' // several controls and no hint ranks them — refusing beats clicking "deny"
  | 'code_not_found' // consent accepted, but no code carrying our state came back
  | 'timeout'

export interface DriveOk {
  ok: true
  /** The opaque authorization code. Never logged. */
  code: string
  /** Which (browser, profile) produced it — so a later run can go straight there. `null` = the
   *  default auto-sweep, which is the common case and needs no configuration at all. */
  via: BrowserProfile | null
}
export interface DriveErr {
  ok: false
  reason: DriveFailure
  /** Operator-facing detail. Must never carry the code, a cookie or the verifier. */
  detail?: string
}
export type DriveResult = DriveOk | DriveErr

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

/** A concrete (browser, profile) pair for `--browser` / `--browser-profile`. */
export interface BrowserProfile {
  browser: string
  profile: string
}

export interface DriveDeps {
  /** Injected so the whole state machine is testable without a browser. Production runs `unbrowse`;
   *  tests hand back canned pages, including in languages nobody coded for. */
  run?: (args: string[], timeoutMs: number) => Promise<RunResult>
  /** Injected so profile discovery is testable without touching the developer's real home. */
  discoverProfiles?: () => BrowserProfile[]
}

function defaultRun(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile('unbrowse', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? 1 : 0 })
    })
  })
}

/** unbrowse prints human `[auth] …` lines before its JSON, so take the object at the first brace.
 *  Returns null on anything unparseable — a caller that cannot find a session id must fail rather
 *  than proceed with `undefined` and drive "the most recent session", which could be somebody
 *  else's. */
function lastJson(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{')
  if (start === -1) return null
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Chromium-family user-data directories, mapped to the token `--browser` expects. Firefox is absent
 * on purpose: unbrowse harvests its cookies during the auto-sweep but does not take it as a
 * `--browser` value, so listing it here would build candidates that cannot be driven.
 */
const BROWSER_DIRS: ReadonlyArray<readonly [browser: string, relPath: string]> = [
  ['chrome', 'Google/Chrome'],
  ['brave', 'BraveSoftware/Brave-Browser'],
  ['edge', 'Microsoft Edge'],
  ['arc', 'Arc/User Data'],
  ['vivaldi', 'Vivaldi'],
  ['opera', 'com.operasoftware.Opera'],
  ['chromium', 'Chromium'],
]

/** Chromium names its profile directories exactly this way. Structural, not localized. */
const PROFILE_DIR = /^(Default|Profile \d+)$/

/**
 * Enumerate every (browser, profile) pair present on this machine.
 *
 * This reads CONFIG DIRECTORIES, not the browser — it is not an end-run around the unbrowse-only
 * rule, it is how we build the `--browser` / `--browser-profile` arguments unbrowse itself takes.
 * Seven Chromium-family browsers were installed on the owner's machine when this was written, which
 * is exactly why hardcoding one of them was wrong.
 */
export function discoverBrowserProfiles(home: string = homedir()): BrowserProfile[] {
  const root = join(home, 'Library', 'Application Support')
  const found: BrowserProfile[] = []
  for (const [browser, rel] of BROWSER_DIRS) {
    const base = join(root, rel)
    if (!existsSync(base)) continue
    let entries: string[]
    try {
      entries = readdirSync(base)
    } catch {
      continue // an unreadable browser dir is not a reason to abandon the other six
    }
    for (const e of entries) {
      if (PROFILE_DIR.test(e)) found.push({ browser, profile: e })
    }
  }
  return found
}

export interface DriveOptions {
  /** From `startReauth()`. Carries the PKCE challenge and the state we verify against. */
  authorizeUrl: string
  /** Pin a specific (browser, profile). Omit for autodetection, which is the intended path. */
  via?: BrowserProfile
  /** Per-step wall clock. */
  timeoutMs?: number
  /** Cap on profiles tried after the default sweep lands on a sign-in page. Each attempt opens a
   *  visible window, so an unbounded sweep across seven browsers would carpet the owner's screen. */
  maxProfileAttempts?: number
}

interface AttemptOutcome {
  result: DriveResult | null
  /** True when this attempt failed only because the profile had no session — the one failure worth
   *  escalating past. Every other failure is reported immediately; retrying a Cloudflare wall on
   *  another profile just opens more windows to be walled. */
  retryElsewhere: boolean
}

async function attempt(
  opts: DriveOptions,
  via: BrowserProfile | null,
  expectedState: string,
  run: (args: string[], timeoutMs: number) => Promise<RunResult>,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const args = ['act', 'go', opts.authorizeUrl]
  // Naming a browser NARROWS unbrowse's own multi-browser sweep, so it is passed only when the
  // caller pinned one or when we are escalating to a specific profile.
  if (via) args.push('--browser', via.browser, '--browser-profile', via.profile)
  // Not optional — see MEASURED CONSTRAINTS. Headless is served a stuck interstitial.
  args.push('--headed', '--timeout', String(timeoutMs))

  const go = await run(args, timeoutMs + 30_000)
  const goJson = lastJson(go.stdout)
  const session = goJson?.session_id
  if (typeof session !== 'string' || !session) {
    return {
      result: { ok: false, reason: 'launch_failed', detail: go.stderr.slice(0, 400) || 'no session id in output' },
      retryElsewhere: false,
    }
  }

  try {
    // `act go` already carried the text — measured. No second read.
    const page = goJson?.page as { text?: string } | undefined
    const pageText = page?.text ?? ''
    const cookiesInjected = typeof goJson?.cookies_injected === 'number' ? goJson.cookies_injected : undefined

    const snap = await run(['eval', 'snap', '--session', session], timeoutMs)
    const ax = parseAxTree(snap.stdout)

    const kind = classifyPage({ ax, pageText, expectedState, cookiesInjected })

    if (kind === 'challenge') {
      return { result: { ok: false, reason: 'cloudflare_challenge' }, retryElsewhere: false }
    }
    if (kind === 'callback') {
      const code = extractCode(pageText, expectedState)
      return code
        ? { result: { ok: true, code, via }, retryElsewhere: false }
        : { result: { ok: false, reason: 'code_not_found' }, retryElsewhere: false }
    }
    if (kind === 'login') {
      return { result: null, retryElsewhere: true }
    }
    if (kind === 'unknown') {
      return {
        result: { ok: false, reason: 'consent_not_found', detail: `no activatable control in ${ax.length} nodes` },
        retryElsewhere: false,
      }
    }

    // `actionable`: controls, nothing to type. Either the consent screen or a provider sign-in
    // screen — structure cannot tell those apart (page-classify explains why), so we act and then
    // check the OUTCOME rather than trusting the guess.
    const { ordered, ambiguous } = findConsentCandidates(ax)
    if (ordered.length === 0) {
      return { result: { ok: false, reason: 'consent_not_found' }, retryElsewhere: false }
    }
    if (ambiguous) {
      // Several controls and nothing ranks them. On a consent screen the wrong click is "deny", and
      // a silent deny reads exactly like a broken selector afterwards. Refuse, and name the controls
      // so the operator can extend the hint list instead of re-deriving the page.
      return {
        result: {
          ok: false,
          reason: 'consent_ambiguous',
          detail: `${ordered.length} controls, none recognised: ${ordered.map((c) => c.name).join(' | ')}`,
        },
        retryElsewhere: false,
      }
    }

    await run(['act', 'click', ordered[0].ref, '--session', session], timeoutMs)

    const after = await run(['eval', 'text', '--session', session], timeoutMs)
    const code = extractCode(after.stdout, expectedState)
    if (code) return { result: { ok: true, code, via }, retryElsewhere: false }

    // No code carrying our state. The likeliest cause is that this was a sign-in screen after all —
    // the ambiguity page-classify warned about — so escalate to another profile rather than
    // reporting a consent failure we cannot substantiate.
    return { result: null, retryElsewhere: true }
  } finally {
    // Best-effort by design: a close that fails must not mask the real result, and there is nothing
    // useful a caller could do about it. A leaked session holds a cloned profile and a browser
    // process, and this runs unattended on a loop.
    await run(['act', 'close', '--session', session], 30_000).catch(() => undefined)
  }
}

/**
 * Open the consent page, approve, and return the authorization code.
 *
 * Autodetects by default: no browser is named, so unbrowse sweeps every one it knows. Only if that
 * lands on a sign-in page do we enumerate concrete profiles and try them — bounded, because each
 * attempt opens a visible window.
 */
export async function driveConsent(opts: DriveOptions, deps?: DriveDeps): Promise<DriveResult> {
  const run = deps?.run ?? defaultRun
  const discover = deps?.discoverProfiles ?? (() => discoverBrowserProfiles())
  const timeoutMs = opts.timeoutMs ?? 90_000
  const maxProfiles = opts.maxProfileAttempts ?? 4

  const expectedState = extractState(opts.authorizeUrl)
  if (!expectedState) {
    // Refused before any browser opens. Without our state there is no way to tell our code from
    // somebody else's, and the exchange downstream would fail anyway — failing here names the cause.
    return { ok: false, reason: 'bad_authorize_url', detail: 'authorize URL carries no state parameter' }
  }

  // A caller that pinned a profile gets exactly that, once — no sweep behind its back.
  if (opts.via) {
    const { result } = await attempt(opts, opts.via, expectedState, run, timeoutMs)
    return result ?? { ok: false, reason: 'not_logged_in', detail: `profile ${opts.via.profile} has no usable session` }
  }

  const first = await attempt(opts, null, expectedState, run, timeoutMs)
  if (first.result) return first.result

  const tried: string[] = ['auto']
  for (const via of discover().slice(0, maxProfiles)) {
    const next = await attempt(opts, via, expectedState, run, timeoutMs)
    if (next.result) return next.result
    tried.push(`${via.browser}/${via.profile}`)
  }

  return {
    ok: false,
    reason: 'not_logged_in',
    detail: `no usable claude.ai session in: ${tried.join(', ')} — log in once in any browser, then retry`,
  }
}
