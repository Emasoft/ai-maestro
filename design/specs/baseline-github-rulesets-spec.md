---
spec: baseline-github-rulesets
spec-version: 1.0.1
status: normative
created: 2026-08-15T00:39:45+0200
updated: 2026-08-30T00:24:53+0200
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
  against the owner's deliberate act. `deletion` still binds every non-admin actor (CI,
  agents, outside contributors).
- rules: `deletion`.
- **`non_fast_forward` is REMOVED — never re-add it** (USER Tier-3 ruling 2026-08-27,
  janitor `TRDD-7EXBJB03`, applied fleet-wide 2026-08-28): *"history rewrite is allowed
  and must be allowed in all rulesets of all github repos. the janitor must ensure of
  that."* `non_fast_forward` IS GitHub's "Block force pushes" rule — the one rule whose
  entire function is to forbid a history rewrite — so keeping it under that directive is
  not a defensible reading. **The 2026-08-13 admin bypass does NOT satisfy the directive
  either: a bypass is a key to a lock, and the ruling says the lock must not be there.**
  Verified in the code SSOT: `branch_protection_lib.py:335-337` carries
  `DELIBERATELY NO non_fast_forward` with the ruling quoted.
- **`required_linear_history` is REMOVED — never re-add it** (USER Tier-3 ruling
  2026-08-08, janitor#14): it forbids merge commits, forcing endless rebase churn on a
  many-agent repo; a workflow opinion, not protection.
- Both removals are the same move for the same stated reason: **the guardian must not be
  the thing blocking the work.** `deletion` is kept because losing a branch is not a
  history rewrite — it is the loss of the ref you would rewrite FROM.

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
- bypass_actors: `[{actor_id: 5, actor_type: RepositoryRole, bypass_mode: always}]` — the
  OWNER (admin role) bypasses tags too. **Changed from `[]` by the same USER Tier-3 ruling
  2026-08-27**, and this was the ruling's REAL gap: with nobody able to repoint or drop a
  tag, every release tag was stranded on a commit that no longer existed after a
  *permitted* history rewrite. **A rewrite you cannot follow through on is a rewrite you
  are not allowed to make.** `deletion` + `update` still bind every non-admin actor.
- **Why this ruleset was treated DIFFERENTLY from `baseline-history-protect` under one
  sentence — do NOT "fix" this into consistency.** On branches the offending rule was
  REMOVED; on tags `update` was KEPT and a bypass added instead. Removing the rule is
  right where the rule IS the prohibition (`non_fast_forward` has no job left under the
  directive); a bypass is right where the rule protects against someone ELSE — tag
  `update` still stops CI, an agent, or a contributor silently repointing a published
  release tag, and only caught the owner in the blast radius.
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
