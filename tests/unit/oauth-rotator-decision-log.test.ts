import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn, spawnSync } from 'child_process'
import {
  appendRotatorLog,
  rotatorLogPath,
  rotatorLogStamp,
} from '@/lib/oauth-rotator/decision-log'

// 0-IMPACT: every test passes an explicit `root` inside a temp dir, so nothing here can reach the
// real `~/.claude/plugins/data/.../oauth-rotator/rotator.log`. That is containment BY CONSTRUCTION;
// the snapshot guard below is the PROOF, because "the writes were contained" and "the writes never
// happened" look identical in a green run. It is deliberately verb-agnostic — it compares the real
// file's bytes rather than asserting which function was called, so it keeps working if this module
// ever changes how it writes.
const REAL_LOG = path.join(
  os.homedir(),
  '.claude',
  'plugins',
  'data',
  'ai-maestro-janitor-ai-maestro-plugins',
  'oauth-rotator',
  'rotator.log',
)
function realLogFingerprint(): string {
  try {
    const st = fs.statSync(REAL_LOG)
    return `${st.size}:${st.mtimeMs}`
  } catch {
    return 'absent'
  }
}
let realBefore = ''

let dir = ''

beforeAll(() => {
  realBefore = realLogFingerprint()
})

afterAll(() => {
  expect(
    realLogFingerprint(),
    `the real shared rotator.log at ${REAL_LOG} CHANGED during this suite — a test escaped its temp root`,
  ).toBe(realBefore)
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-rotlog-'))
})

/** `<ts> <source>/<kind>: <message>` — one record, one line. */
const RECORD = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4} \S+: .*$/

function lines(root: string): string[] {
  return fs.readFileSync(rotatorLogPath(root), 'utf8').split('\n').filter(Boolean)
}

describe('rotatorLogStamp — shares rotator.py\'s timestamp shape', () => {
  it('emits local time with a numeric %z offset, not a UTC Z', () => {
    const s = rotatorLogStamp(new Date(2026, 7, 2, 18, 55, 7))
    // The shape rotator.py's time.strftime("%Y-%m-%dT%H:%M:%S%z") produces. Asserted as a REGEX on
    // a fixed local Date rather than an exact string, because the offset is the runner's own zone.
    expect(s).toMatch(/^2026-08-02T18:55:07[+-]\d{4}$/)
    expect(s).not.toMatch(/Z$/)
  })

  it('renders a sub-hour zone offset without losing the minutes', () => {
    // A half-hour zone is where a naive `offset/60` formatter drops the :30 and writes a stamp an
    // hour off. The offset is injected so this holds on any runner — reading getTimezoneOffset()
    // to build the expectation would be circular, and on a whole-hour CI box it would pass against
    // a formatter that emits "00" unconditionally.
    const d = new Date(2026, 7, 2, 12, 0, 0)
    expect(rotatorLogStamp(d, 330)).toMatch(/\+0530$/) // Asia/Kolkata
    expect(rotatorLogStamp(d, -210)).toMatch(/-0330$/) // America/St_Johns
    expect(rotatorLogStamp(d, 0)).toMatch(/\+0000$/)
  })
})

