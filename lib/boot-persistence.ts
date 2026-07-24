// Machine-level boot persistence self-check (TRDD-NIU5RQ1S).
//
// THE HOLE THIS EXISTS TO MAKE VISIBLE: `services/boot-restore-service.ts` opens by asserting
// "pm2's LaunchAgent brings the AI Maestro server back up". On a host where `pm2 startup` was
// never run, that is FALSE — and every layer beneath it (boot-restore, agent wake, conversation
// resume) is dead code after a power loss, because the server never starts. The whole resurrection
// chain sits behind a door that does not open, and nothing anywhere says so.
//
// Worse, it LOOKS healthy from the inside: `pm2 save` writes `~/.pm2/dump.pm2`, so the resurrect
// LIST exists and an operator glancing at it concludes persistence is configured. What is missing
// is the thing that RUNS `pm2 resurrect` at boot. Both halves are required:
//
//   1. the OS-level unit (launchd LaunchAgent on macOS / systemd unit on Linux) that starts pm2,
//   2. a saved process list that actually CONTAINS this app.
//
// A stale dump is its own trap: it resurrects whatever was saved months ago, which may not include
// this app at all — so "dump exists" is checked for CONTENT, not mere presence.
//
// This module only READS and REPORTS. Installing the unit writes outside the project directory,
// which the agent is not permitted to do — `scripts/install-boot-persistence.sh` is the human's
// one command. Turning an invisible hole into a loud one is the part that belongs here.

import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/** What the filesystem says, separated from the verdict so the logic is testable without a host. */
export interface BootPersistenceFacts {
  platform: NodeJS.Platform
  /** Filenames present in the launchd agent/daemon dirs (macOS) or systemd unit dirs (Linux). */
  unitFileNames: string[]
  /** Does `~/.pm2/dump.pm2` exist? */
  dumpExists: boolean
  /** Does that dump name this app? null when the dump is absent or unreadable. */
  dumpContainsApp: boolean | null
  /** Is the unit actually BOOTSTRAPPED in the running init domain? null when undeterminable.
   *  Distinct from presence on disk — see the `unit-not-loaded` branch for why they differ. */
  unitLoaded?: boolean | null
}

export type BootPersistenceStatus =
  | 'ok'
  | 'missing-unit'
  | 'unit-not-loaded'
  | 'missing-dump'
  | 'stale-dump'
  | 'unknown-platform'

export interface BootPersistenceVerdict {
  status: BootPersistenceStatus
  /** True ONLY when the full chain is proven. Anything uncertain is false — see the fail-safe note. */
  willSurviveReboot: boolean
  /** One line, written to be actionable at 3am by someone who did not build this. */
  message: string
}

/** A launchd/systemd unit filename that belongs to pm2. Deliberately loose: pm2's own template is
 *  `pm2.<user>.plist`, but distributions and `--service-name` overrides vary, and a false NEGATIVE
 *  here (nagging about a unit that exists) is far cheaper than a false positive (silence on a host
 *  that will never come back). */
export function looksLikePm2Unit(fileName: string): boolean {
  return /pm2/i.test(fileName)
}

/**
 * Decide whether this host will bring the server back after a power loss. PURE — every input is in
 * `facts`, so the decision is unit-tested without touching a real machine.
 *
 * FAIL-SAFE DIRECTION: uncertainty resolves to "will NOT survive". A wrong "you are fine" is the
 * one answer with a real cost — the operator stops looking, and discovers the truth only after an
 * outage has already lost the fleet's work.
 */
