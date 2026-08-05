/**
 * The fleet GitHub-config audit — the sixth absorbed janitor chore (TRDD-14HI8ZPR).
 *
 * WHAT THIS SUITE EXISTS FOR. The chore's value is entirely in two properties that are invisible to
 * a happy-path test:
 *
 *   1. The POPULATION comes from the marketplace catalog, never from `lib/ecosystem-constants.ts`.
 *      Measured on this machine those two sets differ in BOTH directions (10 overlap; 4 the janitor
 *      audits that our constants cannot name; 5 we hold that it never audits). An audit driven off
 *      our constants would cover 10 of 14 and — because it also STAMPS — would tell the janitor to
 *      stop covering the other 4, which would then be audited by nobody.
 *
 *   2. The classifier is SILENT on anything it could not prove. Every probe is tri-state, and a
 *      `null` must never become a finding. An audit that invents findings when the network is flaky
 *      trains its reader to ignore it, which is worse than not running.
 *
 * NEUTER RUNS — ACTUALLY RUN 2026-08-05 via scripts/dev/neuter, results as observed:
 *   · `if (facts.admin !== true) return []` → `if (false) return []`
 *     → 1 red: "stays silent when the viewer is not admin, or admin is indeterminate".
 *   · `runGithubConfigAudit` stamping before the population check
 *     → 1 red: "writes NO stamp when the population could not be resolved".
 *
 * AND ONE FINDING ABOUT THE TEST, caught by predicting a neuter before running it: the admin
 * assertion originally used `cleanFacts` — a fully-compliant repo — so it read `[]` whether the
 * guard existed or not, and the mutation above would have reddened NOTHING. It now feeds facts
 * that DO produce findings, with a positive control asserting they do, so the guard is the only
 * thing that can silence them.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  classifyRepo,
  fleetRepoSlugs,
  auditFleet,
  runGithubConfigAudit,
  FINDING_BLURB,
  type RepoFacts,
} from '@/lib/github-config-audit'
import { choreStampPath } from '@/lib/janitor-chore-stamp'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-gca-'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function catalog(plugins: unknown): string {
  const p = path.join(tmpRoot, 'marketplace.json')
  fs.writeFileSync(p, JSON.stringify({ plugins }), 'utf8')
  return p
}

/** A repo with active branch protection that satisfies everything — the baseline to perturb. */
function cleanFacts(overrides: Partial<RepoFacts> = {}): RepoFacts {
  return {
    slug: 'Emasoft/x',
    admin: true,
    defaultBranch: 'main',
    rulesets: [
      {
        target: 'branch',
        enforcement: 'active',
        rules: [{ type: 'pull_request' }, { type: 'required_status_checks' }],
      },
      { target: 'tag', enforcement: 'active', rules: [] },
    ],
    classicProtected: false,
    hasWorkflows: true,
    ...overrides,
  }
}

