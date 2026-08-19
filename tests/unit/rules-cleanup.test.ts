// TRDD-5II83KK4 — the absorbed rules-cleanup lane, ported line-faithful from the janitor's
// rules_installer.py (cleanup_user_orphans_if_uninstalled) + daemon.py task_rules_cleanup.
// 0-IMPACT: every fs touch is a tmp fixture; the uninstalled predicate and the destructive
// remover are driven through injected deps — never the developer's real ~/.claude.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isJanitorInstalledRule,
  janitorDataDir,
  janitorRuleFilesIn,
  janitorUninstalled,
  removeJanitorRulesIn,
  runRulesCleanup,
  startRulesCleanupScheduler,
  userRulesDir,
  PROVENANCE_MARKER,
} from '@/lib/rules-cleanup'
import { activeAbsorbedChores } from '@/lib/janitor-chore-stamp'

function tmpRules(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rules-cleanup-'))
}
function seed(dir: string, name: string, body: string): string {
  const p = path.join(dir, name)
  fs.writeFileSync(p, body)
  return p
}

/*
 * NEUTER RUNS (2026-08-20 — OBSERVED via scripts/dev/neuter, restores blob-hash-verified):
 *   marker gate → .filter(() => true)          → 3 red/11 green (the 3 marker-gate tests,
 *     incl. "removes ONLY provenance-marked *.md" — the card's mandatory pin)
 *   settings signal dropped from the AND        → 2 red/12 green (referencing + disabled cases)
 *   installed-guard dropped from the beat       → 1 red/13 green (NOTHING removed while installed)
 *   claim made unconditional                    → 1 red/13 green (unarmed never claims)
 *   detect-only gate dropped (!deps.armed)      → 1 red/13 green (unarmed deletes nothing)
 */
describe('path anchors — requirement 3 (explicit root resolution, never __dirname/cwd)', () => {
  it('data dir + rules dir anchor on HOME with the janitor-verbatim shapes', () => {
    expect(janitorDataDir()).toBe(
      path.join(os.homedir(), '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins'),
    )
    expect(userRulesDir()).toBe(path.join(os.homedir(), '.claude', 'rules'))
  })
})

describe('the marker gate — an unmarked (user-authored) rule is NEVER removed', () => {
  it('removes ONLY provenance-marked *.md files; user rules and non-md files survive', () => {
    const dir = tmpRules()
    const marked = seed(dir, 'janitor-rule.md', `# rule\n<!-- ${PROVENANCE_MARKER} -->\nbody`)
    const userRule = seed(dir, 'my-own-rule.md', '# mine\nno marker here')
    const notMd = seed(dir, 'marked-but-not-md.txt', PROVENANCE_MARKER)
    const removed = removeJanitorRulesIn(dir)
    expect(removed).toEqual([marked])
    expect(fs.existsSync(marked)).toBe(false)
    expect(fs.existsSync(userRule)).toBe(true) // the whole point of the gate
    expect(fs.existsSync(notMd)).toBe(true) // *.md only, janitor-verbatim
  })
  it('fail-closed: an unreadable candidate is treated as NOT ours (never removed, no throw)', () => {
    const dir = tmpRules()
    // EISDIR provocation, not chmod — a permissions fixture passes vacuously under root/CI
    fs.mkdirSync(path.join(dir, 'unreadable.md'))
    const marked = seed(dir, 'real.md', PROVENANCE_MARKER)
    expect(janitorRuleFilesIn(dir)).toEqual([marked]) // positive control in the same call
    expect(isJanitorInstalledRule(path.join(dir, 'unreadable.md'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'unreadable.md'))).toBe(true)
  })
  it('an absent rules dir yields [] (janitor: `if not rules_dir.is_dir()`)', () => {
    expect(janitorRuleFilesIn(path.join(tmpRules(), 'nope'))).toEqual([])
  })
})

describe('janitorUninstalled — BOTH signals must agree (rules_installer.py::janitor_uninstalled)', () => {
  it('settings still referencing the plugin ⇒ installed, even with the data dir gone', () => {
    expect(
      janitorUninstalled({
        settingsText: () => '{"enabledPlugins":{"ai-maestro-janitor@ai-maestro-plugins":true}}',
        dataDirExists: () => false,
      }),
    ).toBe(false)
  })
  it('a DISABLED plugin still appears in settings ⇒ installed (the docstring case)', () => {
    expect(
      janitorUninstalled({
        settingsText: () => '{"disabledPlugins":{"ai-maestro-janitor@ai-maestro-plugins":true}}',
        dataDirExists: () => false,
      }),
    ).toBe(false)
  })
  it('no settings reference but the data dir still present ⇒ installed (transient-miss guard)', () => {
    expect(janitorUninstalled({ settingsText: () => null, dataDirExists: () => true })).toBe(false)
    expect(janitorUninstalled({ settingsText: () => '{}', dataDirExists: () => true })).toBe(false)
  })
  it('no reference AND data dir gone ⇒ uninstalled', () => {
    expect(janitorUninstalled({ settingsText: () => '{}', dataDirExists: () => false })).toBe(true)
    expect(janitorUninstalled({ settingsText: () => null, dataDirExists: () => false })).toBe(true)
  })
})

