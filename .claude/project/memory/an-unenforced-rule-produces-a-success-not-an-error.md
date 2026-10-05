---
name: an-unenforced-rule-produces-a-success-not-an-error
description: "the scenario passed / the tests are green / the feature works — but is the governance rule actually ENFORCED? how do I test authorization? why didn't the test suite catch that anyone can create an agent?"
ocd: 2026-07-14
lmd: 2026-10-05
metadata:
  node_type: memory
  type: project
  tier: aspect
  topic: teams-and-governance
publish-globally: false
---

^TCEJ9DW2 [desc: "A missing authorization check does not error — it produces a SUCCESS that should never have happened. The feature works is evidence of nothing; verify by reading the guard that refuses.", keywords: why_did_every_test_pass_but_the_rule_is_not_enforced missing_authorization_check_no_error green_test_suite_camouflage how_do_I_verify_a_governance_rule_is_enforced happy_path_proof_of_nothing read_the_guard_that_refuses governance_unenforced_but_tests_green the_feature_works_is_not_evidence, ocd: 2026-07-14, lmd: 2026-09-27]
**A missing authorization check does not produce an error. It produces a SUCCESS that should
never have happened.** This single asymmetry is why ai-maestro's governance could be
comprehensively unenforced while every test, every scenario, and every day of real use looked
fine.

Therefore: **"the feature works" is evidence of NOTHING about authorization.** A green
happy-path test is exactly what a missing guard looks like from the outside. Verify a rule by
**reading the guard that refuses the violation** — never by observing the permitted case
succeed.

^QO2COMKB [desc: "2026-07-14, commit 1ac64125: R30.1 unenforced (any title can POST /api/agents); R28 portfolio token inert (OPERATIONS_REQUIRING_TOKEN = {}); R29.1 auto-creates only the COS; R31 freeze never wired.", keywords: R30.1_unenforced_any_agent_can_create_agents POST_api_agents_no_title_check portfolio_token_inert_empty_operations_requiring_token R29.1_team_born_incomplete_auto_cos_only R31_freeze_never_wired evidence_commit_1ac64125 governance_holes_table 2026_07_14_authorization_audit, ocd: 2026-07-14, lmd: 2026-09-27]
## The evidence (all confirmed 2026-07-14, `1ac64125`)

