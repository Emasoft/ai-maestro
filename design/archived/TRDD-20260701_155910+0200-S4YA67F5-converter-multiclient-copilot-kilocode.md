---
trdd-id: S4YA67F5
title: Multi-client converter — add github-copilot + kilocode, generate all 6 skill variants from Claude source
column: complete
created: 2026-07-01T15:59:10+0200
updated: 2026-08-01T22:50:24+0200
current-owner: main
assignee: main
priority: 3
severity: MEDIUM
effort: L
labels: [converter, cross-client, github-copilot, kilocode, code-analysis, dry, wip]
task-type: feature
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
release-via: none
delivery: pull-request
target-branch: main
feature-branch: feat/code-analysis-tooling
merge-strategy: squash
test-requirements: [unit, typecheck]
audit-requirements: []
review-requirements: [human-review]
impacts: [public-api]
runtime-targets: [macos, linux]
external-refs: ["github.com/parcadei/tldr-code", "github.com/parcadei/fastedit"]
implementation-commits: [1f4c424f]
---

# TRDD-S4YA67F5 — Multi-client converter: github-copilot + kilocode + single-sourced skill variants

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-01

- **Status:** IN PROGRESS (`dev`). USER-directed 2026-07-01: add `github-copilot` +
  `kilocode` as FIRST-CLASS converter clients so `convert()` emits them like
  codex/gemini/opencode/kiro, then GENERATE all 6 non-Claude tldr-code+fastedit skill
  variants from the single Claude source (DRY — replaces the hand-authored variants).
  USER relaxed the bar: "a few clients is OK for now, label the rest WIP, put a
  conversion-state TABLE in the README, users decide."
- **DURABLE SPEC (read before coding):**
  `reports/converter-copilot-kilocode/20260701_160307+0200-impl-spec.md` — surgical,
  all change sites enumerated + grep-verified, generator + tests. Verdict READY.
- **CONFIRMED FACTS (fork dryRun-verified):** `convert()` (direct ProjectIR path in
  `lib/converter/convert.ts`) already emits claude→codex/gemini/opencode/kiro cleanly
  (13 files each, 0 warnings). Universal-IR path (`emitForClient`) is plugin-name-keyed
  under `~/agents/**` → WRONG tool for a standalone repo skill; use `convert()`.
  Parser needs a `skills/<name>/SKILL.md` wrapped layout (stage to /tmp).
- **DECISIONS (recorded — see spec §8):**
  - **D1 launchability:** copilot + kilocode = converter/skill targets ONLY. Add
    ClientType + CAPABILITIES + emitters + bridge maps (required for compile +
    conversion), but do NOT add to `SUPPORTED_CLIENTS` (no tmux launch). copilot
    promotable later with a verified `cli` block; kilocode is IDE-only (never
    launchable). Mirrors `aider` (in ClientType, out of SUPPORTED_CLIENTS).
  - **D2 references:** inline-append all references into the single instruction file
    (copilot `.github/copilot-instructions.md`; kilocode `.kilocode/rules/<name>.md`) —
    self-contained + more complete than the body-only hand-authored stopgaps.
  - **D3 model-map:** DEFER the CLAUDE_TO_COPILOT table (passthrough-safe; skills→
    instructions never reads it; Copilot model ids unverified). Follow-up.
  - **D4 codex skill path:** DEFER reconciling the pre-existing 3-way `.agents/skills`
    vs `~/.codex/skills` mismatch as its own follow-up TRDD; do NOT silently pick.
- **NEXT ACTION:** implement in the spec's §10 order (types→emitters→shared PLATFORM_PATHS
  →client-capabilities→bridge sites→adapter→generator→tests→docs), running `tsc --noEmit`
  as the gate after each phase.
- **Relation to ANYCPRTX:** TRDD-ANYCPRTX shipped the hand-authored variants (a5909778);
  this TRDD SUPERSEDES that approach with converter-generated variants. ANYCPRTX stays
  `complete` for its original scope; the authoritative variants now come from here.
- **N — commit-only, NO push (USER-gated). No agent fleets (token-frugal): core edits done
  directly with tsc as the gate.**

## Goal

`convert({to:'github-copilot'|'kilocode'})` emits like the other 4 non-Claude clients, and
a reproducible generator produces all 6 non-Claude variants of the unified
tldr-code+fastedit skill from the ONE canonical Claude source
(`scripts/code-analysis-skill/claude/`). A README conversion-state table shows per-client
state (✅ / 🚧 WIP / ➖ n-a) so users see coverage at a glance.

