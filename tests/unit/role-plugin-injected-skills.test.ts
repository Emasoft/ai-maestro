/**
 * TRDD-9X2STNL2 — the two AI Maestro compatibility skills that `injectAiMaestroSkills`
 * writes into EVERY generated role-plugin must stay SYNCHRONOUS.
 *
 * The claim. Claude Code 2.1.218 made `context: fork` skills run in the BACKGROUND by
 * default: a backgrounded skill returns only an agent handle, and its result arrives later
 * as a task notification. `aim-governance-rules` and `aim-agent-operations` exist purely to
 * load reference text INTO the turn that asked for it, so backgrounding them means the
 * asking agent gets no governance rules and no error either. `background: false` is the
 * changelog's own opt-out and restores what the committed frontmatter meant before 2.1.218.
 *
 * Why this file exists at all. Before it, `services/role-plugin-service.ts` shipped those
 * two frontmatters as multi-kilobyte TEMPLATE LITERALS with ZERO tests — measured 2026-08-04,
 * nothing in tests/ referenced either constant or either skill name. A template that is
 * auto-injected into every generated role-plugin and pinned by nothing can drift back on the
 * next edit with no signal, which is exactly the failure the fix was repairing.
 *
 * The frontmatter is PARSED, not grepped. A whole-file `toContain('background: false')`
 * would pass if the string merely appeared in the skill's prose — and the same repo has real
 * `background:` lines in CSS, so a loose needle here is not hypothetical.
 *
 * No mocks: the function is mkdir + writeFile against a caller-supplied dir, so a real
 * tmpdir IS the honest altitude.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { injectAiMaestroSkills } from '@/services/role-plugin-service'

/** The skills the injector is documented to write, and the order it returns them in. */
const INJECTED_SKILLS = ['aim-governance-rules', 'aim-agent-operations'] as const

let pluginDir: string

beforeEach(() => {
  pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-role-plugin-'))
})

afterEach(() => {
  fs.rmSync(pluginDir, { recursive: true, force: true })
})

/**
 * The YAML frontmatter block only — everything between the opening `---` and the next `---`.
 * Returns null when the file has no frontmatter, so a malformed SKILL.md fails loudly here
 * instead of silently satisfying a body-wide substring match.
 */
function frontmatterOf(file: string): string | null {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  if (lines[0]?.trim() !== '---') return null
  const end = lines.indexOf('---', 1)
  if (end === -1) return null
  return lines.slice(1, end).join('\n')
}

function skillPath(name: string): string {
  return path.join(pluginDir, 'skills', name, 'SKILL.md')
}

describe('injectAiMaestroSkills — the injected compatibility skills', () => {
  it('writes both SKILL.md files and returns their names', async () => {
    // Positive control for every assertion below: they are only meaningful if the
    // injector actually produced these two files at these two paths.
    const returned = await injectAiMaestroSkills(pluginDir)

    expect(returned).toEqual([...INJECTED_SKILLS])
    for (const name of INJECTED_SKILLS) {
      expect(fs.existsSync(skillPath(name)), `${name}/SKILL.md was not written`).toBe(true)
    }
  })

  it.each(INJECTED_SKILLS)(
    '%s pins `background: false` IN ITS FRONTMATTER — 2.1.218 backgrounds forked skills by default',
    async (name) => {
      await injectAiMaestroSkills(pluginDir)

      const fm = frontmatterOf(skillPath(name))
      expect(fm, `${name}/SKILL.md has no parseable frontmatter`).not.toBeNull()

      // Both halves of the claim, because either one alone is the wrong config:
      // without `context: fork` the multi-kilobyte reference lands in the agent's main
      // context; without `background: false` the fork returns a handle instead of the text.
      expect(fm).toMatch(/^context:\s*fork$/m)
      expect(fm).toMatch(/^background:\s*false$/m)
    },
  )

  it('keeps both skills model-facing rather than user-invocable', async () => {
    // Guards the neighbouring line the `background:` insertion sits against: these skills
    // are loaded by an agent, never typed by a human, so a stray `user-invocable: true`
    // would put two internal reference dumps in the user's slash-command list.
    await injectAiMaestroSkills(pluginDir)

    for (const name of INJECTED_SKILLS) {
      expect(frontmatterOf(skillPath(name))).toMatch(/^user-invocable:\s*false$/m)
    }
  })
})
