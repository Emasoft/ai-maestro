---
trdd-id: 1ZMEXD9X
title: Systematic fleet gap survey and remediation campaign — the orchestrator does the orchestrator's job
column: completed
created: 2026-08-15T16:16:37+0200
updated: 2026-08-15T23:55:59+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-15T16:16:37+0200
priority: 0
severity: high
effort: large
release-via: none
scope: project
project-id: ai-maestro
labels: [campaign, survey, governance, orchestration, user-directive]
npt: []
eht: [2R34M8FA, BL0W6LGY, LMAZO2ET, 4EBVIYBA, IG1MMYFA]
blocked-by: []
---

# Systematic fleet gap survey and remediation campaign

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-15 16:38

**Surveys: 5/5 DONE + hub-verified** (reports/gap-survey/: A1 161922, A2 162700, A3 170500,
A5 162320, A6 162141). Verification verdicts: A1/A2 verified; A6's GAP-1 + cadence deficit
CONFIRMED but its "claimed_chore_watch unwired" claim REFUTED (caller in
scripts/detectors/claimed-chore-stale.py — flat-glob miss); A5's 1 real leak confirmed
(janitor 6CRC9SQQ card home path), 4 others are the leak-detector's own fixtures; only 5
plugins cached locally — 6 role-plugins UNMEASURED (population caveat).

**Gap inventory (new cards, all EHT of this one):** 2R34M8FA (PRRD/SPEC write-guard, P1) →
BL0W6LGY (prrd/spec lint verbs, P1, blocked-by 2R34M8FA) · LMAZO2ET (foreign-approve
5-store invalid state, P1) · 4EBVIYBA (R51 ratchet scan surface, P2). **Existing cards
adopted by the plan (not duplicated):** GADPGOIR (drift automation, approved) · 89LVZSQ0
(terminal-read verb) · SCLSRS6E (governance script layer, blocked) · 9MZQ4T7E/P7XKV3N9
(USER-auth verbs, human_review) · DQ6XN2VP (superseded-in-substance: A2 measured 19/19
wrapped; its residue = InstallElement window + ChangeMarketplace limit-case pinning).

**Delivered:** janitor issue ai-maestro-janitor#274 (3 verified findings) · server
chore-stamp comment fix f6effa7c · SCRIPT-MANIFEST pillar section f97d3e23 · A4 delivery
records: janitor msg a64d33e5, CORE msg aefecc5e.

**SEQUENCED PLAN (execution order):** 1) ~~LMAZO2ET~~ **DONE 2026-08-15 16:53** (commit
a084a1d5, archived `completed` — 5-gate runGateSequence pipeline in
services/foreign-approval-service.ts, 5 per-gate failure tests + 2 recorded neuters, 68/68
affected suites green) → 2) ~~2R34M8FA~~ **DONE 2026-08-15 17:07** (b3a4ec2b, archived
`completed` — lib/pillar/edit-guard.ts as replaceAtLines' in-lock preWriteCheck, 18 tests,
2 recorded neuters 10/8 + 1/17, full suite resolved to zero regressions incl. the R50
category-(c) compensation pin) → 3) ~~BL0W6LGY~~ **DONE 2026-08-15 17:15** (c29661bb,
archived `completed` — lint/validate verbs sharing the guard's finders, 13 tests, neuters
7/6 + 1/12; FIRST LIVE RUN found 46 real findings → **NEW EHT card TRDD-IG1MMYFA**: the
canonical SPEC grammar under-matches 44 live clauses — TERM-xx, RP-ASSISTANT-xx,
RP-SKILL-MENU-xx, STS-Rn.n invisible to the store — plus 2 citation conflations) →
3b) IG1MMYFA (grammar widening, P1 — found work, slots before the detector) → 4) 4EBVIYBA
→ 5) GADPGOIR (drift automation) → 6) synthesis residue: PRRD bootstrap proposal
(USER-floor — needs the USER: golden G1.1 authoring) + ~~github-config-audit TS-vs-py parity
check (open question from A6)~~ **DONE 2026-08-15 23:2x** + the 6 uncached role-plugins'
compliance (needs their repos or a cache install).

**ALL SIX PLAN ITEMS ARE NOW CLOSED OR CORRECTLY BLOCKED.** Item 6's three pieces were never
equal, and only one was ever actionable here:

