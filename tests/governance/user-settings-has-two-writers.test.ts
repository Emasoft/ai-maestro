/**
 * TRDD-ZT3P02PO — the user's global `~/.claude/settings.json` has exactly TWO writers.
 *
 * WHAT WENT WRONG, so the next reader knows what this defends (measured 2026-08-01):
 * `app/api/settings/marketplaces/route.ts` was the ONLY file in the tree that wrote the human
 * user's own global Claude Code config with a direct `writeFile`, and it did so at FIVE sites —
 * each a read-modify-write fed by a file-local LENIENT reader. A lenient reader answers `{}` for a
 * CORRUPT file exactly as it does for a missing one, so each site rebuilt a minimal object out of
 * nothing and REPLACED the file, destroying every key it held.
 *
 * ⚠ WHY THE EXISTING GUARD COULD NOT SEE IT. `one-json-io-implementation.test.ts` forbids a fifth
 * copy of the json-io family, but its detector keys on the NAMES `loadJsonSafe|saveJsonSafe|readJson`
 * — and this copy was called `readJsonSafe`. One character. The sweep was blind to it BY
 * CONSTRUCTION, and the family looked consolidated (TRDD-CS25TA6W) while the worst-placed copy
 * survived. A name-keyed detector cannot see a copy under a different name, so this test keys on the
 * TARGET instead: whatever you call your reader, you may not `writeFile` the user's settings.
 *
 * THE TWO OWNERS, and why each is allowed:
 *   - `lib/json-io.ts` — atomic (tmp+rename) AND guarded (refuses to overwrite a target it could
 *     not read). `save-json-safe-refuses-clobber.test.ts` pins that behaviourally.
 *   - `lib/claude-settings-enforcer.ts` — its own atomic writer, its own non-object refusal, and it
 *     takes a `.aim-bak` backup first.
 *
 * ⚠ NON-VACUITY. The offender set is empty both when the tree is clean and when the scan never ran.
 * The file floor, the "the declaring set contains the file this rule was written for" check, and the
 * positive controls are what separate those two answers.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const SEARCH_DIRS = ['app', 'components', 'hooks', 'lib', 'services', 'types']
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build'])

const OWNERS = new Set([join('lib', 'json-io.ts'), join('lib', 'claude-settings-enforcer.ts')])
/** The file this rule was written for — if the sweep stops seeing it, the sweep is broken. */
const SUBJECT = join('app', 'api', 'settings', 'marketplaces', 'route.ts')

function sources(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) sources(p, acc)
    else if (/\.tsx?$/.test(e)) acc.push(p)
  }
  return acc
}

/**
 * A declaration binding a name to the USER-GLOBAL settings path.
 *
 * `settings.local.json` is deliberately NOT matched: it is a PER-PROJECT file living inside an
 * agent's own working directory, and routes legitimately write it. This rule is about the one file
 * that belongs to the human.
 *
 * ⚠ The argument list is matched with a BOUNDED LAZY `[^;]` run, not `[^)]*`. A `)`-excluding
 * class cannot cross `join(os.homedir(), '.claude', 'settings.json')` — the inline form
 * `lib/claude-settings-enforcer.ts` itself uses — so it would have reported that whole shape as
 * absent. The `[^;]` keeps it inside one statement and the `{0,120}` bound keeps it linear.
 */