describe('fleetRepoSlugs — the population', () => {
  it('derives the population from the catalog file, parsing each plugin source.url', () => {
    const p = catalog([
      { source: { url: 'https://github.com/Emasoft/ai-maestro-janitor' } },
      { source: { url: 'https://github.com/Emasoft/ai-maestro-webdesign.git' } },
      { source: { url: 'git@github.com:Emasoft/ai-maestro-plugin.git' } },
    ])
    expect(fleetRepoSlugs(p)).toEqual([
      'Emasoft/ai-maestro-janitor',
      'Emasoft/ai-maestro-plugin',
      'Emasoft/ai-maestro-webdesign',
    ])
  })

  it('includes repos our own constants cannot name — the reason it reads the catalog at all', () => {
    // None of these four appear anywhere in lib/ecosystem-constants.ts, and all four are in the
    // real catalog. This is the exact 4-repo gap that a constants-driven audit would silently
    // leave unaudited while stamping the chore as covered.
    const p = catalog(
      [
        'ai-maestro-janitor',
        'ai-maestro-visual-communicator-plugin',
        'ai-maestro-web-scenario-tester',
        'ai-maestro-webdesign',
      ].map(n => ({ source: { url: `https://github.com/Emasoft/${n}` } })),
    )
    expect(fleetRepoSlugs(p)).toHaveLength(4)
    expect(fleetRepoSlugs(p)).toContain('Emasoft/ai-maestro-web-scenario-tester')
  })

  it('dedupes and sorts, so the population is stable across catalog reorderings', () => {
    const p = catalog([
      { source: { url: 'https://github.com/Emasoft/b' } },
      { source: { url: 'https://github.com/Emasoft/a' } },
      { source: { url: 'https://github.com/Emasoft/b.git' } },
    ])
    expect(fleetRepoSlugs(p)).toEqual(['Emasoft/a', 'Emasoft/b'])
  })

  it('returns [] for an unreadable, non-JSON, or wrong-shaped catalog', () => {
    expect(fleetRepoSlugs(path.join(tmpRoot, 'nope.json'))).toEqual([])

    const bad = path.join(tmpRoot, 'bad.json')
    fs.writeFileSync(bad, '{ not json', 'utf8')
    expect(fleetRepoSlugs(bad)).toEqual([])

    fs.writeFileSync(bad, JSON.stringify({ plugins: 'not-an-array' }), 'utf8')
    expect(fleetRepoSlugs(bad)).toEqual([])

    // Entries without a usable source.url are skipped rather than crashing the sweep.
    expect(fleetRepoSlugs(catalog([{ source: {} }, { nope: 1 }, null]))).toEqual([])
  })
})

describe('classifyRepo — the silence rules', () => {
  it('stays silent when the rulesets probe failed — a null is never a finding', () => {
    // The whole trustworthiness of the audit rests here: "I could not read the rulesets" must not
    // become "this repo has no protection".
    expect(classifyRepo(cleanFacts({ rulesets: null }))).toEqual([])
  })

  it('stays silent when the viewer is not admin, or admin is indeterminate', () => {
    // The facts must be ones that WOULD produce findings, or this test is vacuous: with a
    // fully-compliant repo the result is [] whether the admin guard exists or not, so removing
    // the guard would redden nothing. (Caught by predicting the neuter before running it.)
    const wouldFlag = { rulesets: [], classicProtected: false, hasWorkflows: false }
    expect(classifyRepo(cleanFacts({ ...wouldFlag, admin: true })).length).toBeGreaterThan(0)

    expect(classifyRepo(cleanFacts({ ...wouldFlag, admin: false }))).toEqual([])
    expect(classifyRepo(cleanFacts({ ...wouldFlag, admin: null }))).toEqual([])
  })

  it('does NOT claim UNPROTECTED when classic protection is merely indeterminate', () => {
    // No rulesets AND a definitive 404 means unprotected. No rulesets and "could not tell" does
    // not — that is the difference between a fact and a guess.
    const indeterminate = classifyRepo(cleanFacts({ rulesets: [], classicProtected: null }))
    expect(indeterminate.map(f => f.code)).not.toContain('UNPROTECTED')

    const definitive = classifyRepo(cleanFacts({ rulesets: [], classicProtected: false }))
    expect(definitive.map(f => f.code)).toContain('UNPROTECTED')
  })

  it('does NOT claim NO_CI when the workflows probe was indeterminate', () => {
    expect(classifyRepo(cleanFacts({ hasWorkflows: null })).map(f => f.code)).not.toContain('NO_CI')
    expect(classifyRepo(cleanFacts({ hasWorkflows: false })).map(f => f.code)).toContain('NO_CI')
  })

  it('finds nothing on a fully-compliant repo — the positive control', () => {
    // Without this, every assertion above is satisfied by a classifier that returns [] always.
    expect(classifyRepo(cleanFacts())).toEqual([])
  })
})

