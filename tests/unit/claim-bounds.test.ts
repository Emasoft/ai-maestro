/**
 * declareChoreBounds — the rev-8 §9.2 executor-declared staleness bounds
 * (TRDD-4WERSFAG; contract mirror: docs/claimed-chores-contract.md).
 *
 * Uses the module's documented test seam: `$JANITOR_CONTROL_DIR` overrides the
 * control dir, resolved at CALL time — so a per-test temp dir works without any
 * module mocking, and nothing here can touch the real ~/.claude/janitor-control.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { declareChoreBounds, claimBoundsPath } from '@/lib/janitor-chore-stamp'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-claim-bounds-'))
  process.env.JANITOR_CONTROL_DIR = tmpDir
})

afterEach(() => {
  delete process.env.JANITOR_CONTROL_DIR
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('declareChoreBounds', () => {
  it('creates claim-bounds.json with the declared map when absent', () => {
    /** Fresh-write direction: no file → file exists with exactly the declared rows */
    declareChoreBounds({ 'marketplace-refresh': 43200 })
    const parsed = JSON.parse(fs.readFileSync(claimBoundsPath(), 'utf8'))
    expect(parsed).toEqual({ 'marketplace-refresh': 43200 })
  })

  it('merge-preserves a foreign key another executor declared', () => {
    /** The file is SHARED per contract — a rewrite must not clobber another executor's rows */
    fs.writeFileSync(claimBoundsPath(), JSON.stringify({ 'some-other-chore': 999 }), 'utf8')
    declareChoreBounds({ 'marketplace-refresh': 43200 })
    const parsed = JSON.parse(fs.readFileSync(claimBoundsPath(), 'utf8'))
    expect(parsed['some-other-chore']).toBe(999)
    expect(parsed['marketplace-refresh']).toBe(43200)
  })

  it('overwrites its OWN key rather than keeping a stale value', () => {
    /** A cadence change must move the declaration — last write wins on owned keys */
    declareChoreBounds({ 'marketplace-refresh': 10800 })
    declareChoreBounds({ 'marketplace-refresh': 43200 })
    const parsed = JSON.parse(fs.readFileSync(claimBoundsPath(), 'utf8'))
    expect(parsed['marketplace-refresh']).toBe(43200)
  })

  it('recovers from a corrupt file and drops insane rows instead of re-emitting them', () => {
    /** Fail-open both ways: garbage in must not persist garbage out or throw */
    fs.writeFileSync(claimBoundsPath(), 'not json {{{', 'utf8')
    declareChoreBounds({ 'marketplace-refresh': 43200 })
    expect(JSON.parse(fs.readFileSync(claimBoundsPath(), 'utf8'))).toEqual({ 'marketplace-refresh': 43200 })

    fs.writeFileSync(claimBoundsPath(), JSON.stringify({ ok: 100, bad: 'x', neg: -5, nan: null }), 'utf8')
    declareChoreBounds({ 'marketplace-refresh': 43200 })
    const parsed = JSON.parse(fs.readFileSync(claimBoundsPath(), 'utf8'))
    expect(parsed).toEqual({ ok: 100, 'marketplace-refresh': 43200 })
  })

  it('never throws when the control dir is not writable (ENOTDIR)', () => {
    /** Best-effort contract: a failed declaration must not fail the scheduler */
    const file = path.join(tmpDir, 'a-file')
    fs.writeFileSync(file, 'x', 'utf8')
    process.env.JANITOR_CONTROL_DIR = path.join(file, 'sub') // mkdir under a FILE → ENOTDIR
    expect(() => declareChoreBounds({ 'marketplace-refresh': 43200 })).not.toThrow()
  })
})