const DECLARES = /(?:const|let)\s+(\w+)\s*=\s*(?:path\.)?join\([^;]{0,120}?['"]\.claude['"]\s*,\s*['"]settings\.json['"]\s*\)/g

/** A direct write to that bound name — `writeFile(X` / `writeFileSync(X`, awaited or not.
 *  `writeFile(?:Sync)?`, NOT `writeFileSync?` — the latter reads as "writeFileSyn" + an optional
 *  "c", so it matches NEITHER spelling. Its positive control is what caught that. */
const writesTo = (name: string) => new RegExp(`writeFile(?:Sync)?\\s*\\(\\s*${name}\\b`)

describe("the user's global settings.json has exactly two writers", () => {
  const files = SEARCH_DIRS.flatMap(d => sources(join(ROOT, d)))
  const rel = (f: string) => f.slice(ROOT.length + 1)

  /** Every file that binds a name to the user-global settings path, with the names it bound. */
  const declaring = files
    .map(f => {
      const src = readFileSync(f, 'utf-8')
      const names = [...src.matchAll(DECLARES)].map(m => m[1])
      return { file: rel(f), src, names }
    })
    .filter(d => d.names.length > 0)

  it('SCAN IS NON-VACUOUS — the sweep really reads the source tree', () => {
    // A floor, not an exact count: this repo grows. Without it a broken walk reports "clean".
    expect(files.length).toBeGreaterThan(200)
    expect(files.map(rel)).toContain(SUBJECT)
  })

  it('THE DECLARING SET IS NON-EMPTY and contains the file this rule was written for', () => {
    // A rule stated only over OFFENDERS passes on an empty set — i.e. it would pass if the regex
    // matched nothing at all. This is the companion "there is at least one X" the offender check
    // needs in order to mean anything.
    expect(declaring.length).toBeGreaterThanOrEqual(3)
    expect(declaring.map(d => d.file)).toContain(SUBJECT)
  })

  it('no file outside the two owners writes it directly', () => {
    const offenders = declaring
      .filter(d => !OWNERS.has(d.file))
      .filter(d => d.names.some(n => writesTo(n).test(d.src)))
      .map(d => d.file)
    expect(offenders).toEqual([])
  })

  it('POSITIVE CONTROL — DECLARES matches the real declaration forms', () => {
    // Without this, "offenders is empty" is equally satisfied by a regex that matches nothing.
    for (const s of [
      `const SETTINGS_PATH = join(HOME, '.claude', 'settings.json')`,
      `const settingsPath = path.join(HOME, '.claude', 'settings.json')`,
      `let userSettingsPath = join(os.homedir(), '.claude', 'settings.json')`,
    ]) expect(new RegExp(DECLARES.source).test(s)).toBe(true)
  })

  it('POSITIVE CONTROL — DECLARES does NOT match the per-project settings.local.json', () => {
    // Routes legitimately write an agent's own settings.local.json; this rule is not about that.
    expect(new RegExp(DECLARES.source).test(
      `const p = join(workdir, '.claude', 'settings.local.json')`,
    )).toBe(false)
  })

  it('POSITIVE CONTROL — the write detector matches the shape that caused the bug', () => {
    const src = `await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\\n')`
    expect(writesTo('SETTINGS_PATH').test(src)).toBe(true)
    // …and does NOT fire on the guarded writer, which is the whole point of the fix.
    expect(writesTo('SETTINGS_PATH').test('await saveJsonSafe(SETTINGS_PATH, settings)')).toBe(false)
    // …nor on a DIFFERENT constant that merely starts with the same letters.
    expect(writesTo('SETTINGS_PATH').test('await writeFile(SETTINGS_PATH_LOCAL, body)')).toBe(false)
  })
})

/**
 * THE SECOND HALF (TRDD-RYFP030K): `settings.local.json` gets the same rule.
 *
 * The block above deliberately EXCLUDED it — "routes legitimately write an agent's own
 * settings.local.json; this rule is not about that" — and that reasoning is now obsolete. It decides
 * which plugins an agent loads, THREE modules write it, and until 2026-08-01 they held three
 * different locks over it (a lockdir, a string key in an in-process Map, and nothing at all). The
 * whole point of the gate is that there is ONE writer, and a rule that covers only the human's copy
 * leaves the agents' copies exactly as unprotected as before.
 *
 * ⚠ THIS IS A RATCHET WITH A RECORDED DEBT, not a clean bill of health. `ChangeClient`'s three
 * direct `writeFileSync` sites are allowlisted BY NAME below because they exist today and this test
 * has to land green — see the entry for what they are and which is legitimate.
 */
const DECLARES_LOCAL =
  /(?:const|let)\s+(\w+)\s*=\s*(?:path\.)?join\([^;]{0,160}?['"]settings\.local\.json['"]\s*\)/g

/**
 * Files permitted to write `settings.local.json` directly, and WHY. Anything not here is a new
 * offender and fails.
 */
const LOCAL_WRITERS = new Map<string, string>([
  [join('lib', 'json-io.ts'), 'THE gate. Writes every settings file, always by parameter.'],
  // ⚠ `services/element-management-service.ts` WAS HERE AS RECORDED DEBT for about twenty minutes
  // on 2026-08-01, and its removal is the deliverable rather than a tidy-up. It held ChangeClient's
  // three direct `writeFileSync` sites on settings.local.json: two plain read-modify-writes in
  // G07/G08 (one of which carried a LIVE instance of the destroy-the-config bug — a lenient
  // `catch { /* keep empty */ }` read followed by a full file replace), and one R51 compensation
  // replaying a raw byte snapshot. The two RMWs are now `updateJson`; the compensation is
  // `restoreRawSnapshot`, which keeps the raw semantics a compensation requires and adds the
  // atomicity and the lock it was missing. All three writes moved INTO `lib/json-io.ts`, which is
  // this list's first entry and is also in `KNOWN_INDIRECT_WRITERS` — so the line is deleted with
  // the write RE-HOMED, never merely dropped.
])

describe("an agent's settings.local.json has one writer too", () => {
  const files = SEARCH_DIRS.flatMap(d => sources(join(ROOT, d)))
  const rel = (f: string) => f.slice(ROOT.length + 1)

  const declaring = files
    .map(f => {
      const src = readFileSync(f, 'utf-8')
      const names = [...src.matchAll(DECLARES_LOCAL)].map(m => m[1])
      return { file: rel(f), src, names }
    })
    .filter(d => d.names.length > 0)

  it('THE DECLARING SET IS NON-EMPTY — the rule is stated over something that exists', () => {
    // Same companion the offender check above needs: a rule written only over offenders passes on
    // an empty set, i.e. it would pass if the regex matched nothing at all.
    expect(declaring.length).toBeGreaterThanOrEqual(5)
    expect(declaring.map(d => d.file)).toContain(join('services', 'element-management-service.ts'))
  })

  it('no NEW file writes an agent settings.local.json directly', () => {
    const offenders = declaring
      .filter(d => !LOCAL_WRITERS.has(d.file))
      .filter(d => d.names.some(n => writesTo(n).test(d.src)))
      .map(d => d.file)
    expect(offenders).toEqual([])
  })

  it('the migrated modules are STILL clean — the ratchet would notice a regression', () => {
    // These three were migrated to `updateJson` on 2026-08-01. Asserting their cleanliness
    // POSITIVELY is what turns "offenders is empty" into evidence: the set-difference test above
    // stays green if a file drops out of `declaring` entirely (e.g. someone inlines the path), which
    // looks identical to the file being fixed.
    for (const f of [
      join('lib', 'client-plugin-adapters', 'claude-adapter.ts'),
      join('services', 'role-plugin-service.ts'),
    ]) {
      const d = declaring.find(x => x.file === f)
      expect(d, `${f} no longer declares a settings.local.json path — did it move, or was it lost?`).toBeDefined()
      expect(d!.names.some(n => writesTo(n).test(d!.src)), `${f} regressed to a direct write`).toBe(false)
    }
  })

  it('POSITIVE CONTROL — DECLARES_LOCAL matches the real forms and not the user-global one', () => {
    for (const s of [
      `const localSettings = join(resolved, '.claude', 'settings.local.json')`,
      `const settingsPath = path.join(agentDir, '.claude', 'settings.local.json')`,
    ]) expect(new RegExp(DECLARES_LOCAL.source).test(s)).toBe(true)
    // The two rules must not collapse into one — this half is about the AGENT's file.
    expect(new RegExp(DECLARES_LOCAL.source).test(
      `const p = join(HOME, '.claude', 'settings.json')`,
    )).toBe(false)
  })
})
