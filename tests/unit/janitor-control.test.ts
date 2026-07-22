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
    touch('version-update-request')
    expect(fleetActuationBlocked()).toEqual({ blocked: false, reason: null })
    // ...but they ARE reported as present by the snapshot
    const flags = readFleetControlFlags()
    expect(flags['reload-needed.flag']).toBe(true)
    expect(flags['version-update-request']).toBe(true)
    expect(flags['kill-switch.flag']).toBe(false)
  })

  it('kill-switch is reported first even when multiple stop flags are set (stable reason)', () => {
    touch('global-pause.flag')
    touch('kill-switch.flag')
    expect(fleetActuationBlocked()).toEqual({ blocked: true, reason: 'kill-switch.flag' })
  })
})
