import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * The governance password must never appear in a committed file.
 *
 * A test that pins the CURRENT literal would be worthless the moment it is
 * rotated — and would itself be a committed copy of the secret. So this guard
 * enforces the SHAPE that makes a leak impossible instead of chasing one value:
 *
 *   1. a scenario declares the env var NAME, never a value;
 *   2. no step instructs the runner to type a password;
 *   3. no helper accepts a password argument (a parameter is a value the caller
 *      must first possess — exactly what the model must not).
 *
 * Provenance: the old contract passed the password as `$1`, so 197 clear-text
 * copies accumulated across 34 files and a publish carried the live credential
 * into a PUBLIC repo. TRDD-44RGLOO8 / TRDD-E9BZ5P7S.
 */

const SCEN_DIR = 'tests/scenarios'
const HELPERS = join(SCEN_DIR, 'scripts/dev-browser-helpers/aim-helpers.sh')
const ENV_REF = '$AIM_GOVERNANCE_PASSWORD'

const scenarioFiles = readdirSync(SCEN_DIR).filter((f) => f.endsWith('.scen.md'))

describe('the governance password never passes through a model', () => {
  // Non-vacuity: a selector over zero inputs passes for the wrong reason.
  it('actually has scenarios to check', () => {
    expect(scenarioFiles.length).toBeGreaterThan(20)
  })

  it('every scenario declares the env var NAME, never a password value', () => {
    const offenders: string[] = []
    for (const f of scenarioFiles) {
      const body = readFileSync(join(SCEN_DIR, f), 'utf8')
      const m = body.match(/^governance_password:\s*(.+)$/m)
      if (!m) {
        offenders.push(`${f}: no governance_password field`)
      } else if (!m[1].includes(ENV_REF)) {
        // Deliberately does NOT echo the offending value — that would print the
        // secret into CI logs, which is the bug.
        offenders.push(`${f}: governance_password is a literal, not ${ENV_REF}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no scenario step names a password VALUE', () => {
    // A password literal has a distinctive shape: a BARE token — no slash, no
    // whitespace. Everything else the corpus legitimately backticks after the
    // word "password" is an API route (has a `/`) or prose (has a space). So a
    // bare token that is not on this two-item allowlist is a literal.
    //
    // Deliberately NOT a lookahead: with one, the engine backtracks past the
    // clean `$AIM_GOVERNANCE_PASSWORD` and re-anchors on a later backtick pair
    // (`Login`), so a correct line "matches" and the guard cries wolf. Leftmost
    // capture + explicit inspection says what we actually mean.
    const SANCTIONED = new Set([ENV_REF, 'governance_password'])
    const offenders: string[] = []
    for (const f of scenarioFiles) {
      const body = readFileSync(join(SCEN_DIR, f), 'utf8')
      for (const m of body.matchAll(/password[^\n]{0,25}?`([^`\n]+)`/gi)) {
        const tok = m[1]
        const bare = !/[\s/]/.test(tok)
        // Never echo the token — printing it would leak the secret into CI logs,
        // which is the very bug this test exists to prevent.
        if (bare && !SANCTIONED.has(tok)) offenders.push(`${f}: a bare literal follows "password"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the helpers accept NO password argument', () => {
    const sh = readFileSync(HELPERS, 'utf8')
    // A `local password=` / `${1:?...password}` reintroduces the value-passing
    // contract that produced the leak.
    expect(sh).not.toMatch(/local\s+password=/)
    expect(sh).not.toMatch(/\$\{[12]:\?[^}]*password/i)
    // And the one legitimate source is present.
    expect(sh).toContain('aim__password_json')
    expect(sh).toContain('AIM_GOVERNANCE_PASSWORD')
  })
})
