---
trdd-id: BRRJK57P
title: USER fleet program — every plugin self-audits twice, remediates via TRDDs, and is proven by new scenario tests
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T16:53:19+0200
updated: 2026-08-16T18:56:22+0200
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

**3 sessions reported as of 18:49; all their CONFIRMED findings are hub-verified — see the
verification ledger below.** Outstanding: architect axis 4, assistant-role axis 4, and every
session that has not yet reported. Phase-2 dispatch stays BLOCKED on the USER (relayed authority
was correctly refused by three sessions; the hold is endorsed).

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

## Hub verification ledger — 2026-08-16T18:49+0200

Acceptance box 2 is satisfied per row below. Every command was run by the hub, read-only, in the
owning repo. **A row marked REFUTED does not kill the finding — it kills the SUPPORTING CLAIM**,
and the corrected finding is stated beside it.

### ai-maestro-architect-agent (`~/Code/EMASOFT-ARCHITECT-AGENT/…`)

| Finding | Hub verdict | What the hub ran |
|---|---|---|
| 10 planning-patterns scripts crash on ANY invocation | **CONFIRMED, count exact** | `--help` on all 15 → 10 fail, 5 pass. `ModuleNotFoundError: No module named 'cross_platform'`. `skills/shared` absent; module is `lib/cross_platform.py`. The 5 passes are the positive control: the harness works. |
| `lib/report_utils.py` `report_output()` has zero callers | **CONFIRMED** | repo-wide grep minus the defining file → only `:3` docstring + `:15` def. Control `atomic_write_json` = 15 hits. |
| 8 docstring usage lines cite hyphenated filenames | **CONFIRMED, 8/8** | per name: citedIn=1, fileExists=0. |
| 2 archived cards carry `column: complete` | **CONFIRMED, and the population is 9** | 2 `complete` · 4 `completed` · 3 `published`. |
| `archived` is unreachable and "nothing else writes it" | **SUPPORTING CLAIM REFUTED** | `scripts/amaa_design_lifecycle.py:189` writes `status: archived` by regex; `amaa_github_sync_status.py:49,95` map it. The cited grep (`grep -rn "archiv" --include='*.py' scripts skills`) MUST return :189 — the reported output was not that command's output. **Corrected finding, still real and sharper:** two writers, one gated by `VALID_TRANSITIONS` (which has NO edge into `archived`) and one bypassing it entirely. Doc drift confirmed separately: README/SKILL promise `implementing`/`completed`, code has `implemented`. |
| 2 legacy lowercase-hex TRDD ids | **CONFIRMED as fact, REFUTED as a defect** | ids are full v1 UUIDs (`536c42e3-2a21-…`). Both cards are ARCHIVED, i.e. FROZEN by the IND base (terminal cards: only `updated:`/`superseded-by:` may change), and v1→v2 migration is explicitly "on next touch". Renumbering them would break every citation to them. Record, do not migrate. |
| `baseline-tag-protect` filed as a Tier-2 deviation, then self-downgraded | **DOWNGRADE CORRECT; the stated reason is WRONG** | It is not merely "outside the default-branch gate" — it is a RATIFIED baseline member: `rules/aimaestro/aimaestro-manager-approval-defaults.md:152`, `design/specs/baseline-github-rulesets-spec.md:62`, and `tests/governance/baseline-spec-ratchet.test.ts:20` pins the TRIO by name. So the repo carrying it with `bypass_actors: []` is baseline COMPLIANCE. There is no unowned "wording gap": the machine-global orphan `~/.claude/rules/manager-approval-defaults.md` has **0** hits for it, and that file is already surfaced to the USER as stale (handoff blocker 1). |

### ai-maestro-assistant-role-agent (`~/Code/ai-maestro-assistant-role-agent` — flat, NOT `<UPPER>/<name>`)

| Finding | Hub verdict | What the hub ran |
|---|---|---|
| Workflow comments say `@v3.1.0`; invocations say `@v5.5.0` | **CONFIRMED verbatim** | `ci.yml:170` / `release.yml:57` comments vs `ci.yml:196` / `release.yml:85` invocations. Pin inventory re-derived independently: 7 sites, all `@v5.5.0` (`publish.py` ×5 + 2 workflows) — matches. |
| "that grep returns exactly those two lines and nothing else" | **REFUTED (population, not finding)** | unbounded `git grep -n "v3\.1\.0"` returns **10** lines. The other 8 are legitimate: 4 TRDD cards recording the bump, 1 memory note, **and 2 TEST FIXTURES** — `tests/test_no_bare_github_mentions.py:56,145` embed the exact string `PINNED to @v3.1.0` as the guard's own fixture. **A blanket replace of `@v3.1.0` breaks that test.** Fix the 2 comments by hand. |

### ai-maestro-maintainer-agent — the CPV writer