describe('runRulesCleanup — the beat', () => {
  const installed = { settingsText: () => 'ai-maestro-janitor', dataDirExists: () => true }
  const uninstalled = { settingsText: () => '{}', dataDirExists: () => false }

  it('NOTHING is removed (or even enumerated) while the janitor is installed', () => {
    const dir = tmpRules()
    const marked = seed(dir, 'janitor-rule.md', PROVENANCE_MARKER)
    const enumerate = vi.fn(janitorRuleFilesIn)
    const r = runRulesCleanup({ ...installed, rulesDir: dir, enumerate, armed: true, log: () => {} })
    expect(r).toEqual({ uninstalled: false, wouldRemove: [], removed: [] })
    expect(enumerate).not.toHaveBeenCalled() // steady state is two cheap checks, no dir walk
    expect(fs.existsSync(marked)).toBe(true)
  })

  it('UNARMED + uninstalled = detect-only: reports what it WOULD remove, deletes nothing', () => {
    const dir = tmpRules()
    const marked = seed(dir, 'janitor-rule.md', PROVENANCE_MARKER)
    const logs: string[] = []
    const r = runRulesCleanup({ ...uninstalled, rulesDir: dir, armed: false, log: (m) => logs.push(m) })
    expect(r.uninstalled).toBe(true)
    expect(r.wouldRemove).toEqual([marked])
    expect(r.removed).toEqual([])
    expect(fs.existsSync(marked)).toBe(true) // the file SURVIVES a detect-only beat
    expect(logs.some((l) => /would remove 1 .*\[detect-only: AIM_RULES_CLEANUP not set\]/.test(l))).toBe(true)
  })

  it('ARMED + uninstalled: removes the marked orphans, leaves user rules, logs the removal', () => {
    const dir = tmpRules()
    const marked = seed(dir, 'janitor-rule.md', PROVENANCE_MARKER)
    const userRule = seed(dir, 'my-own.md', 'no marker')
    const logs: string[] = []
    const r = runRulesCleanup({ ...uninstalled, rulesDir: dir, armed: true, log: (m) => logs.push(m) })
    expect(r.removed).toEqual([marked])
    expect(fs.existsSync(marked)).toBe(false)
    expect(fs.existsSync(userRule)).toBe(true)
    expect(logs.some((l) => /removed 1 orphaned rule/.test(l))).toBe(true)
  })

  it('stamps on ATTEMPT — every beat, including the installed-and-nothing-to-do one', () => {
    const stamp = vi.fn()
    runRulesCleanup({ ...installed, stamp, log: () => {} })
    runRulesCleanup({ ...uninstalled, rulesDir: tmpRules(), stamp, armed: true, log: () => {} })
    expect(stamp).toHaveBeenCalledTimes(2)
  })
})

describe('startRulesCleanupScheduler — claim ONLY when armed (CONDITIONAL_CHORES shape)', () => {
  const prevEnv = { ...process.env }
  afterEach(() => {
    process.env.AIM_RULES_CLEANUP = prevEnv.AIM_RULES_CLEANUP
    if (prevEnv.AIM_RULES_CLEANUP === undefined) delete process.env.AIM_RULES_CLEANUP
  })

  it('unarmed: scheduler runs but NEVER claims rules-cleanup (the janitor keeps the chore)', () => {
    delete process.env.AIM_RULES_CLEANUP
    const stop = startRulesCleanupScheduler({
      intervalMs: 3_600_000,
      runBeat: () => ({ uninstalled: false, wouldRemove: [], removed: [] }),
    })
    try {
      expect(activeAbsorbedChores()).not.toContain('rules-cleanup')
    } finally {
      stop?.()
    }
  })

  it('armed: claims rules-cleanup while live, releases it on stop', () => {
    process.env.AIM_RULES_CLEANUP = '1'
    const stop = startRulesCleanupScheduler({
      intervalMs: 3_600_000,
      runBeat: () => ({ uninstalled: false, wouldRemove: [], removed: [] }),
    })
    expect(activeAbsorbedChores()).toContain('rules-cleanup') // positive control for the row above
    stop?.()
    expect(activeAbsorbedChores()).not.toContain('rules-cleanup')
  })
})
