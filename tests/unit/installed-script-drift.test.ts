/**
 * TRDD-GADPGOIR — the installed-script drift detector.
 *
 * FIXTURE-DRIVEN ON PURPOSE. It would be easy to assert "this host has zero drift", and that
 * test would pass or fail depending on when someone last ran the installer — the exact
 * machine-dependent shape that made three fleet-liveness tests look like load flakes for weeks.
 * The live scan belongs to `yarn scripts:drift`; the LOGIC is pinned here against synthetic
 * inputs, so the verdict is the same on every machine.
 */
import { describe, it, expect } from 'vitest'
import {
  compareInstalledScripts,
  driftExitCode,
  formatDriftReport,
  isTrackedScriptName,
} from '@/lib/installed-script-drift'

const src: Record<string, string> = {
  'amp-helper.sh': '#!/bin/sh\n_expected_name\n',
  'amp-send.sh': '#!/bin/sh\nsend\n',
  'aimaestro-agent.sh': '#!/bin/sh\nagent\n',
}

function run(installed: Record<string, string | undefined>) {
  return compareInstalledScripts({
    names: Object.keys(src),
    readSource: (n) => src[n],
    readInstalled: (n) => (n in installed ? (installed[n] as string) : null),
  })
}

describe('compareInstalledScripts', () => {
  it('all installed and identical → clean, exit 0', () => {
    const r = run({ ...src })
    expect(r.identical).toBe(3)
    expect(r.drifted).toEqual([])
    expect(r.missing).toEqual([])
    expect(driftExitCode(r)).toBe(0)
  })

  it('POSITIVE CONTROL — a genuinely drifted file IS flagged', () => {
    // The 2026-08-04 incident in miniature: the installed copy lags a source commit. A detector
    // that cannot produce this finding is the 12-day silence it exists to end.
    const r = run({ ...src, 'amp-helper.sh': '#!/bin/sh\n' })
    expect(r.drifted).toEqual(['amp-helper.sh'])
    expect(driftExitCode(r)).toBe(1)
  })

  it('MISSING is its own state, never folded into drifted', () => {
    // Different fault, different remedy: a drifted script runs the wrong code, a missing one is
    // `command not found` for every agent that calls it. This host has exactly one (measured
    // 2026-08-15: aimaestro-check-decoupling.sh), which is why the distinction is not academic.
    const { 'amp-send.sh': _omitted, ...rest } = src
    const r = run(rest)
    expect(r.missing).toEqual(['amp-send.sh'])
    expect(r.drifted).toEqual([])
    expect(driftExitCode(r)).toBe(1)
  })

  it('a whitespace-only difference still counts — bytes, not a version string', () => {
    // mtime says when a file was WRITTEN (an install rewrites it even unchanged) and a version
    // string is only as honest as whoever bumped it. Bytes are what the agent executes.
    const r = run({ ...src, 'amp-send.sh': '#!/bin/sh\nsend \n' })
    expect(r.drifted).toEqual(['amp-send.sh'])
  })

  it('AN EMPTY SCAN IS EXIT 2, NEVER A CLEAN 0', () => {
    // The failure mode this whole card is about: "clean" and "I looked at nothing" print the
    // same way. A human check reported in-sync for 12 days over a set it never really built.
    const r = compareInstalledScripts({ names: [], readSource: () => '', readInstalled: () => null })
    expect(r.scanned).toBe(0)
    expect(driftExitCode(r)).toBe(2)
    expect(formatDriftReport(r)).toMatch(/COULD NOT RUN/)
  })

  it('the report NAMES the remediation but never performs it', () => {
    const out = formatDriftReport(run({ ...src, 'amp-helper.sh': 'x' }))
    expect(out).toMatch(/DRIFTED\s+amp-helper\.sh/)
    // All-or-nothing is the load-bearing half: applying the self-heal without its sibling
    // activates a heal that rebuilds the agent object and silently drops `id` — the uuid that IS
    // the agent's identity — across every affected agent.
    expect(out).toMatch(/never cherry-pick/)
    expect(out).toMatch(/install-messaging\.sh/)
  })
})

/**
 * THE FAMILY LIST IS THE SCAN SET, so this predicate decides what the whole detector can SEE.
 * A family missing from it is not under-reported, it is invisible — and the census then prints a
 * confident "N compared / all identical" about scripts it never opened. That is exactly what
 * happened: the predicate lived inline in `scripts/check-script-drift.mjs` as
 * /^(amp|aimaestro)-.*\.sh$/, omitting `aid-*`, and all SIX aid scripts went unchecked. The live
 * scan read `47 compared`; with the family restored it reads `54`.
 *
 * The lesson these tests encode is WHY it was unpinnable: the lib had a full test file, and the
 * one line deciding what gets tested sat outside it, in an untested `.mjs`.
 */
describe('isTrackedScriptName — the scan set', () => {
  it('REGRESSION — the aid-* family is tracked (it was silently omitted)', () => {
    // Neuter this by removing `aid` from the alternation in lib/installed-script-drift.ts:
    // this test reds and no other does, which is what makes it the pin for that one character.
    expect(isTrackedScriptName('aid-auth.sh')).toBe(true)
    expect(isTrackedScriptName('aid-token.sh')).toBe(true)
    expect(isTrackedScriptName('aid-helper.sh')).toBe(true)
  })

  it('POSITIVE CONTROL — the two families that always worked still do', () => {
    // Without this, removing the WHOLE alternation would look like a single-family regression.
    expect(isTrackedScriptName('amp-send.sh')).toBe(true)
    expect(isTrackedScriptName('aimaestro-trdd.sh')).toBe(true)
  })

  it('does not track the extensionless convenience symlinks', () => {
    // install-messaging.sh creates `amp-send -> amp-send.sh` beside every script. Tracking both
    // would compare each file twice and inflate the census with duplicate rows.
    expect(isTrackedScriptName('amp-send')).toBe(false)
    expect(isTrackedScriptName('aid-auth')).toBe(false)
  })

  it('does not track sourced libraries or non-scripts', () => {
    // `agent-*.sh` are sourced by aimaestro-agent.sh, never invoked from PATH as their own
    // command, so they are outside the installed-command layer this detector governs.
    expect(isTrackedScriptName('agent-core.sh')).toBe(false)
    expect(isTrackedScriptName('README.md')).toBe(false)
    expect(isTrackedScriptName('aimaestro-settings-cli.mjs')).toBe(false)
  })
})
