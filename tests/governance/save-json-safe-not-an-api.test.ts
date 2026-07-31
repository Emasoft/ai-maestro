/**
 * TRDD-K71FV649 — `saveJsonSafe` is exported for its TEST, not as an API.
 *
 * The guard inside it (refuse to overwrite an unreadable target) is a property of the primitive, and
 * pinning it needs a real file on disk — so the function had to become exported. Every "exported
 * only for the test" comment decays the moment a second module imports it: the comment stays true-
 * looking while the fact underneath it changes, and nothing reds. This test is the fact.
 *
 * It also guards the more important thing. Three sibling modules carry their own copy-pasted
 * `loadJsonSafe`/`saveJsonSafe` pair WITHOUT the guard (`services/role-plugin-service.ts:323/333`,
 * `services/plugin-storage-service.ts:825/829`, `lib/client-plugin-adapters/claude-adapter.ts:28/42`
 * — measured 2026-07-31, 6 more read-modify-writes, 3 of them on ~/.claude/settings.json). If a
 * fourth module imports THIS one's writer, the family stops being "four copies, one of them fixed"
 * and becomes an undocumented dependency graph — which is the state in which the remaining three
 * never get fixed. Consolidating them into one shared guarded helper is the intended end state
 * (that is what the eht: on the card is for); importing this one ad hoc is not.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const SEARCH_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'types']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build'])
const OWNER = 'services/element-management-service.ts'

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sources(p, acc)
    else if (/\.tsx?$/.test(e)) acc.push(p)
  }
  return acc
}

describe('saveJsonSafe stays test-only', () => {
  const files = SEARCH_DIRS.flatMap(d => sources(join(ROOT, d)))

  it('SCAN IS NON-VACUOUS — the sweep really reads the source tree', () => {
    // A floor, not an exact count: this repo grows. Without it, a broken walk reports "clean".
    expect(files.length).toBeGreaterThan(200)
    expect(files.some(f => f.endsWith('element-management-service.ts'))).toBe(true)
  })

  it('no source file outside the owner imports saveJsonSafe from it', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (f.endsWith(OWNER)) continue
      const src = readFileSync(f, 'utf-8')
      // Any import from the service that names saveJsonSafe among its bindings.
      for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]*element-management-service)['"]/g)) {
        if (/\bsaveJsonSafe\b/.test(m[1])) offenders.push(`${f.slice(ROOT.length + 1)} — { ${m[1].trim()} }`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('POSITIVE CONTROL — the detector DOES see an import of it (proved on a synthetic line)', () => {
    // Without this, the assertion above passes equally on a regex that matches nothing.
    const synthetic = `import { saveJsonSafe, readJson } from '@/services/element-management-service'`
    const hit = [...synthetic.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]*element-management-service)['"]/g)]
      .some(m => /\bsaveJsonSafe\b/.test(m[1]))
    expect(hit).toBe(true)
  })

  it('the export carries the reason, so the next reader knows it is not an API', () => {
    const src = readFileSync(join(ROOT, OWNER), 'utf-8')
    expect(src).toMatch(/EXPORTED FOR ITS TEST ONLY[\s\S]{0,600}export async function saveJsonSafe/)
  })
})
