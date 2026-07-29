import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  janitorControlDir,
  fleetControlFlagPresent,
  readFleetControlFlags,
  fleetActuationBlocked,
  FLEET_CONTROL_FLAGS,
} from '@/lib/janitor-control'

// Isolate the FIXED control-plane path to a throwaway dir BEFORE any flag test —
// the janitor warned (ai-maestro#79) that a test touching the real dir writes the
// LIVE fleet control plane. $JANITOR_CONTROL_DIR is the shared override both sides read.
let tmpDir: string
let priorEnv: string | undefined

beforeEach(() => {
  priorEnv = process.env.JANITOR_CONTROL_DIR
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-janitor-control-'))
  // NOTE: we point the override at a NESTED path that does NOT exist yet, so the
  // "missing dir is fail-safe" tests are real (the reader must not create it).
  process.env.JANITOR_CONTROL_DIR = path.join(tmpDir, 'janitor-control')
})

afterEach(() => {
  if (priorEnv === undefined) delete process.env.JANITOR_CONTROL_DIR
  else process.env.JANITOR_CONTROL_DIR = priorEnv
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function touch(flag: string): void {
  const dir = process.env.JANITOR_CONTROL_DIR!
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, flag), '')
}

describe('the flag NAMES match what the janitor actually writes (TRDD-4F40QCCH)', () => {
  // A wrong filename is indistinguishable from an absent flag: `fleetControlFlagPresent`
  // stats a path nothing writes, returns false, and the server ignores the control plane
  // while looking healthy. That shipped — `'version-update-request'` (no `ed`, no suffix)
  // sat in this list while `version-update-requested.flag` was present on disk, which is
  // the whole reason ai-maestro#102's request was never seen. Nothing errors, so only a
  // structural assertion catches it.

  it('every flag is a .flag FILE — the odd one out was the bug', () => {
    // The mechanical invariant that would have caught it on the day it was written: five of
    // the six entries carried the suffix and one did not. Cheap, and it cannot go stale.
    for (const flag of FLEET_CONTROL_FLAGS) {
      expect(flag, `${flag} must name a control-plane FILE`).toMatch(/\.flag$/)
    }
  })

  it('carries the exact names janitor lib/global_state.py resolves', () => {
    // Pinned as literals because the janitor is a DIFFERENT repo: its source is not
    // guaranteed present (it lives in a plugin cache that may be absent, or at any
    // version), so a test that read it would be skipped exactly when it mattered. These
    // were read from janitor 0.64.1 `_control_path(...)` call sites; a rename on their
    // side must break this test loudly rather than degrade us to a silent false negative.
    expect([...FLEET_CONTROL_FLAGS]).toEqual([
      'kill-switch.flag',
      'maintenance-mode.flag',
      'global-pause.flag',
      'reload-needed.flag',
      'skills-reload-needed.flag',
      'version-update-requested.flag',
    ])
  })

  it('POSITIVE CONTROL — the request flag reads PRESENT once written under its real name', () => {
    // Without this the two assertions above are satisfied by a list of well-formed strings
    // that the reader still cannot find. This drives the actual reader end-to-end.
    expect(fleetControlFlagPresent('version-update-requested.flag')).toBe(false)
    touch('version-update-requested.flag')
    expect(fleetControlFlagPresent('version-update-requested.flag')).toBe(true)
    expect(readFleetControlFlags()['version-update-requested.flag']).toBe(true)
  })

  it('a work-request flag never blocks fleet actuation', () => {
    // The request is a REQUEST, not a stop. Adding it to the blocking set would freeze
    // agent recovery every time an update is pending — the opposite of its purpose.
    touch('version-update-requested.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: false, reason: null })
  })
})

describe('janitor-control reader', () => {
  it('resolves $JANITOR_CONTROL_DIR override, falling back to ~/.claude/janitor-control', () => {
    expect(janitorControlDir()).toBe(process.env.JANITOR_CONTROL_DIR)
    const saved = process.env.JANITOR_CONTROL_DIR
    delete process.env.JANITOR_CONTROL_DIR
    expect(janitorControlDir()).toBe(path.join(os.homedir(), '.claude', 'janitor-control'))
    process.env.JANITOR_CONTROL_DIR = saved
  })

  it('a MISSING control dir is fail-safe — every flag reads false, actuation NOT blocked', () => {
    // dir does not exist (override points at a nested unmade path)
    expect(fs.existsSync(janitorControlDir())).toBe(false)
    for (const flag of FLEET_CONTROL_FLAGS) expect(fleetControlFlagPresent(flag)).toBe(false)
    expect(fleetActuationBlocked()).toEqual({ blocked: false, reason: null })
  })

  it('reading NEVER creates or writes the control dir (never-write invariant)', () => {
    readFleetControlFlags()
    fleetActuationBlocked()
    fleetControlFlagPresent('kill-switch.flag')
    expect(fs.existsSync(janitorControlDir())).toBe(false)
  })

  it('an empty (but existing) control dir does not block actuation', () => {
    fs.mkdirSync(janitorControlDir(), { recursive: true })
    expect(fleetActuationBlocked()).toEqual({ blocked: false, reason: null })
  })

  it('kill-switch blocks actuation with its reason', () => {
    touch('kill-switch.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: true, reason: 'kill-switch.flag' })
  })

  it('global-pause blocks actuation', () => {
    touch('global-pause.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: true, reason: 'global-pause.flag' })
  })

  it('maintenance-mode blocks actuation', () => {
    touch('maintenance-mode.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: true, reason: 'maintenance-mode.flag' })
  })

  it('a reload/skills-reload/version-update request is NOT a stop — actuation continues', () => {
    touch('reload-needed.flag')
    touch('skills-reload-needed.flag')
    // TRDD-4F40QCCH: this line WROTE the wrong filename, and the assertion below READ the
    // same wrong key — so the pair agreed with each other and with the wrong constant, and
    // stayed green while the reader was blind to the real flag. A test propped up by the
    // very bug it was meant to cover; the two assertions in the sibling describe() block
    // above are the ones that can actually fail when this drifts again.
    touch('version-update-requested.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: false, reason: null })
    // ...but they ARE reported as present by the snapshot
    const flags = readFleetControlFlags()
    expect(flags['reload-needed.flag']).toBe(true)
    expect(flags['version-update-requested.flag']).toBe(true)
    expect(flags['kill-switch.flag']).toBe(false)
  })

  it('kill-switch is reported first even when multiple stop flags are set (stable reason)', () => {
    touch('global-pause.flag')
    touch('kill-switch.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: true, reason: 'kill-switch.flag' })
  })
})
