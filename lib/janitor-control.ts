// READ-ONLY reader for the janitor's machine-wide fleet-control plane
// (TRDD-CHN16JXZ / ai-maestro#79 §7.1). The janitor daemon and the ai-maestro
// server are the two writers/readers that must agree on fleet mode so they never
// fight over the same agents. The janitor OWNS this dir; the server only READS it.
//
// WHY the server reads it: before the server actuates any fleet recovery
// (CHN16JXZ), it must honor a machine-wide STOP — a kill-switch, a global pause,
// or maintenance mode. Driving an agent the owner has deliberately halted would be
// the exact "two daemons fighting" corruption the one-daemon-per-host rule guards
// against (#79). So recovery consults `fleetActuationBlocked()` first.
//
// HARD RULES this module encodes (both are janitor-stated hazards, ai-maestro#79):
//  1. NEVER WRITE. The path is FIXED and foreign, so an accidental write here
//     ratchets the whole fleet into a mode nothing lifts. This module has no writer
//     and exports none. Reads only.
//  2. NEVER treat a status/absent read as a fault. A read error, a missing dir, or a
//     missing flag all mean "flag not set" — fail-safe toward LETTING the fleet run,
//     never toward halting it (a crashed reader must not silently freeze the fleet).
//
// The dir resolution matches the janitor's own resolver EXACTLY (fixed
// `~/.claude/janitor-control/`, test override `$JANITOR_CONTROL_DIR`) so the server
// and the janitor contend on the SAME dir in prod AND in tests. Using a different
// override name would let a test isolate one side and not the other — a silent skew.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The six mode flags the janitor publishes to the fixed control dir (audit §2.1;
 *  janitor `lib/global_state.py:149-152`). Presence IS the signal — an empty file
 *  set means the flag is set; absence means it is not. */
export const FLEET_CONTROL_FLAGS = [
  'kill-switch.flag',
  'maintenance-mode.flag',
  'global-pause.flag',
  'reload-needed.flag',
  'skills-reload-needed.flag',
  // TRDD-4F40QCCH / ai-maestro#102. This read `'version-update-request'` — no `ed`, no `.flag`
  // suffix — so `fleetControlFlagPresent` stat'd a path the janitor never writes and reported
  // `absent` for a flag that was PRESENT on disk the whole time. Verified against the WRITER,
  // not inferred from one file: janitor 0.64.1 `lib/global_state.py:596` resolves
  // `_control_path("version-update-requested.flag")`.
  //
  // This is precisely the silent-healthy failure the fixed control path exists to prevent — the
  // janitor's own architecture doc warns that a foreign reader guessing a rung "fails silently as
  // flag-absent, i.e. ignores the control plane while looking healthy". A wrong FILENAME lands in
  // the same place as a wrong DIRECTORY, and is harder to see because nothing errors.
  'version-update-requested.flag',
] as const

export type FleetControlFlag = (typeof FLEET_CONTROL_FLAGS)[number]

/** The flags that mean "the fleet is deliberately halted — do NOT drive agents".
 *  The reload/skills-reload/version-update flags are work requests, NOT stops, so
 *  they never block actuation. */
const ACTUATION_BLOCKING_FLAGS: readonly FleetControlFlag[] = [
  'kill-switch.flag',
  'global-pause.flag',
  'maintenance-mode.flag',
]

/** The fixed control-plane dir. Resolved at CALL time (HOME may be monkey-patched
 *  in tests; a frozen module-load constant would miss it — the same trap the janitor
 *  documents for `_liveness_path`). Test override: `$JANITOR_CONTROL_DIR`. */
export function janitorControlDir(): string {
  const override = process.env.JANITOR_CONTROL_DIR?.trim()
  if (override) return override
  return path.join(os.homedir(), '.claude', 'janitor-control')
}

/** True iff `<flag>` is present in the control dir. Never throws: any error (missing
 *  dir, unreadable, race) reads as "not present" — fail-safe toward running. */
export function fleetControlFlagPresent(flag: FleetControlFlag): boolean {
  try {
    return fs.existsSync(path.join(janitorControlDir(), flag))
  } catch {
    return false
  }
}

/** Snapshot of every mode flag's presence. Read-only; creates nothing. */
export function readFleetControlFlags(): Record<FleetControlFlag, boolean> {
  const out = {} as Record<FleetControlFlag, boolean>
  for (const flag of FLEET_CONTROL_FLAGS) out[flag] = fleetControlFlagPresent(flag)
  return out
}

/** THE gate the fleet-recovery actuator consults before touching any agent: is the
 *  fleet under a machine-wide STOP (kill-switch / global-pause / maintenance)? When
 *  true, recovery must stand down — the halt was deliberate and is the owner's, not a
 *  fault to recover from. Fail-safe: on any read trouble this returns false (do not
 *  freeze the fleet because the control dir was briefly unreadable). */
export function fleetActuationBlocked(): { blocked: boolean; reason: FleetControlFlag | null } {
  for (const flag of ACTUATION_BLOCKING_FLAGS) {
    if (fleetControlFlagPresent(flag)) return { blocked: true, reason: flag }
  }
  return { blocked: false, reason: null }
}
