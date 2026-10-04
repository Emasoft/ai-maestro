/**
 * TRDD-NB70FKKT — the exec-from-agent-writable-tree inventory and the O0RHX7K6 ship gate.
 *
 * Three layers, mirroring the sandbox-channel-inventory suite's conventions:
 *
 *  1. INVENTORY LAYER — the census exists, every entry is classified (class 1-5, per the
 *     card's Remedies table), and the sandboxed column is the typed literal `false`
 *     everywhere: no process runs confined today, so that is measured, and flipping it is
 *     a code change a test sees.
 *  2. SHIP GATE — box 4 of the card, executable: while the sandbox profile is unwired the
 *     gate passes vacuously (nothing is claimed yet); the moment the profile is wired, any
 *     entry still `open` blocks shipping. Both branches driven synthetically — the gate is
 *     a pure function and its failure text names the blocking entries.
 *  3. WIRING MARKER LAYER — lib/agent-runtime.ts (the sole spawn chokepoint) is read and
 *     fed through sandboxProfileWiredIn: while it carries no sandbox-profile marker the
 *     gate must be PASSING (the unshipped state), so flipping the wiring reddens this file
 *     rather than letting the boundary ship silently with holes.
 *
 * Neuters (recorded, not run here): removing the "open" entries from the inventory reddens
 * only the open-set test; removing the marker list reddens the wiring test; making
 * execSiteShipGate return null unconditionally reddens both gate branch tests.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  EXEC_SITE_INVENTORY,
  SANDBOX_WIRING_MARKERS,
  execSiteShipGate,
  sandboxProfileWiredIn,
} from '@/lib/agent-exec-site-inventory'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SPAWN_CHOKEPOINT = path.join(REPO_ROOT, 'lib', 'agent-runtime.ts')

describe('EXEC_SITE_INVENTORY — the census (card box 1)', () => {
  it('carries every class the card ranks, including the fleet classes', () => {
    const classes = new Set(EXEC_SITE_INVENTORY.map((e) => e.execClass))
    for (const c of [1, 2, 3, 4, 5] as const) {
      expect(classes.has(c), `class ${c} must have at least one entry`).toBe(true)
    }
  })

  it('the known-open set matches the card as of now — a landing moves an entry to remediated', () => {
    const openIds = EXEC_SITE_INVENTORY.filter((e) => e.status === 'open').map((e) => e.id)
    expect(new Set(openIds)).toEqual(
      new Set([
        'agent-cli-script',
        'jsonl-reader-binary',
        'plugin-builder-build-script',
        'mcp-discovery-script-source',
        'external-handoff-clear',
        'fleet-env-var-cli',
      ]),
    )
  })

  it('every entry names an executing process and a remedy', () => {
    for (const e of EXEC_SITE_INVENTORY) {
      expect(e.executingProcess.length, e.id).toBeGreaterThan(0)
      expect(e.remedy.length, e.id).toBeGreaterThan(0)
    }
  })

  it('the sandboxed column is the literal false everywhere — measured today, re-answered when the profile wires', () => {
    for (const e of EXEC_SITE_INVENTORY) {
      expect(e.sandboxed, e.id).toBe(false)
    }
  })

  it('the two remediated in-repo fixes are present and point at their landed change', () => {
    const byId = new Map(EXEC_SITE_INVENTORY.map((e) => [e.id, e]))
    expect(byId.get('mcp-discovery-pluginroot')?.status).toBe('remediated')
    expect(byId.get('mcp-discovery-pluginroot')?.remedy).toContain('realResolved')
    expect(byId.get('keychain-probe-script')?.status).toBe('remediated')
    expect(byId.get('keychain-probe-script')?.remedy).toContain('digest')
  })

  it('ids are unique', () => {
    const ids = EXEC_SITE_INVENTORY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('execSiteShipGate — card box 4 (O0RHX7K6 must not ship as a claimed boundary)', () => {
  it('passes while the profile is unwired — nothing is claimed yet', () => {
    expect(execSiteShipGate(false)).toBeNull()
  })

  it('blocks when the profile is wired while open entries remain, naming them', () => {
    const refusal = execSiteShipGate(true)
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('exec-site gate')
    expect(refusal).toContain('fleet-env-var-cli')
    expect(refusal).toContain('agent-cli-script')
    // remediated and accepted-hole entries must NOT be named as blockers
    expect(refusal).not.toContain('mcp-discovery-pluginroot')
    expect(refusal).not.toContain('dispatcher-stub')
    expect(refusal).not.toContain('fleet-generic-path-lookup')
  })

  it('passes when wired and every entry is terminal (synthetic empty-inventory branch)', () => {
    const original = [...EXEC_SITE_INVENTORY]
    EXEC_SITE_INVENTORY.length = 0
    try {
      expect(execSiteShipGate(true)).toBeNull()
    } finally {
      EXEC_SITE_INVENTORY.push(...original)
    }
  })
})

describe('sandboxProfileWiredIn — the wiring marker (lib/agent-runtime.ts is the sole chokepoint)', () => {
  it('the spawn chokepoint is UNWIRED today, so the real gate passes', () => {
    const source = readFileSync(SPAWN_CHOKEPOINT, 'utf8')
    const wired = sandboxProfileWiredIn(source)
    // TRDD-O0RHX7K6 ships the profile DELIBERATELY unwired; if this flips, every
    // inventory entry must be re-answered and the gate below starts enforcing.
    expect(wired).toBe(false)
    expect(execSiteShipGate(wired)).toBeNull()
  })

  it('detects each wiring marker in a synthetic wired source', () => {
    for (const marker of SANDBOX_WIRING_MARKERS) {
      expect(sandboxProfileWiredIn(`spawn: ${marker} applied`)).toBe(true)
    }
    expect(sandboxProfileWiredIn('no profile here')).toBe(false)
  })

  it('a wired chokepoint with today inventory produces the gate refusal', () => {
    expect(execSiteShipGate(true)).toMatch(/\[exec-site gate\]/)
  })
})