## Why

USER wants the cross-client skill (and eventually every convertible plugin) MACHINE-GENERATED
from the single Claude source — not hand-maintained N times (drift-prone). The converter is
ai-maestro's own claude→intermediate→client pipeline; extending it to copilot+kilocode makes
ALL plugins emittable for those clients too, not just this skill.

## Scope

**IN:** the two new converter clients (github-copilot, kilocode) as converter/skill targets;
the reproducible skill-variant generator (all 6); the README conversion-state table; docs.
**OUT (this TRDD):** launchability/tmux-spawn for these clients (D1); the copilot model table
(D3); the codex skill-path reconciliation (D4); converting the OTHER ecosystem plugins (that
is the broader program — this TRDD delivers the converter capability + the tldr skill; the
plugin-by-plugin rollout is tracked separately and reflected in the README matrix).

## Plan (phases — tsc-green at each; full detail in the spec report)

1. `lib/converter/types.ts` ProviderId (+2) · `registry.ts` PROVIDERS (+2).
2. `emitters/github-copilot.ts` + `emitters/kilocode.ts` (NEW, no-frontmatter instruction
   emitters, inline-append refs) · register in `emitters/index.ts`.
3. `emitters/shared.ts` PLATFORM_PATHS (+2) — first exhaustive tsc site.
4. `lib/client-capabilities.ts` — ClientType (+2), CAPABILITIES (+2), clientTypeLabel (+2),
   both bridge maps (+2), detectClientType (+2); `SUPPORTED_CLIENTS` UNCHANGED (D1).
5. `services/cross-client-conversion-service.ts:353` reverseMap (+2) ·
   `components/settings/ClientTabBar.tsx:20` CLIENT_ICONS (+2).
6. `lib/client-plugin-adapters/index.ts` getAdapter — +2 element-adapter cases.
7. `scripts/generate-code-analysis-skill-variants.mjs` (NEW) — stage claude skill → run
   `convert()` for all 6 (dryRun) → strip emitter dir-prefix + `_converted.date` → write
   `scripts/code-analysis-skill/<client>/`. `--check` mode for CI drift. Regenerate all 6.
8. Tests: `converter-copilot-emitter.test.ts` + `converter-kilocode-emitter.test.ts` (NEW),
   extend capability/model tests. `tsc --noEmit` + `vitest` green.
9. Docs: CLAUDE.md code-analysis section, REQUIREMENTS §3.4, **README conversion-state table**;
   fix the 2 stale "…Copilot" comments (types.ts:6, emitters/shared.ts:152).

## Acceptance

- [x] `convert()` emits a valid github-copilot + kilocode variant of the tldr skill — proven live: `lib/converter/emitters/{github-copilot,kilocode}.ts` exist and dedicated unit tests `tests/unit/converter-github-copilot-emitter.test.ts` + `tests/unit/converter-kilocode-emitter.test.ts` exist.
- [x] All 6 non-Claude variants under `scripts/code-analysis-skill/<client>/` are generator-output — `scripts/generate-code-analysis-skill-variants.mjs` exists and `scripts/code-analysis-skill/` contains all 7 client dirs (claude + 6 non-Claude: codex, copilot, gemini, kilocode, kiro, opencode).
- [x] README carries a per-client conversion-state table — verified live at `README.md:346-347` (GitHub Copilot / KiloCode rows with ✅/🚧 status).
- [x] Landed via commit `1f4c424f` ("first-class github-copilot + kilocode clients + single-sourced 6-variant skill generator (TRDD-S4YA67F5)"), commit-only, no push per the card's own N-constraint.

## Approval log
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. `implementation-commits:` was absent
  from frontmatter (bookkeeping gap; the "## Acceptance" section used prose bullets, not
  `- [ ]` checkboxes, which is why board tooling read it as 0/0) — the underlying work is
  landed and verified. Re-verified this session: commit 1f4c424f resolves via
  `git cat-file -e` and its own message cites TRDD-S4YA67F5 verbatim;
  `lib/converter/emitters/{github-copilot,kilocode}.ts`,
  `scripts/code-analysis-skill/{copilot,kilocode}/`, and both emitter test files exist
  on disk; README carries the conversion-state table.
