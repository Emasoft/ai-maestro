/**
 * Fleet-level watchdog: is the tmux server itself keychain-blind? (TRDD-78J4I4QS,
 * EHT of TRDD-CNF1X3J7)
 *
 * TRDD-CNF1X3J7's `preflightPaneKeychain` refuses to LAUNCH a client in a pane
 * that cannot read the login keychain — correct, but per-agent. The blindness is
 * a property of the tmux SERVER every pane is forked from, so once it happens
 * every future launch refuses, one at a time, with no fleet-level signal tying
 * the refusals together. The 2026-07-12 outage was exactly this: N agents
 * silently useless and nothing said "the server they were all forked from is the
 * actual problem — restarting agents will not help."
 *
 * This module is a DETECTOR, not a repairer. Recreating the tmux server kills
 * every pane on it — far too large an action for a background loop to take
 * unasked. It runs the same probe used at launch time, in a THROWAWAY pane, once
 * per sweep, and raises (or clears) one fleet-wide alarm.
 */
import { execFile } from 'child_process'

import { getRuntime, preflightPaneKeychain, type AgentRuntime } from '@/lib/agent-runtime'
import { ensureKeychainProbeInstalled } from '@/lib/agent-keychain-probe'
import { AGENTS_ROOT } from '@/lib/agent-workdir-policy'

/**
 * The throwaway session name. A fixed, well-known name (not one per sweep) so a
 * crashed prior sweep's leftover pane is trivially recognisable and reused/killed
 * by name — never a reason to touch any OTHER session.
 */
export const TMUX_KEYCHAIN_WATCHDOG_SESSION = 'aim-kc-watchdog'

/**
 * Secrets CLIs whose auto-unlock stashes its passphrase in the LOGIN keychain.
 * Such a CLI cannot be sitting at a passphrase prompt unless its pane's keychain
 * is unreadable — the same alarm, arriving earlier (the 2026-07-12 outage had
 * three panes stuck at exactly this prompt for hours, dismissed as junk).
 */
const SECRETS_CLI_CANARY_COMMANDS: ReadonlySet<string> = new Set(['dotenclave'])

const REMEDIATION =
  'the tmux server is keychain-blind; every agent forked from it will fail to authenticate. ' +
  'Recreate the server from a shell verified with the same probe; restarting individual agents will NOT help.'

