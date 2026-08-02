/**
 * A GOVERNANCE ROLE MUST NEVER BE WRITTEN AS AN @-HANDLE.
 *
 * ── WHAT HAPPENED (2026-08-02) ──────────────────────────────────────────────────────────────────
 * A GitHub user with no connection to this project wrote, on ai-maestro-plugin#33:
 *
 *   "I believe what you do is great but I get endless amount of notifications.
 *    Could you please stop mentioning the username?"
 *
 * The account is `manager` — a real person since 2018. Our agents wrote `@manager` meaning the
 * governance ROLE; GitHub read it as a mention of HIM, for weeks.
 *
 * It is not one unlucky name. FIVE of our six titles are real accounts (verified against the GitHub
 * API the same day): manager (2018, 9 repos), maintainer (2009, 13 repos), architect (2017, 66
 * repos), orchestrator (2014), integrator (2023). Short role-shaped nouns are exactly the usernames
 * claimed a decade ago, so our governance vocabulary and GitHub's username namespace collide BY
 * CONSTRUCTION. `reviewer-a` 404s today; that is luck, and someone can register it tomorrow.
 *
 * ── WHY A TEST AND NOT A NOTE IN A STYLE GUIDE ──────────────────────────────────────────────────
 * This defect class has NO LOCAL SYMPTOM. Nothing observable from inside the project indicates it is
 * happening: the harm lands on a stranger's notification feed, outside every system we can inspect.
 * No test failed, no log recorded it, no reviewer saw it. The only detector was a courteous person
 * who chose to ask instead of muting — and a mute would have left us shipping it at everyone else
 * with a role-shaped username, permanently and invisibly.
 *
 * So the guard cannot be "remember not to". It has to fail a build.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(__dirname, '../..')

/**
 * The eight governance titles, plus the abbreviations agents actually type. `cos` is included
 * because "@cos" is the natural shorthand and a two-to-four-letter handle is even more likely to be
 * taken than a word.
 */
const ROLES = [
  // governance titles
  'manager', 'chief-of-staff', 'cos', 'architect', 'orchestrator',
  'integrator', 'member', 'maintainer', 'autonomous', 'reviewer',
  // COMPONENT names — added 2026-08-02 after the USER caught the gap this list originally had.
  // `@janitor` paged Raman Barkholenka (account since 2011) and my first version did NOT catch it,
  // because "janitor" is not a governance title and the list was built from the title enum. That is
  // the wrong generating idea: GitHub does not care what OUR taxonomy calls a word, only whether
  // someone registered it. Checked the same day — 7 of 8 component-shaped names we use every day
  // are REAL accounts: janitor, plugin, agent, maestro, bot, owner, assistant (only `admin` is free).
  'janitor', 'plugin', 'agent', 'maestro', 'bot', 'owner', 'assistant', 'dev-browser', 'memgrep',
]

/** `@role` at a word boundary, case-insensitively — `@Manager` pages the same person as `@manager`. */
const AT_ROLE = new RegExp(`@(${ROLES.join('|')})\\b`, 'i')

/**
 * Files an agent could plausibly copy into published content: the DEP rules seeded into every agent
 * workdir, the governance docs they are told to read, and the CLI wrappers they run. Sourced from
 * git rather than a glob so the set is exactly what we SHIP — an untracked scratch file is not
 * something anyone publishes, and including it would produce noise that gets the test disabled.
 */
function trackedTextFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'rules', 'docs', 'scripts', '.claude'], {
    cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024,
  })
  return out.split('\n').filter(f => /\.(md|sh|ts|mjs|cjs|py|json)$/.test(f))
}

describe('no @role mentions in anything we ship', () => {
  it('fires on a known-bad string — the positive control', () => {
    // Without this, a broken ROLES list or a mis-built regex makes every assertion below pass
    // vacuously, and the suite would certify a corpus it never really matched. That exact failure
    // (a filter reading as correct and matching nothing) is what ai-maestro-janitor#167 documents
    // three times over, and what this file's own subject is a fourth instance of.
    expect(AT_ROLE.test('please ask @manager to review')).toBe(true)
    expect(AT_ROLE.test('@Maintainer - could you weigh in?')).toBe(true)
    expect(AT_ROLE.test('@cos will route it')).toBe(true)
    expect(AT_ROLE.test('ask @janitor to sweep')).toBe(true)   // the one the USER caught
    // …and does NOT fire on the legitimate forms, or the rule is unusable and gets deleted.
    expect(AT_ROLE.test('the MANAGER approves it')).toBe(false)
    expect(AT_ROLE.test('`governanceTitle: manager`')).toBe(false)
    expect(AT_ROLE.test('posted via the shared @Emasoft gh auth')).toBe(false)
    // Backticked mentions are SAFE (GitHub renders no mention inside a code span) and the scan
    // strips them before testing — asserted at the scan level below, not here.
  })

  it('no tracked file writes a governance role as an @-handle', () => {
    const files = trackedTextFiles()

    // Positive control on the SCAN, not just the regex: a `git ls-files` that returns nothing (wrong
    // cwd, renamed dir) would otherwise read as a clean corpus.
    expect(files.length).toBeGreaterThan(50)

    const hits: string[] = []
    for (const f of files) {
      let text: string
      try {
        text = readFileSync(resolve(ROOT, f), 'utf-8')
      } catch {
        continue // deleted between ls-files and read; nothing to judge
      }
      text.split('\n').forEach((line, i) => {
        // Strip inline code spans FIRST. The USER's rule is precise — "never use the `@<name>`
        // syntax OUTSIDE of a code block" — because GitHub does not render a mention inside
        // backticks, so `@owner` in prose ABOUT the convention is correct writing, not a defect.
        // Without this the guard flags every doc that documents the rule, which is the fastest
        // way to get a guard deleted.
        const bare = line.replace(/`[^`]*`/g, '')
        if (AT_ROLE.test(bare)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }

    expect(
      hits,
      `A governance role is written as an @-handle. On GitHub that pages a REAL PERSON who has\n` +
        `nothing to do with this project — five of our six titles are taken accounts, and one of\n` +
        `them asked us to stop on 2026-08-02. Write the role as MANAGER / MAINTAINER (caps, no\n` +
        `sigil). An "@" in published text must be a deliberate act of addressing a person:\n  ${hits.join('\n  ')}`,
    ).toEqual([])
  })
})
