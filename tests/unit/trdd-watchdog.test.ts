/**
 * §D4 watchdog — seeded-violation tests (TRDD-AYBAMFN2 / TRDD-8F8PJEXI / 3P-ZON-11).
 *
 * Discipline per fixture: seed the violation in the shape the live corpus uses, assert
 * the finding by RULE + ID, and pair it with a positive control proving the fixture
 * reached the check at all (a zero-findings assertion is vacuous on a fixture the sweep
 * never evaluated). The 8F8PJEXI complementary neuter is encoded as a TEST: the same
 * forged-mandate fixture is fed to the doctor's declared-floor comparison, which MUST
 * pass it — proving the objective (commit-diff) floor is what catches the forgery, not
 * some other rule firing coincidentally.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  watchdogSweep,
  objectiveFloor,
  declaredFloor,
  pathFloor,
} from '@/lib/trdd-watchdog'
import { lintCorpus } from '@/lib/trdd-doctor'
import { runTrddWatchdogSweep } from '@/lib/trdd-watchdog-scheduler'

let tmp: string

function write(zone: string, name: string, content: string) {
  const dir = path.join(tmp, 'design', zone)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

/** A well-formed v2 card; every fixture is this minus/plus exactly one thing. */
function card(id: string, over: Record<string, string> = {}, body = 'body\n'): string {
  const fm: Record<string, string> = {
    'trdd-id': id,
    title: `Title for ${id}`,
    column: 'dev',
    created: '2026-01-01T00:00:00+0100',
    updated: '2026-01-01T00:00:00+0100',
    npt: '[]',
    eht: '[]',
    'blocked-by': '[]',
    assignee: 'someone',
    'created-by': 'someone',
    'min-approval-requirement': 'none',
    ...over,
  }
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n# TRDD-${id}\n\n${body}`
}

const rules = (r: ReturnType<typeof watchdogSweep>, rule: string) =>
  r.findings.filter((f) => f.rule === rule).map((f) => f.id)

// No fixture has git history, so the default supersede/commit git probes must be stubbed
// everywhere they could run — a test that silently exercises the REAL repo's git measures
// the wrong corpus (and self-matches this repo's own history).
const noGit = { supersedeSetter: () => null, changedPaths: () => null }

describe('D3 objective floor (steps 1-2)', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-wd-'))
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('unambiguous: release-via publish with floor none is an ERROR', () => {
    write('tasks', 'TRDD-20260101_000000+0100-AAAAAAAA-a.md', card('AAAAAAAA', { 'release-via': 'publish' }))
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.scanned).toBe(1) // non-vacuity
    expect(rules(r, 'D3-FLOOR-UNDERCLASSIFIED')).toEqual(['AAAAAAAA'])
  })

  it('unambiguous user rung: impacts public-api + release-via deploy floors at user, above a declared manager', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-BBBBBBBB-b.md',
      card('BBBBBBBB', {
        'release-via': 'deploy',
        impacts: '[public-api, config-schema]',
        'min-approval-requirement': 'manager',
      }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    const f = r.findings.find((x) => x.rule === 'D3-FLOOR-UNDERCLASSIFIED')
    expect(f?.id).toBe('BBBBBBBB')
    expect(f?.message).toContain("'user'")
  })

  it('positive control: declared at (or above) the floor produces NO floor finding', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-CCCCCCCC-c.md',
      card('CCCCCCCC', { 'release-via': 'publish', 'min-approval-requirement': 'manager' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.scanned).toBe(1)
    expect(r.findings.filter((f) => f.rule.startsWith('D3-FLOOR'))).toEqual([])
  })

  it('ambiguous prose signal (.github/ path) is a WARN for the MANAGER queue, never an error', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-DDDDDDDD-d.md',
      card('DDDDDDDD', {}, 'The fix edits `.github/workflows/ci.yml` triggers.\n'),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(rules(r, 'D3-FLOOR-SUSPECT')).toEqual(['DDDDDDDD'])
    expect(rules(r, 'D3-FLOOR-UNDERCLASSIFIED')).toEqual([])
  })

  it('the suspect warn is suppressed when the mandate already claims an issuer at the floor', () => {
    // Same prose signal as above — the ONLY difference is the claimed issuer, so the
    // suppression branch is what this pins (the claim itself is audited by the
    // commit-diff check, so no bypass re-opens).
    write(
      'tasks',
      'TRDD-20260101_000000+0100-EEEEEEEE-e.md',
      card('EEEEEEEE', { mandate: 'true', 'mandated-by': 'user' }, 'Edits `.github/workflows/ci.yml`.\n'),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.scanned).toBe(1)
    expect(rules(r, 'D3-FLOOR-SUSPECT')).toEqual([])
  })

  it('a dated MANAGER drain receipt suppresses the suspect warn — a ruled question never re-fills the queue', () => {
    // Same prose signal as the DDDDDDDD fixture; the ONLY difference is the approval-log
    // receipt, so the receipt gate is what this pins.
    write(
      'tasks',
      'TRDD-20260101_000000+0100-QQQQQQQQ-q.md',
      card(
        'QQQQQQQQ',
        {},
        'Edits `.github/workflows/ci.yml`.\n\n## Approval log\n\n- 2026-01-02 — §D4 sweep D3-FLOOR-SUSPECT ruled by ASSISTANT-MANAGER: floor stays `none`.\n',
      ),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.scanned).toBe(1)
    expect(rules(r, 'D3-FLOOR-SUSPECT')).toEqual([])
  })

  it('the receipt does NOT reach the error tier: an unambiguous floor stays flagged through any prose ruling', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-RRRRRRRR-r.md',
      card(
        'RRRRRRRR',
        { 'release-via': 'publish' },
        'body\n\n## Approval log\n\n- 2026-01-02 — §D4 sweep D3-FLOOR-SUSPECT ruled by ASSISTANT-MANAGER: floor stays `none`.\n',
      ),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(rules(r, 'D3-FLOOR-UNDERCLASSIFIED')).toEqual(['RRRRRRRR'])
  })

  it('scalar impacts (the scalar-npt lesson) still reaches the user rung', () => {
    expect(
      objectiveFloor({ 'release-via': 'publish', impacts: 'public-api' }, '').floor,
    ).toBe('user')
  })

  it('declaredFloor decodes the deprecated approval-tier alias and normalizes maestro→user', () => {
    expect(declaredFloor({ 'approval-tier': 2 })).toBe('manager')
    expect(declaredFloor({ 'min-approval-requirement': 'maestro' })).toBe('user')
    expect(declaredFloor({})).toBe('none')
  })
})

