/**
 * Drive the claude.ai consent page for ONE named account and return the code `completeReauth`
 * consumes — the only leg of the re-login that a human still had to perform (TRDD-CVQJNW3A).
 *
 * WHERE THIS SITS. The repair pipeline is four steps and three of them already run today:
 *
 *     a. tick detects reauth-needed for account X      tick.ts
 *     b. mint PKCE + authorize URL for X               reauth-flow.ts::startReauth
 *     c. drive the consent, return `code#state`        ← THIS FILE
 *     d. exchange the code, file the slot              reauth-flow.ts::completeReauth
 *
 * WHY A BROWSER AT ALL, when ROTATE and REFRESH need none. ROTATE is a local keychain write and
 * REFRESH is a plain `grant_type=refresh_token` POST — but both are useless once a slot's refresh
 * token is DEAD, and a fleet left unattended long enough to need rotating is exactly the fleet
 * whose alternates have expired. So this leg sits on the critical path of every rotation that
 * actually matters, even though it is the rarest one.
 *
 * MEASURED CONSTRAINTS (2026-07-31, against the live site — do not "simplify" these away):
 *
 *  - HEADED IS MANDATORY. A headless run — real Chrome, real cookies, `--share-accounts` — is
 *    served Cloudflare's interstitial and STAYS there: the same `Ray ID` came back on three
 *    consecutive reads, so it is a wall, not a check in progress. The same command with `--headed`
 *    renders the real page. This is why `headed` is not a caller option below: a caller who
 *    omitted it would get a stuck page and a confusing timeout.
 *  - THE ACCOUNT IS SELECTED BY CHROME PROFILE, not by anything unbrowse stores. unbrowse's own
 *    profile store is keyed by DOMAIN (`~/.unbrowse/profiles/<host>`), i.e. one session per site,
 *    which cannot hold three claude.ai identities. The owner's real Chrome profiles are keyed by
 *    account, and `--browser-profile "Profile 2"` rendered a logged-IN app where `Default`
 *    rendered the logged-OUT landing page.
 *  - `--share-accounts` CLONES the profile (`isolated_clone: true`), so the owner's live browser
 *    session is never driven or locked. Always pass it.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO. It never inspects, stores, or logs a token, a cookie,
 * or the PKCE verifier — it returns the opaque `code#state` string off the callback page and
 * nothing else. The verifier stays in `reauth-flow`'s server-side map, which is what keeps PKCE
 * meaningful; and the account that ends up filed is decided by `completeReauth` from /roles, not
 * from the profile we drove. That last point matters: the janitor's Python capture was asked for
 * fmuaddib, found the ambient profile logged in as ipazia, and filed under ipazia. Here a
 * mis-aimed profile cannot mis-file anything — at worst it produces a code for the wrong account,
 * which `completeReauth` files correctly under whoever it belongs to.
 */
import { execFile } from 'child_process'

/** Every distinct way the drive can fail, ONE cause per value — because "the page was a Cloudflare
 *  wall", "nobody is logged in on that profile" and "the consent control moved" need three
 *  different repairs, and a single `drive_failed` would send the operator to guess which. */
export type DriveFailure =
  | 'launch_failed' // unbrowse could not open a session at all (binary missing, Chrome busy)
  | 'cloudflare_challenge' // the bot interstitial — the headless signature; retry is NOT the fix
  | 'not_logged_in' // the profile has no claude.ai session — the taught login is missing
  | 'consent_not_found' // page rendered, but no authorize control in the accessibility tree
  | 'code_not_found' // consent accepted, but the callback page showed no code
  | 'timeout'

export interface DriveOk {
  ok: true
  /** The opaque string the callback page renders — normally `code#state`. Never logged. */
  pastedCode: string
}
export interface DriveErr {
  ok: false
  reason: DriveFailure
  /** Operator-facing detail. Must never carry the code, a cookie, or the verifier. */
  detail?: string
}
export type DriveResult = DriveOk | DriveErr

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}
export interface DriveDeps {
  /** Injected so the whole state machine is testable without a browser. Production runs
   *  `unbrowse`; tests hand back canned pages, including the failure pages we measured. */
  run?: (args: string[], timeoutMs: number) => Promise<RunResult>
}

/** Cloudflare's interstitial, in the two languages this host has actually rendered it in. Matching
 *  the Ray-ID line as well means a localisation we have not seen still trips the right branch. */
const CLOUDFLARE_MARKERS = [/verifica di sicurezza/i, /checking your browser/i, /\bRay ID:/i]

/** The logged-OUT landing page. Matching the sign-in CALLS TO ACTION rather than the marketing
 *  copy, because the marketing copy is what changes. */
const LOGGED_OUT_MARKERS = [/continua con google/i, /continue with google/i, /continua con sso/i, /continue with sso/i]

/** The authorize control, by accessible NAME. The janitor's Playwright used
 *  `button:has-text("Authorize")`; CSS has no text predicate, so we match the AX tree instead —
 *  which is also what makes the Italian rendering work without a second selector. */
const AUTHORIZE_NAME = /\b(authorize|autorizza|approve|approva)\b/i

/** An OAuth code as the callback page renders it: an opaque token, optionally `#state`. Anchored,
 *  so a code embedded in prose is not silently accepted as the whole string. */
const CODE_LINE = /^[A-Za-z0-9._~-]{16,}(#[A-Za-z0-9._~-]+)?$/

function defaultRun(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile('unbrowse', args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? 1 : 0 })
    })
  })
}

