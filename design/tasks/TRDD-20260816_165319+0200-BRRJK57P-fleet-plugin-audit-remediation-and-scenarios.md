---
trdd-id: BRRJK57P
title: USER fleet program — every plugin self-audits twice, remediates via TRDDs, and is proven by new scenario tests
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T16:53:19+0200
updated: 2026-08-16T16:53:19+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: audit
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-16T16:53:19+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
effort: XL
labels: [fleet, plugins, audit, governance, scenarios, user-mandate]
external-refs: []
---

# Fleet program — audit every plugin, remediate, prove it with scenarios

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-16

**Phase 1 (AUDIT) dispatched 2026-08-16 ~16:55 to every live plugin session.** Nothing is
remediated yet. Phase 2 (plan) and Phase 3 (scenarios) have not begun.

**NEXT ACTION:** collect the Phase-1 audit reports as sessions return them, and for each CONFIRMED
finding verify at least one cited `file:line` MYSELF before it becomes a TRDD. A peer report is a
hypothesis — this program was born on the day the hub relayed an unverified peer finding to four
sessions and had to retract it.

## The USER's mandate, verbatim

> 1. investigate the status of all plugins (missing features, governance compliance, scripts
>    alignement, bugs, errors, conflicts). let them examine themselves and report to you on each of
>    those. force them to verify twice.
> 2. plan the interventions to solve all the reported plugins shortcomings and bugs. in detail
>    plans, hundreds of TRDD. orchestrate the agents to do them and track them using the kanban
>    techniques of the 3-pillars task system. ai review column included, but no human review
>    column. I leave that to you.
> 3. write a new series of short scenario tests (multi-phase) to check all the functionalities
>    added and the bugs fixed in every plugin. then run the scenarios tests on ai-maestro server.

Standing rules the USER attached to all three goals:

- **Always update the wikimem** with all changes; **always update the documentation.**
- **Specs move FIRST.** If a spec genuinely needs correcting or expanding, do that BEFORE the
  change, then **verify compliance AFTER** the change.
- **The hub does NOT edit plugin code.** It READS plugin code to discover issues. Every code change
  is made by the plugin's own session, in its own repo.
- **Every plugin PUBLISHES** its updated version after its changes land.
- **Upgrade only USER-scope plugins.** The only user-scoped `ai-maestro-*` plugin is the
  **janitor**; every `emasoft-*` plugin is user-scoped. The rest are local-scoped — do not upgrade
  them under this program.
- **Keep observing `trddgrep`, `prrdgrep`, `specgrep`** for shortcomings and improve them after
  verifying.
- **Never decide without verifying the facts. Never assume anything.**

## PHASE 1 — the audit contract (binding on every plugin session)

Audit YOUR OWN repo across four axes. **Discovery only — fix NOTHING in this phase.** A fix during
discovery destroys the evidence the remediation plan is built from.

1. **MISSING FEATURES** — capability the plugin's own docs/README/skills/persona PROMISE but that
   is absent or non-functional in the shipped tree.
2. **GOVERNANCE COMPLIANCE** — conformance to the 3 pillars (TRDD / PRRD / kanban), the R-rules the
   plugin claims to implement, the ratified GitHub baseline rulesets, and the authorship self-ID
   convention. **A citation that names real code is not proof the rule is enforced** — read the
   rule TEXT against the guard.
3. **SCRIPTS ALIGNMENT** — every script/CLI the plugin ships or calls: does the INSTALLED copy on
   PATH match the repo copy (`cmp`, not `grep`), are its flags real (`--help`), does an unknown
   flag fail loudly rather than exit 0?
4. **BUGS / ERRORS / CONFLICTS** — real defects, plus conflicts with other plugins (same command
   name, same file, same settings key, contradictory rules).

### VERIFY TWICE — and the second pass must try to REFUTE the first

The USER requires two passes, and a second pass that merely re-reads is worthless. Contract:

- **Pass 1 — DISCOVER.** Produce candidate findings. Each carries a `file:line`, a sha where
  relevant, and the exact command that produced it.
