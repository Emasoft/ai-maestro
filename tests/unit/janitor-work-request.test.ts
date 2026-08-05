import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  consumeWorkRequest,
  workRequestPath,
  WORK_REQUEST_FLAGS,
} from '@/lib/janitor-work-request'
import { FLEET_CONTROL_FLAGS, janitorControlDir } from '@/lib/janitor-control'

// ai-maestro#102 — the janitor raises `version-update-requested.flag` when it sees the cache is
// behind, and the chore's owner is contracted to consume it CLEAR-BEFORE-RUN. We never did: the
// flag was listed in FLEET_CONTROL_FLAGS with zero readers, so it sat set on the owner's host from
// 2026-08-02 long after the update it asked for had completed.
//
// 0-IMPACT: $JANITOR_CONTROL_DIR is repointed at a temp dir per test — the SAME override name the
// janitor's own resolver honours, so a test can never isolate one side and not the other. Nothing
// touches the real ~/.claude/janitor-control, which is important for a module whose job is unlink.

let tmpDir: string
let prevOverride: string | undefined

beforeEach(() => {
  prevOverride = process.env.JANITOR_CONTROL_DIR
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-workreq-'))
  process.env.JANITOR_CONTROL_DIR = tmpDir
})

afterEach(() => {
  if (prevOverride === undefined) delete process.env.JANITOR_CONTROL_DIR
  else process.env.JANITOR_CONTROL_DIR = prevOverride
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const FLAG = 'version-update-requested.flag'

function raise(name: string, body = '{"set_at":1,"by":"test"}'): string {
  const p = path.join(tmpDir, name)
  fs.writeFileSync(p, body)
  return p
}

describe('consumeWorkRequest — the release trigger is consumed, and reports that it was', () => {
  it('deletes a raised flag and returns true', () => {
    raise(FLAG)
    expect(consumeWorkRequest(FLAG)).toBe(true)
    expect(fs.existsSync(workRequestPath(FLAG))).toBe(false)
  })

  it('returns false when no request is pending, and creates nothing', () => {
    expect(consumeWorkRequest(FLAG)).toBe(false)
    expect(fs.existsSync(workRequestPath(FLAG))).toBe(false)
  })

  it('is idempotent — a second consume of the same request reports false', () => {
    raise(FLAG)
    expect(consumeWorkRequest(FLAG)).toBe(true)
    expect(consumeWorkRequest(FLAG)).toBe(false)
  })

  it('a request re-raised after consumption is honoured (this is why we clear BEFORE running)', () => {
    raise(FLAG)
    expect(consumeWorkRequest(FLAG)).toBe(true)
    // The janitor notices another release while the chore is mid-run and re-raises.
    raise(FLAG)
    expect(consumeWorkRequest(FLAG)).toBe(true)
  })

  it('NEVER throws when the control dir does not exist', () => {
    process.env.JANITOR_CONTROL_DIR = path.join(tmpDir, 'nope', 'deeper')
    expect(() => consumeWorkRequest(FLAG)).not.toThrow()
    expect(consumeWorkRequest(FLAG)).toBe(false)
  })

  it('resolves the flag inside the janitor control dir the reader module also uses', () => {
    // Both modules must contend on ONE dir; a divergent resolver is a silent skew where we consume
    // a flag the janitor is not writing (or fail to consume the one it is).
    expect(workRequestPath(FLAG)).toBe(path.join(janitorControlDir(), FLAG))
  })
})

describe('the closed union is the safety property — a MODE flag can never be deleted here', () => {
  it('touches no mode flag while consuming a work request', () => {
    // Raise every fleet-control flag, then consume the one work request. The mode flags must all
    // survive: clearing one of those changes the fleet's mode and is the janitor's alone to do.
    for (const f of FLEET_CONTROL_FLAGS) raise(f)
    expect(consumeWorkRequest(FLAG)).toBe(true)

    const survivors = FLEET_CONTROL_FLAGS.filter((f) => fs.existsSync(path.join(tmpDir, f)))
    // Everything except the one work request is still there.
    expect(survivors).toEqual(FLEET_CONTROL_FLAGS.filter((f) => f !== FLAG))
    // Named explicitly, because these three are the catastrophic ones and an `.filter` comparison
    // would still pass if the whole set were somehow empty.
    expect(fs.existsSync(path.join(tmpDir, 'kill-switch.flag'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'global-pause.flag'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'maintenance-mode.flag'))).toBe(true)
  })

  it('every consumable name is a flag the reader module also knows about', () => {
    // A work-request name that the control-plane reader does not list would mean the two modules
    // disagree about what exists in that dir — the drift class this whole file guards.
    for (const w of WORK_REQUEST_FLAGS) {
      expect(FLEET_CONTROL_FLAGS as readonly string[]).toContain(w)
    }
  })
})