/** unbrowse prints human `[auth] …` lines before its JSON, so take the LAST balanced object rather
 *  than parsing the whole stream. Returns null on anything unparseable — a caller that cannot find
 *  a session id must fail, never proceed with `undefined` and drive "the most-recent session",
 *  which could be somebody else's. */
function lastJson(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf('{')
  if (start === -1) return null
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>
  } catch {
    return null
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text))
}

/** AX-tree line shape: `[eN] <role> "<accessible name>"`. Parsed rather than substring-matched
 *  because matching the whole LINE hits the page ROOT first — the consent page's own title is
 *  "Authorize Claude Code", so `[e0] RootWebArea "Authorize Claude Code"` matched before the
 *  button and this function returned the document. Clicking the document does nothing, the code
 *  never appears, and the drive reports `code_not_found` — a wrong diagnosis pointing at the
 *  callback page when the real fault was the selector. Caught by its own test, not in production. */
const AX_LINE = /\[(e\d+)\]\s+(\S+)\s+"([^"]*)"/

/** Roles that can actually be clicked to give consent. A `RootWebArea` or `StaticText` carrying
 *  the same word is never the control. */
const CONTROL_ROLES = /^(button|link|menuitem)$/i

/** Find the `[eN]` ref of the authorize control. Matches the accessible NAME of a CONTROL node —
 *  never the surrounding document, and never free text that merely mentions the word. */
export function findAuthorizeRef(snapshot: string): string | null {
  for (const line of snapshot.split('\n')) {
    const m = AX_LINE.exec(line)
    if (!m) continue
    const [, ref, role, name] = m
    if (!CONTROL_ROLES.test(role)) continue
    if (!AUTHORIZE_NAME.test(name)) continue
    return `[${ref}]`
  }
  return null
}

/** Pull the code off the callback page. Exported because this is the one piece of parsing whose
 *  failure would be silent — a wrong match here files a garbage code and burns the flow. */
export function extractCode(pageText: string): string | null {
  for (const raw of pageText.split('\n')) {
    const line = raw.trim()
    if (CODE_LINE.test(line)) return line
  }
  return null
}

export interface DriveOptions {
  /** From `startReauth()`. Carries the PKCE challenge and state. */
  authorizeUrl: string
  /** Chrome profile DIRECTORY, e.g. `Default` or `Profile 2` — this is what selects the account. */
  chromeProfile: string
  /** Per-step wall clock. The whole drive is at most a few of these. */
  timeoutMs?: number
}

/**
 * Open the consent page as `chromeProfile`, approve, and return the callback code.
 *
 * The session is ALWAYS closed, including on every failure path — a leaked session holds a cloned
 * profile directory and a Chrome process, and this runs unattended on a loop, so a leak per failed
 * repair would accumulate silently until the host ran out of something.
 */
export async function driveConsent(opts: DriveOptions, deps?: DriveDeps): Promise<DriveResult> {
  const run = deps?.run ?? defaultRun
  const timeoutMs = opts.timeoutMs ?? 90_000

  const go = await run(
    [
      'act',
      'go',
      opts.authorizeUrl,
      '--browser',
      'chrome',
      '--browser-profile',
      opts.chromeProfile,
      '--share-accounts',
      // Not optional — see the MEASURED CONSTRAINTS block. Headless is served a stuck interstitial.
      '--headed',
      '--timeout',
      String(timeoutMs),
    ],
    timeoutMs + 30_000,
  )

  const session = lastJson(go.stdout)?.session_id
  if (typeof session !== 'string' || !session) {
    return { ok: false, reason: 'launch_failed', detail: go.stderr.slice(0, 400) || 'no session id in output' }
  }

  try {
    const text = await run(['eval', 'text', '--session', session], timeoutMs)
    const page = text.stdout

    // Order matters: a Cloudflare wall and a logged-out page BOTH lack an authorize control, so
    // checking for the control first would report `consent_not_found` for all three and hide the
    // two that have specific repairs.
    if (matchesAny(page, CLOUDFLARE_MARKERS)) return { ok: false, reason: 'cloudflare_challenge' }
    if (matchesAny(page, LOGGED_OUT_MARKERS)) {
      // DO NOT report this as "the profile has no session" — that is an inference, and it is the
      // one the janitor's docstring warns is wrong. An ABSENT cookie and an UNDECRYPTABLE one
      // render the identical page: Playwright's `launch_persistent_context` forces
      // `--use-mock-keychain`, so macOS OSCrypt uses a mock key, the real claude.ai session cookie
      // cannot be decrypted, and the profile reads as logged-OUT. The two need opposite repairs
      // (log in, vs. fix how the cookie is read), so the message names the SYMPTOM and points at
      // the instrument that distinguishes them rather than guessing.
      return {
        ok: false,
        reason: 'not_logged_in',
        detail: `profile ${opts.chromeProfile} rendered the logged-out page — either it has no claude.ai session, or its cookie could not be decrypted; check with a normal Chrome or the janitor's check-login.sh`,
      }
    }

    const snap = await run(['eval', 'snap', '--session', session], timeoutMs)
    const ref = findAuthorizeRef(snap.stdout)
    if (!ref) return { ok: false, reason: 'consent_not_found' }

    await run(['act', 'click', ref, '--session', session], timeoutMs)

    const after = await run(['eval', 'text', '--session', session], timeoutMs)
    const code = extractCode(after.stdout)
    if (!code) return { ok: false, reason: 'code_not_found' }

    return { ok: true, pastedCode: code }
  } finally {
    // Best-effort by design: a close that fails must not mask the real result, and there is
    // nothing useful a caller could do about it.
    await run(['act', 'close', '--session', session], 30_000).catch(() => undefined)
  }
}
