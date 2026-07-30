---
name: governance-enforcement-ratchet
description: "I added/edited a governance rule and the build went red — what is the enforcement map / how do I keep the governance ratchet green / how do I prove a rule is actually enforced, not just documented"
ocd: 2026-07-14
lmd: 2026-07-30
metadata:
  node_type: memory
  type: project
  tier: component
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
dies); (6) an ENFORCED row naming a test file that doesn't exist; (7) the ENFORCED-without-test
count exceeding `MAX_ENFORCED_WITHOUT_TEST`.

**Keeping it green:**
- Add/edit a rule → add/adjust its map row. A new rule with no row = red.
- Verdicts: `ENFORCED | UNENFORCED | INVENTED | CONTRADICTED | RULING-NEEDED | BEHAVIOURAL`.
- Guard may be `file`, `file:N`, or `file:N-M` and **nothing else** — the grammar rejects a
  free-form parenthetical or prose (`called from …`), so a citation is a path, optionally plus
  `(Pipeline::Gnn)`. Cite the SEAM *and* the CALL SITE: an extracted-but-unwired guard is dead
  code, and a citation naming only the seam cannot tell the two apart. The first token before a
  comma is validated to exist. A rule enforced in BOTH server modes cites both guards comma-separated, e.g.
  `app/api/.../route.ts:NN, services/headless-router.ts:NN` — the map tracks per-mode parity (see
  [[two-server-modes-the-headless-router-reimplements-routes]]; the headless router reimplements
  routes, so a guard in one mode can be absent in the other).
- `MAX_ENFORCED_WITHOUT_TEST` is a SHRINKING ratchet — it may ONLY fall. Write an adversarial
  refusal test for an ENFORCED rule → cite it in the row → drop the constant to the new floor to
  lock the gain. It began as honest debt (the audit cited guards far more often than tests) and is
  paid down monotonically, never regrown; adding a new ENFORCED rule without a test turns it red.
- The ratchet proves a claim EXISTS (something enforces + something tests), NOT correctness. The
  adversarial suites (attempt the forbidden act, assert the 403) prove correctness. Coverage ≠
  correctness — but zero coverage = guaranteed-incorrectness, and that is the state it ends.

**A rule is authored in the SPEC, never in the map's rules doc.** The 2026-07-22 authority
inversion makes `design/specs/governance-spec.md` the source of truth and
`docs/GOVERNANCE-RULES.md` its EMANATION — so a new rule lands as `GOV-Rnn` in the spec (bump its
`spec-version`) and only then as a catalog row.[^1] Topic-owned families live in their own spec
instead (R50/R51 are in `all-in-one-spec.md`). And `scripts/aio-gate-coverage.py` derives the map's
Part II table INDEPENDENTLY — it never opens the map — so take a new rule's Part II row *and the
tally* from that script's own output rather than hand-writing them.

**State (2026-07-30):** catalog **v5.1.0**, **52** rules, `MAX_ENFORCED_WITHOUT_TEST = 30` (was
134 at the 2026-07-14 audit; 35 → 32 → 30 on 2026-07-30 alone). Newest rule is **R52 — the write
boundary** (`lib/write-boundary.ts`: ai-maestro writes only inside `~/.aimaestro` and `~/agents`,
plus three ratified `~/.claude` settings keys). The CONTRADICTED column is the git-tracked record
of which rules conflict (rule-vs-code or rule-vs-rule); most need a USER ruling because they pit an
IRON (user-set) rule against the code. Full per-rule detail is gitignored evidence under
`reports/governance-audit/` (the map is the durable git-tracked half).

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