describe('mandate vs the COMPUTED floor (step 3) — content and commit-diff tiers', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-wd-'))
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('a self-mandate on an unambiguous manager-floor card is MANDATE-BELOW-OBJECTIVE-FLOOR', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-FFFFFFFF-f.md',
      card('FFFFFFFF', { 'release-via': 'publish', mandate: 'true', 'mandated-by': 'self' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(rules(r, 'MANDATE-BELOW-OBJECTIVE-FLOOR')).toEqual(['FFFFFFFF'])
  })

  it('8F8PJEXI: a self-mandated none-floor card whose citing commit touches .github/ is MANDATE-FORGED', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-GGGGGGGG-g.md',
      card('GGGGGGGG', {
        mandate: 'true',
        'mandated-by': 'self',
        'implementation-commits': '[abc1234]',
      }),
    )
    const dir = path.join(tmp, 'design')
    const r = watchdogSweep(dir, {
      supersedeSetter: () => null,
      changedPaths: () => ['.github/workflows/ci.yml'],
    })
    const f = r.findings.find((x) => x.rule === 'MANDATE-FORGED')
    expect(f?.id).toBe('GGGGGGGG')
    expect(f?.severity).toBe('error')
    expect(f?.message).toContain('.github/workflows/ci.yml')

    // THE COMPLEMENTARY NEUTER, as a test: the DECLARED-floor comparison (the doctor's
    // MANDATE-FORGED) passes this exact fixture clean — none vs none, 0 < 0 is false —
    // which is precisely the bypass 8F8PJEXI documents. Only the objective floor catches it.
    const doctor = lintCorpus(dir)
    expect(doctor.findings.filter((x) => x.rule === 'MANDATE-FORGED')).toEqual([])
    // Positive control that the doctor DID evaluate the card (it is not silently skipped):
    expect(doctor.scanned).toBe(1)
  })

  it('positive control: an innocuous citing commit produces NO forgery finding', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-HHHHHHHH-h.md',
      card('HHHHHHHH', { mandate: 'true', 'mandated-by': 'self', 'implementation-commits': '[abc1234]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), {
      supersedeSetter: () => null,
      changedPaths: () => ['lib/some-module.ts', 'tests/unit/some.test.ts'],
    })
    expect(rules(r, 'MANDATE-FORGED')).toEqual([])
    expect(r.scanned).toBe(1)
  })

  it('an unresolvable sha is COUNTED as a blind spot, never guessed into a finding', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-IIIIIIII-i.md',
      card('IIIIIIII', { mandate: 'true', 'mandated-by': 'self', 'implementation-commits': '[deadbeef]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.commitFloorUnresolved).toBe(1)
    expect(rules(r, 'MANDATE-FORGED')).toEqual([])
  })

  it('pathFloor blind spot pinned as data: a PRRD edit floors at manager, never user (golden-vs-silver lives in diff CONTENT)', () => {
    expect(pathFloor(['design/requirements/PRRD.md']).floor).toBe('manager')
    expect(pathFloor(['lib/x.ts']).floor).toBe('none')
  })
})