- **Pass 2 — FALSIFY.** For each candidate, actively try to prove it WRONG: re-run the command,
  read the surrounding code, check whether the thing you called missing exists under another name,
  in another file, or via another mechanism. Default to REFUTED when uncertain.
- A finding is **CONFIRMED** only if it survives pass 2. Report refuted candidates too, one line
  each, with why — they are how the next auditor avoids re-finding them.

**"Not verified" and "verified absent" are DIFFERENT tokens and must never collapse.** A worker
reporting "0 present / not fully verified" is evidence that the WORKER STOPPED, never evidence the
thing is missing. (Adopted from the assistant-manager session, which caught two of its own
subagents doing exactly this and would have manufactured two phantom findings.)

**CODE and git settle STATUS; prose only states INTENT.** To decide whether something landed:
`implementation-commits:` → `git show <sha>` → confirm the artifact exists on disk. A STATE block
is written at authoring time and is frequently never refreshed — it reads as current truth while
describing a plan that already executed, which makes it the most confidently wrong field on a card.

**Instrument discipline, each of which cost this fleet a real error today:**
- A convenient ZERO is usually a wrong needle. Echo the resolved path/set; positive-control every
  search against something you KNOW is present.
- `grep -r --include=<glob>` does not filter on every toolchain — verify the filter before
  believing a count built on it.
- `ps` `%CPU` is a LIFETIME AVERAGE, not a live sample. Two sessions independently raised a false
  runaway from it today.
- Never report a count from a truncated or capped command. A negative claim needs an UNBOUNDED
  instrument.

### Report format

Write to `<your-repo>/reports/plugin-self-audit/<ts±tz>-audit.md`. Return to the hub ONLY: the
counts per axis (confirmed / refuted) and the report path. Do not paste findings into the message.

## PHASE 2 — remediation (not yet dispatched)

Each CONFIRMED finding becomes a TRDD in the OWNING plugin's repo, worked through the kanban:
`todo → dispatch → dev → testing → ai_review → complete`. **`ai_review` is IN. `human_review` is
OUT** — the USER has delegated that column to the hub, so a card that would have escalated to a
human instead comes to the hub session for judgement.

## PHASE 3 — scenarios (not yet dispatched)

Short MULTI-PHASE scenario tests covering every feature added and every bug fixed, run against the
live ai-maestro server. The governance password is referenced by the env var name
`AIM_GOVERNANCE_PASSWORD` and **its value never appears in a scenario file, a report, a command, or
an agent prompt** — scenarios name the variable, helpers resolve it. 197 copies of that literal
once accumulated across 34 committed files here and one reached a PUBLIC repo; the format required
them to.

## Acceptance

- [ ] Every live plugin session has returned a Phase-1 audit report with per-axis confirmed/refuted
      counts and a report path.
- [ ] For every CONFIRMED finding, the hub has re-verified at least one cited `file:line` itself
      before it becomes a TRDD — no finding enters the plan on a peer's word alone.
- [ ] Refuted candidates are recorded with their refutation, not silently dropped.
- [ ] Phase 2 TRDDs exist in the OWNING repos, not here, and each cites its audit finding.
- [ ] Specs corrected/expanded BEFORE their dependent changes, with compliance re-verified after.
- [ ] wikimem and documentation updated for every landed change.
- [ ] Every user-scope plugin that changed has PUBLISHED a new version; local-scope plugins were
      not upgraded under this program.
- [ ] Phase-3 scenarios exist, are multi-phase, and have RUN against the live server with results
      recorded.
- [ ] No governance password literal appears anywhere in any artifact this program produced.
- [ ] `trddgrep` / `prrdgrep` / `specgrep` shortcomings found during the program are recorded and,
      where verified, improved.

## Approval log

- 2026-08-16T16:53:19+0200 — MANDATE issued by the USER (min-approval-requirement: none).
  Pre-approved: the issuer is the USER, above every agent rung. No approval request was sent.