export function evaluateBootPersistence(facts: BootPersistenceFacts): BootPersistenceVerdict {
  if (facts.platform !== 'darwin' && facts.platform !== 'linux') {
    return {
      status: 'unknown-platform',
      willSurviveReboot: false,
      message:
        `Boot persistence UNVERIFIED on platform "${facts.platform}" — this check knows launchd (macOS) ` +
        `and systemd (Linux) only. Confirm by hand that pm2 restarts at boot.`,
    }
  }

  const hasUnit = facts.unitFileNames.some(looksLikePm2Unit)
  const mechanism = facts.platform === 'darwin' ? 'launchd LaunchAgent' : 'systemd unit'

  if (!hasUnit) {
    return {
      status: 'missing-unit',
      willSurviveReboot: false,
      message:
        `⚠ NO ${mechanism} for pm2 — after a reboot or power loss pm2 will NOT start, so the server ` +
        `never comes up and NO agent is restored. Boot-restore, conversation resume and fleet ` +
        `recovery are all unreachable until this is fixed. Run: bash scripts/install-boot-persistence.sh`,
    }
  }

  if (!facts.dumpExists) {
    return {
      status: 'missing-dump',
      willSurviveReboot: false,
      message:
        `⚠ pm2's ${mechanism} is installed but there is NO saved process list (~/.pm2/dump.pm2), so ` +
        `boot resurrects NOTHING. Run: pm2 save`,
    }
  }

  if (facts.dumpContainsApp === false) {
    return {
      status: 'stale-dump',
      willSurviveReboot: false,
      message:
        `⚠ pm2's saved process list does not contain this app — boot would resurrect a STALE set and ` +
        `the server would stay down. Run: pm2 save`,
    }
  }

  // dumpContainsApp === null means the dump exists but could not be read/parsed. Do not claim OK.
  if (facts.dumpContainsApp === null) {
    return {
      status: 'missing-dump',
      willSurviveReboot: false,
      message:
        `⚠ pm2's saved process list (~/.pm2/dump.pm2) exists but could not be read — cannot confirm ` +
        `this app would be resurrected. Re-run: pm2 save`,
    }
  }

  // PRESENT-ON-DISK ≠ SUPERVISED-RIGHT-NOW, and conflating them was this module's own first bug.
  // The unit file can sit in LaunchAgents while no job is bootstrapped in the running domain (a
  // `launchctl bootout`, or an install that never bootstrapped). A REBOOT still recovers — login
  // loads ~/Library/LaunchAgents and RunAtLoad fires — so this is not a reboot failure and must not
  // be reported as one. What it IS: pm2 is unsupervised until then, so if the pm2 DAEMON dies today
  // nothing (not even the unit's KeepAlive, which only applies to a loaded job) brings it back. That
  // is a different interruption than the one the reboot flag answers, so it gets its own status
  // rather than being folded into either OK or a false alarm.
  if (facts.unitLoaded === false) {
    return {
      status: 'unit-not-loaded',
      willSurviveReboot: true,
      message:
        `Boot persistence OK for a REBOOT, but pm2's ${mechanism} is not currently loaded — until the ` +
        `next login nothing supervises pm2, so a pm2-daemon crash today would NOT be recovered. ` +
        `Load it now with: launchctl bootstrap gui/$UID ~/Library/LaunchAgents/pm2.$USER.plist`,
    }
  }

  return {
    status: 'ok',
    willSurviveReboot: true,
    message: `Boot persistence OK — ${mechanism} present and the saved process list includes this app.`,
  }
}

function safeListDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** The launchd / systemd directories a pm2 startup unit can land in, per platform. */
export function unitSearchDirs(platform: NodeJS.Platform, homedir: string): string[] {
  if (platform === 'darwin') {
    return [path.join(homedir, 'Library', 'LaunchAgents'), '/Library/LaunchDaemons', '/Library/LaunchAgents']
  }
  if (platform === 'linux') {
    return ['/etc/systemd/system', path.join(homedir, '.config', 'systemd', 'user')]
  }
  return []
}

/** Does the pm2 dump carry an entry whose `name` is this app? null when the dump cannot be parsed
 *  as the expected array-of-processes, so the caller can fall back rather than conclude "no". */
export function namedInDump(raw: string, appName: string): boolean | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.some((p) => typeof p === 'object' && p !== null && (p as { name?: unknown }).name === appName)
  } catch {
    return null
  }
}

/**
 * Ask the init system whether a pm2 job is actually bootstrapped right now. Returns null whenever
 * the answer cannot be established — an unknown must never be reported as a "no", which would nag
 * on a healthy host and train the operator to ignore this line.
 *
 * The listing is matched on the LABEL, not the filename: pm2's macOS template installs
 * `pm2.<user>.plist` but labels the job `com.PM2`, so a filename-derived label lookup misses it.
 */
function detectUnitLoaded(platform: NodeJS.Platform): boolean | null {
  const probe: [string, string[]] | null =
    platform === 'darwin'
      ? ['launchctl', ['list']]
      : platform === 'linux'
        ? ['systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager']]
        : null
  if (!probe) return null
  try {
    const out = execFileSync(probe[0], probe[1], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] })
    return out.split('\n').some(looksLikePm2Unit)
  } catch {
    return null
  }
}

/** Gather the facts from this host, then decide. Never throws — a self-check that crashes the boot
 *  it is auditing would be worse than the hole it reports. */
export function detectBootPersistence(
  appName = 'ai-maestro',
  homedir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): BootPersistenceVerdict {
  try {
    const unitFileNames = unitSearchDirs(platform, homedir).flatMap(safeListDir)

    const dumpPath = path.join(homedir, '.pm2', 'dump.pm2')
    let dumpExists = false
    let dumpContainsApp: boolean | null = null
    try {
      dumpExists = fs.statSync(dumpPath).isFile()
    } catch {
      dumpExists = false
    }
    if (dumpExists) {
      try {
        const raw = fs.readFileSync(dumpPath, 'utf8')
        // Prefer the EXACT question — "is there an entry NAMED this app?" — over a substring, which
        // any recorded path under the project directory would satisfy even when the app itself is
        // absent from the resurrect list (a false OK, the one direction that costs). The substring
        // stays as the fallback because pm2's dump shape has changed across versions and a parse
        // failure must degrade to loose-but-answerable, not to a wrong "no".
        dumpContainsApp = namedInDump(raw, appName) ?? raw.includes(appName)
      } catch {
        dumpContainsApp = null
      }
    }

    return evaluateBootPersistence({
      platform,
      unitFileNames,
      dumpExists,
      dumpContainsApp,
      unitLoaded: detectUnitLoaded(platform),
    })
  } catch (err) {
    return {
      status: 'unknown-platform',
      willSurviveReboot: false,
      message: `Boot-persistence check failed (${err instanceof Error ? err.message : String(err)}) — UNVERIFIED.`,
    }
  }
}
