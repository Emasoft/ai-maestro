---
trdd-id: SX5FPMG0
title: Branch-protection baseline shape is derived from the APPLIER's ambient context, not from the repo
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T03:57:52+0200
updated: 2026-08-21T04:02:10+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: infra
min-approval-requirement: manager
mandate: false
mandated-by: none
approved: false
derived: false
npt: []
eht: []
blocked-by: []
labels: [fleet-blocker, branch-protection, baseline, measured]
external-refs: [ai-maestro-janitor#282, ai-maestro-janitor#14, ai-maestro-janitor:TRDD-R4XC8MV1, ai-maestro-janitor:TRDD-Q8ZT5NW3]
relevant-rules: [22]
---

# Branch-protection baseline shape is derived from the APPLIER's ambient context, not the repo

**Classified `manager` per the §D3 objective floor** (`.github/` rulesets · baseline-ruleset
deviation), self-set per §D2 and audited later by §D4. It is a FINDING plus a proposed fix, not an
apply — nothing here has been applied.

## The defect in one sentence

A **persistent, security-relevant resource** — the GitHub branch-protection ruleset on 9 public
repos — has its shape decided by **who ran the applier and from which directory**, so two honest
callers write two different rulesets to the same repo and each one's post-condition reports
success.

## Measured, live API, 2026-08-21

`baseline-pr-and-checks` across the 9 fleet repos:

| repo | rules | updated_at | writer |
|---|---|---|---|
| ai-maestro | `pull_request, required_status_checks` | 2026-08-20T01:50:58 | hub |
| claude-plugins-validation | `pull_request, required_status_checks` | 2026-08-20T01:51:01 | hub |
| AgentlensPro | `pull_request, required_status_checks` | 2026-08-20T01:50:51 | hub |
| ai-maestro-plugins | `pull_request` | 2026-08-20T01:50:57 | hub |
| claude-plugin | `pull_request` | 2026-08-20T01:50:59 | hub |
| agent-identity | `pull_request` | 2026-08-20T01:50:53 | hub |
| ai-maestro-janitor | `required_status_checks` | 2026-08-20T08:21:55 | janitor applier |
| ai-maestro-plugin | `required_status_checks` | 2026-08-20T08:38:22 | janitor applier |
| ai-maestro-maintainer-agent | `required_status_checks` | 2026-08-19T20:28:31 | janitor applier |

The split is **not** by repo. It is by **which process last wrote**.

## Root cause — BOTH halves of the payload read the ambient context

Diagnosed by the janitor session and verified first-hand here against its source.

**1. `pull_request` ← the calling process's ENVIRONMENT.**
`branch_protection_lib.require_pull_request_for(slug)` is TRUE in two situations, and situation 1
is (docstring verbatim) *"**Inside the ai-maestro harness.** Governance there is that every repo is
managed by the MAINTAINER agent … the PR is the hand-off that governance is built on"*. That is
resolved by `harness_backend.backend()` → `is_harness_session()` → `state.in_ai_maestro_agent_env()`
(`scripts/lib/state.py:860`), which reads `AIMAESTRO_AGENT` / `THIS_IS_AIMAESTRO` /
`AMP_AGENT_ID` / `AID_AUTH` **from the calling process**. It consults nothing about the repo.

So the hub's applier (running inside a harness agent) evaluates TRUE and writes `pull_request`;
the janitor's (standalone session/daemon) evaluates FALSE and removes it. **Neither is buggy on
its own terms.** That is worse than a disagreement between two payloads, because making the
payloads agree cannot fix it — the same applier flip-flops against itself depending on where it is
invoked from.

**2. `required_status_checks` ← the calling process's CWD.**
`detect_required_status_checks(project_root)` reads `.github/workflows` from a LOCAL CHECKOUT; with
no checkout it returns empty and the rule is omitted entirely (GitHub 422s an empty list). The
cwd-dependence is documented and carved out in the janitor's DD0M4QL7 acceptance.

**The proof that this is context and not repo drift** is `ai-maestro-plugins`: a local checkout
DOES exist (`Code/AI-MAESTRO-PLUGINS-MARKETPLACE/ai-maestro-plugins`) and DOES carry a workflow
file, yet its ruleset has no `required_status_checks` — so detection ran from somewhere that was
not that tree. `claude-plugin` and `agent-identity` have no local checkout at all, which is the
same mechanism with a simpler cause.

## Why it matters

- **The fleet's protection state is nondeterministic.** Whichever process wrote last decides,
  and the next run of the other one reverses it. An oscillation nobody observes, because both
  writers' post-conditions are true of what they sent.
- **It defeats verification by construction.** A conformance check that re-derives the expected
  payload IN THE CHECKER'S OWN CONTEXT will agree with whichever writer shares that context and
  flag the other — so the checker's verdict also depends on where it runs.
- **It is invisible to every gate we have.** No test can see it: each applier is internally
  consistent, and the divergence only exists ACROSS processes.

## Proposed fix (shape only — not applied, and the predicate is another repo's)

1. **A fleet-wide apply MUST PIN its evaluation context** rather than inherit it from whatever
   process happens to run it. This is the janitor session's recommendation and it is the load-
   bearing half.
2. **Derive `pull_request` from a REPO-SCOPED fact**, not a caller-scoped one. "Is this repo
   worked by harness agents?" is a property of the repo; "am I currently running inside a harness
   agent?" is a property of the moment. The intent behind situation 1 is right; the proxy is not.
3. **`required_status_checks` needs the same treatment** — read the workflows from the repo
   (API), or refuse to write the ruleset at all when no checkout is available, rather than
   silently omitting a security rule.
4. Until 1-3 land, **the hub does not run fleet-wide baseline applies**. The 2026-08-20 01:50 run
   is what put the divergent shape on six repos.

## Ownership

- The predicate (`require_pull_request_for`, `detect_required_status_checks`) is the **janitor's**
  code. That session has offered to file the caller-context issue on its own repo — accepted; this
  card does not duplicate it and this repo does not patch another repo's source.
- The **hub's** half is items 1 and 4: our fleet apply inherited its context and wrote a
  harness-evaluated shape onto six repos. That is this card's own defect to answer for.

## Not claimed

- **Which shape is CORRECT for each of the nine.** That is the predicate's verdict to give once it
  is repo-scoped, and it is exactly what nobody can answer today.
- **That any repo is currently unprotected.** All nine carry the admin-bypass history-protect
  ruleset; the divergence is in the PR/checks ruleset. Impact is on non-admin actors (CI,
  contributors), not on the owner.
- **That an oscillation has been OBSERVED.** It has not — the hub has not re-applied since
  2026-08-20 01:50. The oscillation is a mechanism proven by reading the code and the timestamps,
  not an event measured twice.

## Acceptance

- [x] The janitor's caller-context card exists and is linked here (their repo, their filing) —
      **`ai-maestro-janitor:TRDD-R4XC8MV1`** (high, `design/tasks/`, `todo`, commit `837c1306`).
      Its acceptance deliberately requires *"the predicate returns the same verdict for a given
      repo regardless of the calling process's env"* and *"a test pins BOTH caller shapes against
      one slug and asserts agreement"* — because a fix that merely makes today's two callers agree
      leaves the NEXT caller free to flip it again. That is the right shape and it is stricter
      than what this card asked for.
      Sibling filed the same commit: **`ai-maestro-janitor:TRDD-Q8ZT5NW3`** — the audit line's
      `verb = "updated"` on an ISSUED (not CHANGED) PUT. One constraint recorded there that this
      card endorses: the fix must NOT silence the no-op line. `updated` vs **`unchanged`**, never
      `updated` vs nothing — deleting the line would re-create the silent-no-op ambiguity that
      DD0M4QL7 added the trace to end.
- [ ] A fleet-wide apply pins its evaluation context, with the pinned value recorded in the run log
- [ ] `pull_request` is derived from a repo-scoped fact; the derivation is stated in the SSOT
- [ ] `required_status_checks` either reads the repo via API or REFUSES rather than silently omitting
- [ ] Re-measure all 9 repos from a pinned context; every one matches its declared shape
- [ ] The 2026-08-20 divergence is resolved on all six hub-written repos, or explicitly ratified

## Approval log

- 2026-08-21T03:57:52+0200 — FILED as a proposal at `min-approval-requirement: manager` (§D3
  floor: baseline-ruleset deviation). Discovery only; nothing applied. Authored by the hub, which
  is also the party responsible for the 01:50 apply that produced the divergence.