describe('classifyRepo — the findings', () => {
  it('flags LINEAR_HISTORY independently of everything else', () => {
    const facts = cleanFacts({
      rulesets: [
        {
          target: 'branch',
          enforcement: 'active',
          rules: [
            { type: 'pull_request' },
            { type: 'required_status_checks' },
            { type: 'required_linear_history' },
          ],
        },
        { target: 'tag', enforcement: 'active', rules: [] },
      ],
    })
    expect(classifyRepo(facts).map(f => f.code)).toEqual(['LINEAR_HISTORY'])
  })

  it('treats protection as ADDITIVE across rulesets', () => {
    // Two rulesets each contributing one rule protect jointly. Reasoning per-ruleset instead of
    // over the union would report NO_PR_REVIEW on a repo that plainly requires a PR.
    const facts = cleanFacts({
      rulesets: [
        { target: 'branch', enforcement: 'active', rules: [{ type: 'pull_request' }] },
        { target: 'branch', enforcement: 'active', rules: [{ type: 'required_status_checks' }] },
        { target: 'tag', enforcement: 'active', rules: [] },
      ],
    })
    expect(classifyRepo(facts)).toEqual([])
  })

  it('ignores rulesets that are not active', () => {
    const facts = cleanFacts({
      rulesets: [
        { target: 'branch', enforcement: 'evaluate', rules: [{ type: 'pull_request' }] },
        { target: 'tag', enforcement: 'active', rules: [] },
      ],
      classicProtected: false,
    })
    expect(classifyRepo(facts).map(f => f.code)).toContain('UNPROTECTED')
  })

  it('does not infer review/checks gaps on a CLASSIC-only protected repo', () => {
    // Its required_pull_request_reviews live in the classic protection body, which this audit does
    // not read — so claiming the gap would false-flag a compliant repo, and the janitor's fix skill
    // would then mutate it.
    const facts = cleanFacts({ rulesets: [], classicProtected: true })
    const codes = classifyRepo(facts).map(f => f.code)
    expect(codes).not.toContain('NO_PR_REVIEW')
    expect(codes).not.toContain('NO_REQUIRED_CHECKS')
    expect(codes).toContain('NO_TAG_PROTECT')
  })

  it('carries the shared blurb text, so both implementations word a finding identically', () => {
    const f = classifyRepo(cleanFacts({ rulesets: [], classicProtected: false }))
    expect(f[0].detail).toBe(FINDING_BLURB.UNPROTECTED)
  })
})

describe('runGithubConfigAudit — the stamp', () => {
  it('writes NO stamp when the population could not be resolved', async () => {
    const stamp = choreStampPath('github-config-audit')
    fs.rmSync(stamp, { force: true })

    const r = await runGithubConfigAudit({ slugs: [] })

    expect(r.ran).toBe(false)
    expect(r.reason).toMatch(/population unresolved/)
    // "I could not read the population" must never be recorded as "this chore is on cadence" —
    // the janitor reads a stamp as permission to stop covering the chore itself.
    expect(fs.existsSync(stamp)).toBe(false)
  })

  it('audits every slug it was given and counts them', async () => {
    const seen: string[] = []
    const audit = await auditFleet({
      slugs: ['Emasoft/a', 'Emasoft/b'],
      gather: async slug => {
        seen.push(slug)
        return cleanFacts({ slug, rulesets: [], classicProtected: false })
      },
      now: () => 1_700_000_000_000,
    })
    expect(seen).toEqual(['Emasoft/a', 'Emasoft/b'])
    expect(audit?.repos_scanned).toBe(2)
    expect(audit?.generated_at).toBe(1_700_000_000)
    expect(audit?.findings.map(f => f.slug)).toEqual(['Emasoft/a', 'Emasoft/b'])
  })

  it('returns null rather than an empty audit when there is no population', async () => {
    // An empty FleetAudit would serialize as "0 repos scanned, 0 findings" — indistinguishable
    // from a clean fleet.
    expect(await auditFleet({ slugs: [] })).toBeNull()
  })
})
