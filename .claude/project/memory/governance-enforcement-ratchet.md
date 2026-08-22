---
name: governance-enforcement-ratchet
description: "I added/edited a governance rule and the build went red — what is the enforcement map / how do I keep the governance ratchet green / how do I prove a rule is actually enforced, not just documented / my coverage guard is green but the route has no authorization / a guard whose scan root or needle is narrower than the class it names"
ocd: 2026-07-14
lmd: 2026-08-22
metadata:
  node_type: memory
  type: project
  tier: component
  topic: teams-and-governance
publish-globally: false
---

`docs/GOVERNANCE-RULES.md` is a FIXTURE, not just prose. The ratchet test
`tests/governance/enforcement-coverage.test.ts` turns every governance sub-rule into a build
obligation: each `Rx.y` in the rules doc MUST have a row in `docs/GOVERNANCE-ENFORCEMENT-MAP.md`
carrying `| sub-rule | verdict | guard file:line | test |`.

**Why it exists:** a missing authorization guard produces a SUCCESS, not an error (see
[[an-unenforced-rule-produces-a-success-not-an-error]]), so the whole governance layer could be
comprehensively unenforced while every test, scenario, and day of use looked green — which is
exactly the state a 2026-07-14 audit found (33 of 42 rules had never been adversarially checked).
The ratchet makes "add a governance rule" cost something: you must declare what enforces it and
what proves it, or the suite goes red. Governance-by-prose stops being free.

**The 7 assertions red-build on:** (1) the rules doc unparseable / <250 sub-rules (guards the
parser itself); (2) an audited sub-rule with no map row; (3) a stale map row (rule
renumbered/deleted); (4) an unknown verdict; (5) an ENFORCED row whose guard `file:line` vanished
(file gone or shrunk past the line — catches a guard being moved/gutted, the usual way a citation
dies; note it cannot catch a guard that was never IMPORTABLE in the first place [^5]); (6) an
ENFORCED row naming a test file that doesn't exist; (7) the ENFORCED-without-test
count exceeding `MAX_ENFORCED_WITHOUT_TEST`.

**Keeping it green:**
- Add/edit a rule → add/adjust its map row. A new rule with no row = red.
- Verdicts: `ENFORCED | UNENFORCED | INVENTED | CONTRADICTED | RULING-NEEDED | BEHAVIOURAL`. A guard
  living in a `.tsx`/hook is CORRECT and complete when the rule is a PRESENTATION rule — do not
  downgrade it on the "a check in a client is no check" reflex, which governs AUTHORIZATION. [^6]
- Guard may be `file`, `file:N`, or `file:N-M` and **nothing else** — the grammar rejects a
  free-form parenthetical or prose (`called from …`), so a citation is a path, optionally plus
  `(Pipeline::Gnn)`. Cite the SEAM *and* the CALL SITE: an extracted-but-unwired guard is dead
  code, and a citation naming only the seam cannot tell the two apart. The first token before a
  comma is validated to exist. **Count the rule's CLAUSES and find that many enforcement sites** —
  a multi-clause rule cited once leaves the uncited site invisible to every instrument. [^4]
  A rule enforced in BOTH server modes cites both guards comma-separated, e.g.
  `app/api/.../route.ts:NN, services/headless-router.ts:NN` — the map tracks per-mode parity (see
  [[two-server-modes-the-headless-router-reimplements-routes]]; the headless router reimplements
  routes, so a guard in one mode can be absent in the other).
- `MAX_ENFORCED_WITHOUT_TEST` is a SHRINKING ratchet — it may ONLY fall. Write an adversarial
  refusal test for an ENFORCED rule → cite it in the row → drop the constant to the new floor to
  lock the gain. It began as honest debt (the audit cited guards far more often than tests) and is
  paid down monotonically, never regrown; adding a new ENFORCED rule without a test turns it red.
  It also falls when an ENFORCED verdict is DOWNGRADED, which pins nothing — so say WHICH mechanism
  moved it. [^2]
- The ratchet proves a claim EXISTS (something enforces + something tests), NOT correctness — and
  not even that the guard matches the rule's current TEXT. [^3] The
  adversarial suites (attempt the forbidden act, assert the 403) prove correctness. Coverage ≠
  correctness — but zero coverage = guaranteed-incorrectness, and that is the state it ends.

**A rule is authored in the SPEC, never in the map's rules doc.** The 2026-07-22 authority
inversion makes `design/specs/governance-spec.md` the source of truth and
`docs/GOVERNANCE-RULES.md` its EMANATION — so a new rule lands as `GOV-Rnn` in the spec (bump its
`spec-version`) and only then as a catalog row.[^1] Topic-owned families live in their own spec
instead (R50/R51 are in `all-in-one-spec.md`). And `scripts/aio-gate-coverage.py` derives the map's
Part II table INDEPENDENTLY — it never opens the map — so take a new rule's Part II row *and the
tally* from that script's own output rather than hand-writing them.

