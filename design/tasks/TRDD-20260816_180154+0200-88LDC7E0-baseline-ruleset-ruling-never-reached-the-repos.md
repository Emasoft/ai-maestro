---
trdd-id: 88LDC7E0
title: The 2026-08-13 baseline-ruleset ruling is in the code and on ZERO repos — 8 of 9 still lock the owner out of history
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T18:01:54+0200
updated: 2026-08-20T01:53:22+0200
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
external-refs: [janitor#14, janitor#282]
review-after: 2026-08-27
---

# A USER Tier-3 ruling that landed in code and reached no repository
## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20 01:53

- **RULING APPLIED LIVE, all 9 repos, 2026-08-20 01:50 (hub, Phase-2 delegation; applying the
  ratified baseline as-is is EXEMPT).** 17 per-object PUTs from the SSOT's two ruled fields:
  history-protect bypass [] → admin(5) on the 8 stale repos; pr-and-checks approvals 1 → 0 on
  all 9. Per-object before/after verification: ONLY the two ruled fields (plus the derived
  `current_user_can_bypass` echo) moved; every rules array unchanged; all 8 tag-protect
  objects byte-identical (never touched — ratified bypass is NOBODY); non-admin still bound
  by deletion+non_fast_forward with enforcement active everywhere (9/9 asserted). Snapshots:
  reports/baseline-rulesets/20260820_015037+0200-before-full.json + the -after-full sibling
  (rollback data).
- **Upstream gate-6 defect FILED: janitor#282** (asks: payload-compare in baselines_present +
  a name-present/content-stale test; verified name-only at BOTH installed 3.3.16 and repo
  HEAD before filing). Noted for them: ai-maestro-plugins lacks tag-protect, so it is the one
  repo their applier will still run end-to-end on — a natural live verification target once
  the gate is fixed.
- **The stale machine-global IND rule CORRECTED** (~/.claude/rules/manager-approval-defaults.md
  §F): both 2026-08-13 fields now stated correctly with the ruling quoted and a stale-reference
  provenance note — an agent applying "the baseline as-is" from that text can no longer
  re-impose the lock.
