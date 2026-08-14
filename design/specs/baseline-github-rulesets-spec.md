---
spec: baseline-github-rulesets
spec-version: 1.0.0
status: normative
created: 2026-08-15T00:39:45+0200
updated: 2026-08-15T00:39:45+0200
maintainer: ai-maestro
project-id: ai-maestro
authority: "DESCRIPTIVE record of the ratified baseline — blob-addressable so 'the ratified baseline' resolves to one file instead of each agent's local prose copy (TRDD-683C7H8E; the ai-maestro#140 propagation incident). The EXECUTABLE source of truth is the janitor's `branch_protection_lib.baseline_ruleset_payloads` (scripts/lib/ in Emasoft/ai-maestro-janitor) — code beats this prose on any disagreement, and payloads sent to GitHub are built from that function, NEVER from this document."
external-refs: [ai-maestro#140, ai-maestro#146]
---

# The ratified GitHub-ruleset baseline (trio)

Every AI Maestro repository carries THREE rulesets, ratified on
[janitor#14](https://github.com/Emasoft/ai-maestro-janitor/issues/14) +
[maintainer#7](https://github.com/Emasoft/ai-maestro-maintainer-agent/issues/7)
(byte-identical across the janitor and maintainer plugins). Applying the trio **as-is is
Tier-0 EXEMPT**; ANY deviation is Tier-2 (MANAGER) per §F of
`rules/aimaestro/aimaestro-manager-approval-defaults.md`.

**Membership is a TRIO, not a pair.** A membership constant short by one member silently
narrows every guard that reads it — and a test asserting the stale membership DEFENDS the
drift (measured: INTEGRATOR's `_ratified_baseline_present` failed OPEN on a
tag-protect-only repo, 2026-08-15, fixed 69b8173).

## 1. `baseline-history-protect` — target: branch, enforcement: active

- conditions: `ref_name.include: ["~DEFAULT_BRANCH"]` (the magic ref, never a literal branch)
- bypass_actors: `[{actor_id: 5, actor_type: RepositoryRole, bypass_mode: always}]` — the
  OWNER (admin role) bypasses. **USER Tier-3 ruling 2026-08-13** ("both
  baseline-history-protect and baseline-pr-and-checks must be changed to allow mutations
  in history and direct pushing/merging by the owner"): the previous `[]` (nobody) was a
  lock with no key on solo-owner repos — the baseline protects against accident, never
  against the owner's deliberate act. `deletion` + `non_fast_forward` still bind every
  non-admin actor (CI, agents, outside contributors).
- rules: `deletion`, `non_fast_forward`.
- **`required_linear_history` is REMOVED — never re-add it** (USER Tier-3 ruling
  2026-08-08, janitor#14): it forbids merge commits, forcing endless rebase churn on a
  many-agent repo; a workflow opinion, not protection. This is the only place this spec
  names that rule, and the guard test pins exactly that.

## 2. `baseline-pr-and-checks` — target: branch, enforcement: active

- conditions: `ref_name.include: ["~DEFAULT_BRANCH"]`
- bypass_actors: admin `always` (as above — publish.py's direct-push path).
- rules — BOTH CONDITIONAL, per the code SSOT:
  - `pull_request` is emitted only where `require_pull_request_for(repo)` holds (an
    aimaestro-harness workdir, or a repo NOT owned by the gh login). On a solo-owned
    standalone repo the rule is DROPPED entirely: the author and reviewer would be the
    same identity, so a PR reviews nothing and only blocks the merge. When emitted:
    `required_approving_review_count: 0` (**USER Tier-3 ruling 2026-08-13** — GitHub
    forbids self-approval, so count 1 was UNSATISFIABLE on every solo-owner repo: "a repo
    sat eternally stuck with dozens of feature branches it can open but never merge"; do
    NOT restore 1 fleet-wide — raise it per-repo if a repo ever has two humans),
    `dismiss_stale_reviews_on_push: true`, `require_code_owner_review: false`,
    `require_last_push_approval: false`, `required_review_thread_resolution: true`.
  - `required_status_checks` (`strict_required_status_checks_policy: true`, auto-detected
    contexts) is OMITTED ENTIRELY when no contexts are detectable — GitHub 422s an empty
    checks array and the 422 takes the whole ruleset write down with it.

## 3. `baseline-tag-protect` — target: tag, enforcement: active

- conditions: `ref_name.include: ["refs/tags/v*.*.*"]` (readback-pinned on first apply)
- bypass_actors: `[]` — nobody. Creating a NEW tag is unrestricted, so publish.py still
  cuts releases; nothing needs a bypass.
- rules: `deletion`, `update` (NOT non_fast_forward — `update` also blocks a fast-forward
  re-point of an existing tag onto a malicious descendant commit; minimal-complete tag
  immutability). Closes the supply-chain gap where a moved release tag re-points
  installers at arbitrary code that itself passes CI. Ratified as the fleet-wide third
  ruleset, USER Tier-3 2026-06-05.

## Governance-fit clause

The baseline must FIT the repo's governance, never impose a workflow on it (janitor
36f05aa): the admin bypass IS the accommodation that keeps a direct-push,
publish.py-gated solo repo working; the conditional `pull_request` rule is its stronger
form. A guard verifying baseline presence checks the TRIO by name against the LIVE API
(the falsified-guard model, INTEGRATOR v1.6.3) — never a prose copy, and never a
two-name set.

## Change protocol

A ruling that changes the baseline is edited into the CODE SSOT first
(`baseline_ruleset_payloads`, with the ruling dated in a comment), then THIS spec is
synced citing the same ruling, then the §F prose. A disagreement between this spec and
the code is resolved by the code and fixed here — recorded, dated, never silently.