describe('supersede (step 7) — drift half + authority half', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-wd-'))
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  const replacement = () =>
    write(
      'archived',
      'TRDD-20260101_000000+0100-NEWCARD1-n.md',
      card('NEWCARD1', { column: 'completed', 'created-by': 'agent-a' }),
    )

  it('a non-empty superseded-by on a non-superseded column is drift', () => {
    replacement()
    write(
      'tasks',
      'TRDD-20260101_000000+0100-JJJJJJJJ-j.md',
      card('JJJJJJJJ', { 'superseded-by': '[NEWCARD1]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(rules(r, 'SUPERSEDED-BY-WITHOUT-COLUMN')).toEqual(['JJJJJJJJ'])
  })

  it('a setter that is NOT the replacement author is SUPERSEDE-AUTHORITY', () => {
    replacement()
    write(
      'proposals',
      'TRDD-20260101_000000+0100-KKKKKKKK-k.md',
      card('KKKKKKKK', { column: 'superseded', 'superseded-by': '[NEWCARD1]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), {
      changedPaths: () => null,
      supersedeSetter: () => 'agent-b', // the introducing commit's Agent: trailer
    })
    const f = r.findings.find((x) => x.rule === 'SUPERSEDE-AUTHORITY')
    expect(f?.id).toBe('KKKKKKKK')
    expect(f?.message).toContain('agent-b')
    expect(f?.message).toContain('agent-a')
  })

  it('positive control: the replacement author setting its own claim is clean', () => {
    replacement()
    write(
      'proposals',
      'TRDD-20260101_000000+0100-LLLLLLLL-l.md',
      card('LLLLLLLL', { column: 'superseded', 'superseded-by': '[NEWCARD1]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), {
      changedPaths: () => null,
      supersedeSetter: () => 'agent-a',
    })
    expect(rules(r, 'SUPERSEDE-AUTHORITY')).toEqual([])
    expect(r.scanned).toBe(1) // the superseded proposal was scanned; the archived replacement is outside the scan set
  })

  it('no Agent: trailer is a COUNTED blind spot, not a guess', () => {
    replacement()
    write(
      'proposals',
      'TRDD-20260101_000000+0100-MMMMMMMM-m.md',
      card('MMMMMMMM', { column: 'superseded', 'superseded-by': '[NEWCARD1]' }),
    )
    const r = watchdogSweep(path.join(tmp, 'design'), noGit)
    expect(r.supersedeUnattributed).toBe(1)
    expect(rules(r, 'SUPERSEDE-AUTHORITY')).toEqual([])
  })
})

describe('the scheduled sweep (TGNU1EP7 / 3P-ZON-11 "being scheduled is part of the clause")', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-wd-'))
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('a seeded forged floor appears in the sweep report without anyone running a command', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-PPPPPPPP-p.md',
      card('PPPPPPPP', { 'release-via': 'publish' }),
    )
    const r = runTrddWatchdogSweep(tmp)
    expect(r.ran).toBe(true)
    expect(r.errors).toBeGreaterThanOrEqual(1)
    const report = fs.readFileSync(r.reportPath!, 'utf8')
    expect(report).toContain('D3-FLOOR-UNDERCLASSIFIED')
    expect(report).toContain('PPPPPPPP')
    // The report lands under the repo's gitignored reports/ tree, never elsewhere.
    expect(r.reportPath!.startsWith(path.join(tmp, 'reports', 'trdd-watchdog'))).toBe(true)
  })

  it('a corpus the sweep never read is a SKIP with a reason, never a clean report', () => {
    fs.mkdirSync(path.join(tmp, 'design', 'tasks'), { recursive: true })
    const r = runTrddWatchdogSweep(tmp)
    expect(r.ran).toBe(false)
    expect(r.reason).toContain('0 TRDDs')
    // and NO report file was written for a run that read nothing
    expect(fs.existsSync(path.join(tmp, 'reports', 'trdd-watchdog'))).toBe(false)
  })

  it('a repo with no design/tasks at all is a SKIP naming the path', () => {
    const r = runTrddWatchdogSweep(tmp)
    expect(r.ran).toBe(false)
    expect(r.reason).toContain('no design/tasks')
  })
})