**State (2026-07-30):** catalog **v5.1.0**, **52** rules, `MAX_ENFORCED_WITHOUT_TEST = 13` (was
134 at the 2026-07-14 audit; 35 → 32 → 30 → 28 → 23 → 18 → 16 → 15 → 14 → 13 across 2026-07-30).
**Read the count and
the remaining rule LIST from the ratchet's own failure message** — set the constant to 0, run
`-t "shrinking ratchet"`, restore. A hand grep gets it wrong twice over. [^7] The cheapest unit of
work is a **shared-guard pair**: two rules enforced by one guard, so one test file pins both
(R34.2+R35.2 on one route's two auth lines; R7.2+R7.9 on one `useState`). It also forces the right
discipline — when two gates run in ORDER, each refusal test must let the OTHER gate pass, or it
passes with its own gate deleted. Newest rule is **R52 — the write
boundary** (`lib/write-boundary.ts`: ai-maestro writes only inside `~/.aimaestro` and `~/agents`,
plus three ratified `~/.claude` settings keys). The CONTRADICTED column is the git-tracked record
of which rules conflict (rule-vs-code or rule-vs-rule); most need a USER ruling because they pit an
IRON (user-set) rule against the code. Full per-rule detail is gitignored evidence under
`reports/governance-audit/` (the map is the durable git-tracked half).


^ATOM-VRQB-59EF [desc: "The ratchet does not cover ROUTE-level authorization coverage — a separate guard does, and it was blind twice: a scan root of `[id]/` only, and a needle counting `buildAuthContext(` as authorization", keywords: the_coverage_guard_is_green_but_the_route_has_no_authorization scan_root_too_narrow_so_the_guard_walked_a_subtree_that_was_already_clean buildAuthContext_counted_as_an_authorization_step POST_/api/agents_was_authenticated_and_never_authorized an_unauthorized_mutating_route_the_guard_could_never_have_seen, ocd: 2026-08-22, lmd: 2026-08-22]

The ratchet above proves a RULE is enforced somewhere. It says nothing about whether every
mutating API ROUTE performs an authorization step — that is
`tests/unit/agent-route-authorization-coverage.test.ts`, and on 2026-08-22 it was blind twice, in
ways that both read as green (TRDD-F1SL03CK, TRDD-CAVCTULL):

1. **Its scan root was `app/api/agents/[id]/` only.** The COLLECTION subtree
   (`app/api/agents/*/route.ts`) had never been under any guard: 26 mutating routes, **19 with no
   authorization step at all**. A guard walking an already-clean subtree is indistinguishable from
   a clean codebase.
2. **Its `AUTHORIZES` needle counted `\bbuildAuthContext\(` as an authorization step,** on the
   theory that the call forwards the caller into a `Change*` pipeline that authorizes at Gate 0.
   `POST /api/agents` — the route that MINTS agents — already called it, and `CreateAgent`'s first
   gate is `G00f`, an R40 foreign-user check, not an `authorize()` call. So a context CONSTRUCTION
   read as an authorization DECISION.

The instance it missed was a live hole: **any agent of any title could create agents.** Closed by
`authorize(auth, 'create-agent')` in the route, gated to MANAGER and CHIEF-OF-STAFF (R30.1/R30.2).

The guard now carries a SEPARATE collection root and ledger (the `[id]` ledger stays provably
empty), the forward-only spelling is pinned in an UNVERIFIED tier rather than counted as covered,
and a positive control asserts the walker reaches >=26 routes by name — plus the widened guard was
PROVEN to red on a seeded unauthorized route, because a widened root that still matches nothing
looks exactly like a clean one.

## See also

- [[aio-pipeline-rollback-transactions]] — the same ratchet shape pointed at R51 instead of the
  rule map: `tests/governance/aio-txn-10-runner-coverage.test.ts` discovers pipelines from the AST
  and caps how many may still hand-roll their compensations.

## Notes and lessons learned

[^1]: [id:ATOM-UJJK-L60I, status:valid, keywords:"authored_the_rule_in_the_wrong_file emanation_vs_spec governance_rules_md_is_not_the_source_of_truth", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT author a new governance rule in `docs/GOVERNANCE-RULES.md`, BECAUSE the 2026-07-22
  inversion made it an EMANATION of `design/specs/governance-spec.md`, so a rule written only there
  has no normative source. DO write the `GOV-Rnn` clause in the spec first, then emanate.

[^2]: [id:ATOM-7HAS-05BO, status:valid, keywords:"ratchet_fell_without_a_new_test count_dropped_but_nothing_was_pinned enforced_to_contradicted", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT assume the ratchet can only fall by PINNING a guard, BECAUSE it also falls when an
  ENFORCED verdict is DOWNGRADED — retracting a false claim removes the obligation without proving
  anything. DO say which mechanism moved it, or a `-2` reads as coverage that was never written.

[^3]: [id:ATOM-S2SH-WJFT, status:valid, keywords:"enforced_and_tested_while_the_rule_text_moved guard_implements_a_superseded_rule green_test_certifies_the_divergence", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT read ENFORCED+TESTED as "the guard matches the rule", BECAUSE a guard can implement a
  SUPERSEDED version of the text and a test written against that guard PASSES, certifying the drift
  — R39.5/R39.7 were both. DO diff the rule TEXT against the guard before believing either column.

[^4]: [id:ATOM-O2AG-3YUP, status:valid, keywords:"one_clause_cited_one_clause_invisible rule_has_two_halves only_one_enforcement_site_cited", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT cite one site for a multi-clause rule, BECAUSE the uncited site is invisible to every
  instrument (the citation it lacks names real working code, so nothing reddens) — 3 for 3 in two
  sessions. DO count the rule's clauses, then find that many enforcement sites.

[^5]: [id:ATOM-L5HY-HZG1, status:valid, keywords:"guard_cannot_be_tested_at_all inline_in_server_startup unobservable_guard refactor_deleted_it_silently", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT leave a guard inline in `server.mjs::startServer`, BECAUSE that file binds sockets on
  import so nothing can import it, and an unobservable guard is one refactor away from silently not
  existing. DO extract it to an importable `.mjs` seam (R9.9/R17.17/R17.20 — TRDD-L42SKUBW) and
  cite seam + call site.

[^6]: [id:ATOM-Y4BK-8FYY, status:valid, keywords:"guard_lives_in_a_tsx_component client_side_check_is_no_check downgrade_a_ui_rule_to_behavioural presentation_rule_vs_authorization_rule", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT downgrade a rule because its only guard is client-side, BECAUSE "a check in a client is no
  check" governs AUTHORIZATION (every route is curl-able, so that check must land in the route) and
  says nothing about what the UI DISPLAYS — applying it to the 9 presentation rules would have gutted
  9 correct rows. DO ask which kind of rule it is first; a presentation rule is fully enforced by its
  `.tsx`/hook guard and is pinnable today with `renderHook`/`render`.

[^7]: [id:ATOM-OX2U-OE9S, status:valid, keywords:"which_rules_are_still_untested hand_grep_of_the_enforcement_map awk_split_on_pipe_phantom_guards ratchet_count_disagrees", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT hand-grep the map for the untested-ENFORCED list, BECAUSE it misses lettered ids (`R17.18a`)
  AND the map has a SECOND 3-column table further down that poisons `awk -F'|'` with ~118 phantom
  `—` guards. DO set `MAX_ENFORCED_WITHOUT_TEST = 0`, run `-t "shrinking ratchet"`, and read the
  count and the list off the failure message — the parser that gates the build is the only one whose
  answer matters.

[^8]: [id:ATOM-VQ3E-M2LC, status:valid, keywords:"neuter_reddened_nothing mutated_the_wrong_expression earlier_ternary_arm_already_matched guard_is_not_the_line_the_rule_names", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT read a no-op neuter as "the test is vacuous", BECAUSE it may mean you mutated a SHADOWED
  expression — mine flipped `hasMultipleOptions = len > 1` → `> 0` and nothing reddened, since the
  render is `isSingleLocked ? … : hasMultipleOptions ? …` and the single-item fixture never reaches
  the second arm. DO find which branch actually MATCHES for your fixture before naming a guard; the
  rule's text pointed at `> 1` and the working guard was the arm above it.

[^9]: [id:ATOM-K7WD-N1RA, status:valid, keywords:"citation_points_at_a_different_rule cited_the_subagent_gate_not_the_manager_gate wrong_endpoint_entirely parity_rule_has_three_sites", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT trust a Guard citation because the file exists and the line is in range, BECAUSE the
  ratchet only checks bounds — R10.6 cited the SUBAGENT gate (another rule) and a line inside the
  /stop handler (another ENDPOINT), and R7.1/R7.3 cited a `useState` and a comment. DO read the
  cited line and confirm it is the rule's own guard; a parity rule needs EVERY mode's site cited
  (R10.6 had three).
