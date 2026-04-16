/**
 * Kill switch: emergency lockdown on repeated auth failures.
 *
 * When consecutive authentication failures across ALL endpoints exceed
 * the configured threshold (default: 20), the system enters lockdown
 * mode. In lockdown, all non-GET/HEAD/OPTIONS requests are rejected
 * with 503 until the lockout duration expires (default: 30 minutes)
 * or the system owner manually resets via a GET /api/settings/security/status endpoint.
 *
 * This stops brute-force attacks, credential stuffing, and automated
 * exploitation cold — even if the attacker has a valid session cookie,
 * all write operations are blocked.
 *
 * The counter resets to 0 on every SUCCESSFUL authentication.
 */

import { loadSecurityConfig } from '@/lib/security-config'

interface KillSwitchState {
  consecutiveFailures: number
  lockdownUntil: number | null
  lastFailureAt: number | null
  activatedCount: number // how many times the kill switch has fired since boot
}

interface KillSwitchGlobals {
  __aiMaestroKillSwitch?: KillSwitchState
}

const g = globalThis as unknown as KillSwitchGlobals
const state: KillSwitchState = g.__aiMaestroKillSwitch ?? {
  consecutiveFailures: 0,
  lockdownUntil: null,
  lastFailureAt: null,
  activatedCount: 0,
}
if (!g.__aiMaestroKillSwitch) g.__aiMaestroKillSwitch = state

/** Record a failed authentication attempt. */
export function recordAuthFailure(): void {
  state.consecutiveFailures++
  state.lastFailureAt = Date.now()

  const cfg = loadSecurityConfig().killSwitch
  if (state.consecutiveFailures >= cfg.maxConsecutiveAuthFailures) {
    state.lockdownUntil = Date.now() + cfg.lockoutDurationMinutes * 60_000
    state.activatedCount++
    console.error(
      `[KILL-SWITCH] ⚠ ACTIVATED — ${state.consecutiveFailures} consecutive auth failures. ` +
      `System locked for ${cfg.lockoutDurationMinutes} minutes. Activation #${state.activatedCount}.`
    )
  }
}

/** Record a successful authentication — resets the failure counter. */
export function recordAuthSuccess(): void {
  state.consecutiveFailures = 0
}

/** Check if the system is in lockdown. */
export function isLockedDown(): boolean {
  if (!state.lockdownUntil) return false
  if (Date.now() >= state.lockdownUntil) {
    // Lockout expired — auto-reset
    state.lockdownUntil = null
    state.consecutiveFailures = 0
    console.log('[KILL-SWITCH] Lockout period expired — system unlocked')
    return false
  }
  return true
}

/** Manual reset by system owner (via security status endpoint). */
export function resetKillSwitch(): void {
  state.lockdownUntil = null
  state.consecutiveFailures = 0
  console.log('[KILL-SWITCH] Manually reset by system owner')
}

/** Diagnostic info for the security status endpoint. */
export function getKillSwitchStatus(): {
  isLocked: boolean
  consecutiveFailures: number
  lockdownUntil: number | null
  activatedCount: number
  lastFailureAt: number | null
} {
  return {
    isLocked: isLockedDown(),
    consecutiveFailures: state.consecutiveFailures,
    lockdownUntil: state.lockdownUntil,
    activatedCount: state.activatedCount,
    lastFailureAt: state.lastFailureAt,
  }
}
