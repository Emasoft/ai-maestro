import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * trdd-extrefs must FAIL LOUD when it cannot see the board.
 *
 * The whole point of the tool is to notice external blockers that have quietly cleared.
 * The one way it can betray that is to walk zero cards — a bad cwd, a renamed zone, a
 * broken frontmatter parse — and print "no open card cites an all-closed set of issues"
 * with exit 0. That output is indistinguishable from a genuinely clean board, which is
 * exactly how a blind instrument gets trusted.
 *
 * So the guard is: scanned nothing ⇒ exit 2 (COULD NOT RUN), never 0 (clean).
 * These tests drive the real CLI as a subprocess, because the guard lives in its
 * top-level control flow and no in-process import can reach it.
 */

const SCRIPT = resolve(__dirname, '../../scripts/trdd-extrefs.mjs')
const tmpRoots: string[] = []

// Plain `node`, NOT `node --import tsx` as the yarn script uses. The loader package is
// resolved relative to CWD, and these tests deliberately run from a temp dir, so `--import
// tsx` dies with ERR_MODULE_NOT_FOUND before the script's own code is ever reached — the
// harness failing, dressed as the tool failing. The script is plain ESM importing only node
// builtins, so it needs no transpilation; the guard under test is its own control flow and
// is identical either way.
function runIn(cwd: string): { status: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

function tmpRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'extrefs-'))
  tmpRoots.push(d)
  return d
}

afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

describe('trdd-extrefs non-vacuity guard', () => {
  it('exits 2 (COULD NOT RUN), never 0, when no design zone exists at all', () => {
    const { status, stderr } = runIn(tmpRoot())
    expect(status).toBe(2)
    expect(stderr).toMatch(/COULD NOT RUN/)
    // The message must name the refusal, so a CI log says why rather than just failing.
    expect(stderr).toMatch(/Refusing to report "clean"/)
  })

  it('exits 2 when the zones exist but hold no card carrying external-refs', () => {
    const root = tmpRoot()
    mkdirSync(join(root, 'design/tasks'), { recursive: true })
    // A real-shaped card that simply cites nothing external — must NOT read as "clean".
    writeFileSync(
      join(root, 'design/tasks/TRDD-20260101_000000+0000-AAAA1111-x.md'),
      ['---', 'trdd-id: AAAA1111', 'title: no external refs', 'column: todo', '---', '', '# x', ''].join('\n'),
    )
    const { status, stderr } = runIn(root)
    expect(status).toBe(2)
    expect(stderr).toMatch(/no card with an external-refs/)
  })

  it('does NOT treat a body mention of an issue as a citation', () => {
    // Anchoring on a frontmatter line start is what keeps MENTION out of USE. A card whose
    // BODY discusses `Emasoft/ai-maestro#1` cites nothing, so the walk still finds zero
    // citing cards and must refuse rather than silently resolve a discussed issue.
    const root = tmpRoot()
    mkdirSync(join(root, 'design/tasks'), { recursive: true })
    writeFileSync(
      join(root, 'design/tasks/TRDD-20260101_000000+0000-BBBB2222-y.md'),
      ['---', 'trdd-id: BBBB2222', 'title: mentions an issue in prose', 'column: todo', '---', '',
       '# y', '', 'This card discusses Emasoft/ai-maestro#1 at length but does not cite it.', ''].join('\n'),
    )
    const { status } = runIn(root)
    expect(status).toBe(2)
  })
})
