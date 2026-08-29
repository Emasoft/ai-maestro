/**
 * UPDATED-IN-THE-FUTURE — the board sorts on `updated:`, so a future value parks a card at the
 * top until real time catches up.
 *
 * WHY A CHECK AND NOT A LESSON. The prose rule forbidding a typed timestamp was already on file
 * and had been read when it was broken four times in one session (2026-08-29: 13:18 / 13:34 /
 * 13:46 / 13:58 written while the clock read 12:37). A rule that is read and then broken is a
 * rule that needs an instrument, not a stronger sentence.
 *
 * The tests are written against `Date.now()` at RUN time rather than fixed literals, because a
 * hard-coded "future" date is only future until it isn't — the test would start passing for the
 * wrong reason on that date and nobody would be watching.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { lintCorpus } from '@/lib/trdd-doctor'

let tmp: string

const write = (content: string) => {
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
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n# TRDD-${id}\n\nbody\n`
}

/** An ISO-with-offset stamp `mins` minutes from now — the exact shape the frontmatter uses. */
const stamp = (mins: number) => {
  const d = new Date(Date.now() + mins * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(off) / 60))
  const om = pad(Math.abs(off) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}${om}`
}

const find = () => lintCorpus(tmp).findings.filter(f => f.rule === 'UPDATED-IN-THE-FUTURE')

describe('UPDATED-IN-THE-FUTURE', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-future-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('FIRES as error on a card stamped an hour ahead — the real 2026-08-29 shape', () => {
    write(card('FFFFFFF1', { updated: stamp(60) }))
    expect(find().map(f => `${f.id}:${f.severity}`)).toEqual(['FFFFFFF1:error'])
  })

  it('SILENT on a past timestamp — the overwhelmingly common case', () => {
    write(card('FFFFFFF2', { updated: stamp(-60) }))
    expect(find()).toEqual([])
  })

  it('SILENT inside the skew allowance — a clock a few minutes fast is not a defect', () => {
    // The allowance exists so a legitimately skewed contributor is not flagged. Every real
    // instance of the bug has been tens of minutes out, so this costs nothing to give away.
    write(card('FFFFFFF3', { updated: stamp(5) }))
    expect(find()).toEqual([])
  })

  it('SILENT on an unparseable value — that is the day-parser\'s business, not this rule\'s', () => {
    // Two rules reporting one defect is noise; `frontmatterDay` already fails open on garbage.
    write(card('FFFFFFF4', { updated: 'not-a-timestamp' }))
    expect(find()).toEqual([])
  })

  it('names the fix in its message, since the cause is always the same', () => {
    write(card('FFFFFFF5', { updated: stamp(120) }))
    expect(find()[0].message).toMatch(/date \+%Y-%m-%dT%H:%M:%S%z/)
  })
})