| piece | disposition |
|---|---|
| PRRD bootstrap (golden G1.1) | **BLOCKED — USER-only.** Tier 3; an agent may not author it. |
| 6 uncached role-plugins | **BLOCKED — needs their repos or a cache install.** |
| github-config-audit TS-vs-py parity (A6) | **DONE** — e71af448, 0f72c0fe |

**A6 parity outcome (the actionable piece).** Surveyed `lib/github-config-audit.ts` against the
janitor's `github_config_audit.py` (3.3.5). The classifier is a faithful port — finding codes and
blurbs byte-identical, silence rules identical — with **one real behavioural gap**, now fixed:

- **GAP (fixed, `e71af448`).** `fullRulesets` DROPPED any ruleset whose per-ruleset detail fetch
  failed, converting "I could not read this" into "this does not exist" — the one inference the
  module forbids everywhere else (its header: *"it never claims a gap it could not prove"*, applied
  correctly to `admin`, `rulesets`, `classicProtected`, `hasWorkflows`, and violated in this single
  loop). Two false findings followed; the sharp one is that a repo whose ONLY active branch ruleset
  failed its detail probe was reported **UNPROTECTED** off one transient 5xx. Now kept as the list
  summary tagged `_detail_unresolved` — the janitor's own key (their janitor#244), so the two stay
  interchangeable. **Neuters (complementary pair, run):** reverting the tagging reds exactly 1 test
  (the `fullRulesets` half); dropping the `!anyUnresolved` gate reds 3 DIFFERENT tests (the
  classifier half). Zero overlap — each half independently pinned. 25/25 green, tsc 0.