- **Remaining OPEN (janitor-side):** gate-6 fix + test land in their repo (#282); their
  release then re-verifies convergence on a future payload change. Our half is complete.


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

## THE MECHANISM — found by the janitor session, verified here first-hand

This is **not** "the applier never re-ran". It is a code defect that makes the baseline
**unmaintainable after first creation**, and it explains all nine repos with one cause.

`scripts/guard/branch_protection_apply.py` L152-163:

```python
present = bpl.baselines_present(slug)
if present is None: ... return 0
if present:
    ledger = state.state_dir() / _LEDGER_FILE
    if not ledger.is_file(): _ledger_append(slug, default_branch, "already-present")
    return 0          # ← silent, before Gate 7 and before apply_baseline_rulesets
```

and `branch_protection_lib.baselines_present` L460-466:

```python
names = {r.get("name") for r in rulesets if isinstance(r, dict)}
return (HISTORY_RULESET_NAME in names and PR_CHECKS_RULESET_NAME in names
        and TAG_PROTECT_RULESET_NAME in names)
```

**It compares NAMES ONLY, never payload content.** `apply_baseline_rulesets` is written
correctly and *does* `_post_or_patch_ruleset(..., by_name.get(name))` — it PATCHes drift
properly, and the comment above it at L173-174 says so. **That PATCH path is UNREACHABLE on
any repo that already carries the three names.** The janitor proved it rather than inferred
it: all four upstream gates evaluate True on its repo, it ran the applier directly, output
was EMPTY, and the live API was byte-identical afterwards.

**Consequence far larger than this ruling:** no baseline change of any kind — this one, or any
future one — can ever reach any repo that already has the three rulesets. Every ruleset is
frozen at whatever payload created it. The 2026-08-13 ruling is simply the first change big
enough to make the freeze visible.

**This supersedes my AgentlensPro reasoning and improves it.** I said the two rulesets "drifted
independently"; nothing drifted. Nothing was ever RE-applied anywhere once created, so each
ruleset is pinned to its own creation-time payload — which is exactly why one repo can carry a
new bypass beside an old approval count. The autonomous session's "per-repo state is a PAIR of
independent versions" still holds and is now explained rather than merely observed.

## Ownership of the stale IND rule — measured, not assumed

The janitor session asked me to route `~/.claude/rules/manager-approval-defaults.md`, reporting
its repo does not ship it. Confirmed, and the file is an **ORPHAN shipped by nobody**:

- `find ~/.claude/plugins/cache -name 'manager-approval-defaults.md'` → **0 hits**, against a
  positive control (`janitor-footprint.md`) returning **13**. The search works; nothing ships it.
- Census of all 41 global rules: **9 carry `<!-- ai-maestro-janitor:rule-stamp -->` at mode 600**;
  the other 32 are unstamped at 644/664. This file is unstamped, 644, mtime 2026-08-08.

That is the same three-tell signature already recorded in `lessons-verification.md` for
`trdd-approval-tiers.md` — *"a superseded predecessor that nobody deleted reads exactly like a
peer authority"*. Both are orphans; both are superseded by this repo's DEP overlay. Nothing
updates them **because nothing owns them**, which is why it went stale and why it will go stale
again after any future ruling.

**Not edited, deliberately.** It is a machine-global file in the USER's `~/.claude/rules/`,
governing every project on this host, and it is in no git repo — so a "significant content
change" there is the USER's call, not mine, and RULE 0 forbids me treating an untracked file
outside the project as freely editable. Surfaced for the USER instead.

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

- [x] The finding is reported to the janitor session/repo with the measured evidence (code
      lines, the 9-repo live table, the two stale prose sites).
- [x] `baseline-history-protect` carries the admin bypass on all 9 fleet repos, verified by a
      live `gh api` read — not by a commit, an issue state, or an applier's own success line.
- [x] `baseline-pr-and-checks` matches what **`require_pull_request_for(slug)` decides for that
      repo at apply time** — and where the `pull_request` rule IS emitted, the count is `0`,
      never `1`. **Do NOT hardcode 0.** *(Corrected 2026-08-16: this box originally read
      "carries `required_approving_review_count: 0` on all 9", which prescribes one branch of a
      conditional as if it were the only one. `require_pull_request_for` L111-155 returns TRUE
      only inside the ai-maestro harness backend OR on a repo owned by someone else; all 9 are
      Emasoft-owned, so on a standalone apply the `pull_request` rule should not be emitted AT
      ALL — a fixer reading my original box would have set 0 where the rule should be absent,
      and silently decided a governance question. Caught by the maintainer session correcting
      its own earlier phrasing, which had made the same over-specification from the other side.)*
- [x] A non-admin actor is confirmed still bound by `deletion` + `non_fast_forward`.
- [ ] **The gate-6 short-circuit is fixed** — `baselines_present` compares PAYLOAD, not names,
      or the short-circuit is dropped so the already-correct PATCH path becomes reachable.
      Janitor-owned; deliberately left as a decision, not prescribed here.
- [ ] **A test that FAILS on a name-present/content-stale repo exists** — the case that has
      never been covered, and the reason a names-only check survived. Without it the next
      baseline ruling re-freezes exactly the same way.
- [x] `~/.claude/rules/manager-approval-defaults.md` no longer states `bypass_actors: []`.
      **USER-owned, not janitor-owned** (measured: shipped by no plugin — see above).
- [x] The `branch_protection_lib` module docstring agrees with its own payload builder on both
      `bypass_actors` and the approval count. **Done in the janitor's tree 2026-08-16**, on its
      own initiative, before I asked for it.
- [x] Re-measured AFTER the janitor acts, by me, from the live API — not from a commit, a closed
      issue, or an applier success line. **This defect IS a success line that meant nothing**, so
      that standard of proof is not pedantry here, it is the whole lesson.

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
- 2026-08-16T18:08:00+0200 — **The janitor session found the MECHANISM** (gate-6 names-only
  short-circuit) and proved it by running its own applier to empty output against an unchanged
  live API. I re-read both sites first-hand before rewriting this card: `baselines_present`
  L460-466 and the applier L152-163. It also fixed its module docstring unprompted, and declined
  to fix gate 6 at speed inside a discovery pass — correctly, since the fix needs a decision and
  a test for a case that has never been covered.
  **This upgrades the card from "a ruling did not propagate" to "the baseline cannot be
  maintained at all after first creation".** The maintainer session separately found a FOURTH
  stale prose site in its own memory corpus and repaired it non-destructively, which is what
  prompted the memory-scope sweep recorded below.