| Finding | Hub verdict | What the hub ran |
|---|---|---|
| CPV 5.5.0 PUTs `bypass_actors: []` over `baseline-history-protect` | **CONFIRMED end-to-end, in the INSTALLED copy** | `…/claude-plugins-validation/5.5.0/scripts/setup_branch_rules.py` (mtime Aug 15 16:36): `:807` `"bypass_actors": []` → `:948-956` `action="UPDATE"` when it already exists → `:964-978` `apply_ruleset()` POST-or-**PUT**. |
| The builder docstring asserts its own currency | **CONFIRMED — and it is the worst part** | `:783-791` defends the empty bypass as "the point of the ruleset", states `--adopt-bypass-actors` "deliberately cannot reach this payload" (the operator escape hatch is closed BY DESIGN), and then warns that *other* prose is stale about `required_linear_history`. A fixer who trusts that docstring concludes the payload is deliberate and leaves it. It is right about linear-history and wrong about the bypass, in the same paragraph. |
| Phase-2 ordering: CPV's payload must land before/with the janitor gate fix | **ACCEPTED as a constraint, recorded** | With the janitor's gate unable to reach a converged repo, CPV's script is the only tool in the fleet that CAN move these rulesets. Fixing the janitor first, while CPV still writes `[]`, hands the fleet a working writer aimed at the wrong shape. |

### ai-maestro-plugin (CORE) — 6 confirmed, and one is the same error the architect made

| Finding | Hub verdict | Note |
|---|---|---|
| `publish.py:2216` retry defeat | **CONFIRMED end-to-end** | see the fleet section below — it is not CORE's bug, it is the template's |
| 3 GitHub rulesets vs "ratified baseline is 2" ⇒ Tier-2 deviation | **REFUTED — it is COMPLIANCE** | The ratified set is a **TRIO**; `baseline-tag-protect` is its third member (`rules/aimaestro/aimaestro-manager-approval-defaults.md:152`, `design/specs/baseline-github-rulesets-spec.md:62`, `tests/governance/baseline-spec-ratchet.test.ts:20`). CORE's own grep returning 0 is TRUE and is about CORE's repo, which does not carry the fleet spec. **Two sessions reached this same wrong conclusion independently today** — that is not two careless workers, it is a DISTRIBUTION defect: the ratified trio is documented in `ai-maestro` and reachable from no plugin repo. Worth its own card. |
| `exempt-operations.md:133-135` carries `bypass_actors: []` AND `required_linear_history` | **CONFIRMED class** | Both abolished (2026-08-08 and 2026-08-13 USER rulings). CORE's classification is the right one: it is DOCUMENTATION, nothing machine-reads it — but it is a skill reference an AGENT loads to decide EXEMPT vs NON-EXEMPT, so it misleads an agent, not a human. Sixth known stale carrier of that abolished pair. |
| `publish.py:814` `--install-hook` discards `check=False` result, prints success unconditionally | **plausible, hub has not re-derived** | A failed write leaves pushes unguarded, silently. Same family as the retry defect: the process ran, the control did not. |
| `plugin.json` advertises "code graph"/"docs search"; 30 skill dirs, 0 match | not re-derived | pre-install marketplace listing |
| `TRDD-…LLSSTD3P:3` `column: complete` with an open EHT | not re-derived | TRDD rule 9 |

CORE's refusal to accept a hub-relayed USER delegation for its two parked `human_review` cards is
**CORRECT and endorsed**. A file the hub authored quoting the USER is still the hub's report of what
the USER said. It waits for its own USER confirmation; nothing else is blocked on it.

### ai-maestro-assistant-role-agent — Phase 1 complete, 4 confirmed

`publish.py:1950` retry defeat (fleet, below) · `publish.py:578,641` doubled backslash printing a
literal `\n` where siblings use `\n` · the CPV pin-comment drift already verified above. Their axis-3
recount from 7 to **0** (all seven were compliance PASSES) is accepted. Their axis-4 worker had
written a COMPLETE report at 17:12 and then hung for 1h38m while `running` — the file was finished
and the process was not. **Promoted to contract: check the FILE, never the process state.**

### FLEET-WIDE — the retry budget is defeated on the release push, in 12 repos

**Found independently by two sessions in their own copies (`ai-maestro-plugin` `publish.py:2216`,
`ai-maestro-assistant-role-agent` `publish.py:1950`). Hub verified the chain end-to-end in CORE and
then swept the fleet — it is a defect of the CANONICAL `publish.py` TEMPLATE, not a per-repo slip.**

