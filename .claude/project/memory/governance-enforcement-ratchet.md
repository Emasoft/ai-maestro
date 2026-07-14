---
name: governance-enforcement-ratchet
description: "I added/edited a governance rule and the build went red — what is the enforcement map / how do I keep the governance ratchet green / how do I prove a rule is actually enforced, not just documented"
ocd: 2026-07-14
lmd: 2026-07-14
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
- Guard may be `file`, `file:N`, or `file:N-M`; the first token before a comma is validated to
  exist. A rule enforced in BOTH server modes cites both guards comma-separated, e.g.
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

**State (2026-07-14 audit — commit `b53c8054` built the ratchet, `3fc74c22` dropped the cap to
134 after the headless-parity fix `1f1a53f1` added tests for R3.6/R8.2):** 289 sub-rules — 141
ENFORCED, 97 UNENFORCED, 33 CONTRADICTED, 3 INVENTED, 2 RULING-NEEDED, 13 BEHAVIOURAL.
`MAX_ENFORCED_WITHOUT_TEST = 134`. The CONTRADICTED column is the git-tracked record of which
rules conflict (rule-vs-code or rule-vs-rule); most need a USER ruling because they pit an IRON
(user-set) rule against the code. Full per-rule detail is gitignored evidence under
`reports/governance-audit/` (the map is the durable git-tracked half).

## Notes and lessons learned
(none yet)
