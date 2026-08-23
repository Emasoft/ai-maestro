// OAuth-rotator supervisor — the governance layer. A faithful TS port of the janitor daemon's
// oauth_rotator/supervisor.py (TRDD-7DRSIKVZ). ALERT-ONLY: it gathers facts and surfaces the
// conditions a HUMAN must act on (a pinning env var that defeats rotation, an opted-in non-macOS
// host where the keychain swap cannot run, a stalled tick, a no-refresh setup-token nearing
// expiry, an account stuck in a human-only cascade leg). It heals NOTHING — the tick (tick.ts,
// driven by server-tick.ts) owns the 60 s rotation beat.
//
// OPT-IN GATED: a total no-op unless the rotator opt-in flag is present (root/opt-in.flag).
//
// Design split (so the decision logic is unit-testable with NO network / keychain):
//   - gatherFacts() — all I/O: read the flag, scan env, read slot metadata, tick stamp, liveness.
//   - diagnose(facts) — PURE: facts -> Finding[]. Heavily unit-tested.
//   - apply(findings, log) — records + logs the alert findings.
//
// R16: this module reads observable metadata and emits alerts. It writes only the observability
// sidecar (cookie-leg-since.json); it NEVER mutates a live credential.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'fs'
import os from 'os'
import path from 'path'

import { rotatorRoot, slotKeychainRead, type CredentialBlob } from './slots'
import { rotatorLogPath } from './decision-log'
// Consecutive keepalive-refresh failures after which a present-but-FAILING refresh token is
// treated as DEAD and escalated down the cascade (TRDD-HJGR4I5W). A few ticks: long enough to ride
// out a transient token-endpoint flake, short enough to surface a truly-dead token within the hour.
//
// Moved here 2026-08-07 (TRDD-XV9BLQC5) from the deleted `cascade.ts`, which was a TypeScript port
// of the janitor's `oauth_rotator/cascade.py` that nothing ever called: 8 of its 10 exports had
// zero production callers, and this constant — used at the `noUsableRefresh` decision below — was
// the only thing keeping the module reachable. A constant now lives with its sole consumer.
export const DEFAULT_MAX_REFRESH_FAILURES = 3

// A pinning env var is read at process start and overrides the keychain, so the live `claude`
// never sees a swapped credential — rotation is silently defeated.
export const PINNING_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] as const

// A no-refresh setup-token (~1y) cannot be keepalive-refreshed; warn this many days ahead so the
// human re-captures BEFORE it dies.
export const SETUP_REMIND_DAYS = 30

function envNum(name: string, dflt: number): number {
  const n = parseFloat((process.env[name] ?? '').trim())
  return Number.isFinite(n) ? n : dflt
}

// F4 (TRDD-7PYTX4E9): alert when the 60s tick hasn't COMPLETED in this long while the daemon is
// alive. The 2026-07-08 tick hung on a keychain ACL prompt and stopped silently for 30+ minutes
// with zero alarms — rotation was dead exactly when it was needed. 600s = ten missed beats.
export const TICK_STALL_ALERT_S = envNum('ROTATOR_TICK_STALL_ALERT_S', 600)

// D3 (TRDD-WBYFTU2L): alert when an account has been unable to SELF-renew (no usable refresh path
// — the cascade's human/browser-dependent RENEW_COOKIE / REAUTH legs) for this long. The
// 2026-07-18 incident: an account sat in the renew-cookie leg all day as a silent plan line — no
// actor executes that leg and nothing told the human. 2h: long enough that a transient refresh
// flake self-heals first, short enough to act before the fleet thins out.
export const COOKIE_LEG_ALERT_S = envNum('ROTATOR_COOKIE_LEG_ALERT_S', 7200)