Chain (verified in CORE, read-only):
`publish.py:2216` `git_with_retry([… push --atomic …], capture_output=False)` → `subprocess.run`
gets `capture_output=False` (`cpv_network_resilience.py:215`) so `result.stderr is None` → `:242`
`stderr = result.stderr or ""` → `""` → `:116-117` `if not stderr: return False` classifies EVERY
failure PERMANENT → `:243-244` `break  # permanent failure — don't waste retries`. The documented
retry budget never runs, and the failure is byte-identical to a genuine permanent one. That call is
the atomic push that makes a release public. `2216` is the ONLY `capture_output=False` in CORE's
`publish.py`; the other 26 sites are all `=True`, which is what makes it a slip and not a design.

Fleet population (`find ~/Code -maxdepth 4 -path '*/scripts/publish.py'`): **22 copies · 12 carry
`capture_output=False` · 14 sites total · 13 of the 14 are `git_with_retry` on a push, 12 of those
on `--atomic`.** Affected: ai-maestro-plugin, ai-maestro-janitor, claude-plugins-validation,
ai-maestro-maintainer-agent, ai-maestro-integrator-agent, ai-maestro-orchestrator-agent,
ai-maestro-assistant-role-agent, ai-maestro-web-scenario-tester, claude-voice-loop,
claude-menu-system, AI-MAESTRO-WEBDESIGN-AGENT, visual-comunicator (×3 — one site at `:1016` is
NOT a `*_with_retry` call and is unclassified). Clean or no resilience module: the other 10.

**Instrument note, because it nearly produced the wrong number:** the first sweep ran at
`-maxdepth 3` and found **7** copies with a plausible-looking control. Repos nest at
`~/Code/<UPPER>/<name>`, so depth 3 missed every nested one — the true population is 22. Same trap
as the `$TMPDIR` depth-4 case in the lessons file.

**Scope of the hub's claim, stated so nobody over-reads it:** the CHAIN is verified end-to-end only
in CORE. For the other 11 repos the hub verified the SHAPE (a `git_with_retry` push with
`capture_output=False`, alongside a `cpv_network_resilience.py` carrying the `if not stderr` guard).
Each owning session re-derives its own before it becomes a card.

### FLEET-WIDE #2 — the release tool cannot satisfy its project's own GOLDEN rule, in 21 of 22 repos

Raised by ai-maestro-assistant-role-agent as A2-C2 and swept by the hub. `publish.py:1916` runs
`run(["git", "commit", "-m", expected_subject], cwd=root)` — subject only. PRRD **G1.1** (that repo's
`design/requirements/PRRD.md`) says commit messages **MUST** carry an `Agent: <plugin-slug>`
trailer. GOLDEN means user-set and immutable to MANAGER — so the release tool structurally cannot
comply, and their measurement shows exactly that signature: **28 of 40 recent commits carry the
trailer, and the 12 that do not are dominated by `chore: bump version to X`** — the tool's own
commits, not hand-written ones. Not discipline drift; a tool that cannot obey.

Hub sweep over the same 22 copies: **21 emit ZERO `Agent:` trailer. Exactly one implements it** —
`ai-maestro-chief-of-staff/scripts/publish.py:208`, via
`git interpret-trailers --trailer "Agent: ai-maestro-chief-of-staff"`. **That is the reference
implementation to port**, with the wrinkle the assistant-role session already identified: COS
hardcodes its slug, and canon cannot — it must derive it, and it already computes exactly that
value for the dependency tag (`_plugin_name(root)`).

Two template-wide findings now, both invisible from inside any single repo, both found by a session
that had correctly verified its own copy end-to-end and stopped at its own tree boundary. **That
boundary is the hub's job, and it is the argument for the sweep being routine rather than clever.**

### The distribution defect, restated by CORE better than the hub had it

CORE's own words, kept because they name a failure mode no control catches: *"a grep returning 0 in
a repo that does not own the document is not evidence about the document. The needle was fine, the
repo was simply the wrong haystack."* Both sessions kept their measurement (`grep tag-protect` → 0,
true) and changed the CLAIM from "this repo deviates" to "the ratified set is not discoverable from
this repo". Two sessions reaching it independently within an hour is the evidence that the
distribution gap is real.

### Sequencing consequence flagged by CORE

CORE has an unpushed docs commit that can only reach the remote through `publish.py`. **Every
release cut before the canonical-pipeline card lands runs its final atomic push with zero retries.**
That is the cost of the wait, stated so whoever sequences Phase 2 can weigh it.

### Cross-finding worth keeping (raised by the architect, endorsed)

A single-axis worker can "CONFIRM" against a premise another axis has already destroyed: axis 1
justified keeping a finding by reasoning that "`cross_platform.py` IS imported by 8+ scripts, so
the import mechanism clearly works" — axis 3 had already proven those exact imports all crash. The
conclusion survived on other evidence; the reasoning did not. **Cross-check premises across axes
before a finding enters the plan.**

## Approval log

- 2026-08-16T16:53:19+0200 — MANDATE issued by the USER (min-approval-requirement: none).
  Pre-approved: the issuer is the USER, above every agent rung. No approval request was sent.
