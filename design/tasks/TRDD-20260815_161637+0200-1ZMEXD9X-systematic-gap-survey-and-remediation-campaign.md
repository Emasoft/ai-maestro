---
trdd-id: 1ZMEXD9X
title: Systematic fleet gap survey and remediation campaign — the orchestrator does the orchestrator's job
column: dev
created: 2026-08-15T16:16:37+0200
updated: 2026-08-15T16:38:00+0200
eht: [2R34M8FA, BL0W6LGY, LMAZO2ET, 4EBVIYBA]
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
eht: []
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

**SEQUENCED PLAN (execution order):** 1) LMAZO2ET (real invalid-state bug, highest harm) →
2) 2R34M8FA → 3) BL0W6LGY → 4) 4EBVIYBA → 5) GADPGOIR (drift automation) → 6) synthesis
residue: PRRD bootstrap proposal (USER-floor — needs the USER: golden G1.1 authoring) +
github-config-audit TS-vs-py parity check (open question from A6) + the 6 uncached
role-plugins' compliance (needs their repos or a cache install).

**NEXT ACTION:** execute plan item 1 (LMAZO2ET) unless the USER re-prioritizes.

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
- [ ] Execution begun in sequence (first N cards moved, with commits)

## Approval log

- 2026-08-15T16:16:37+0200 — MANDATE issued by USER, in the first person, to the hub session
  ("i left you in charge … do a better job!"). Pre-approved: issuer authority above every
  floor. The survey layer is read-only; each spawned FIX card carries its own floor.
