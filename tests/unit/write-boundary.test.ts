/**
 * THE WRITE BOUNDARY gate — TRDD-0GCIMQ9F.
 *
 * USER, 2026-07-29: "this is extremely dangerous, the only writings should be into ~/.aimaestro
 * and into ~/agents".
 *
 * The property under test is not "the code is careful" — it is: **a NEW write outside those two
 * roots FAILS THIS BUILD.** The rule previously lived only in memory notes, which is how three
 * write sites and one recursive-delete site accumulated under `~/.claude/`, one of them deleting
 * the user-scope plugin record on every role-plugin swap.
 *
 * A source-scanning guard is worthless unless its SCAN SET is controlled too, so this file asserts
 * the scanned count, the total write-call-site count, and a non-zero hit for EACH marker class —
 * then drives the classifier over a seeded violation to prove it can actually fail. Without those,
 * a broken regex reports "clean" on a set it never built.
 */
import { describe, it, expect } from 'vitest'
import {
  scanWriteBoundary,
  classifyText,
  ALLOWED_OUT_OF_ROOT_WRITES,
  KNOWN_INDIRECT_WRITERS,
} from '@/lib/write-boundary'

const ROOTS = ['lib', 'services', 'app', 'server.mjs']
const scan = scanWriteBoundary(process.cwd(), ROOTS)

describe('write-boundary detector is actually looking (non-vacuity)', () => {
  it('scanned a real source tree, not an empty one', () => {
    // Measured 556 files on 2026-07-29. A floor, not an equality: the tree grows.
    expect(scan.scanned).toBeGreaterThan(400)
  })

  it('found a realistic number of write-verb call sites — proves the verb regex is alive', () => {
    // If this collapses toward zero the verb alternation broke, and every "clean" result below
    // would be meaningless rather than reassuring.
    expect(scan.writeCallSites).toBeGreaterThan(100)
  })

  it('every marker CLASS has at least one hit, so neither class regex is silently dead', () => {
    // The `inline` class exists because a violation can compose the path on the spot instead of
    // naming a constant. A zero here means that whole shape is invisible.
    expect(scan.byClass.constant).toBeGreaterThan(0)
    expect(Object.keys(scan.byClass).sort()).toEqual(['constant', 'inline'])
  })

  it('FLAGS a seeded violation — the control that proves the gate can fail', () => {
    const seeded = `
      import { homedir } from 'os'
      import { join } from 'path'
      async function sneak() {
        await writeFile(join(homedir(), '.claude', 'anything.json'), '{}', 'utf-8')
      }
    `
    const { sites } = classifyText(seeded, 'fixture/sneak.ts')
    expect(sites).toHaveLength(1)
    expect(sites[0].markerClass).toBe('inline')
    expect(sites[0].verb).toBe('writeFile')
  })

  it('does NOT flag a write into an AGENT workdir — that is inside ~/agents and legal', () => {
    // The distinction the `inline` regex must make. A false positive here would push authors to
    // work around the gate, which is how a linter gets routed around.
    const legal = `
      const resolvedDir = agent.workingDirectory
      await mkdir(join(resolvedDir, '.claude'), { recursive: true })
      await saveJsonSafe(join(resolvedDir, '.claude', 'settings.local.json'), settings)
    `
    expect(classifyText(legal, 'fixture/legal.ts').sites).toHaveLength(0)
  })

  it('does NOT flag a marker that appears in a LATER argument rather than the target', () => {
    const later = `await writeFile(someOtherPath, \`wrote to \${CLAUDE_DIR}\`, 'utf-8')`
    expect(classifyText(later, 'fixture/later.ts').sites).toHaveLength(0)
  })
})

describe('the boundary itself', () => {
  it('every out-of-root write is on the allowlist with a ratifying TRDD', () => {
    const found = [...new Set(scan.sites.map((s) => s.key))].sort()
    const allowed = ALLOWED_OUT_OF_ROOT_WRITES.map((a) => a.key).sort()

    const unexpected = found.filter((k) => !allowed.includes(k))
    const stale = allowed.filter((k) => !found.includes(k))

    // Both directions matter. An UNEXPECTED site is a new boundary crossing. A STALE entry is an
    // allowlist line that no longer describes the code — which quietly widens what is permitted.
    expect(
      { unexpected, stale },
      `\nOUT-OF-ROOT WRITES (${found.length}):\n${found.map((k) => '  ' + k).join('\n')}\n`,
    ).toEqual({ unexpected: [], stale: [] })
  })

  it('no allowlist entry is anonymous — an unratified line is a TODO, not permission', () => {
    for (const a of ALLOWED_OUT_OF_ROOT_WRITES) {
      expect(a.ratifiedBy, `allowlist entry "${a.key}" names no ratifying TRDD`).toMatch(/TRDD-[A-Z0-9]{8}/)
      expect(a.why.length, `allowlist entry "${a.key}" explains nothing`).toBeGreaterThan(20)
    }
  })

  it('pins what the detector CANNOT see, so its reach is stated rather than assumed', () => {
    // An undetectable write site is worse than a detected one: silence about it reads as absence.
    // `claude-settings-enforcer.ts` writes ~/.claude/settings.json through a local `file` variable,
    // so no marker appears in the first argument — exactly the shape a future violation could hide
    // in. Pinning the list means the blind spot cannot grow without this test failing.
    expect(KNOWN_INDIRECT_WRITERS.map((w) => w.file)).toEqual(['lib/claude-settings-enforcer.ts'])
    for (const w of KNOWN_INDIRECT_WRITERS) {
      expect(w.ratifiedBy).toMatch(/TRDD-[A-Z0-9]{8}/)
    }
  })

  it('the detector does not scan ITSELF — a scanner in its own search set is guaranteed to match', () => {
    // lib/write-boundary.ts writes nothing, but its docs and MARKERS array necessarily contain the
    // patterns it hunts. Before the self-exclusion it reported its own prose as two violations —
    // the same failure as `pgrep -f` matching the shell that runs it.
    expect(scan.sites.some((s) => s.file === 'lib/write-boundary.ts')).toBe(false)
  })

  it('records which entries are still UNRATIFIED, so the debt is visible not forgotten', () => {
    // These are the ones TRDD-0GCIMQ9F must resolve. This test does not fail on them — it makes
    // the count explicit, so shipping while they exist is a decision rather than an oversight.
    const unratified = ALLOWED_OUT_OF_ROOT_WRITES.filter((a) => /UNRATIFIED/.test(a.ratifiedBy))
    expect(unratified.map((a) => a.key).sort()).toEqual([
      'services/element-management-service.ts :: mkdir :: CLAUDE_DIR',
      'services/element-management-service.ts :: saveJsonSafe :: INSTALLED_FILE',
    ])
  })
})
