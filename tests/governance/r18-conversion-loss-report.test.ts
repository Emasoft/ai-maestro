/**
 * R18.8 — a feature that cannot be mapped to the target client emits a LOSS
 * REPORT, and the conversion MUST STILL PROCEED.
 *
 * The rule has two clauses and they fail in opposite directions, so both are
 * driven here:
 *
 *   (a) MECHANISM — the unmappable field is NAMED in the loss report. A silent
 *       drop is the failure: the caller ships a plugin missing a feature and
 *       nothing ever says so.
 *   (b) COVERAGE  — the operation proceeds ANYWAY, for EVERY registered
 *       emitter. Aborting is the failure the rule exists to forbid: "a plugin
 *       with reduced features is acceptable — an agent with no plugins is not."
 *
 * Clause (b) is quantified over target clients, so pinning one emitter would
 * launder an instance into a rule — the coverage half drives every emitter the
 * registry knows about, so a new client cannot be added with an abort-on-loss
 * path and stay invisible.
 *
 * Neuter record (2026-07-30), complementary — one per clause:
 *   • delete the `warnLossySkill(skill, warnings)` call in codex.ts::emit
 *     → ONLY "names every unmappable skill field" fails. The proceed tests stay
 *       green, proving they do not lean on the loss report.
 *   • `if (skill.allowedTools) throw new Error('unmappable')` in codex.ts::emit
 *     → the two proceed tests fail (mechanism's file-presence + coverage/codex),
 *       and the loss-report test fails with them, proving clause (b) is what
 *       carries "the files still come back".
 */
import { describe, it, expect } from 'vitest'
import codexEmitter from '@/lib/converter/emitters/codex'
import { getEmitter, getRegisteredEmitters } from '@/lib/converter/emitters'
import type { ProjectIR, SkillIR } from '@/lib/converter/types'

/**
 * A skill carrying three fields Codex has no equivalent for (`allowed-tools`,
 * `metadata`, `paths`) — the exact shape R18.8 governs.
 */
function lossySkill(): SkillIR {
  return {
    name: 'r18-lossy',
    description: 'carries fields the target client cannot represent',
    userInvokable: true,
    args: [],
    license: null,
    compatibility: null,
    metadata: { owner: 'r18-test' },
    allowedTools: 'Read, Grep',
    paths: ['src/**/*.ts'],
    body: 'Body of the lossy skill.',
    references: [],
    auxFiles: [],
    dirName: 'r18-lossy',
    sourcePath: '/fixture/skills/r18-lossy/SKILL.md',
  }
}

/** A skill every client can represent — so `files` is never empty by accident. */
function plainSkill(): SkillIR {
  return {
    ...lossySkill(),
    name: 'r18-plain',
    metadata: null,
    allowedTools: null,
    paths: null,
    dirName: 'r18-plain',
    sourcePath: '/fixture/skills/r18-plain/SKILL.md',
  }
}

function project(): ProjectIR {
  return {
    skills: [lossySkill(), plainSkill()],
    agents: [],
    instructions: [],
    mcp: null,
    commands: [],
    hooks: [],
    sourceProvider: 'claude-code',
    rootDir: '/fixture',
  }
}

/** Every warning the emitter surfaced, flattened across the files it returned. */
function allWarnings(files: Array<{ warnings: string[] }>): string[] {
  return files.flatMap(f => f.warnings)
}

describe('R18.8 — unmappable features emit a loss report and the conversion proceeds', () => {
  it('names every unmappable skill field in the loss report (clause a)', () => {
    const warnings = allWarnings(codexEmitter.emit(project())).join('\n')

    // Each field Codex cannot represent is named, with the skill it belongs to.
    expect(warnings).toContain('allowed-tools')
    expect(warnings).toContain('metadata')
    expect(warnings).toContain('paths')
    expect(warnings).toContain('r18-lossy')

    // The skill that lost nothing is not reported as lossy.
    expect(warnings).not.toContain('r18-plain')
  })

  it('still emits the lossy skill rather than dropping or aborting it (clause b)', () => {
    const files = codexEmitter.emit(project())

    // The operation proceeded: the lossy skill's own file came back.
    expect(files.some(f => f.path.includes('r18-lossy'))).toBe(true)
    // ...and it did not take the mappable skill down with it.
    expect(files.some(f => f.path.includes('r18-plain'))).toBe(true)
  })

  it('proceeds for EVERY registered emitter, not just Codex (clause b, coverage)', async () => {
    const ids = getRegisteredEmitters()
    // Guard against a vacuous pass if the registry ever returns nothing.
    expect(ids.length).toBeGreaterThan(1)

    for (const id of ids) {
      const emitter = await getEmitter(id as Parameters<typeof getEmitter>[0])
      expect(emitter, `no emitter registered for ${id}`).not.toBeNull()

      // An unmappable feature must never abort the conversion for any client.
      const files = emitter!.emit(project())
      expect(files.length, `${id} emitted nothing for a project with an unmappable field`).toBeGreaterThan(0)
    }
  })
})
