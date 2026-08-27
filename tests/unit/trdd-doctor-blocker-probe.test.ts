/**
 * TRDD-CV5KDCB7 — a PARKED card must carry a RUNNABLE blocker probe.
 *
 * Each rule is made to FIRE on a synthetic card and proven SILENT on its positive control.
 * The two false-fire directions the card names are pinned by name: an UNPARKED card never
 * fires (U1), and an EMPTY probe never satisfies the gate (E1).
 *
 * NEUTER RUNS (2026-08-27, observed — restored by blob hash):
 *   N1 lib/trdd-doctor.ts: `const parked =` → `const parked = false; const _x =` ⇒ 8 red:
 *      F1 F2 F3 F4 F5 E1 B1 C1 (every FIRES test), the SILENT tests stay green.
 *      (A first attempt `= false &&` reddened NOTHING — `&&` binds tighter than `||`, so it
 *      neutered only the column-blocked disjunct. A neuter is proven by the mutated LINE, not
 *      by the exit code of the run that follows it.)
 *   N2 `if (probe === '' || holds === '')` → `if (holds === '')` ⇒ exactly E1 reds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { lintCorpus, PROBE_GATE_SINCE } from '@/lib/trdd-doctor'

let tmp: string
// The store scans TRDD-<ts>-<id8>-<slug>.md only — a bare name is invisible (measured: 10/10 red).
const write = (_unused: string, content: string) => {
  const id = /trdd-id: (\w{8})/.exec(content)![1]
  fs.writeFileSync(path.join(tmp, 'tasks', `TRDD-20260101_000000+0100-${id}-x.md`), content, 'utf8')
}

function card(id: string, over: Record<string, string> = {}): string {
  const fm: Record<string, string> = {
    'trdd-id': id, title: `Title for ${id}`, column: 'dev',
    created: '2026-01-01T00:00:00+0100', updated: '2026-01-01T00:00:00+0100',
    npt: '[]', eht: '[]', 'blocked-by': '[]',
    assignee: 'someone', 'created-by': 'someone', 'min-approval-requirement': 'none',
    ...over,
  }
  const lines = Object.entries(fm).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n# TRDD-${id}\n\nbody\n`
}
const POST = '2026-08-28T10:00:00+0200' // after PROBE_GATE_SINCE
const PRE = '2026-08-01T10:00:00+0200'
const PARK = { column: 'blocked', 'blocked-by': '[TRDD-ZZZZZZZZ]', 'pre-block-column': 'dev' }
const PROBE = { 'blocker-probe': 'bash /x/probe.sh', 'blocker-holds-if': 'not-match:HEALTHY' }
const find = (rule: string) => lintCorpus(tmp).findings.filter((f) => f.rule === rule)

describe('TRDD-CV5KDCB7 — BLOCKED-WITHOUT-PROBE and its grammar rules', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-probe-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) fs.mkdirSync(path.join(tmp, z), { recursive: true })
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('F1 FIRES as ERROR: column blocked, touched after the boundary, no probe', () => {
    write('a.md', card('F1F1F1F1', { ...PARK, updated: POST }))
    const f = find('BLOCKED-WITHOUT-PROBE')
    expect(f.map((x) => `${x.id}:${x.severity}`)).toEqual(['F1F1F1F1:error'])
  })
  it('F2 FIRES as WARN: same card touched BEFORE the boundary (grandfathered to warn, not silence)', () => {
    write('a.md', card('F2F2F2F2', { ...PARK, updated: PRE }))
    expect(find('BLOCKED-WITHOUT-PROBE').map((x) => `${x.id}:${x.severity}`)).toEqual(['F2F2F2F2:warn'])
    expect(PRE.slice(0, 10) < PROBE_GATE_SINCE).toBe(true)
  })
  it('F3 FIRES: parked by a non-empty blocked-by while the column is NOT blocked', () => {
    write('a.md', card('F3F3F3F3', { 'blocked-by': '[TRDD-ZZZZZZZZ]', updated: POST }))
    expect(find('BLOCKED-WITHOUT-PROBE').map((x) => x.id)).toEqual(['F3F3F3F3'])
  })
  it('F4 FIRES: parked by a FUTURE review-after', () => {
    write('a.md', card('F4F4F4F4', { 'review-after': '2999-01-01', updated: POST }))
    expect(find('BLOCKED-WITHOUT-PROBE').map((x) => x.id)).toEqual(['F4F4F4F4'])
  })
  it('F5 FIRES: parked by a fleet-ask label', () => {
    write('a.md', card('F5F5F5F5', { labels: '[governance, fleet-ask]', updated: POST }))
    expect(find('BLOCKED-WITHOUT-PROBE').map((x) => x.id)).toEqual(['F5F5F5F5'])
  })
  it('U1 SILENT: an UNPARKED card (dev, empty blocked-by, past review-after, no park label) never fires', () => {
    write('a.md', card('U1U1U1U1', { 'review-after': '2020-01-01', labels: '[governance]', updated: POST }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(r.findings.filter((f) => f.rule.startsWith('BLOCK')).map((f) => f.rule)).toEqual([])
  })
  it('U2 SILENT: review-after equal to LOCAL today is an EXPIRED park, not a future one (zone-safe)', () => {
    // `review-after:` is written as a LOCAL date; comparing it to a UTC calendar day made a
    // just-expired park read as parked for the hours the two days disagree — a false fire on
    // an unparked card. Run under TZ=Pacific/Kiritimati (UTC+14) to reproduce at any hour.
    const d = new Date()
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(localToday).toMatch(/^\d{4}-\d{2}-\d{2}$/) // a wrong SHAPE must red, never pass vacuously
    write('a.md', card('U2U2U2U2', { 'review-after': localToday, updated: POST }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(r.findings.filter((f) => f.rule.startsWith('BLOCK')).map((f) => f.rule)).toEqual([])
  })
  it('E1 FIRES: an EMPTY blocker-probe does NOT satisfy the gate even with a valid predicate', () => {
    write('a.md', card('E1E1E1E1', { ...PARK, updated: POST, 'blocker-probe': '', 'blocker-holds-if': 'exit-0' }))
    expect(find('BLOCKED-WITHOUT-PROBE').map((x) => x.id)).toEqual(['E1E1E1E1'])
  })
  it('S1 SILENT: a parked card WITH a probe + not-match predicate (fail-closed, no canary needed)', () => {
    write('a.md', card('S1S1S1S1', { ...PARK, ...PROBE, updated: POST }))
    const r = lintCorpus(tmp)
    expect(r.scanned).toBe(1)
    expect(r.findings.filter((f) => /PROBE|CANARY/.test(f.rule))).toEqual([])
  })
  it('B1 FIRES: a predicate outside the grammar', () => {
    write('a.md', card('B1B1B1B1', { ...PARK, updated: POST, 'blocker-probe': 'true', 'blocker-holds-if': 'sometimes' }))
    expect(find('BLOCKER-PROBE-BAD-PREDICATE').map((x) => x.id)).toEqual(['B1B1B1B1'])
    expect(find('BLOCKED-WITHOUT-PROBE')).toEqual([])
  })
  it('C1 FIRES: match: without a canary is fail-open; C2 SILENT with one', () => {
    write('a.md', card('C1C1C1C1', { ...PARK, updated: POST, 'blocker-probe': 'true', 'blocker-holds-if': 'match:ACTION DUE' }))
    expect(find('BLOCKER-PROBE-NO-CANARY').map((x) => `${x.id}:${x.severity}`)).toEqual(['C1C1C1C1:error'])
    fs.rmSync(path.join(tmp, 'tasks', 'TRDD-20260101_000000+0100-C1C1C1C1-x.md')) // one card at a time
    write('a.md', card('C2C2C2C2', { ...PARK, updated: POST, 'blocker-probe': 'true', 'blocker-holds-if': 'match:ACTION DUE', 'blocker-probe-canary': 'match:cookie/session' }))
    expect(find('BLOCKER-PROBE-NO-CANARY')).toEqual([])
  })
})
