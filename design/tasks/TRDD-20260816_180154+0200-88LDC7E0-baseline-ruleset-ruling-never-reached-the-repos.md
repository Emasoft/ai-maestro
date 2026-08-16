---
trdd-id: 88LDC7E0
title: The 2026-08-13 baseline-ruleset ruling is in the code and on ZERO repos — 8 of 9 still lock the owner out of history
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T18:01:54+0200
updated: 2026-08-16T18:05:00+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: manager
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
effort: small
labels: [governance, baseline-rulesets, cross-repo, goal-1-audit, fleet]
external-refs: [janitor#14]
---

# A USER Tier-3 ruling that landed in code and reached no repository

## Problem

The USER's Tier-3 ruling of **2026-08-13** — *"both `baseline-history-protect` and
`baseline-pr-and-checks` must be changed to allow mutations in history and direct
pushing/merging by the owner"* — is implemented in the executable SSOT and is live on
**almost nothing**. Measured first-hand 2026-08-16 against the GitHub API.

`design/specs/baseline-github-rulesets-spec.md:29-36` names the SSOT and its precedence:
the janitor's `branch_protection_lib.baseline_ruleset_payloads`, *"code beats this prose on
any disagreement"*. So the code was read, not the prose.

### What the code emits (v3.3.0 through v3.3.11, every cached version since)

`~/.claude/plugins/cache/.../ai-maestro-janitor/3.3.9/scripts/lib/branch_protection_lib.py`

| line | ruleset | emits |
|---|---|---|
| 226-232 | `baseline-history-protect` | `bypass_actors: [{RepositoryRole, actor_id: 5, always}]` |
| 259-265 | `baseline-pr-and-checks` | `bypass_actors: [{RepositoryRole, actor_id: 5, always}]` |
| 303 | `baseline-pr-and-checks` | `required_approving_review_count: 0` |

The comment at 213-225 quotes the ruling verbatim and explains it: `[]` on a solo-owner
repo *"is not protection, it is a lock with no key"*. `_ADMIN_REPOSITORY_ROLE_ID` occurs
**2×** in v3.2.0 and **3×** in v3.3.0 and every version after — so the history-protect half
landed in **3.3.0** and has shipped in eleven consecutive releases.

### What is live (all 9 fleet repos, `gh api repos/Emasoft/<r>/rulesets`)

```
baseline-history-protect        bypass_actors
  ai-maestro                    0   []          ← ruling NOT applied
  ai-maestro-janitor            0   []
  ai-maestro-plugin             0   []
  ai-maestro-autonomous-agent   0   []
  claude-plugins-validation     0   []
  agent-identity                0   []
  claude-plugin                 0   []
  ai-maestro-plugins            0   []
  AgentlensPro                  1   [RepositoryRole:5:always]   ← the only one

baseline-pr-and-checks          bypass          approvals
  all 9 repos                   [RepositoryRole:5]      1       ← code says 0
```

**Two independent drifts, and they are not the same drift.** AgentlensPro carries the
history-protect bypass and *still* carries `approvals: 1`, so it is not evidence that the
current payload was ever applied anywhere — the two rulesets moved independently, by some
path that is not "the current applier ran". **Nothing measured carries the full current
payload.**

The mechanism, per the autonomous session's independent verification: **the two rulesets are
separate API objects written by separate apply calls**, so a repo's baseline state is a PAIR of
independent versions, never one. A repo can be half-migrated in either direction, and any
"which repos are current?" query that reads one object answers about that object only.

## The live consequences, in severity order

1. **8 repos lock the OWNER out of history operations.** `deletion` + `non_fast_forward`
   with `bypass_actors: []` means no amend, no rebase of a stale branch, no force-push to
   undo a bad commit — for the one person entitled to do it. This is precisely the state
   the 2026-08-13 ruling abolished, still live three days later.
   **This half is first because it is the QUIET one** (integrator session's argument, and a
   better ordering rationale than mine): an unmergeable PR is LOUD and someone notices within
   minutes, whereas an owner who cannot amend or rebase their own default branch reads as
   *"git is being difficult"* and gets worked around — and the workaround is usually worse than
   the lockout. So a re-measure that asserts only on the approval count that prompted the
   ticket would certify the dangerous half unchecked.
2. **9 repos require an approval GitHub makes unsatisfiable.** `required_approving_review_count: 1`
   on a repo whose author is its only reviewer: GitHub forbids self-approval, so the PR path
   is closed. The admin bypass *is* live on `pr-and-checks` (9/9), so the OWNER can push
   around it — but **agents are not admin**, so an agent-opened PR is unmergeable, on every
   fleet repo. This is the predicted cause of branches accumulating unmerged.
   **Scope it precisely (autonomous session's amendment): this is PR-PATH-ONLY.** *"Agents
   cannot merge PRs"* is true; *"agents cannot ship"* is not — repos that publish via their own
   `scripts/publish.py` with an admin direct push are unaffected, and that path is guarded
   separately (a `.githooks/pre-push` ancestry check, not the ruleset). Two sessions have since
   confirmed they are NOT blocked because their work never took the PR path. Overstating this
   half would send someone hunting a blocker they do not have.
3. **The IND base rule contradicts the ruling in every session on this machine.**
   `~/.claude/rules/manager-approval-defaults.md:114-115` still states
   *"`bypass_actors: []` (nobody, incl. admin)"*. That file loads into every agent's context,
   so the whole fleet reads the pre-ruling baseline as current — and an agent applying "the
   ratified baseline as-is" (a Tier-0 EXEMPT operation) from that text would *re-impose* the
   lock. The ai-maestro DEP overlay (`rules/aimaestro/aimaestro-manager-approval-defaults.md:123-126`)
   is correct; the two disagree.
4. **The SSOT file's own module docstring contradicts its own code, twice.** Lines 24-25
   claim `bypass_actors: []` *"(nobody bypasses history protection)"* and line 33 claims
   *"1 approval"* — 200 lines above the code that emits the opposite. This is the exact
   defect class the fleet audit has been finding all day: correct code under stale prose,
   where the prose is what a reader consults.

## Why this was invisible

Every instrument reported clean. A closed ruling is not an applied ruling; the code carries
no record of whether it ever ran; and the three prose copies (IND base, DEP overlay, module
docstring) disagree with each other in a way no test compares. The only instrument that could
see it is a **live read of the deployed surface**, which nothing was doing.

## Ownership — this is NOT ours to fix

The applier, the payload code, and the IND rule file all live in **`Emasoft/ai-maestro-janitor`**.
Per `~/.claude/rules/how-to-fix-issues-of-other-projects.md` the hub does not edit that tree.
The ai-maestro side of this card is: record the finding, notify the janitor session with the
evidence, and re-verify the live surface after they act.

**Do not hand-apply rulesets from here.** Re-applying the ratified baseline is Tier-0 EXEMPT
and the janitor owns the idempotent applier that does it correctly; hand-rolled `gh api` writes
across 8 public repos' branch protection is how a filter that silently selects everything
weakens a repo it never meant to touch (recorded in `lessons-verification.md` — the
`jq 'select(…)'`-exits-0-on-empty incident weakened three public repos exactly this way).

## Verification

- Re-run the two live sweeps above; `bypass_actors` = 1 admin actor on history-protect for
  all 9, and `required_approving_review_count` = 0 on pr-and-checks for all 9.
- `~/.claude/rules/manager-approval-defaults.md` and the janitor lib's module docstring both
  agree with `baseline_ruleset_payloads` — checked by reading the code, not the prose.
- **Complementary half, mandatory:** a non-admin actor (an agent) is still refused `deletion`
  and `non_fast_forward`. A bypass granted to everyone is not the ruling, it is the removal
  of the baseline.

## Acceptance

- [ ] The finding is reported to the janitor session/repo with the measured evidence (code
      lines, the 9-repo live table, the two stale prose sites).
- [ ] `baseline-history-protect` carries the admin bypass on all 9 fleet repos, verified by a
      live `gh api` read — not by a commit, an issue state, or an applier's own success line.
- [ ] `baseline-pr-and-checks` carries `required_approving_review_count: 0` on all 9, same
      standard of proof.
- [ ] A non-admin actor is confirmed still bound by `deletion` + `non_fast_forward`.
- [ ] `~/.claude/rules/manager-approval-defaults.md` no longer states `bypass_actors: []`
      (janitor-owned edit).
- [ ] The `branch_protection_lib` module docstring agrees with its own payload builder on both
      `bypass_actors` and the approval count (janitor-owned edit).
- [ ] Re-measured AFTER the janitor acts, by me, from the live API.

## Approval log

- 2026-08-16T18:01:54+0200 — Filed at `min-approval-requirement: manager`: it concerns the
  ratified GitHub-ruleset baseline across 9 repos, which the objective floor (§D3) puts at
  MANAGER regardless of who executes. **Discovery only — nothing applied.** Found while
  answering the autonomous session's inverted ruleset query; every claim here was measured
  first-hand from the code and the live API, after the module's own docstring was read and
  found to be the stale half.
- 2026-08-16T18:05:00+0200 — INDEPENDENTLY VERIFIED by the autonomous session against its own
  repo (`Emasoft/ai-maestro-autonomous-agent`) and against janitor **3.3.11** (a newer version
  than the 3.3.9 I read — same line numbers, same payload, so the drift is not a version
  artifact). It confirmed both halves and both stale docstring sites, and contributed the two
  amendments folded in above. It applied nothing, on the stated ground that a fleet-wide
  reapply from a leaf-repo session would race the janitor's applier.
- 2026-08-16T18:05:00+0200 — The integrator session confirmed it is NOT blocked (0 open PRs;
  its work did not take the PR path), which is the measurement that bounds consequence 2 rather
  than a claim that contradicts it, and contributed the quiet-vs-loud ordering argument.
  **Three sessions have now been told not to hand-apply and all three declined independently** —
  recorded because a fix everyone agrees is obvious, applied by four parties at once to nine
  public repos, is the failure mode this card is one step away from.