- **Dead code removed (`0f72c0fe`).** `github-cli.ts::setBranchProtection` — ZERO callers, so it had
  mis-protected nothing, but it encoded THREE contradictions of ratified governance
  (`required_approving_review_count: 1` vs the USER's 2026-08-13 ruling of 0; `enforce_admins: true`
  vs that ruling's added owner bypass; the LEGACY branch-protection API rather than RULESETS). Also
  `ghApi`, dead before that removal — its only non-definition occurrence was a mention in a COMMENT.

**⚠ ONE FINDING THAT MUST NOT BE "FIXED" LATER.** The survey also found the ratified baseline
**APPLIER** (the `baseline-*` trio's names, payloads, `bypass_actors`,
`required_approving_review_count: 0`) exists **only** in the janitor's `branch_protection_lib.py`,
with no TS port. **That is deliberate and must stay so.** This server AUDITS read-only; the janitor
APPLIES. Porting the applier here would put one set of ratified constants in two codebases — the
exact drift that has already bitten this fleet (a peer's cadence constant read 6 h vs 2.0 h across
two copies). A future reader seeing "no TS applier" should read it as the design, not a gap.

**NEXT ACTION:** nothing in the numbered plan. The two remaining item-6 pieces are blocked on the
USER and on external repos respectively (see the table above) — do NOT start either. The campaign's
own open work is done; the remaining fleet-level item is DPPYVLVH's human-watched first switch,
which needs one live Fable agent and must not be recorded as verified until both signals are seen.

**Items 1-3b are DONE** (each archived `completed`, with recorded neuters):
`LMAZO2ET` (a084a1d5) · `2R34M8FA` (b3a4ec2b) · `BL0W6LGY` (c29661bb) ·
`IG1MMYFA` (1c01e02a + c0609620 — `specgrep lint` now exit 0 clean over 263 records, and
`yarn pillars:lint` exit 0 over 453 documents).

**Interleaved USER directives, both landed and outside the numbered plan:**
the scoped-window rotation mirror (`TRDD-IZ6KU37Y`, 0497a2ba) and server-triggered
externalized compaction (`TRDD-DSQUWKVI`, 2be39063 + fcbeb021). The model-fallback arming
(`TRDD-DPPYVLVH`, 56047fa5) is live but its human-watched first switch is still PENDING a
live Fable agent — it must not be recorded verified until `confirmed=true` and the pane flip
are both observed.

## The USER's directive (2026-08-15, verbatim complaints — each becomes a survey axis)

> "i left you in charge and you did not concretized anything. why the plugins are still not
> compliant with the governance rules? why the recent changes in the janitor are not being
> integrated into the ai-maestro global daemon? why there is still a lack of scripts functions
> and commands for things that the agents needs? why the janitor claude and the core plugin are
> not being provided with the full updated list of scripts commands needed to interact with the
> ai-maestro server? why the trddgrep, prrdgrep and the specgrep are still not completed and
> unable to enforce the most basic rules of formatting and composition when writing, or to lint
> correctly the files before and after to ensure no update is going to produce invalid files?
> why there are still tons of api functions leaving the ai-maestro server in invalid states? and
> why you did not surveyed the state of the plugins, written down all the things still
> missing/to fix and planned the interventions systematically?"

The structural failure this card fixes: the hub worked card-by-card (reactive drain) and never
produced the SYSTEMATIC layer — a measured survey, a written gap inventory, a sequenced plan.
This card is that layer, and it stays open until every axis below has (a) a measured survey
report, (b) its gaps written as TRDDs at honest floors, and (c) a sequenced execution record.

## The seven axes → survey assignments

| axis | question | survey deliverable |
|---|---|---|
| A1 pillar tooling | trddgrep / prrdgrep / specgrep: which exist, which verbs, is there WRITE-time enforcement + pre/post lint, can an update produce an invalid file? | reports/gap-survey/A1-*.md |
| A2 API invalid states | which server mutations can leave multi-store state inconsistent (R51 transaction coverage census: wrapped vs hand-rolled vs unwrapped) | reports/gap-survey/A2-*.md |
| A3 agent script surface | what agent-facing scripts/commands exist vs what agents actually need; deployment drift source→installed | reports/gap-survey/A3-*.md |
| A4 script list for janitor+CORE | the full updated list of server-interaction commands, delivered TO the janitor Claude and the core plugin (not just written here) | manifest update + delivery record |
| A5 plugin governance compliance | the 8 role-plugins + core + janitor vs the governance rules (read-only, cross-repo) | reports/gap-survey/A5-*.md |
| A6 janitor→daemon integration | janitor 3.x changes the server global daemon should absorb/mirror but hasn't | reports/gap-survey/A6-*.md |
| A7 synthesis | gap inventory → one TRDD per gap at its honest floor → sequenced plan | this card's STATE + the spawned cards |

Already-approved cards that BELONG to this campaign (fold in, do not duplicate):
GADPGOIR (installed script layer drifts undetected → A3), ZKQ38TSG (janitor per-chore stamps →
A6), DQ6XN2VP (transactional all-in-one, measured 19 pipelines / 14 remaining → A2 baseline),
8KDIB2LT (propagate the CLI contract → A4), CHN16JXZ/DXJZM3BW (continuity CLI surface → A3).

## Method constraints

- Surveys are READ-ONLY, run as bounded sonnet[1m] workers, reports to
  `reports/gap-survey/` (gitignored), returning PATHS only.
- Every claim in a survey report is verified by the hub (grep the cited line) before it
  becomes a TRDD — sub-agent reports are hypotheses (decide-on-facts).
- Cross-repo axes (A5, A6) are read-only; fixes in other repos go through issues/messages,
  never their trees.
- Gap cards go to their HONEST floor: manager/user-floor gaps become proposals, not
  self-mandates.

## Acceptance

- [x] All survey reports exist with file:line evidence — 5 reports (A4 was a delivery task,
      not a report; its record is the manifest commit + the two message ids in STATE)
- [x] Gap inventory written: 4 new EHT cards + 6 existing cards adopted, deduped (STATE)
- [x] A4 delivered: manifest f97d3e23; janitor msg a64d33e5; CORE msg aefecc5e; #274 filed
- [x] Sequenced plan recorded in STATE and reported to the USER (same session)
- [x] Execution begun in sequence — plan item 1 (LMAZO2ET) executed to `completed` the same
      day: commit a084a1d5, per-gate failure tests, neuter runs recorded on the card

## Approval log

- 2026-08-15T16:16:37+0200 — MANDATE issued by USER, in the first person, to the hub session
  ("i left you in charge … do a better job!"). Pre-approved: issuer authority above every
  floor. The survey layer is read-only; each spawned FIX card carries its own floor.
- 2026-08-15T23:55:59+0200 — COMPLETED by ai-maestro. All five acceptance boxes checked and
  all five EHTs terminal (`2R34M8FA` `BL0W6LGY` `LMAZO2ET` `4EBVIYBA` `IG1MMYFA`, each
  `completed` in `design/archived/`), so both closing gates pass. The campaign's own
  actionable work is finished; the two residual item-6 pieces are NOT this card's to do —
  the PRRD golden G1.1 bootstrap is Tier-3 USER-only, and the 6 uncached role-plugins need
  their repos or a cache install. Holding the card open on work an agent may not perform
  would make `dev` claim activity that cannot happen. `DPPYVLVH`'s human-watched first
  model-fallback switch is tracked on its own card, not here.