// Own promise wrapper, NOT util.promisify(execFile) — Node's execFile carries a
// util.promisify.custom symbol that returns {stdout, stderr}; a plain vi.fn()
// mock in tests has no such symbol, so promisify's DEFAULT behavior (resolve
// with only the first callback arg) would silently drop stdout. Handling the
// callback ourselves keeps the contract identical in prod and in tests.
function execFileP(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

export type TmuxServerKeychainStatus = 'ok' | 'blind' | 'skip'

/**
 * Run the keychain probe ONCE, in a throwaway pane on the DEFAULT tmux server —
 * the same server every agent pane is forked from, so its verdict speaks for the
 * whole fleet. macOS-only: the blindness this detects does not exist elsewhere,
 * so off-darwin we skip (never falsely refuse — mirrors preflightPaneKeychain's
 * own platform gate).
 *
 * FAIL-SAFE: anything short of a proven 'ok' — a refused probe OR any error
 * standing up the throwaway pane itself — is reported 'blind'. "Cannot prove it
 * works" must never resolve to "ok" (the same rule preflightPaneKeychain
 * enforces per-launch; this is its fleet-level twin).
 */
export async function checkTmuxServerKeychainOnce(
  runtime: AgentRuntime = getRuntime(),
): Promise<{ status: TmuxServerKeychainStatus; reason?: string }> {
  if (process.platform !== 'darwin') return { status: 'skip' }

  try {
    await runtime.createSession(TMUX_KEYCHAIN_WATCHDOG_SESSION, AGENTS_ROOT)
    await ensureKeychainProbeInstalled()
    const result = await preflightPaneKeychain(runtime, TMUX_KEYCHAIN_WATCHDOG_SESSION)

    if (result.status === 'refuse') {
      return { status: 'blind', reason: result.reason ?? 'keychain_unreadable' }
    }
    // 'ok' is the only other reachable outcome here — preflightPaneKeychain's
    // own 'skip' branch can't fire since we already gated on darwin above.
    return { status: 'ok' }
  } catch (err) {
    return {
      status: 'blind',
      reason: `tmux_server_probe_failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    // ALWAYS — never leave the throwaway pane behind, whether creation, the
    // probe install, or the probe itself failed.
    await runtime.killSession(TMUX_KEYCHAIN_WATCHDOG_SESSION).catch(() => {})
  }
}

/**
 * Is any pane's foreground command a known secrets-CLI canary? Tolerates every
 * failure silently (no tmux server, no panes, tmux missing) — none of those are
 * a keychain verdict, only the absence of a signal.
 */
async function checkSecretsCliCanary(): Promise<{ tripped: boolean; command?: string }> {
  try {
    const { stdout } = await execFileP('tmux', ['list-panes', '-a', '-F', '#{pane_current_command}'])
    const commands = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    const hit = commands.find((c) => SECRETS_CLI_CANARY_COMMANDS.has(c))
    return hit ? { tripped: true, command: hit } : { tripped: false }
  } catch {
    return { tripped: false }
  }
}

interface AlarmState {
  active: boolean
  since?: string
  message?: string
}

let alarmState: AlarmState = { active: false }

/** Current fleet-level alarm state. Read by the dashboard / any status surface. */
export function getTmuxServerKeychainAlarm(): AlarmState {
  return { ...alarmState }
}

/** Test-only reset — mirrors resetKeychainProbeInstallForTests' shape. */
export function resetTmuxServerKeychainAlarmForTests(): void {
  alarmState = { active: false }
}

/**
 * One fleet-level sweep: the throwaway-pane probe plus the canary, both
 * macOS-only (the underlying failure mode is a login-keychain property that does
 * not exist elsewhere, so a non-darwin sweep touches tmux NOT AT ALL — not even
 * the canary's list-panes call).
 *
 * On 'blind' or a tripped canary: raise the alarm and log ONE fleet-level error
 * line (never one per agent — an agent-count of log lines for a single root
 * cause is the alarm-fatigue failure mode test 2 exists to prevent).
 * On 'ok': clear the alarm and log NOTHING — silence is the steady state.
 * On 'skip': leave the alarm exactly as it was (no verdict was reached).
 */
let sweepInFlight = false

export async function sweepTmuxServerKeychain(runtime: AgentRuntime = getRuntime()): Promise<void> {
  if (process.platform !== 'darwin') return

  // Re-entrancy guard: the probe can legitimately take up to its ~8s timeout,
  // and the throwaway session name is FIXED. Two overlapping sweeps would race
  // on that name — the loser gets "duplicate session", which the fail-safe in
  // checkTmuxServerKeychainOnce would then report as 'blind': a FALSE fleet
  // alarm caused by nothing but scheduling. One sweep at a time; an overlap
  // simply skips (the next interval re-checks anyway).
  if (sweepInFlight) return
  sweepInFlight = true
  try {
    await sweepTmuxServerKeychainInner(runtime)
  } finally {
    sweepInFlight = false
  }
}

async function sweepTmuxServerKeychainInner(runtime: AgentRuntime): Promise<void> {
  const probe = await checkTmuxServerKeychainOnce(runtime)
  const canary = await checkSecretsCliCanary()

  if (probe.status === 'blind' || canary.tripped) {
    const detail = probe.status === 'blind'
      ? probe.reason
      : `secrets-CLI canary: "${canary.command}" sitting at a prompt (cannot unlock without login-keychain access)`
    alarmState = {
      active: true,
      since: alarmState.active ? alarmState.since : new Date().toISOString(),
      message: REMEDIATION,
    }
    console.error(`[TmuxServerKeychainWatchdog] ${REMEDIATION}${detail ? ` (${detail})` : ''}`)
    return
  }

  if (probe.status === 'ok') {
    alarmState = { active: false }
  }
  // probe.status === 'skip' is unreachable here (already gated above), kept
  // only so a future change to the gate above degrades safely.
}
