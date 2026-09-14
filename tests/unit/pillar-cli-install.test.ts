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


const LAUNCHER_SRC = fs.readFileSync(path.join(REPO, "scripts", "pillar-cli"), "utf-8")

import os from 'os'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'

describe('the pillar CLI launcher has NO argv write gate of its own (ai-maestro#161 phase b)', () => {
  // Shared fixture: a symlinked launcher under the `trddgrep` name, an install-root pointer
  // pointing back at THIS checkout, and a throwaway corpus with one real card. Both tests
  // below run the ACTUAL scripts/pillar-cli file (not the tool's .mjs directly) so a
  // regression that re-adds a bash argv scan in the launcher fails HERE — the sibling
  // unit suite that drives the tool's own entry point directly would never see it.
  function setupFixture() {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-launcher-')))
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    const launcherLink = path.join(bin, 'trddgrep')
    fs.symlinkSync(path.join(REPO, 'scripts', 'pillar-cli'), launcherLink)

    const xdg = path.join(tmp, 'xdg')
    const jail = path.join(tmp, 'jail')
    fs.mkdirSync(path.join(xdg, 'aimaestro'), { recursive: true })
    fs.mkdirSync(jail, { recursive: true })
    fs.writeFileSync(path.join(xdg, 'aimaestro', 'install-root'), fs.realpathSync(REPO), 'utf-8')

    const design = path.join(tmp, 'design')
    for (const zone of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(design, zone), { recursive: true })
    }
    const id = 'ZZLNCHR1'
    const cardPath = path.join(design, 'tasks', `TRDD-20260101_000000+0100-${id}-launcher-gate-probe.md`)
    fs.writeFileSync(
      cardPath,
      [
        '---',
        `trdd-id: ${id}`,
        'title: edit the rotator',
        'column: dev',
        'created: 2026-01-01T00:00:00+0100',
        'updated: 2026-01-01T00:00:00+0100',
        'blocked-by: []',
        '---',
        '',
        '# edit the rotator',
        '',
        'body line',
        '',
      ].join('\n'),
      'utf-8',
    )

    const { AIM_PILLAR_ALLOW_WRITE, ...cleanEnv } = process.env
    const env = { ...cleanEnv, XDG_DATA_HOME: xdg, HOME: jail }
    return { tmp, launcherLink, design, id, cardPath, env }
  }

  it('Test A - a SEARCH containing the word "edit" is never refused (no argv scan)', () => {
    const { launcherLink, design, id, env, tmp } = setupFixture()
    const r = spawnSync(launcherLink, ['--design-dir', design, 'edit the rotator'], {
      cwd: tmp,
      encoding: 'utf-8',
      env,
    })
    // The id in stdout is the positive control that the search really ran - a launcher
    // that failed before reaching the tool's entry point (bad Node pin, bad install-root)
    // would also print nothing, and a bare exit-code assertion would not catch it.
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(id)
    expect(r.stderr).not.toContain('disabled outside')
  })

  it("Test B - 'edit' is still refused outside the checkout, with the NODE gate's wording", () => {
    const { launcherLink, design, id, cardPath, env, tmp } = setupFixture()
    const before = createHash('sha256').update(fs.readFileSync(cardPath)).digest('hex')
    const r = spawnSync(
      launcherLink,
      ['--design-dir', design, 'edit', id, '--expect', 'a', '--replace', 'b'],
      { cwd: tmp, encoding: 'utf-8', env },
    )
    // This does NOT prove WHICH entry point ran - main checkout's write gate carries the
    // identical wording, so a launcher that silently fell back to main's checkout would
    // pass this assertion too. Test A is what actually proves this launcher has no argv
    // scan; this test only proves the launcher still reaches SOME gate with the current
    // (node) wording, and that the corpus is untouched on refusal.
    expect(r.status).toBe(2)
    expect(r.stderr).toContain("'edit' rewrites the corpus and is disabled outside the ai-maestro checkout")
    expect(r.stderr).not.toContain('are disabled')
    expect(createHash('sha256').update(fs.readFileSync(cardPath)).digest('hex')).toBe(before)
  })
})

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
