/**
 * Authority is `governanceTitle` alone — `role` is never an authority fallback.
 *
 * TRDD-4Z62YRDG (ai-maestro#122). `Agent.role` (messaging, default `'autonomous'`)
 * and `Agent.governanceTitle` share the `AgentRole` type and therefore the same
 * value vocabulary, so a defaulted `role: "autonomous"` beside
 * `governanceTitle: "manager"` reads as a title CONTRADICTION when it is merely a
 * default. On 2026-08-05 a live AUTONOMOUS agent refused a legitimate MANAGER
 * mandate over exactly that misreading, and TWO Claude instances independently
 * made the same misread before either opened `types/agent.ts`.
 *
 * Two production sites had baked the confusion into code as an authority
 * FALLBACK — `agent.governanceTitle || agent.role` — and one of them
 * (`/api/teams/[id]/composition-check`) is a governance gate, so a titleless
 * agent's defaulted `role` could satisfy a composition requirement it did not
 * meet. That is a false PASS on a governance check, which is the worst shape a
 * bug can take here: it reports success. Both were removed in b9f7e401.
 *
 * This is the ratchet that keeps them gone. It is a SOURCE SCAN, deliberately:
 * the defect is a code SHAPE that can reappear anywhere, so pinning the two known
 * sites behaviourally would leave a third free to land.
 *
 * NON-VACUITY IS THE WHOLE PROBLEM WITH A SCAN LIKE THIS — "0 findings" is also
 * what a broken detector, an empty file list, or a wrong root returns. So this
 * file asserts, every run: the scan set is large, it contains a known
 * TOP-LEVEL file (a `dir/**\/*.ts` pathspec silently drops those), and the
 * detector still matches a seeded violation of each shape.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'services', 'app', 'components']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '__snapshots__'])

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

/**
 * The two orderings of the same defect. `governanceTitle || role` is the one that
 * shipped; `role || governanceTitle` is worse (role wins outright) and is included
 * so the ratchet is not merely a memorial to the exact bug that was found.
 */
const PATTERNS: Array<{ name: string; re: RegExp; sample: string }> = [
  {
    name: 'governanceTitle || role',
    re: /governanceTitle[^a-zA-Z]*\|\|[^a-zA-Z]*[\w.]*\brole\b/,
    sample: 'const t = (agent.governanceTitle || agent.role || "unknown")',
  },
  {
    name: 'role || governanceTitle',
    re: /\brole\b[^a-zA-Z]*\|\|[^a-zA-Z]*[\w.]*governanceTitle/,
    sample: 'const t = agent.role || agent.governanceTitle',
  },
  {
    name: 'governanceTitle ?? role',
    re: /governanceTitle[^a-zA-Z]*\?\?[^a-zA-Z]*[\w.]*\brole\b/,
    sample: 'const t = agent.governanceTitle ?? agent.role',
  },
]

const FILES = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)))

describe('the scan itself is real — without this, "0 findings" proves nothing', () => {
  it('scanned a substantial number of source files', () => {
    // A floor, not an exact count: an exact one rots into a chore on every new
    // file. This only has to be big enough that an empty or mis-rooted walk fails.
    expect(FILES.length).toBeGreaterThan(300)
  })

  it('includes TOP-LEVEL files of each scanned directory', () => {
    // The trap this exists for: a `dir/**\/*.ts` pathspec matches only NESTED
    // files, so a top-level one is silently outside the scan while the count
    // still looks healthy. Assert one real top-level file per directory.
    const rel = new Set(FILES.map((f) => relative(ROOT, f)))
    expect(rel.has(join('lib', 'authorization.ts'))).toBe(true)
    expect(rel.has(join('services', 'agents-core-service.ts'))).toBe(true)
  })

  it('the detector matches a seeded violation of every shape', () => {
    // The positive control. If a regex is broken — and one of these was written
    // three times before it matched what it meant to — the sweep reads CLEAN and
    // the ratchet silently protects nothing.
    for (const p of PATTERNS) {
      expect(p.re.test(p.sample), `pattern "${p.name}" failed to match its own sample`).toBe(true)
    }
  })
})

describe('R-authority: no production site reads `role` as authority', () => {
  it('finds zero authority-from-role fallbacks', () => {
    const findings: string[] = []

    for (const file of FILES) {
      // This file necessarily CONTAINS the patterns it hunts (in PATTERNS above),
      // so a scanner that does not exclude itself reports itself — the `pgrep -f`
      // self-match trap, one layer up. It lives outside SCAN_DIRS, but exclude it
      // explicitly so moving it can never turn the ratchet red against itself.
      if (file.endsWith('authority-never-reads-role.test.ts')) continue

      const src = readFileSync(file, 'utf-8')
      if (!src.includes('governanceTitle')) continue

      src.split('\n').forEach((line, i) => {
        // Comments are prose ABOUT the rule — including the ones added by
        // b9f7e401 explaining why the fallback was removed. Flagging those would
        // make the correct fix red and get the ratchet deleted.
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
        if (/^\s*\*/.test(line)) return

        for (const p of PATTERNS) {
          if (p.re.test(code)) {
            findings.push(`${relative(ROOT, file)}:${i + 1}  [${p.name}]  ${line.trim()}`)
          }
        }
      })
    }

    expect(
      findings,
      'Authority must come from `governanceTitle` alone. `role` is the MESSAGING field: it ' +
        'defaults to "autonomous", so falling back to it invents a title the agent was never ' +
        'granted — and on a governance gate that is a false PASS, not a failure.\n' +
        findings.join('\n'),
    ).toEqual([])
  })
})
