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
import { DEFAULT_MAX_REFRESH_FAILURES } from './cascade'

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
}

/** One supervisor conclusion — always an alert a human must act on. `code` is a stable machine
 *  code, e.g. 'pinning-env'. */
export interface Finding {
  code: string
  message: string
}

/**
 * PURE: turn gathered facts into alert findings. No I/O.
 *
 * Order: opt-in gate first (no-op when off), then the things that DEFEAT rotation entirely (a
 * pinning env var, an opted-in non-macOS host where the keychain swap cannot run), then the
 * per-slot credential alerts a human must act on.
 */
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
        `— the tick is hanging or failing; rotation is effectively OFF. Check rotator.log and the daemon log.`,
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
    // D3 (TRDD-WBYFTU2L): the cascade's RENEW_COOKIE / REAUTH legs are human/browser driven BY
    // DESIGN — an account stuck there is invisible unless we ALERT.
    if (s.cannotSelfRenewAgeS !== null && s.cannotSelfRenewAgeS > COOKIE_LEG_ALERT_S) {
      out.push({
        code: 'cookie-leg-stuck',
        message:
          `${s.email} has needed a one-time login for ${(s.cannotSelfRenewAgeS / 3600.0).toFixed(1)}h ` +
          `(> ${(COOKIE_LEG_ALERT_S / 3600.0).toFixed(0)}h) — its refresh path is dead and only a human can renew it; ` +
          `run /janitor-refresh-cc-logins before the fleet runs out of accounts.`,
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
    const meta = idx[email] as { refresh_failures?: number } | undefined
    const rf = typeof meta?.refresh_failures === 'number' ? meta.refresh_failures : 0
    out.push({ email, hasRefresh, expiresDays: days, refreshFailures: rf, cannotSelfRenewAgeS: null })
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
    optIn,
    onMacos,
    pinningEnv,
    slots: optIn ? slotFacts(root, now, deps) : [],
    tickCompletedAgeS: optIn ? tickCompletedAgeS(root, now) : null,
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
