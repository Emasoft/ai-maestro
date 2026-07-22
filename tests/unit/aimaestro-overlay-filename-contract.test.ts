/**
 * The aimaestro-* overlay filenames are a CROSS-REPO CONTRACT (TRDD-TAFH4U0G,
 * ai-maestro#83). The ai-maestro-janitor's IND base rules — shipped globally to
 * ~/.claude/rules/ — cite these DEP overlay files BY NAME in their layering notes
 * (e.g. prrd-design-rules.md says "the overlay `aimaestro-prrd-governance.md`
 * EXPANDS this base"). ai-maestro seeds the overlays into agent workdirs by GLOB
 * (`lib/agent-rules-seed.ts` — readdir + `aimaestro-*.md` filter + sort), so a rename
 * does NOT break seeding: it silently seeds the new name while the janitor's prose
 * pointer dangles. Nothing else in ai-maestro CI would catch that.
 *
 * This test is that guard. A rename/removal here fails CI instead of silently
 * orphaning a janitor pointer — forcing coordination on ai-maestro#83 BEFORE the
 * rename lands. Discovery mirrors the seeder exactly, so the test asserts what is
 * actually shipped, not a hand-list that could drift from the seeder.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'

// Same source dir the seeder uses (DEFAULT_RULES_SOURCE_DIR in agent-rules-seed.ts).
const RULES_SOURCE_DIR = join(process.cwd(), 'rules', 'aimaestro')

// Discover EXACTLY as `ensureAgentRules` does (agent-rules-seed.ts) so this test
// guards the real shipped set, not a parallel hand-maintained one. The seeder scopes
// to the `aimaestro-*` prefix (not bare `.md`) so a colocated non-overlay doc — the
// 3-pillars conformance SPEC that now shares this dir — is neither seeded nor counted
// as an overlay here.
const shippedOverlayFiles = (): string[] =>
  readdirSync(RULES_SOURCE_DIR)
    .filter((f) => f.startsWith('aimaestro-') && f.endsWith('.md'))
    .sort()

// The 4 governance overlays that ARE the janitor cross-repo contract, each paired
// with the IND base file (in the janitor repo) whose layering note names it.
// Renaming any of these silently orphans that IND pointer — coordinate on #83 first.
const CROSS_REPO_CONTRACT: ReadonlyArray<{ overlay: string; citedByJanitorIndBase: string }> = [
  { overlay: 'aimaestro-prrd-governance.md', citedByJanitorIndBase: 'prrd-design-rules.md' },
  { overlay: 'aimaestro-kanban-multiagent.md', citedByJanitorIndBase: 'universal-kanban.md' },
  // trdd-design-tasks.md is the IND base for the TRDD/approval pillar; its overlay is:
  { overlay: 'aimaestro-trdd-approval.md', citedByJanitorIndBase: 'trdd-design-tasks.md' },
  // Harness sibling retired from CORE in ai-maestro-plugin#35; server-owned overlay:
  { overlay: 'aimaestro-manager-approval-defaults.md', citedByJanitorIndBase: 'trdd-design-tasks.md' },
]

// The full frozen set = the 4 governance overlays + the internal operating rule.
// aimaestro-agent-rules.md is NOT a janitor cross-repo contract (its CONTENT is
// guarded by agent-operating-rules.test.ts); it is pinned here only so the SET is
// exact — an accidental add/remove is caught too. Changing this list is a
// deliberate act, not a rebase.
const EXPECTED_OVERLAY_SET: readonly string[] = [
  'aimaestro-agent-rules.md',
  'aimaestro-kanban-multiagent.md',
  'aimaestro-manager-approval-defaults.md',
  'aimaestro-prrd-governance.md',
  'aimaestro-trdd-approval.md',
]

describe('aimaestro-* overlay filename contract (cross-repo, ai-maestro#83)', () => {
  it.each(CROSS_REPO_CONTRACT)(
    'ships $overlay — the janitor IND base $citedByJanitorIndBase cites it by name',
    ({ overlay }) => {
      expect(shippedOverlayFiles()).toContain(overlay)
    },
  )

  it('ships EXACTLY the frozen overlay set (any add/rename/remove is a deliberate contract change)', () => {
    // If this fails after an intentional overlay change: update EXPECTED_OVERLAY_SET,
    // and — if the changed name is in CROSS_REPO_CONTRACT — coordinate the janitor's
    // IND-base pointer update on ai-maestro#83 in the SAME change.
    expect(shippedOverlayFiles()).toEqual([...EXPECTED_OVERLAY_SET].sort())
  })

  it('every contract overlay is also in the frozen set (the two lists cannot drift apart)', () => {
    for (const { overlay } of CROSS_REPO_CONTRACT) {
      expect(EXPECTED_OVERLAY_SET).toContain(overlay)
    }
  })
})

describe('3-pillars conformance SPEC colocation (ai-maestro#85, USER-directed same-dir)', () => {
  // USER directive 2026-07-22: "the specs must be stored along with the governance
  // rules, same dir." The spec is a maintainer conformance CONTRACT, not an overlay —
  // it deliberately carries NO `aimaestro-` prefix so the seeder (scoped to that
  // prefix) does NOT inject it into every agent's per-turn context. This pins both
  // its presence in the dir AND its exclusion from the seeded overlay set.
  it('the 3-pillars SPEC lives in rules/aimaestro/ beside the governance overlays', () => {
    expect(readdirSync(RULES_SOURCE_DIR)).toContain('3-pillars-spec.md')
  })

  it('the SPEC is NOT a seeded overlay (no aimaestro- prefix → excluded from the seeded set)', () => {
    expect(shippedOverlayFiles()).not.toContain('3-pillars-spec.md')
  })
})