/**
 * The janitor's refresh-failure cause vocabulary — `oauth_rotator/rotator.py`'s `REFRESH_FAIL_*`
 * constants (janitor#228), written into each slot's state-index meta as `last_refresh_failure`.
 *
 * OWNED THERE, MERELY CONSUMED HERE. The janitor pins it in its own source ("these four constants
 * are the classifier's whole output vocabulary; keep them stable, they are logged into slot
 * state"), and `cascade.ts` was deleted in b50cf390 precisely to stop this repo carrying a second
 * copy of a taxonomy the janitor already owns — the two copies had drifted 3× on constants alone.
 * So this list is a MIRROR of a published contract, not a classifier: nothing here decides a cause.
 *
 * The split that matters is not the four names, it is WHO OWNS THE REMEDY:
 *   `credential-dead`                        → the endpoint rejected the token (invalid_grant)
 *   `transport-refused` / `network` / `malformed` → nothing judged the credential; RETRYABLE
 * Collapsing them is exactly the defect this alert carried (TRDD-XV9BLQC5): measured 2026-08-20,
 * all three live slots read `network` — "retryable, benign" by the janitor's own classifier —
 * while this alert told the owner the refresh path was dead and only a human could fix it.
 */
export const REFRESH_FAIL_CAUSES = ['transport-refused', 'credential-dead', 'network', 'malformed'] as const
export type RefreshFailureCause = (typeof REFRESH_FAIL_CAUSES)[number]

/** Observable, non-secret metadata for one captured account slot. */
export interface SlotFact {
  email: string
  hasRefresh: boolean
  /** days until the token's expiresAt, or null */
  expiresDays: number | null
  /** consecutive failed keepalive refreshes; a dead present refresh token escalates to REAUTH */
  refreshFailures: number
  /** D3: seconds this slot has continuously lacked a USABLE refresh path (absent, or dead —
   *  refreshFailures ≥ the cascade's max) → it sits in a human/browser-dependent cascade leg.
   *  null = self-renewable. */
  cannotSelfRenewAgeS: number | null
  /** janitor#228: the CAUSE of the most recent failed keepalive exchange, or null when the rotator
   *  recorded none — a pre-#228 janitor classifies nothing, and a slot carrying no refresh token is
   *  deliberately never classified there ("reporting a cause there would invent one").
   *
   *  ONLY MEANINGFUL WHILE A FAILURE IS OUTSTANDING. The janitor resets `refresh_failures` to 0 on
   *  a successful exchange but does NOT clear this field (rotator.py:2238-2261), so it can outlive
   *  the failure it describes — read it together with `refreshFailures`, never alone.
   *
   *  Optional so every existing SlotFact literal stays valid and an older rotator's slot is simply
   *  uncaused rather than mistyped. */
  lastRefreshFailure?: RefreshFailureCause | null
}

/** Everything `diagnose` needs, gathered by `gatherFacts` (the only I/O). */
export interface Facts {
  optIn: boolean
  onMacos: boolean
  pinningEnv: string[]
  slots: SlotFact[]
  /** seconds since the rotator last stamped tick-completed.ts (null = never stamped / unreadable) */
  tickCompletedAgeS: number | null
  /** gates the tick-stalled alert — a stale stamp with the daemon DOWN is the daemon's own problem */
  daemonAlive: boolean
  /** The root these facts were gathered from. Carried so `diagnose` can NAME absolute paths in an
   *  alert without reaching for the ambient `rotatorRoot()` — which would print a path the facts
   *  did not come from whenever a caller passed its own root, the same per-root confusion
   *  `slotFacts` warns about. Required, not optional: a default here would be the ambient root
   *  again, silently, at exactly the call sites that forgot to set it. */
  root: string
}

/** One supervisor conclusion — always an alert a human must act on. `code` is a stable machine
 *  code, e.g. 'pinning-env'. */
export interface Finding {
  code: string
  message: string
}