| Rule (IRON, USER-set) | What the code does |
|---|---|
| **R30.1** — "the COS requires the MANAGER's approval/**mandate** to create agents" | **No enforcement anywhere.** `POST /api/agents` calls `authenticateFromRequest()` and *nothing else* — no `authorize()`, no title check. There is no `create-agent` AuthAction in the RBAC enum, and the route is absent from `security-registry.json`. **Any authenticated agent of any title can create agents.** |
| **R30.1's mandate mechanism** (the R28 portfolio token) | Built, wired into `CreateAgent`, six passing test suites — and **inert**: `OPERATIONS_REQUIRING_TOKEN = {}`, so `matchPortfolioToken` returns `ok:true` unconditionally. |
| **R29.1** — a team auto-creates the COS **+ the 5 basic members** | `createNewTeam` creates the auto-COS **only**. Every team is born incomplete. |
| **R31** — an incomplete team is **FROZEN** | **Zero enforcement.** (The only `frozen` hits are R9.8's no-MANAGER-on-host cascade — a different rule.) |

^L4RB2P9N [desc: "R29.1 and R31 conceal each other: teams are born without their mandated members and the rule that would catch it was never wired — two mutually-masking holes, invisible from the happy path.", keywords: R29.1_and_R31_conceal_each_other mutually_masking_holes team_creation_scenario_passes_while_violating_rules happy_path_suite_constitutionally_blind_to_missing_guard natural_test_reaches_wrong_conclusion holes_invisible_from_permitted_case two_holes_masking, ocd: 2026-07-14, lmd: 2026-09-27]
**R29.1 and R31 conceal each other**, which is the whole lesson in miniature: teams are born
without their mandated members, and the rule that would have caught that was never wired. Two
holes, mutually masking, both invisible from the happy path.

^RHVRUQYO [desc: "Only an adversarial test finds a missing guard — attempt the forbidden act, assert refusal: MEMBER → POST /api/agents must 403; COS without mandate 403; fresh team = 5 members; missing one = FROZEN.", keywords: how_to_write_an_adversarial_authorization_test test_the_refusal_not_the_permission 403_assertions_forbidden_acts negative_case_first_governance_test what_forbidden_calls_should_return_403 team_must_contain_five_members_test frozen_team_test missing_guard_finds_only_adversarial, ocd: 2026-07-14, lmd: 2026-09-27]
## The corollary that kills the obvious fix

A UI scenario *"the USER asks the MANAGER to create a team, then destroy it"* — the natural test
to reach for — **PASSES today.** MANAGER may create a team ✓. The auto-COS is created through
the ungated path ✓ (*because* it is ungated). MANAGER may delete the team ✓. Green, end to end,
while violating R29.1, R30.1 and R31.

**A happy-path suite is constitutionally blind to a missing guard, however many you write.**
Only an **adversarial** test finds one — attempt the forbidden act and assert the *refusal*:

- a MEMBER calls `POST /api/agents` → **must be 403** (today: **201**)
- a COS creates an agent with no MANAGER mandate → **must be 403** (today: **201**)
- a freshly-created team → **must contain the 5 base members** (today: **1**)
- a team missing a base member → **must be FROZEN** (today: fully operational)

Same shape as `[[TRDD-SB5I53K1]]`'s sibling lesson from the approval verifier: *a verifier that
never fails is not a verifier.*

^S7X879S9 [desc: "Where rules are SILENT, code invents policy read as law: lib/authorization.ts hard-denies COS agent deletion though R30 governs only creation. Unenforced looks missing; invented looks DECIDED.", keywords: code_invents_policy_when_rule_silent lib_authorization_delete_agent_invention R30_says_nothing_about_deletion invented_policy_more_dangerous_than_unenforced hard_denial_not_in_any_rule what_if_code_denies_something_rules_do_not Say agent_policy_undefined_same_shape strict_route_agent_policy, ocd: 2026-07-14, lmd: 2026-09-27] [^3] [^4]
## The third category — worse than an unenforced rule

Where the rules are **SILENT**, the code invents a policy, and the invention is then read
downstream as law. `lib/authorization.ts`:

```ts
// Only system-owner and MANAGER can delete agents.  ← asserted as policy…
// No agent can delete itself via API. COS cannot delete.
if (action === 'delete-agent') { … return { allowed: false, reason: 'Only MANAGER can delete agents' } }
```

R30 governs COS agent *creation* and says **nothing** about deletion. That flat denial is an
**invention**, and it contradicts the COS's own role definition (*"per-team agent management"*)
— a role that may create its team's agents and may not remove them. The USER has since ruled
otherwise (`[[TRDD-8K68E16G]]`).

**An unenforced rule looks missing. An invented one looks DECIDED.** That is why this category
is the most dangerous, and it is the same shape as the `agent_policy_undefined` incident in
`[[strict-route-agent-policy]]` — hit twice in one week.

^X595GKVS [desc: "Applying the lens: (1) audit a rule → open the guard, cite file:line; (2) governance tests → negative first; (3) hard denial in code → check the rule says it; (4) built-but-off → check the switch.", keywords: how_to_audit_a_governance_rule governance_test_negative_case_first reading_a_hard_denial_in_code built_but_switched_off_mechanism check_the_switch_beside_the_call_site grep_miss_is_not_proof_of_absence unenforced_rule_checklist four_step_enforcement_audit, ocd: 2026-07-14, lmd: 2026-09-27]
## How to apply

1. **Auditing a rule?** Open the guard. Cite `file:line` for the refusal. A grep miss is not
   proof of absence (see `[[claim-verification]]` discipline) — open the plausible file.
2. **Writing a governance test?** Write the **negative** case first. The positive case will
   pass whether or not the guard exists, so it distinguishes nothing.
3. **Reading a hard denial in code?** Check the rule actually *says* it. If the rule is silent,
   you are looking at an invention, not a policy — and something downstream is already treating
   it as law.
4. **Found a mechanism that's built but switched off?** That is the sixth instance this week —
   see `[[agent-claims-the-api-was-never-delivered]]`. Check the switch beside the call site.

## Applies to

- `[[team-creation]]` — the canonical case. Every rule of the team-creation model (R12.1's
  5-role base, R30.1's COS mandate, R31's incomplete-team freeze) is unenforced, and the
  system reports healthy: a team is born at 1-of-5 and stays there, while *"the MANAGER
  created a team"* passes every test. Read it as the worked example of this aspect.
- `[[two-server-modes-the-headless-router-reimplements-routes]]` — the structural reason this
  keeps happening HERE rather than everywhere. Every route is served twice, and the headless
  copy reimplements the handler, so a guard can be genuinely present in one mode and genuinely
  absent in the other. The absence shows up as a **200**, which is why three separate
  security-review passes (SVC2-MAJ-12, SVC2-CRIT-01/02) each added an *authn* check, wrote a
  comment calling the operation privileged, and left the *authz* hole wide open — under a fully
  green suite.

## See also

- [[governance-enforcement-ratchet]] — the build-time obligation this aspect motivated: every
  governance sub-rule now needs a declared guard + test, or the suite goes red, so this asymmetry
  can no longer hide behind a green happy-path suite.

## Notes and lessons learned

[^1]: [id:ATOM-RESTART-SURFACED-AUTH-HOLES, status:valid, keywords:"bugs_found_just_by_restarting_server authorization_layer_never_exercised happy_path_success_is_camouflage assume_unverified_not_working power_switch_found_defects", ocd:2026-07-14, lmd:2026-07-14] All four holes above surfaced from **stopping and
  restarting the server** — nobody was using ai-maestro, no feature was under test. Touching
  the power switch was enough. The lesson is not "we found bugs"; it is that the defects sat in
  the authorization layer, where nothing exercises them, and the system's own success was the
  camouflage. When a subsystem's correctness is only ever observed through its happy path,
  assume it is unverified rather than working.

[^2]: [id:ATOM-COS-CREATE-AGENT-ALREADY-ANSWERED, status:valid, keywords:"declared_question_unanswerable_when_answered filed_TRDD_asking_manager_to_settle grep_governance_rules_before_asking R30.2_COS_can_create_agent reasoned_instead_of_reading", ocd:2026-07-14, lmd:2026-07-14] I filed `TRDD-F1SL03CK` saying its blocking question —
  *"does a COS ever create an agent in normal team operation?"* — was one I could not answer and
  that the MANAGER could settle "in one query". **R30.2 already answered it: yes.** The answer
  was written by the USER, in the repo, in the rules file the TRDD itself cites. I reasoned about
  what I *would need to be told* instead of reading what was *already there*.
  Lesson: **before declaring a question unanswerable, grep the governance rules for the answer.**
  This is the same error as `[[agent-claims-the-api-was-never-delivered]]`, committed while
  writing a TRDD about that very error.
[^3]: [id: ATOM-TWGA-A6Z7, status: valid, supersedes: S7X879S9, desc: "The COS-cannot-delete example is historical: MANAGER/COS may soft-delete, hard delete and purge are user-only", keywords: "only_manager_can_delete_agents_stale_example can_a_chief_of_staff_delete_an_agent who_can_delete_an_agent soft_delete_vs_hard_delete who_can_purge_the_cemetery invented_policy_example_now_historical delete-agent_authorization cos_cannot_delete_superseded hard_delete_user_only cemetery_purge_sudo", ocd: 2026-10-05, lmd: 2026-10-05] DO NOT read the quoted 'Only MANAGER can delete agents / COS cannot delete' denial as current policy, BECAUSE the user has since ruled otherwise (TRDD-A50RC5G8, TRDD-8K68E16G): a MANAGER may soft-delete any agent and a CHIEF-OF-STAFF one in its own team (archive stays in the cemetery, user can resurrect); HARD delete and cemetery purge are user-only and sudo-protected. The lesson that code invented a policy where the rules were silent still stands; the example is now historical. DO check lib/authorization.ts for the current rule. SUPERSEDED BODY: (empty)
[^4]: [id: ATOM-KEDP-4P3D, status: valid, supersedes: S7X879S9, desc: "Corrects the earlier delete-authority lesson: ruled vs implemented vs awaiting the user", keywords: "can_a_chief_of_staff_delete_an_agent who_can_delete_an_agent only_manager_can_delete_agents_stale soft_delete_vs_hard_delete who_can_purge_the_cemetery delete_authority_ruled_vs_implemented headless_hard_delete_not_sudo_gated cemetery_purge_sudo_full_mode chair_soft_delete_interpretation_awaiting_user correction_of_overstated_lesson", ocd: 2026-10-05, lmd: 2026-10-05] DO NOT cite the earlier delete-authority lesson on this atom as unqualified, BECAUSE it overstated what is implemented. RULED BY THE USER: a MANAGER may soft-delete any agent; a CHIEF-OF-STAFF may soft-delete an agent in its OWN team; the archive stays in the cemetery and the user can always resurrect it; hard delete is reserved to the user and needs a sudo confirmation. AS IMPLEMENTED: in full mode (the dashboard) hard delete and cemetery purge require sudo; headless mode has no sudo layer, so cemetery purge is forwarded to the full-mode handler (and so requires sudo there too), but headless hard delete is NOT yet sudo-gated (open on TRDD-A50RC5G8). INTERPRETATIONS AWAITING THE USER (TRDD-VR4OPNVI): that a chair may not soft-delete a MANAGER, and which titles a chair may soft-delete. DO read lib/authorization.ts and the delete routes for the current behaviour. SUPERSEDED BODY: (empty)
