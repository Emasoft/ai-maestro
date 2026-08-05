/**
 * `docs/SCRIPT-MANIFEST.md` announces EVERY script this repo ships (R23.7 / R23.8).
 *
 * WHY THIS FILE EXISTS. R23.8: *"announcing a new verb is part of shipping it… an unannounced verb
 * looks absent, and a plugin that believes the layer lacks what it needs is pushed back toward
 * `/api/*`."* The manifest is that announcement, and R23.7 makes it — not a host's `~/.local/bin` —
 * the frozen surface a plugin may depend on.
 *
 * Measured 2026-08-05, the manifest was **missing 7 shipped scripts** and carried **four mutually
 * contradictory counts**: §1 said 77, §2's heading said 46 (+12+21 = 79), §8's check said 75, and
 * the disk held 86. Among the unannounced were `aimaestro-settings.sh` (the only sanctioned way to
 * mutate a settings.json) and `aimaestro-check-decoupling.sh` (**the R23 compliance gate itself**) —
 * so the rule's own enforcement tool was invisible under the rule's own announcement requirement.
 * The AUTONOMOUS agent hand-rolled a grep on ai-maestro#107 for want of it.
 *
 * WHY A TEST AND NOT THE §8 SHELL BLOCK. §8 has documented these commands for months and nobody ran
 * them — which is how four counts drifted apart inside one document. A check that depends on a human
 * remembering to type it is not a check; it is a note. The header also *claimed* the file was
 * "Generated from scripts/*.sh" while nothing generated it, and that false claim is what stopped
 * anyone verifying: a reader who believes a file is generated does not audit it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not check that a row is CORRECT — that a signature
 * matches the script's real flags. It cannot: the manifest is prose. It checks only that every
 * shipped script is NAMED. That is the R23.8 property (announced at all), not the R23.4 property
 * (frozen accurately), and conflating them would let this file claim a guarantee it has no way to
 * provide. The `refuse --reason` drift earlier the same day was a CORRECTNESS drift and this test
 * would not have caught it.
 *
 * NEUTER RUN (2026-08-05 — OBSERVED): renaming any one manifest mention (here
 * `aimaestro-check-decoupling.sh` → `aimaestro-check-decoupled.sh`) reddens the coverage closure and
 * names the missing script; deleting a Tier count line reddens the count closure. The two are
 * independent — neither mutation reddens the other's closure.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const MANIFEST = path.join(REPO, 'docs', 'SCRIPT-MANIFEST.md')
const SCRIPTS_DIR = path.join(REPO, 'scripts')

const manifest = fs.readFileSync(MANIFEST, 'utf8')

/** Every `*.sh` this repo ships at the top level of `scripts/`. */
const shipped = fs
  .readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith('.sh'))
  .sort()

describe('R23.8 — every shipped script is announced', () => {
  it('finds a non-trivial number of scripts (guards against an empty scan)', () => {
    // Without this the coverage assertion below passes vacuously if the glob ever breaks —
    // "every script is announced" is trivially true of zero scripts.
    expect(shipped.length).toBeGreaterThan(50)
  })

  it('names every script in scripts/*.sh', () => {
    const missing = shipped.filter((name) => !manifest.includes(name))
    // Name them, so the failure is actionable rather than a count.
    expect(missing, `unannounced in docs/SCRIPT-MANIFEST.md (R23.8): ${missing.join(', ')}`).toEqual(
      [],
    )
  })
})

describe('the tier counts agree with each other and with the disk', () => {
  /** Pull an integer out of the first capture group of `re`, or fail loudly. */
  function num(re: RegExp, label: string): number {
    const m = manifest.match(re)
    expect(m, `could not locate the ${label} count in the manifest — has its wording changed?`).toBeTruthy()
    return Number(m![1])
  }

  it('Tier A + Tier B + Tier C equals the number of scripts on disk', () => {
    const a = num(/Tier A — the frozen skill-facing CLI \((\d+) scripts\)/, 'Tier A heading')
    const b = num(/Tier B — internal libraries \((\d+)\)/, 'Tier B heading')
    const c = num(/Tier C — operator \/ dev scripts \((\d+)\)/, 'Tier C heading')

    // The four-way disagreement this test was written for: 77 vs 79 vs 75 vs 86.
    expect(a + b + c).toBe(shipped.length)
  })

  it('the §1 tier table agrees with the section headings', () => {
    const a1 = num(/\*\*A — frozen CLI\*\* \(§2, (\d+) scripts\)/, '§1 Tier A')
    const c1 = num(/\*\*C — operator\/dev\*\* \(§4, (\d+) scripts\)/, '§1 Tier C')
    const a2 = num(/Tier A — the frozen skill-facing CLI \((\d+) scripts\)/, 'Tier A heading')
    const c2 = num(/Tier C — operator \/ dev scripts \((\d+)\)/, 'Tier C heading')

    expect(a1).toBe(a2)
    expect(c1).toBe(c2)
  })
})
