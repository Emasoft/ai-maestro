import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

/**
 * TRDD-HF2DY4VT — `updateJson`'s post-commit audit returns `auditOk`, and NOTHING BRANCHES ON IT.
 *
 * `lib/json-io.ts` re-reads the file after the atomic swap and compares it byte-for-byte against
 * what it wrote. A mismatch means the write did not land as intended. It deliberately does NOT
 * roll back (restoring the backup would destroy a legitimate write by the `claude` CLI, which
 * takes no lock of ours) — it returns `auditOk: false` and logs.
 *
 * WHY THIS FILE EXISTS. That comment used to promise "the caller decides", which was false, and
 * the correction replaced it with a CENSUS: zero callers branch on the flag. A census written into
 * a comment is exactly the thing this repo keeps finding stale — and "zero branch" is not a dated
 * measurement, it is an INVARIANT CLAIM, which fails in the reassuring direction: if someone later
 * adds a branch, the comment still tells the next reader nobody does, and a reader who believes it
 * may delete the flag — or the audit — as dead code. `r51-7-invariants.test.ts` already
 * establishes the convention (`MIN_WITH_INVARIANTS`): a census this codebase relies on is pinned
 * by a ratchet, never left in prose.
 *
 * ⚠ WHAT THIS TEST DOES AND DOES NOT PROVE. It is an IDENTIFIER scan, and an identifier scan
 * answers "does this spelling appear", NOT "does anyone consume the value". Two consumers today
 * genuinely RECEIVE `auditOk` without ever naming it — `app/api/settings/edit/route.ts` and
 * `scripts/aimaestro-settings-cli.mjs` both spread the whole result into their output, so the flag
 * ships to an HTTP client and a CLI beside a sibling `success: true`. This test stays green
 * through that, correctly: it pins "nobody BRANCHES", which is the claim in the comment. Proving
 * "nobody consumes" needs value-flow classification (a bare `await updateJson(…)` discards the
 * result and cannot read the flag under any spelling; only sites that bind or destructure it, or
 * that go through a propagating wrapper like `settings-gate.ts::editSettings`, can). Do not let a
 * green run here be read as the stronger claim.
 */

const REPO = path.resolve(__dirname, '..', '..')
const ROOTS = ['app', 'lib', 'services', 'components', 'scripts']
const EXTS = ['.ts', '.tsx', '.mjs']

/** The definition itself necessarily names the field; it is the thing being measured, not a consumer. */
const DEFINITION = 'lib/json-io.ts'

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next' || e === '.git') continue
      const full = path.join(dir, e)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (EXTS.some(x => e.endsWith(x))) out.push(full)
    }
  }
  for (const r of ROOTS) walk(path.join(REPO, r))
  const serverMjs = path.join(REPO, 'server.mjs')
  try {
    if (statSync(serverMjs).isFile()) out.push(serverMjs)
  } catch {
    /* absent in some checkouts — the floor below catches a scan set that collapsed */
  }
  return out
}

/** Files that call `updateJson(` or `editSettings(` — the set that could observe the flag. */
function callerFiles(): string[] {
  return sourceFiles().filter(f => {
    if (path.relative(REPO, f) === DEFINITION) return false
    const src = readFileSync(f, 'utf-8')
    return src.includes('updateJson(') || src.includes('editSettings(')
  })
}

describe('TRDD-HF2DY4VT — the auditOk census is pinned, not asserted in prose', () => {
  const files = sourceFiles()
  const callers = callerFiles()

  it('POSITIVE CONTROL — the walker found a real scan set', () => {
    // A mis-joined root would make every assertion below pass by scanning nothing.
    expect(files.length).toBeGreaterThan(200)
    expect(files.some(f => path.relative(REPO, f) === DEFINITION)).toBe(true)
  })

  it('POSITIVE CONTROL — the extractor found the known caller files', () => {
    // A broken `includes` would report zero callers, and zero callers trivially branch on nothing.
    const rel = callers.map(f => path.relative(REPO, f))
    expect(callers.length).toBeGreaterThanOrEqual(10)
    expect(rel).toContain('lib/settings-gate.ts')
    expect(rel).toContain('services/element-management-service.ts')
    expect(rel).toContain('app/api/settings/edit/route.ts')
  })

  it('no caller of updateJson/editSettings BRANCHES on auditOk', () => {
    const consumers = callers
      .map(f => path.relative(REPO, f))
      .filter(rel => readFileSync(path.join(REPO, rel), 'utf-8').includes('auditOk'))

    expect(
      consumers,
      `A caller now names \`auditOk\`: ${consumers.join(', ')}. That is not a failure — it is the ` +
        `census in lib/json-io.ts going stale. THE CENSUS LIVES IN TWO PLACES — fix BOTH or you ` +
        `recreate the stale prose this ratchet exists to prevent: (1) the block comment above ` +
        `\`updateJson\` in lib/json-io.ts, and (2) TRDD-HF2DY4VT, which tracks whether the flag ` +
        `should be acted on at all.`,
    ).toEqual([])
  })
})