/**
 * PURE. What the cookie-leg alert may HONESTLY say about one slot: the OBSERVED cause and the owner
 * of the remedy, never a verdict this process cannot reach (TRDD-XV9BLQC5 box 3).
 *
 * ⚠ THIS MESSAGE USED TO ASSERT THE OPPOSITE OF THE STATE. It read `its refresh path is dead and
 * only a human can renew it` for EVERY slot reaching this branch, and both halves overclaim from
 * evidence that establishes neither:
 *   - "dead"           — all we saw is N failed exchanges. The janitor classifies the cause
 *                        (janitor#228); measured 2026-08-20 all three live slots read `network`,
 *                        i.e. "retryable, benign", while this alert called them dead.
 *   - "only a human"   — the cookie rung mints a fresh pair with NO human, and that layer lives in
 *                        the janitor's keychain, which THIS PROCESS CANNOT SEE. `tick.ts` corrected
 *                        the identical claim on 2026-08-07; it was fixed there and left live here.
 * The alert CODE stays `cookie-leg-stuck` deliberately: alert-delivery's per-code escalating
 * backoff keys on it, so renaming would reset the backoff of a condition that holds for many beats.
 */
function cookieLegCause(s: SlotFact): string {
  // Named once: every branch whose remedy involves a human must still say that a cookie makes the
  // human optional, because that is the half this process cannot observe.
  const cookieTail =
    'A live claude.ai cookie can still mint a fresh pair with NO human — that layer lives in the ' +
    "janitor's keychain and is invisible from this process, so check it before running " +
    '/janitor-refresh-cc-logins.'
  if (!s.hasRefresh) {
    return `the slot carries no refresh token, so nothing here can renew it. ${cookieTail}`
  }
  // `refreshFailures > 0` is what keeps a STALE cause out of the message (see the field's docstring:
  // the janitor clears the counter on success but not the cause). In production a slot with a
  // refresh token only reaches this branch at refreshFailures ≥ DEFAULT_MAX_REFRESH_FAILURES, so
  // the guard is defence-in-depth for any other caller of this PURE function rather than a path a
  // live tick can take — stated plainly instead of claimed as tested.
  const cause = s.refreshFailures > 0 ? (s.lastRefreshFailure ?? null) : null
  const failed = `${s.refreshFailures} refresh exchanges failed, the last one`
  const retryable = 'the credential itself was never judged. Retryable: chase the transport, do not re-login on this evidence.'
  switch (cause) {
    case 'credential-dead':
      return `the endpoint REJECTED the refresh token (invalid_grant) after ${s.refreshFailures} failed exchanges — this credential really is dead. ${cookieTail}`
    case 'transport-refused':
      return `${failed} REFUSED IN TRANSPORT (Cloudflare 403/1010) — ${retryable}`
    case 'network':
      return `${failed} on the NETWORK (timeout/DNS/connection) — ${retryable}`
    case 'malformed':
      return `${failed} MALFORMED (a 200 with no access token) — ${retryable}`
    default:
      // Includes a value outside the janitor's vocabulary: state.json is a foreign file, and an
      // unrecognised string must never reach the operator dressed as a diagnosis.
      return `${s.refreshFailures} refresh exchanges failed with NO cause recorded, so whether this credential is dead is UNKNOWN from here. ${cookieTail}`
  }
}

/**
 * PURE: turn gathered facts into alert findings. No I/O.
 *
 * Order: opt-in gate first (no-op when off), then the things that DEFEAT rotation entirely (a
 * pinning env var, an opted-in non-macOS host where the keychain swap cannot run), then the
 * per-slot credential alerts a human must act on.
 */
/**
 * The COMPLETE alert vocabulary `diagnose` can emit — the supervisor beat's ownership claim over
 * the shared `active-alerts.json` (TRDD-W6PHZFC9).
 *
 * It lives HERE, beside the `code:` literals below, because a producer's vocabulary and its
 * ownership claim drift apart the moment they live in different files — and a claim that has
 * drifted NARROW silently stops reaping a real code, while one that has drifted WIDE resumes
 * evicting another producer's alerts, which is the bug this exists to fix.
 *
 * Stated as a literal set rather than "everything the tick does not own": a negation would hand
 * this producer every code a FUTURE third producer introduces, re-creating the same eviction
 * against a caller nobody has written yet.
 */