describe('appendRotatorLog', () => {
  it('writes one well-formed, source-tagged record', () => {
    expect(appendRotatorLog('tick', 'live account within limits', { root: dir })).toBe(true)
    const l = lines(dir)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatch(RECORD)
    expect(l[0]).toContain('aim-server/tick: live account within limits')
  })

  it('APPENDS — a second call never replaces the first', () => {
    appendRotatorLog('tick', 'first', { root: dir })
    appendRotatorLog('tick', 'second', { root: dir })
    const l = lines(dir)
    expect(l).toHaveLength(2)
    expect(l[0]).toContain('first')
    expect(l[1]).toContain('second')
  })

  it('collapses a multi-line message to ONE record', () => {
    // Not cosmetic: rotator.py's trim realigns on the first \n of the retained tail, so a record
    // spanning two lines corrupts the boundary it lands on.
    appendRotatorLog('alert', 'line one\nline two\r\nline three', { root: dir })
    const l = lines(dir)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatch(RECORD)
    expect(l[0]).toContain('line one line two line three')
  })

  it('NEVER trims — bounding the file is the janitor\'s job, and two trimmers lose whole spans', () => {
    const big = 'x'.repeat(1900)
    for (let i = 0; i < 200; i++) appendRotatorLog('tick', `${i} ${big}`, { root: dir })
    // ~380 KB, well past rotator.py's 256 KB ceiling. If this module ever grew a trim, the count
    // would drop and the earliest records would be gone.
    expect(fs.statSync(rotatorLogPath(dir)).size).toBeGreaterThan(256 * 1024)
    const l = lines(dir)
    expect(l).toHaveLength(200)
    expect(l[0]).toContain('aim-server/tick: 0 ')
  })

  it('creates the root when the janitor has never run on this machine', () => {
    const fresh = path.join(dir, 'never', 'existed')
    expect(appendRotatorLog('tick', 'first ever decision', { root: fresh })).toBe(true)
    expect(lines(fresh)).toHaveLength(1)
  })

  it('is best-effort: returns false instead of throwing when the path is unusable', () => {
    // ENOTDIR — a FILE where the root directory must be. Deliberately not a chmod: a permission
    // fixture passes vacuously when the suite runs as root, and CI often does.
    const blocker = path.join(dir, 'blocker')
    fs.writeFileSync(blocker, 'not a directory')
    expect(appendRotatorLog('tick', 'should not throw', { root: blocker })).toBe(false)
    // Positive control — the same call against a usable root DOES return true, so the assertion
    // above is about the unusable path and not about the function being broken outright.
    expect(appendRotatorLog('tick', 'control', { root: dir })).toBe(true)
  })
})

describe('rotatorLogPath', () => {
  it('names an absolute path ending in rotator.log', () => {
    const p = rotatorLogPath(dir)
    expect(path.isAbsolute(p)).toBe(true)
    expect(path.basename(p)).toBe('rotator.log')
  })
})

describe('cross-daemon concurrency — the actual shared-file claim', () => {
  const python = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0

  it.runIf(python)(
    'loses NO records when the janitor (python) appends to the same file concurrently',
    async () => {
      // The real property, exercised across the real language boundary: rotator.py appends with
      // O_APPEND and so do we, which is what lets two processes share one file with no lock — and
      // no lock is what we are forced into anyway, since Python lockdirs and a Node mutex are
      // different physical objects that would exclude nobody. A truncating or seek+write
      // implementation loses records here; O_APPEND does not.
      const N = 300
      const target = rotatorLogPath(dir)
      fs.mkdirSync(dir, { recursive: true })

      const py = spawn('python3', [
        '-c',
        [
          'import sys, time',
          'p = sys.argv[1]; n = int(sys.argv[2])',
          'for i in range(n):',
          '    with open(p, "a", encoding="utf-8") as fh:',
          '        fh.write("%s janitor/auto: record %d\\n" % (time.strftime("%Y-%m-%dT%H:%M:%S%z"), i))',
        ].join('\n'),
        target,
        String(N),
      ])
      const pyDone = new Promise<number>((res) => py.on('close', (c) => res(c ?? -1)))

      for (let i = 0; i < N; i++) appendRotatorLog('tick', `record ${i}`, { root: dir })
      expect(await pyDone).toBe(0)

      const l = lines(dir)
      expect(l).toHaveLength(2 * N)
      // Every record intact — no torn or interleaved lines.
      expect(l.filter((x) => RECORD.test(x))).toHaveLength(2 * N)
      expect(l.filter((x) => x.includes('aim-server/tick:'))).toHaveLength(N)
      expect(l.filter((x) => x.includes('janitor/auto:'))).toHaveLength(N)
    },
  )
})
