/**
 * TRDD-217AYEOT — the pillar CLIs actually reach a bin dir, under the right names.
 *
 * This reads `install-messaging.sh` rather than running it: the installer writes to the
 * developer's real `~/.local/bin` and `~/.local/share`, so executing it in a test would
 * violate 0-IMPACT to check a property that is purely textual.
 *
 * The property is easy to lose by accident. Both of the installer's existing loops match
 * `scripts/*.sh`, and the USER's naming law makes these tools extensionless
 * (`<document type>grep`), so they are invisible to both. The launcher must therefore
 * stay extensionless AND keep its explicit step — and the failure mode if either drifts
 * is silent: `trddgrep` simply stops existing on new installs, which is the exact bug
 * this card was opened for.
 */
import fs from 'fs'
import path from 'path'

import { describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const INSTALLER = fs.readFileSync(path.join(REPO, 'install-messaging.sh'), 'utf-8')

describe('the pillar CLI launcher', () => {
  it('exists, is executable, and is the ONE implementation behind every pillar name', () => {
    const launcher = path.join(REPO, 'scripts', 'pillar-cli')
    expect(fs.existsSync(launcher)).toBe(true)
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(launcher).mode & 0o111).toBeGreaterThan(0)
    // Dispatch on the invoked name is what makes one file serve N tools. Without it we
    // would be back to a script per pillar — "multiple versions of the tools".
    expect(fs.readFileSync(launcher, 'utf-8')).toContain('TOOL="$(basename "$0")"')
  })

  it('has NO .sh extension, so the installer glob cannot give it a second name', () => {
    // A `pillar-cli.sh` would be picked up by the `scripts/*.sh` loop and land in
    // ~/.local/bin as `pillar-cli.sh` — the same tool, reachable under a fourth,
    // undocumented name.
    expect(fs.existsSync(path.join(REPO, 'scripts', 'pillar-cli.sh'))).toBe(false)
  })
})

describe('install-messaging.sh installs the pillar CLIs explicitly', () => {
  it('records the install root, because the launcher must locate this tree at runtime', () => {
    // $SCRIPT_DIR is the one place that provably knows where ai-maestro is installed;
    // a packaged install has no ~/ai-maestro to hardcode.
    expect(INSTALLER).toMatch(/install-root/)
    expect(INSTALLER).toMatch(/printf '%s\\n' "\$SCRIPT_DIR" > ~\/\.local\/share\/aimaestro\/install-root/)
  })

  it('installs one copy of the launcher per pillar name', () => {
    expect(INSTALLER).toMatch(/for PILLAR_TOOL in trddgrep prrdgrep specgrep/)
    expect(INSTALLER).toMatch(/cp "\$SCRIPT_DIR\/scripts\/pillar-cli" ~\/\.local\/bin\/"\$PILLAR_TOOL"/)
  })

  it('installs a name only when its implementation exists — no stub that refuses', () => {
    // An agent that finds a tool and gets an error cannot tell "planned" from "broken",
    // so prrdgrep/specgrep appear the day their .mjs does, and not before.
    expect(INSTALLER).toMatch(/if \[ -f "\$SCRIPT_DIR\/scripts\/\$PILLAR_TOOL\.mjs" \]/)
  })

  it('the tool this card shipped is one of those names', () => {
    expect(fs.existsSync(path.join(REPO, 'scripts', 'trddgrep.mjs'))).toBe(true)
    // …and the pre-rename name is gone, so nothing can install it under both.
    expect(fs.existsSync(path.join(REPO, 'scripts', 'greptrdd.mjs'))).toBe(false)
  })
})