export const SUPERVISOR_ALERT_CODES: ReadonlySet<string> = new Set([
  'pinning-env',
  'non-macos',
  'tick-stalled',
  'setup-token-expiring',
  'cookie-leg-stuck',
])

/** Does the supervisor beat own `code`, i.e. is it this producer's to reap when it stops being
 *  reported? See `SUPERVISOR_ALERT_CODES`. */
export function ownsSupervisorAlert(code: string): boolean {
  return SUPERVISOR_ALERT_CODES.has(code)
}

export function diagnose(facts: Facts): Finding[] {
  if (!facts.optIn) return [] // rotator not activated on this machine -> silent no-op
  const out: Finding[] = []

  // A pinning env var overrides the keychain and silently defeats rotation. The daemon cannot
  // unset a user's shell env -> alert only.
  for (const v of facts.pinningEnv) {
    out.push({
      code: 'pinning-env',
      message: `$${v} is set — it overrides the keychain and DEFEATS rotation. Unset it so the rotator's keychain swaps take effect.`,
    })
  }

  if (!facts.onMacos) {
    // The keychain swap uses macOS `security`; off-mac the opt-in flag is set but rotation cannot
    // run here. Alert rather than thrash.
    out.push({
      code: 'non-macos',
      message: 'OAuth rotator is opted-in but the keychain swap is macOS-only; rotation cannot run on this platform.',
    })
    return out
  }

  // F4 (TRDD-7PYTX4E9): a stamp that goes stale while the daemon is ALIVE means the tick is hanging
  // or silently failing — rotation is OFF exactly when the user relies on it. null (never stamped)
  // counts as stalled too.
  if (facts.daemonAlive && (facts.tickCompletedAgeS === null || facts.tickCompletedAgeS > TICK_STALL_ALERT_S)) {
    const age = facts.tickCompletedAgeS !== null ? `${facts.tickCompletedAgeS.toFixed(0)}s` : 'never'
    out.push({
      code: 'tick-stalled',
      message:
        `the 60s rotator tick has not COMPLETED for ${age} (> ${TICK_STALL_ALERT_S.toFixed(0)}s) while the daemon is alive ` +
        `— the tick is hanging or failing; rotation is effectively OFF. Check the shared decision log ` +
        // The ABSOLUTE path, because this alert previously said "Check rotator.log" and that is not
        // an instruction anyone can follow: the file sits under a plugin data dir nobody memorises,
        // and the server did not write a byte of it, so even a reader who found it saw nothing the
        // server had decided. Both halves are fixed — we write it now, and we say where it is.
        `${rotatorLogPath(facts.root)} and the daemon log.`,
    })
  }

  // Per-slot credential alerts (a human must re-capture / re-auth).
  for (const s of facts.slots) {
    if (!s.hasRefresh && s.expiresDays !== null && s.expiresDays < SETUP_REMIND_DAYS) {
      out.push({
        code: 'setup-token-expiring',
        message: `${s.email} is a no-refresh setup-token expiring in ${s.expiresDays.toFixed(0)}d (< ${SETUP_REMIND_DAYS}d) — re-capture a full OAuth login for it.`,
      })
    }
    // D3 (TRDD-WBYFTU2L): the RENEW_COOKIE / REAUTH legs are human/BROWSER driven BY DESIGN — an
    // account stuck there is invisible unless we ALERT. Two legs, two different owners: the wording
    // is `cookieLegCause`'s job precisely because collapsing them into "only a human" is the defect
    // TRDD-XV9BLQC5 measured.
    if (s.cannotSelfRenewAgeS !== null && s.cannotSelfRenewAgeS > COOKIE_LEG_ALERT_S) {
      out.push({
        code: 'cookie-leg-stuck',
        message:
          `${s.email}: no usable refresh path for ${(s.cannotSelfRenewAgeS / 3600.0).toFixed(1)}h ` +
          `(> ${(COOKIE_LEG_ALERT_S / 3600.0).toFixed(0)}h) — ${cookieLegCause(s)}`,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// I/O wrappers (not unit-tested against the live system; exercised at runtime).
// ---------------------------------------------------------------------------

/** True iff the rotator opt-in flag is present. A single cheap stat — the gate every keychain
 *  read chokes on, so a non-opted-in machine pays nothing and never touches the OS keychain. */
export function optInPresent(root: string = rotatorRoot()): boolean {
  return existsSync(path.join(root, 'opt-in.flag'))
}

/**
 * D3 (TRDD-WBYFTU2L): persist the FIRST-SEEN epoch of each slot's cannot-self-renew state in
 * `cookie-leg-since.json` and stamp each SlotFact with its continuous age.
 *
 * "Cannot self-renew" = no usable refresh path (refresh token ABSENT, or present but DEAD —
 * refreshFailures ≥ the cascade's max) AND the access token is already dead or dies within a day
 * (expiresDays null / < 1). The runway clause keeps a healthy ~1y no-refresh SETUP token (covered
 * by setup-token-expiring at <30d) from tripping a login alert it doesn't need. The DURATION in
 * that state is the alert signal. Best-effort I/O: an unreadable/unwritable sidecar degrades to
 * age-unknown (null) — never breaks fact gathering.
 */
export function trackCannotSelfRenew(root: string, slots: readonly SlotFact[], now: number): SlotFact[] {
  const sidecar = path.join(root, 'cookie-leg-since.json')
  let since: Record<string, unknown> = {}
  try {
    if (existsSync(sidecar) && statSync(sidecar).isFile()) {
      const parsed = JSON.parse(readFileSync(sidecar, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) since = parsed as Record<string, unknown>
    }
  } catch {
    since = {}
  }
  const updated: Record<string, number> = {}
  const stamped: SlotFact[] = []
  for (const s of slots) {
    const noUsableRefresh = !s.hasRefresh || s.refreshFailures >= DEFAULT_MAX_REFRESH_FAILURES
    const dying = s.expiresDays === null || s.expiresDays < 1.0
    if (noUsableRefresh && dying) {
      const first = since[s.email]
      const firstF = typeof first === 'number' && Number.isFinite(first) ? first : now
      updated[s.email] = firstF
      stamped.push({ ...s, cannotSelfRenewAgeS: Math.max(0.0, now - firstF) })
    } else {
      stamped.push(s) // self-renewable → age stays null; any sidecar entry is dropped
    }
  }
  // Rewrite only when the pruned map differs (retired accounts don't leave stale entries).
  const sameKeys =
    Object.keys(updated).length === Object.keys(since).length &&
    Object.keys(updated).every((k) => since[k] === updated[k])
  if (!sameKeys) {
    try {
      const tmp = sidecar + '.tmp'
      writeFileSync(tmp, JSON.stringify(sortedObject(updated)))
      renameSync(tmp, sidecar)
    } catch {
      // observability state only — never break fact gathering
    }
  }
  return stamped
}

function sortedObject(o: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(o).sort()) out[k] = o[k]
  return out
}

/** Seconds since the rotator's tick-completed.ts stamp, or null when it is absent/garbage —
 *  which diagnose treats as stalled. */
export function tickCompletedAgeS(root: string, now: number): number | null {
  try {
    const raw = readFileSync(path.join(root, 'tick-completed.ts'), 'utf8').trim()
    const t = parseFloat(raw)
    if (!Number.isFinite(t)) return null
    return Math.max(0.0, now - t)
  } catch {
    return null
  }
}

/** Injectable I/O for gatherFacts — mirrors tick.ts's dependency-injection so the wiring is
 *  testable and the server-specific liveness probe is supplied at the call site (part 3). */
export interface GatherDeps {
  /** Read one slot's credential blob (keychain-first, plaintext-file fallback handled inside). */
  readSlotBlob?: (email: string) => CredentialBlob | null
  /** Is the process that owns the tick alive? The Python probes the janitor daemon; in the server
   *  the caller passes whether the in-process oauth-rotator tick is armed. Defaults to false — the
   *  faithful fail-safe: an unknown liveness SILENCES the tick-stalled alert rather than false-alarm. */
  daemonAlive?: () => boolean
  /** How OLD is the beat owner's last completed tick, in seconds? Defaults to `tickCompletedAgeS`,
   *  which reads `tick-completed.ts` — correct in the JANITOR, where the daemon's rotator writes
   *  that file (`oauth_rotator/rotator.py`).
   *
   *  ⚠ IT IS WRONG AS A DEFAULT FOR THE SERVER, which is why this seam exists (TRDD-IGCSDTIU).
   *  Nothing in this repo writes `tick-completed.ts` — repo-wide the name appears only in the read
   *  below, its comments, and test fixtures. The janitor daemon EXITS while a server owns the host,
   *  so on a server-owned host that stamp freezes at whenever the daemon last ran. `diagnose` then
   *  reads "armed + stale" and concludes the tick is hanging — which is a SOUND inference from a
   *  FALSE premise, and the loudest possible way to be wrong: it emits `rotation is effectively OFF`
   *  every beat, forever, beside real alerts that then get discounted with it. Measured 2026-08-07:
   *  368930 s claimed while the tick was completing every 60 s, matching the frozen stamp's age to
   *  the second.
   *
   *  So the SERVER injects a probe reading the stamp ITS OWN tick writes. The rule this encodes:
   *  a liveness signal must be written by the thing it is judging. */
  tickAgeS?: (root: string, now: number) => number | null
  now?: () => number
}

/** Read non-secret metadata for every captured slot (never a token VALUE beyond presence +
 *  expiresAt). Emails come from the state.json index plus any legacy plaintext slot file. */
function slotFacts(root: string, now: number, deps: GatherDeps): SlotFact[] {
  // KEYCHAIN-SAFETY GATE: refuse to touch the OS keychain unless the user has OPTED IN. gatherFacts
  // already checks optIn before calling here, so this is redundant-safe — but it is the choke-point
  // that guarantees "paused" means ZERO keychain access (a locked keychain raises a GUI unlock
  // prompt on every read otherwise).
  if (!optInPresent(root)) return []

  // Read the slots INDEX from the PASSED root's state.json (root-scoped, exactly like the Python —
  // NOT the global loadState(), which would read a different root and break per-root gathering).
  let idx: Record<string, unknown> = {}
  const sf = path.join(root, 'state.json')
  try {
    if (existsSync(sf) && statSync(sf).isFile()) {
      const parsed = (JSON.parse(readFileSync(sf, 'utf8')) as { slots?: unknown }).slots
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) idx = parsed as Record<string, unknown>
    }
  } catch {
    idx = {}
  }
  const emails: string[] = Object.keys(idx)
  const slotsDir = path.join(root, 'slots')
  try {
    if (existsSync(slotsDir) && statSync(slotsDir).isDirectory()) {
      for (const f of readdirSync(slotsDir).filter((n) => n.endsWith('.json')).sort()) {
        const stem = f.slice(0, -'.json'.length)
        if (!emails.includes(stem)) emails.push(stem)
      }
    }
  } catch {
    // no legacy dir — the index is authoritative
  }
  if (emails.length === 0) return []

  const readBlob = deps.readSlotBlob ?? ((email: string) => slotKeychainRead(email))
  const out: SlotFact[] = []
  for (const email of emails) {
    let blob: CredentialBlob | null = readBlob(email)
    if (blob === null) {
      // legacy plaintext fallback (pre-migration / no keyring)
      const p = path.join(slotsDir, email.replace(/\//g, '_') + '.json')
      try {
        if (existsSync(p) && statSync(p).isFile()) blob = JSON.parse(readFileSync(p, 'utf8')) as CredentialBlob
      } catch {
        blob = null
      }
    }
    const rec = blob as Record<string, unknown> | null
    const inner = (rec && typeof rec === 'object' ? (rec['claudeAiOauth'] ?? rec) : null) as Record<string, unknown> | null
    if (!inner || typeof inner !== 'object') continue
    const hasRefresh = Boolean(inner['refreshToken'] ?? inner['refresh_token'])
    const exp = inner['expiresAt'] ?? inner['expires_at']
    let days: number | null = null
    if (typeof exp === 'number' && Number.isFinite(exp)) {
      const secs = exp > 1e12 ? exp / 1000 : exp
      days = (secs - now) / 86400.0
    }
    const meta = idx[email] as { refresh_failures?: number; last_refresh_failure?: unknown } | undefined
    const rf = typeof meta?.refresh_failures === 'number' ? meta.refresh_failures : 0
    // janitor#228: the failure CAUSE rides in the SAME meta object we already read the counter
    // from, so surfacing it costs no extra I/O. VALIDATED rather than passed through — state.json
    // belongs to another process, and a value outside the janitor's published vocabulary must never
    // reach the operator as if it were a diagnosis.
    const rawCause = meta?.last_refresh_failure
    const cause =
      typeof rawCause === 'string' && (REFRESH_FAIL_CAUSES as readonly string[]).includes(rawCause)
        ? (rawCause as RefreshFailureCause)
        : null
    out.push({ email, hasRefresh, expiresDays: days, refreshFailures: rf, cannotSelfRenewAgeS: null, lastRefreshFailure: cause })
  }
  return trackCannotSelfRenew(root, out, now)
}

/** Collect every observable fact `diagnose` needs. The ONLY I/O entry point. */
export function gatherFacts(opts: { root?: string; deps?: GatherDeps } = {}): Facts {
  const root = opts.root ?? rotatorRoot()
  const deps = opts.deps ?? {}
  const now = deps.now ? deps.now() : Date.now() / 1000
  const optIn = optInPresent(root)
  const onMacos = os.platform() === 'darwin'
  const pinningEnv = PINNING_ENV.filter((v) => process.env[v])
  return {
    root,
    optIn,
    onMacos,
    pinningEnv,
    slots: optIn ? slotFacts(root, now, deps) : [],
    // TRDD-IGCSDTIU. The `??` is load-bearing in BOTH directions, so it carries a COMPLEMENTARY
    // neuter pair — one mutation certifies only half a conditional, and the red sets below are
    // DISJOINT, which is what proves the halves are pinned independently rather than together.
    //
    // NEUTER RUN (2026-08-07 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
    //   s/\(deps\.tickAgeS \?\? tickCompletedAgeS\)\(root, now\)/tickCompletedAgeS(root, now)/
    //     → 2 red / 27 green:  the SERVER half — the false alarm returns
    //         a frozen janitor stamp no longer alerts, and a genuinely hung tick still does
    //         gatherFacts CONSULTS an injected tickAgeS instead of tick-completed.ts
    //   s/\(deps\.tickAgeS \?\? tickCompletedAgeS\)/(deps.tickAgeS ?? (() => null))/
    //     → 2 red / 27 green:  the JANITOR half — the unchanged path breaks
    //         gatherFacts still reads tick-completed.ts when NO probe is injected (the janitor path)
    //         assembles Facts from the root + injected blob reader + daemonAlive + now
    //
    // That second red is a PRE-EXISTING test, and it is the useful signal: the janitor path was
    // already covered, so the fallback demonstrably preserves it rather than merely claiming to.
    tickCompletedAgeS: optIn ? (deps.tickAgeS ?? tickCompletedAgeS)(root, now) : null,
    daemonAlive: optIn ? (deps.daemonAlive ? deps.daemonAlive() : false) : false,
  }
}

/** What `apply` did — alert codes recorded + logged (no heals: the tick owns rotation now). */
export interface SupervisorResult {
  alerts: string[]
}

/** Record + log every alert finding. The supervisor heals nothing now that the tick owns the 60 s
 *  beat, so this just surfaces the human-actionable conditions (and returns their codes). */
export function apply(findings: readonly Finding[], log: (msg: string) => void = () => {}): SupervisorResult {
  const res: SupervisorResult = { alerts: [] }
  for (const f of findings) {
    res.alerts.push(f.code)
    log(`[oauth-supervisor] ALERT ${f.code}: ${f.message}`)
  }
  return res
}
