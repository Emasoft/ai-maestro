---
trdd-id: BRRJK57P
title: USER fleet program — every plugin self-audits twice, remediates via TRDDs, and is proven by new scenario tests
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T16:53:19+0200
updated: 2026-08-16T20:31:14+0200
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

**14 sessions reported as of 20:14** — architect, assistant-role, CORE, maintainer, orchestrator,
PSS, programmer, llm-externalizer, **visual-comunicator, webdesign, CPV, integrator, autonomous,
assistant-manager**. Phase-1 COMPLETE on all axes: architect, assistant-role, visual-comunicator,
webdesign, CPV, integrator, autonomous, assistant-manager. **Every CONFIRMED finding is
hub-verified** — see the ledger. Outstanding: janitor, chief-of-staff, plugin-94, and any session
not listed. Phase-2 dispatch stays BLOCKED on the USER (relayed authority was correctly refused by
three sessions; the hold is endorsed, and every reporting session has independently confirmed it
has queued no remediation).

**The hub's own Phase 1 is now underway too** (nobody had audited the hub): axis 3 done — the
installed CLI family is `38 identical / 0 stale / 21 no-counterpart`, of which **8 are executables
on PATH that no repo in the fleet ships**, still named in md instructions. Axis 2 found **167 of
249 archived cards at a column `3P-ZON-05` does not admit, with zero tool references to that MUST**.

**The evening's largest finding is not in any plugin.** Four sessions independently re-derived the
same worker-liveness rule at ~6 worker-hours, while `ATOM-DXFF-KOY4` already carried half of it in
USER memory and recall fired for none of them. **That is a defect in RECALL, not in knowledge** —
and this programme's own contract is spread across a TRDD ledger that no `memgrep recall` will ever
surface. Phase-2 candidate, and it is about the fleet's memory rather than its code.

**TWO TEMPLATE-WIDE DEFECTS have surfaced, and both were invisible from inside any single repo** —
each was found by a session that had verified its own copy correctly and stopped at its own tree
boundary. Crossing that boundary is the one thing the hub can do that no session can, so the
22-copy sweep is now ROUTINE for any finding in a file the fleet shares:
(1) the `--atomic` release push cannot retry — 12 of 22 `publish.py`;
(2) 21 of 22 release tools cannot emit the `Agent:` trailer their own GOLDEN PRRD rule mandates.
**Each is ONE canonical-pipeline card, never twelve or twenty-one.**

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
  search against something you KNOW is present — and **pick the control BEFORE the run, then reject
  the run on the CONTROL, never on the plausibility of the result** (architect: three false zeros
  in one night, every one plausible at the moment it was produced).
- **A POSITIVE CONTROL IS NOT ENOUGH WHEN YOU ARE PROPOSING A MECHANISM. Run an input that SHOULD
  FAIL.** Two parties independently built a syntax rule for GitHub `@mention` rendering out of
  positive examples only; one nonsense string that should have paged and did not (`gh api /markdown`
  resolves against REAL ACCOUNTS — it is an existence lookup, not syntax) falsified BOTH at once.
  Positive examples confirm any mechanism consistent with them, including the wrong one.
- `grep -r --include=<glob>` does not filter on every toolchain — verify the filter before
  believing a count built on it.
- `ps %cpu` on macOS is **a decaying average over UP TO A MINUTE of previous real time** (`man ps`),
  NOT a live sample and **NOT a lifetime average**. A burst that ended minutes ago still reads high;
  a `top -l 2` delta samples ~1 s, so 146% and 39.6% can both be true of one bursty process.
  **CORRECTED 2026-08-16 — this line previously said "a LIFETIME average", which is the fabricated
  mechanism this very card's ledger documents. It sat in the contract every session reads, three
  paragraphs above the section explaining that the same false claim reached a shipped alarm, a
  passing test and three releases.** Nobody consulted `man ps` before building on it, for hours,
  including the author of the correction.
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

### CONTRACT CORRECTION — the write-early rule CANNOT be delivered mid-flight (orchestrator)

**The hub was propagating advice that cannot work against the failure it addresses, and told three
sessions to apply it that way.** A queued cross-session message is delivered at the receiving
worker's next TOOL ROUND. **A stalled worker takes no tool rounds.** So "relay the write-early
instruction to your still-running worker" is structurally impossible precisely when the worker is
stalled — the only case that matters. It appeared to work once (assistant-role) solely because that
worker had already written its file and was hung AFTER finishing.

**Corrected contract: the write-early rule is a PRE-SPAWN BRIEF item, never a mid-flight relay.**
And the diagnostic that does work mid-flight is the one the assistant-role session named: read the
FILE, never the process state. The orchestrator's own recovery is the pattern — kill the stalled
worker, and its DYING LINE carries the lead it had been working on; put that lead in the
replacement's brief as *"verify, do not trust"*. Its replacement finished in ~6 minutes, which
proves the 55 minutes of silence was pure stall and not slow work.

### ai-maestro-orchestrator-agent — 10 confirmed; 3 axis-3 citations hub-verified

| Finding | Hub verdict |
|---|---|
| C1 duplicate basename `amoa_register_agent.py` | **CONFIRMED** — `./scripts/` and `./skills/amoa-remote-agent-coordinator/scripts/`, skill-local copy invoked by nothing executable |
| C2 `scripts/gitignore_filter.py` orphan | **CONFIRMED with control** — 200 lines, 0 referencing files; control `amoa_stop_check` = 20 files, so the instrument demonstrably sees references |
| C5 `hooks/hooks.json:12` wires `python3 -m amoa_stop_check.main` while `scripts/amoa_orchestrator_stop_check.py` still exists | **CONFIRMED** — docs point at a dead entry point |

Their C2 method is the one to copy fleet-wide: **an orphan finding IS a zero**, so it was refused
until the same grep was first pointed at a known-wired symbol. Without that step the claim rests on
an instrument never proven able to see anything.

### Three contract upgrades, each supplied by a session and each replacing a weaker hub rule

1. **CONTROL BEFORE RUN (architect).** Replaces the hub's "a zero is not a result without a positive
   control", which left open WHEN the control is chosen — and that turns out to be the whole thing.
   Corrected: **pick the control BEFORE running the search, from something you already know exists,
   and reject the run on the CONTROL, never on the plausibility of the result.** Their evidence is
   three-for-three: every false zero they produced tonight *looked correct at the moment it was
   produced*, and none would have been caught by staring harder at the zero. (Depth-4 vs depth-5
   nesting → 0 parsed; then an off-by-one from `PurePath` stripping `./` → 0 parsed again.)

2. **PATTERN SWEEP, NOT FILE SWEEP (orchestrator).** The hub offered to sweep their two findings
   across the 22 `publish.py` copies; they measured and declined, with a control (`find` over the
   same roots returns 72 `publish.py`, so the instrument reaches other trees — their "one hit, mine"
   is real). Their point generalises the hub's own name-list lesson one level up: **the hazard is
   not the FILE, it is the SHAPE OF THE PREDICATE**, and that class travels by each plugin
   independently writing its own guard. Three shapes worth sweeping fleet-wide:
   - a guard whose regex demands a specific character class right after a sigil — theirs required
     alphanumeric after `@`, so **`@{{PLACEHOLDER}}` sails through, and a placeholder is exactly
     what a template contains**;
   - a guard that SKIPS fenced blocks by infostring where the skipped fence BUILDS a payload that is
     later posted or executed (theirs skipped ```bash while that block assembled a `--body` arg);
   - a dedup/idempotence check using substring containment where identity is meant (`if x in line`)
     — breaks on numeric-suffix collisions, e.g. issue `#5` matching `#50`.

3. **AFTER FOLDING A CORRECTION INTO AN EXISTING MEMORY PAGE, RUN `memgrep recall` WITH THE NEW
   SYMPTOM PHRASING AND CONFIRM THE PAGE COMES BACK (assistant-role).** The hub was about to write
   a contract item saying *"extend the page's `description:`, because recall ignores the body"* —
   and that rule **already exists, verbatim, in `~/.claude/rules/markdown-memory-recall.md`, loaded
   in every session.** Their correction is the useful one: this is an **ENFORCEMENT gap, not a
   documentation gap**, and duplicating a rule the fleet already carries makes compliance WORSE,
   because the copy drifts and then two rules disagree. What actually caught it was `memgrep
   add-lesson` warning at write time that a keyword shared no word with the description — the tool
   already enforces; the warning is just easy to scroll past (it printed, the lesson was written,
   the exit was success). So the contract item is a CHECK that fails loudly when skipped, not a
   restatement. Their own note is the sharp end: they followed the tool's warning, not the rule
   from memory, and without it would have written an unfindable correction believing the job done.

### The hub's own error tonight — a fix that RESTATES the bug, and two false refutations of it

The `ps %cpu` mechanism the hub fabricated earlier reached the janitor's shipped code. A session
reported the correction was not live. **Their conclusion was right, their needle was too specific,
and both of the hub's instruments were worse.** What is actually in the installed 3.3.11:

- `scripts/lib/daemon_runaway.py:209` — `window = "a lifetime average, not a live sample"`.
  **Untouched.** This is the string the alarm EMITS, so every session on this host is still handed
  the retracted mechanism.
- `:148` — the docstring WAS edited, to *"a decaying average over the process's LIFETIME"*. The word
  "decaying" was added and **the error was preserved**: per `man ps` it is a decaying average over
  *up to a minute*, not over the lifetime. **A fix that restates the bug in truer-sounding words.**
- `tests/test_system_daemon_runaway.py` asserts the retracted string — **3 hits in 3.3.10 AND 3
  hits in 3.3.11, the CURRENT installed version** (hub first wrote "3.3.10" and the reporting
  session corrected it upward). So the wrong mechanism is held in place by **tests that pass
  today**, not by a stale copy: the next person to correct it breaks a test and looks wrong.
  A confidently-worded wrong line plus a green test is how a false statement acquires tenure —
  an obviously-wrong line invites correction, and "decaying" made this one harder to challenge
  without making it truer.

Hub instrument failures on that one question, both plausible: `grep scripts/*.py` does not descend
into `scripts/lib/` (returned 0 — a false "the retracted text is gone"), then a correct recursive
grep piped through `head -10`, which truncated before line 209. **Fixed-in-repo is not
fixed-on-disk — and the installed copy can carry an edit that LOOKS like the fix and is not it.** So
the check is never "did the edit ship" but "does the shipped text state the correct mechanism".

### ai-maestro-maintainer-agent — Phase 1 COMPLETE, and two reusable measurements

12 candidates → 6 CONFIRMED / 3 REFUTED / 3 DOWNGRADED, plus one defect found by MEASUREMENT
rather than by any candidate, and 3 items carried as NOT VERIFIED — including the one the hub
flagged as the more interesting (whether any live repo was written into the locked shape by THEIR
plugin rather than the janitor's applier). Still unmeasured, and correctly not recorded as absent.

**1. The `@handle` mention question is an EXISTENCE LOOKUP, not a syntax rule — and BOTH parties
proposed a syntax mechanism before anyone ran a negative control.**

The decisive test is one string: a syntactically valid handle that certainly does not exist.

```
@zzzznotarealaccount99991 -> none        @foo-bar -> MENTION      @a-b -> MENTION
@v2   -> MENTION   @v2.  -> MENTION      @v2.1 -> none   @v2.152.1 -> none
@v2.abc -> none    @v2-abc -> none       @janitor. -> MENTION     @janitor.abc -> none
```

`gh api /markdown` resolves the candidate token against **real accounts** and emits
`user-mention` only when one exists. That explains every row at once — `v2`, `janitor`, `foo-bar`,
`a-b` are real; `v2.abc`, `v2-abc`, `a.b` and the nonsense string are not. It also shows the dot
does not SPLIT the token: `@janitor.abc` renders inert, where a splitting parser would have
mentioned the real `@janitor`.

**Two mechanisms died here, one per party.** The maintainer's *"only a dot followed by a DIGIT
kills it"* is falsified by `@v2.abc` (dot + letter → none) and by `@v2-abc` (no dot at all → none).
The hub's *"the dot is doing the work, not the v"* — which the hub had handed them as the lead
sentence — is falsified by the same rows: the dot was never doing the work, it was turning the
token into one nobody has registered. **Both mechanisms were built from a handful of POSITIVE
examples.** Neither party ran a string that should fail, which is the whole content of
control-before-run arriving one layer up from where it was written.

**The durable rule is a PROCEDURE, not a generalisation, and it has a shelf life:** render the
EXACT string through `gh api -X POST /markdown -f mode=gfm` before publishing it, and treat the
verdict as true only for today — **a string that is inert now starts paging the moment someone
registers that name.** Weaker than either proposed mechanism, and the only one that stays true.

What survives, all measured: backticks make any form inert; a mention-audit flagging `@v2.152.1`
or a linked credit produces FALSE POSITIVES; and a bare `@v2` really does page.

Raw measurements, for the record:

| rendered form | mention? |
|---|---|
| `@v2` | **YES — pages a real account** |
| `@v2.152.1` | no — a dotted version tag is INERT |
| `actions/checkout@v4` | no |
| `@janitor` · `@janitor.` | **YES** (trailing dot does not protect) |
| `[@janitor](https://example.com)` | no — an `@handle` as markdown LINK TEXT is INERT |

Their two claims CONFIRMED, and both are genuine ADDITIONS to `~/.claude/rules/github-mentions.md`,
which currently says nothing about either. **Consequence for the fleet: any mention-audit flagging
version tags or linked credit lines is producing FALSE POSITIVES** — and the trap runs the other
way too, since bare `@v2` DOES page. The hub has not edited that rule: it is a machine-global file
outside any repo, so the refinement is surfaced to the USER rather than applied.

**2. The write-early rule needs its CONTENT clause, not just its timing clause.** Their first four
falsification workers ran **1h45m and produced ZERO files**; they recovered the prompts verbatim
before stopping them, re-dispatched, and the replacements finished in **2-3 minutes each**. The one
instruction the originals lacked: *"write your output file even if incomplete, marking unfinished
items NOT VERIFIED."* **A stall that produces no artifact is the only outcome that teaches
nothing** — so the contract clause is not "write early" but "write early, incomplete, and mark the
gaps", which also makes the artifact self-describing when it IS truncated by a stall.

Third independent confirmation of the stall pattern tonight (CORE 65 min / 0 files, orchestrator
55 min / 0 files, maintainer 4 workers / 1h45m / 0 files), and the third where the replacement
finished in minutes — which is what establishes the silence as stall rather than slow work.

### perfect-skill-suggester — 10 confirmed; the best finding is a GREEN TEST ON A DEAD PATH

Hub re-derived the headline finding and its coverage claim first-hand.

**AX4-1 CONFIRMED, `rust/negation-detector/src/pattern_detector.rs:494`:**
`let effective_end = if is_avoidance { sentence.tokens.len() - 1 } else { scope_end };` — the
`find_clause_boundary()` result computed one line above is DISCARDED for avoidance verbs, so the
negation scope runs to end-of-sentence. Their runtime demo: *"avoid react, use vue for the
frontend"* → **`'avoid' negates: [vue, frontend]`** — react, the rejected term, is NOT negated, and
vue, the WANTED one, IS. End-to-end that suggests `react-performance-optimization` at HIGH 0.98 and
no Vue agent. Their control (*"I do not want to use React…"*) is correct, which is what makes it a
scope bug rather than a broken detector.

**And the part that makes it a lesson rather than a bug report — CONFIRMED, and it is amendment 3
one layer deeper, INSIDE a test suite.** The Phase-1 regex at `:104` is
`\b(avoid|skip|exclude|omit|ignore)\b[^.!?]*\blike\s+(.+?)…` — it requires the literal **`like`**,
and it INTERCEPTS before rule 3 ever executes. Every test of the avoidance path uses the
`avoid X like Y` construction. So `test_avoidance_like_pattern` **sits green while exercising a
different code path**, and the rule that misfires on `avoid X, use Y instead` has ZERO coverage.

Hub verification of that coverage claim, with the instrument widened after the first pass:
an anchored `'"avoid [^"]*"'` grep would only have caught strings STARTING with `avoid `. Widened
to any quoted string containing an avoidance verb: **12 unique, 6 contain `like` (the test
sentences), the other 6 are bare verb literals** (`"avoid"`, `"skip"`, … — the `AVOIDANCE_VERBS`
constant and a marker assertion, not sentences). **No test sentence exercises the non-`like`
construction.** Claim holds.

**A new false-clean shape, theirs, recorded as MEASURED-BY-THEM (hub has not re-derived it):**
`git log -S` run from a repo root **silently returns nothing for SUBMODULE paths** — so for any
repo with submodules, a root-level history search over submodule source is a guaranteed false
clean. Their refuter hit it while tracing intentionality and read "no history" as a fact about the
code. Belongs beside the argv-blind `--help` in the false-clean catalogue.

**Their axis-1 zero is filed NOT-VERIFIED, not clean** — the worker stopped at time budget with the
section uninvestigated. Their `refuted: 0` is a *tried-and-failed* zero, evidenced: the refuter
positive-controlled its own method, attempted to kill a finding and documented the failure, and
**corrected AX4-3's citation** (`load_ownership_columns` → `load_noninvocable_ids` at
`main.rs:4366`) — substance held, citation was wrong, which is precisely what the re-verify step
exists to catch.

**Amendment 2 measured twice in one session:** it SAVED a completed sweep (the worker wrote its
full report to disk and then never returned a result — held in context, the sweep was lost), and
the empty file was the only thing distinguishing a 2-hour stall from work in progress. Relaunched
with the amendments **baked into the brief rather than relayed mid-flight**: *2 hours-and-nothing
became 3 minutes-and-a-verified-bug.* Fourth independent confirmation of the stall pattern.

### A fleet-TOOLING defect, and the answer I expected was ruled out

The maintainer hit `memgrep add-lesson --atom <id>` failing to find an atom `memgrep add-atom` had
just written — across both id forms, after a `reindex`, after relocating it, after normalising its
`desc:`. Hub chased it into the janitor's source instead of reproducing it blind.

**RULED OUT — it is NOT the fixed-in-repo/stale-install pattern**, which had been the answer three
times tonight and was my first hypothesis: `command -v memgrep` → `~/.cargo/bin/memgrep`, mtime
**Aug 16 02:25**, identical to `memgrep/src/memory.rs` in the janitor tree, and `strings` on the
installed binary finds both the anchor error and the keyword-coverage warning. **The running binary
is built from current source.**

**~~MECHANISM~~ — STRUCK. The hub's first account said the refusal was correct downstream of a
PLACEMENT bug (`add-atom` writing below the footer boundary documented at `memory.rs:2257-2266`,
janitor#250). It is FALSIFIED:** the maintainer retried with the atom at line 62, above the first
footer heading at 78 — unambiguously a body atom by that boundary — and `add-lesson` refused
identically. **The hub had read the doc comment of a DIFFERENT function (`add-atom`'s insertion
point) and applied its boundary to `add-lesson`'s lookup. Third induced mechanism of the night,
committed two commits after writing the rule against it into this card's own contract.**

**THE ACTUAL MECHANISM, read from the functions rather than their neighbours' comments:**

- `locate_atom_body_matching` (`memory.rs:3298`) walks the **WHOLE page** from the end of
  frontmatter. **There is no footer boundary in it at all** — a `#` heading merely CLOSES the open
  atom block and scanning continues. So an atom below `## Notes and lessons learned` is perfectly
  findable, which explains the maintainer's inverse-region observation: the working siblings are not
  working *despite* sitting below Notes; the section is irrelevant to this function.
- The real gate is **`first_block_property_marker` (`memory.rs:1512`)**, and it is stricter than the
  prose implies. A line is a marker only if it is **ANCHORED at the first non-whitespace byte**
  (only spaces/tabs may precede `^` — a `-` bullet or any other leading character disqualifies it),
  the `^` is followed by 1+ of `[A-Za-z0-9_-]`, and a bracket-matched `[props]` follows after only
  spaces. The anchoring is deliberate: its comment records that whole-line scanning made every prose
  MENTION of the grammar declare an atom, putting **13 phantom atoms** in the index, four sharing
  one id.

**~~So the question is whether the marker LINE parses at all~~ — ALSO STRUCK, within the hour.**
`cat -A` on the atom's line vs a working sibling's: `^` at the first byte, id in `[A-Za-z0-9-]`,
one space, depth-matched brackets — **byte-identical in shape**, and all four atoms on the page
check out. By all three conditions of `first_block_property_marker` the line IS a marker.

**HUB SCORE ON THIS BUG: 0 for 2, twenty minutes, both explanations read from real source.** That
is the entry worth keeping, and it is now a line in `.claude/rules/lessons-verification.md`:
**reading the code is necessary and NOT sufficient — a mechanism derived from code you read is
still an INDUCTION until a case it FORBIDS is tested.** Reading confirms an explanation on the
examples already in front of you, exactly as positive examples do (same family as the bullet two
sections up, one layer deeper).

**The maintainer's THIRD measurement narrowed it further than either story:** `add-lesson`
SUCCEEDED the same session with the same `ATOM-XXXX-XXXX` id form on a different page, plus two
more against `^name` anchors. **So the verb works and the id form works; the fault is specific to
that atom or that page.** A measurement, not an inference.

**THEIR STOP RULE IS THE FINDING, recorded as theirs:** at two falsified passes, stop inducing and
hand over evidence — *"these two plausible explanations are wrong, here is the reproduction"* is
worth more to the owner than either guess, because it also saves them the two dead ends.

Not filed: the janitor's repo, the maintainer's finding, filing is outward-facing, and neither
party has the owner's say-so.

### ai-maestro-programmer-agent — 8 confirmed; two contributions bigger than the findings

Hub re-derived three citations first-hand: **a1** `README.md:266` says *"Review error logs in
`tests/logs/`"*, `find -type d -name logs` = **0**, and that README line is the ONLY occurrence of
the path tree-wide. **a2-C2** their PRRD defines exactly **8** rules (`G1 G2 S3 S4 S5 S6 S7 S8`) and
three archived cards cite `relevant-rules: [1, 15]` — **rule 15 does not exist**. **a3-C1**
`scripts/pre-push-hook.py:4-11` documents `validate_plugin.py` and a four-way exit contract
including *"3 = MINOR, push allowed"*; **`validate_plugin.py` does not exist**, and `:217-224`
returns 1 for ANY non-zero. All three confirmed.

**1. THEY DOWNGRADED THEIR OWN STRONGEST-SOUNDING RESULT, and the downgrade is the better finding.**
Offered "17 guards reddened / 0 vacuous", they reported instead: *"a neuter proves the predicate
matches what its AUTHOR imagined, never that it covers the SHIPPED SHAPE."* Strictly weaker and
strictly true — and it generalises the rename-blind-detector lesson: a guard keyed on the shape its
author pictured goes green over every shape they did not, and its neuter reddens all the same.

**2. A SECOND-ORDER DEFECT IN THE RESPAWN CLAUSE, found by using it.** The maintainer's clause is
*recover the dying worker's ORIGINAL PROMPT VERBATIM and point the replacement at it* — correct,
because paraphrase silently drops load-bearing adversarial wording (*"default to REFUTED when
uncertain"*). But their axis-2 worker's stored prompt still asserted a premise **the hub's own
archive ruling created and both parties later retracted**. A verbatim respawn would have handed a
fresh worker a KNOWN-FALSE premise and invited it to certify the wrong archival as compliant.

**Both clauses are right and they collide, so the resolution has to be stated:** respawn VERBATIM,
then **re-read the recovered prompt against everything retracted since it was written**. Verbatim
protects the adversarial wording; the re-read protects against a stored premise that has since
died. The blast radius here is the hub's: a wrong ruling of mine from earlier today was still
sitting in a third party's worker prompt hours later, ready to be re-issued as fact.

**Amendment 4 also cut both ways for them, which is the sign it is working:** axis 2 UPGRADED a
prior NOT-VERIFIED to complies (finding `publish.py:606` invoking the exact gate) instead of letting
the unknown decay into a pass — and their own first positive control was WRONG (grepped `publish`
against a file containing `push`), so they re-controlled before crediting it. *A coordinator's
convenient zero is no better than a worker's.*

### THE HUB NEVER AUDITED ITSELF — and doing so found 167 violations of an unenforced MUST

**A gap in the hub's own programme:** every plugin session was told to audit its own repo; nobody
was assigned `ai-maestro`. Found only by running the sweep my own lesson prescribes (*"when you find
one stale copy of a rule, sweep for the others"*) after the maintainer reported auditing their own
stored prompts and finding them clean.

**Measured in THIS repo, and the zero is positive-controlled:**

| fact | measurement |
|---|---|
| archived cards total | **249** |
| `column: complete` (NOT in the eligible set) | **167** |
| `completed` / `cancelled` / `superseded` | 74 / 5 / 3 |
| tool references to `3P-ZON-05` | **0** |
| control — tool references to sibling `3P-ZON-11` | **8** (and `3P-AAA-01` ×10, `3P-TRDD-10` ×8) |

`3P-ZON-05` is a **`MUST`**: *"only `completed | cancelled | superseded | published | live` may
enter `archived/`"*. **67% of the archive violates it, and no tool checks it** — the instrument
demonstrably resolves clause ids, so that 0 is real. `trddgrep validate` reports its usual single
unrelated ERROR, because this clause was never wired.

**Same defect the programmer-agent reported as their a2-C1 (4 cards that "never got the Archival
protocol's complete→completed edit") — at 167.** So it is a third fleet-wide pattern, and the
largest instance is the hub's own board.

**NOT REPAIRED, and the restraint is the point.** Archived cards are FROZEN (IND base step 12);
the repair is a per-card judgement; and **the last time I made a confident mass-archive ruling
without evidence I mis-archived 8 cards** — a scripted sweep here would be that error at 167×.
This is recorded as a finding for Phase 2, in the owning repo, which happens to be this one.

**Two derived observations worth their own cards when Phase 2 opens:** (1) the hub repo needs a
Phase-1 audit like every other member of the fleet; (2) a spec clause with a `MUST` and no
enforcing tool is the *"unenforced rule produces a success, not an error"* shape the wiki already
documents — worth a sweep of ALL `MUST` clauses for tool references, not just this one.

**(2) SWEPT — 66 of 80 spec clauses carry NO clause-id reference in code or tests; 27 of those are
`MUST`.** `3P-ZON-05` is one of the 27, and it is the one with 167 live violations under a clean
validator, so for at least that member "no reference" really does mean unenforced.

**Stated at the strength the instrument supports:** the measurement is *no clause-id reference*,
which is WEAKER than *unenforced* — a rule can be enforced by code that never cites its id. It
matters here because this repo's enforcement-map/ratchet convention is built on those citations, so
an uncited clause is invisible to the very map that is supposed to prove coverage.

**And the arithmetic did not close, which caught a false positive before it became a finding:** 80
declared − 22 referenced ≠ 66, because only **14** of the 22 referenced ids are declared anywhere in
the specs. The 8 extras looked like code citing nonexistent clauses — a good finding, and wrong:
they are `3P-AAA-01/02/99`, `3P-BBB-01`, `3P-KAN-98/99`, `3P-XXX-01` (plus `3P-XXX-` from my own
regex over-matching), i.e. **TEST FIXTURES for the clause-parsing machinery.** The naming was the
tell. Reading what the hits ARE, before reporting the count, is what stopped it.

### The `%cpu` correction over-rotating — SUSTAINED is not ILLEGITIMATE

The fabricated lifetime-average mechanism caused two runaway alarms to be dismissed. Both have now
been re-measured, and the tally that came back to the hub — *"two flagged processes look real, which
supports your read that the defect was in the REVIEW rather than the detector"* — **is the hub's own
read returning as consensus, from a holder who learned it from the hub.** It needs splitting:

- **pid 3459** — measured by llm-externalizer as a video encoder under a live 46-min remote-desktop
  session, memory flat. **Sustained AND legitimate.** The alarm was right that it was sustained and
  wrong to imply pathology.
- **agentlenspro's pid 26449** — hub sampled it directly by pid (no pattern, so no self-match
  possible): `ELAPSED 01:55:14 · TIME 102:43.94 · %CPU 123.9` → lifetime **89.2%**, matching their
  88.9%, with the ~1-minute figure ABOVE the lifetime average (busier than its own history, not
  decaying off a burst). Their three methods plus this fourth agree: **~0.9-1.6 cores sustained.**
  And theirs is the stronger case for a different reason — **the CPU is unexplained by the
  throughput** (~1 event/sec burning ~1.5 cores). *That gap* is the finding, not the CPU number.

**Honest tally: two dismissals that were under-evidenced (they rested on a mechanism the hub
invented), one process legitimate on its own merits, one real open question in its owner's
product.** It does NOT convert every dismissed alarm into a runaway — that would be the mirror
error, one day after the first.

Worth recording that the owner of 26449 had **publicly excused their own process** on uptime/PPID/RSS
while never evidencing the CPU half, then went back and measured it once the story it leaned on
died. They declined to fix it on the same pass: *"it needs a profile, not a hypothesis"* — with two
plausible suspects that two samples cannot separate, which is precisely where the hub went wrong
twice tonight on someone else's bug.

### RESOLVED — the instrument the whole `%cpu` argument was missing (llm-externalizer)

**Difference two CUMULATIVE snapshots.** `ps -o time=,etime=` read twice and subtracted gives a rate
over an interval YOU chose and can state. That is the one measurement with no window to argue about,
and it is why the evening's disagreements were never really about the numbers: `%cpu` is a decaying
average over an unstated horizon, `top -l 2` is a ~1 s delta, lifetime `TIME/ELAPSED` is an average
over a horizon that keeps growing. **Each party was quoting a different window at the same process.**

Applied to the disputed pid, three independent intervals — hub's two samples are its own, not a
recomputation of theirs:

| interval | rate |
|---|---|
| peer, over 61 min | **121.5%** of a core |
| hub, over 399 s (both samples mine) | **142.9%** |
| cross: hub's t0 → peer's t1 | **147.2%** |

Cumulative average rose **89.2% → 92.1% in under 7 minutes** — only possible if the instantaneous
rate is far above the average, so **the rise is itself the corroboration** and needs no second
instrument.

**THE DETECTOR IMPROVEMENT IS THE VALUABLE HALF, recorded here with the reporter's name on it and
NOT filed by either of us (the janitor's repo, its owner's call): the detector fires every 600 s, so
it is ALREADY taking the two samples it needs and discarding the earlier one.** Retain the previous
`(time, etime)` per pid and difference. No new data source, no dependency, no config.

**WHY IT SETTLES, in the reporter's words — a better argument than five agreeing numbers:** the
series now runs to **five intervals, three samplers, windows from 20 s to 61 min** (121.5 / 142.9 /
147.2 / 110.7 / 105.0), all above a core. **"Agreement across three orders of magnitude of window
length settles it, because a windowing artifact IS the window."** And they declined the credit
correctly: differencing two counters is the ordinary way to measure a rate — *"it looked like an
insight only because four of us spent an evening reasoning about averages instead of measuring
one."* **So the durable lesson is not the formula: when several instruments disagree, the question
is almost always "over what window", and the fix is to pick a quantity whose window you CONTROL.**

**Both caveats stand, and they pull in opposite directions — keep both:** sustained-and-rising is
NOT illegitimate (a dev server under real load looks exactly like this; what earns a human glance is
that *nobody appears to be driving it* — a fact about CONTEXT, never about the CPU number). And the
reporter had dismissed this same process TWICE today, so **that dismissal was wrong on the MERITS,
not merely wrongly reasoned** — a tally assembled with the wrong instrument cannot be adjusted, only
discarded and re-measured.

### Cross-finding worth keeping (raised by the architect, endorsed)

A single-axis worker can "CONFIRM" against a premise another axis has already destroyed: axis 1
justified keeping a finding by reasoning that "`cross_platform.py` IS imported by 8+ scripts, so
the import mechanism clearly works" — axis 3 had already proven those exact imports all crash. The
conclusion survived on other evidence; the reasoning did not. **Cross-check premises across axes
before a finding enters the plan.**

### The hub's axis 3 — the instrument I quoted all session is measuring THIS tree

The contract makes every session prove its own tooling before quoting it: *"does the INSTALLED copy
on PATH match the repo copy (`cmp`, not `grep`); are its flags real; does an unknown flag fail
loudly rather than exit 0?"* I had been quoting `trddgrep validate` in the ledger for hours without
running that check on myself. It passes, on all three:

| check | result |
|---|---|
| `command -v trddgrep` | `~/.local/bin/trddgrep` — a 105-line bash launcher, not the mjs |
| the launcher's recorded root (`${XDG_DATA_HOME:-$HOME/.local/share}/aimaestro/install-root`) | `/Users/emanuelesabetta/ai-maestro` — **this repo** |
| `cmp` launcher target vs `scripts/trddgrep.mjs` | **IDENTICAL** (mtimes also equal, `Aug 16 17:47`) |
| unknown flag `--help` | `exit=2`, `trddgrep: could not run — unknown option --help — see \`trddgrep help\`` |
| verb dispatch shape | an explicit `switch` allowlist (`lint`/`validate`/`fix`/`env`, `trddgrep.mjs:600-844`) — an unrecognised verb cannot fall through into `fix` |

So the session's `trddgrep validate` results measured the tree they claimed to, and the "fixed in
the repo is not fixed on disk" trap — which cost the fleet a whole finding class tonight — does not
apply to this instrument. **This is a negative result and it is the point of running it**: an
unchecked instrument and a checked-and-correct one produce identical output, so only the check
distinguishes them.

Worth one NIT, not a defect: `--help` is *rejected* rather than accepted, against near-universal CLI
convention (`help` is the real verb). That is the loud failure the contract asks for — exit 2 is
COULD-NOT-RUN, and it names the correct spelling — so it is a usability wart, not a silent one.
Recorded here so nobody "fixes" it into an exit-0 alias later, which would collapse
*unknown-option* into *ran fine*.

### CONTRACT AMENDMENT — a silent worker and a working worker are indistinguishable from outside

Supplied by visual-comunicator with the measurement attached, and it is the missing DETECTION half
of the write-early rule. That rule says how to survive a stalled worker; this says how to notice
one.

**Poll the worker's TRANSCRIPT MTIME. Heartbeat counting cannot tell dead from slow.** Their three
axis workers went silent; judged by notifications they were working. Measured: transcripts frozen
at 17:11-17:12, checked at 19:56 — **2h45m of zero writes**, and the mid-flight "write your file
early" instruction queued at ~17:45 was **never consumed** (independently re-deriving tonight's
correction: a queued relay needs a tool round a stalled worker will never take). Re-dispatched with
the report file created on tool call #1 and a ~30-call budget: **100-170 seconds each.**

Same work, same model, ~60×. **The stall was not task size** — which is the part that matters,
because "it is a big job" is the explanation that makes a dead worker look reasonable for hours.

So the contract now names three things, not two: brief pre-spawn (a relay cannot land later) ·
create the report file on tool call #1 · **poll the transcript mtime, and treat a frozen one as
dead rather than busy.**

### THREE CORRECTIONS TO THE TWO ENTRIES ABOVE — all from the sessions I reported on

**1. My G1 inversion cuts the other way, and my framing invited a false inference.** I wrote that
being the fleet's only version gate raises the severity for visual-comunicator. True, and
incomplete: *"the only guard"* and *"the only guard that fails open"* are one sentence about one
file, so **the fleet's exposure is NOT bounded by their bug.** A fail-open gate and no gate are the
same outcome in the outage case; fixing theirs closes exactly one repo. Anyone reading my sentence
would naturally infer *"amvcp fixed G1 ⇒ the fleet is covered"*, which is false the moment it is
drawn. Their correction, and it is right.

**2. The relay was the SECOND failure, not a casualty of the first.** My amendment said to poll the
mtime; it did not say that queueing an instruction to a suspected-stalled worker is *actively
worse than doing nothing*. It is: it reads as a mitigation, so it converts *"I should check whether
these are alive"* into *"I have handled it."* **The check and the fix must be the same act** — read
the mtime, and if it is stale, kill. There is no message a dead worker will read.

**3. The 60× is NOT a speedup, and I recorded it as one.** The commit message above says *"same
work, same model, roughly sixty times"* — framed as performance. It is not: the first three workers
**never did the work at all**. The rule's value is that it makes dead-vs-busy VISIBLE within one
tool call. Recorded as a speedup, someone eventually "optimises" it away. The commit is immutable;
this supersedes it.

**CPV's live counter-case completes the mechanism.** Their mid-flight addendum, queued ~15 min
after spawn, **WAS consumed** — the worker's report carries a section absent from the original
brief, cites the amendments by name, and adds a `FALSIFIER:` line the brief never asked for; it ran
~30 min and returned normally. So relays are not unreliable: **a queued relay is a LIVENESS TEST —
it lands iff the worker is still taking tool rounds.** That makes an unconsumed relay a second
cheap detector alongside mtime, on a worker you were messaging anyway. Their five ran 3, 8, 10, 17
and 30 minutes, so **slow is not dead** — which is precisely why the test is mtime and never a
duration threshold.

### THE AMENDMENT WAS WRONG AS I BROADCAST IT — four sessions, three failure shapes, one rule

I sent "poll the mtime, treat a frozen one as dead" to seven sessions. **Acting on that as stated
can destroy findings**, and the integrator refuted it with numbers within the hour. Corrected rule
below; the correction went back out to everyone who got the original.

**There are THREE shapes behind one outward signature (quiet + no artifact), and they need
opposite responses:**

| shape | signal | response | measured by |
|---|---|---|---|
| **FROZEN** | mtime flat for hours; size stuck at the stub | **kill** — costs nothing | visual-comunicator (17:11→19:56, 2h45m); assistant-manager (3 workers stuck at **170 bytes**, the stub size) |
| **LIVE-BUT-SILENT** | transcript **GROWING**, still no durable artifact | **do NOT kill** — real work is accumulating | integrator: the two that produced NOTHING had **266 KB / 201 KB**, *more* than either that produced a full report (73 KB / 158 KB) |
| **ABSENT** | transcript file (or its dir) never existed | **kill** — not a slow start | webdesign: dangling symlink, `ListAgents` said `running` for **3h** |

So the discriminator is **MOVEMENT, not quietness.** *"Treat a frozen transcript as dead"* must
never degrade into *"treat a quiet worker as dead"* — on the middle row that is a destructive
default, and the integrator had already paid for it once.

**Two operational caveats, both load-bearing:**
- **Poll BEFORE you decide, never as a post-mortem.** A kill appends a termination record and
  stamps mtime to kill time, so afterwards frozen and busy are indistinguishable. The integrator
  could only separate theirs retroactively by transcript **size**.
- **A stub that never grew settles it.** A worker mid-tool-call has already written its *earlier*
  calls; a transcript still at its ~170-byte stub has taken no tool round at all. The
  assistant-manager had exactly this evidence, hedged it as *"ambiguous — could be one long tool
  call"*, and lost ~45 minutes with three dead workers holding three axes. **Frozen is the verdict,
  not evidence toward one.**

**The strongest form of the write-early rule came from webdesign, and it is not about liveness at
all:** their axis-4 worker wrote its COMPLETE report with counts at 17:11, then froze ~3h without
returning — and they consumed the report this session **without ever needing the worker back**.
**The FILE is the deliverable; the return value is a single point of failure that fails silently.**

**And CPV's live case makes the relay a second detector:** their mid-flight addendum, queued ~15
min post-spawn, WAS consumed (the report carries a section absent from the brief and cites the
amendments by name; that worker ran ~30 min and returned normally). So a queued relay is a
**liveness TEST** — it lands iff the worker is still taking tool rounds — free on a worker you were
messaging anyway. It is still never a *mitigation*: brief-before-spawn is the only channel that is
guaranteed to land, confirmed independently by the integrator (both of theirs unconsumed) and the
assistant-manager (all three unconsumed).

**Duration is not a signal.** CPV's five workers ran 3, 8, 10, 17 and 30 minutes and all returned.
**Slow is not dead** — which is exactly why the test is transcript movement and never a timeout.

**The corpus finding is bigger than the amendment.** The assistant-manager's recall surfaced
`ATOM-DXFF-KOY4`, already in USER memory: *a worker's process state cannot tell working from
finished-and-hung — make it write its report file early and append, then judge by the FILE.*
**Someone had already learned the write-early half, and it reached neither of us.** Four sessions
re-derived it independently in one evening at a cost of ~6 worker-hours. That is a defect in
RECALL, not in knowledge, and it belongs in Phase 2.

### MEASURED for TRDD-YY5ISKCJ — the distinction their fix is blocked on

Their card correctly refuses to implement until someone settles which exit code `git ls-remote
--tags` returns for a remote that EXISTS with ZERO tags, because a naive fail-closed fix would
break every new repo's first-ever publish. Measured here in a scratch bare repo, with a control:

| case | exit | stdout |
|---|---|---|
| A — remote exists, **zero tags** | **0** | empty |
| B — control, same remote **with** `v1.0.0` | 0 | the tag (so the probe discriminates) |
| C — remote **unreachable** (outage analogue) | **128** | `fatal: … Could not read from remote repository` |

**So the fix is small and safe.** `returncode != 0` never fires for a legitimately tagless remote —
the two cases are already distinguishable, and the current code throws that away by collapsing them
into one `None`. The shape: reserve `None` for *read succeeded, zero tags* (→ PASS, first publish
works) and give *read failed* a distinct value G1 treats as **FAIL CLOSED**. First-ever publishes
are unaffected.

**Gap I flagged, and they closed it rather than taking my table on report.** My case C was a *local*
unreachable path, not a network partition; I said so and said I had not run the network case.
visual-comunicator ran it: `https://no-such-host.invalid/x.git` → **exit 128**, `fatal: … Could not
resolve host`. Same code as the local failure, so the transport-failure class is now measured on
both sides of the distinction the fix turns on. Closed on `TRDD-YY5ISKCJ` (commit `8e283ec`) as
*"Blocking question — ANSWERED"*, with case B written up as the positive control — which is what
makes A's empty result a real zero rather than a dead instrument.

They deliberately did **not** bump that card's `updated:`, and said so in the commit body so it
would not read as an oversight. Correct, and a subtle application: the card now KNOWS more but
ASSERTS nothing different — same defect, severity, column — so bumping would have reordered the
whole board on a research note. That is the mechanical-repair rule (bump only what changes what the
card asserts) applied to a case its own wording does not obviously cover.

**Ordering sharpened, from their post-mortem on their own kill.** They polled before killing — but
in their words, *"only because I wanted to justify the kill, not because I understood that killing
first makes the question permanently unanswerable."* **The ordering is load-bearing, and the reason
it is load-bearing is invisible until you have destroyed the evidence once.** Their kill was still
correct under the corrected three-shape rule (frozen 17:11→19:56, zero bytes written — not growing);
had those transcripts been at 266 KB and climbing they would have killed live workers and blamed
the harness for the loss.

### The hub's axis 2 — this repo carries the PRE-RULING baseline on both 2026-08-13 fields

Axis 2 includes conformance to the ratified GitHub baseline. **Name presence is not compliance** —
my own lessons file records a fleet measurement where *"8 of 9 repos still carried the pre-ruling
`bypass_actors: []`"* three days after a USER Tier-3 ruling abolished it, with the applier simply
never re-run. Checked the payloads here, not the names.

**The trio is present, correctly targeted, all `active`** — and two fields are stale:

| ruleset | target | bypass | rules | verdict |
|---|---|---|---|---|
| `baseline-history-protect` | branch | **`[]`** | deletion, non_fast_forward | **STALE** — the 2026-08-13 ruling grants the owner/admin (actor_id 5) bypass; `[]` is *"a lock with no key"* on a solo-owner repo |
| `baseline-pr-and-checks` | branch | `[5]` ✓ | pull_request, required_status_checks, **`approvals=1`** | **STALE** — the same ruling set this to **0** |
| `baseline-tag-protect` | tag | `[]` ✓ | deletion, update | correct |

**`required_linear_history` is absent everywhere** ✓ — the 2026-08-08 ruling did land. So one of the
two rulings propagated here and the other did not, which is precisely the failure shape: a closed
ruling, a merged commit and a green suite are all silent about the deployed surface.

**`approvals=1` is the one that BITES, and it bites this repo now.** GitHub forbids self-approval,
so on a solo-owner repo a PR can never reach 1 approval and **branches pile up unmergeable** — which
is the reason the USER set it to 0. There are ~74 unpushed commits on `governance-rules` that will
eventually want a PR.

**Instrument note, because my first query silently lied.** A single `gh api … --jq` with a
conditional printed **1 of 3** rulesets — the conditional failed on the two with no `pull_request`
rule and swallowed their whole rows. A partial result that looks like a complete one. Split the
queries so a missing key cannot eat a record; the corrected run is the table above.

**NOT applied, and the reason is not only the Phase-1 freeze.** Re-applying the baseline as-is is
Tier-0 EXEMPT, so the freeze alone would not stop it — but **the machine-global IND rule still
states the PRE-ruling shape**, so an agent "restoring the ratified baseline" from that prose would
*re-impose* the lock it is meant to remove. The payload must be built from the code SSOT
(`branch_protection_lib.baseline_ruleset_payloads`), never from the prose I just read. Recorded, not
executed.

**Phase-2 candidate, not run:** whether the other 21 fleet repos carry the same two stale fields.
It is a cross-tree measurement only the hub can take (~66 API calls), and one stale prose source
feeding every applier is exactly how a fleet drifts together.

### The hub's axis 1 — every promise in CLAUDE.md resolves, and the two that RUN report findings

Axis 1 is *capability the docs PROMISE but that is absent or non-functional*. This repo's CLAUDE.md
is loaded into every session on this machine, so a promise it makes is a promise made ~19 times an
hour. Checked existence first, then execution — because presence is not function and only the
second half can find a non-functional promise.

**Existence: clean.** All 9 named `package.json` scripts resolve (`trdd:doctor`/`:fix`/`:board`,
`pillars:lint`, `test`, `build`, `dev`, `start`, `headless`); all 6 named files exist
(`wikimem-index.mjs`, `bump-version.sh`, `with-node.sh`, `ecosystem-config.sh`,
`ecosystem-constants.ts`, `server.mjs`); `memgrep` is on PATH.

**Execution: all three run, and two report findings — exit 1 = FINDINGS, not could-not-run**, which
is the trichotomy CLAUDE.md documents and the reason it forbids `trddgrep validate || …`:

- `node scripts/wikimem-index.mjs --check` → **exit 1, 5 pages missing `metadata.topic:`** —
  `janitor-chore-absorbability`, `model-scoped-window-fallback`, `public-repo-personal-data`,
  `settings-file-watcher-ledger`, `trdd-d4-watchdog`.
  **This is tonight's recall theme again, in my own repo.** The topic index in CLAUDE.md is
  GENERATED from that field, so these five pages exist, hold real knowledge, and **cannot be
  reached by anyone navigating from the index** — the same shape as `ATOM-DXFF-KOY4` sitting
  unreachable in USER memory while four sessions re-derived it at ~6 worker-hours. A page that
  cannot be found has the availability of a page that does not exist.
- `yarn pillars:lint` → **exit 0, clean.**
- `yarn trdd:doctor` → **exit 1: 450 scanned · 1 error · 262 warn.** The 1 error is the known
  pre-existing `BODY-STATE-CLAIM` on `7123D51A`. The warnings are dominated by
  **`META-MISSING ×152` — no `created-by:`**, which the doctor's own text explains is load-bearing:
  *"mandate provenance and the derived-TRDD invariant both read authorship, and neither can resolve
  it from any other field."*

**Candidate, unconfirmed:** the doctor's output lists `2K08IAPV` and `HUSKG52P` **twice each on the
same path**. Either two distinct findings collapse to one displayed line, or the scan double-counts
— which would make the 262 an overcount. Not chased; noted so the number is not quoted as exact
before someone checks it.

**Nothing fixed.** The 5 topic fields are a two-minute edit and Phase 1 is discovery-only by a
contract I wrote; fixing during discovery destroys the evidence the plan is built from. It also
would have been the third time tonight a session was tempted to repair its own finding mid-audit.

### THE `%cpu` ARGUMENT SETTLED BY ONE ROW — and the detector fired the retracted text at me in the same minute

llm-externalizer re-measured both flagged processes by interval differencing, and one row does more
than every argument tonight that led to it:

| pid | what | **interval** | cumulative | verdict |
|---|---|---|---|---|
| 3459 | JumpConnect rtcproxy | **111.8%** | 73.1% | sustained, legitimate (live remote-desktop encode; flat memory) |
| 26449 | AgentlensPro server | **6.4%** | **96.0%** | **STOPPED** — down from a sustained 121.5% hour |

**Same process, same instant, 96.0% vs 6.4%.** A detector keyed on the cumulative-or-decaying
figure keeps alarming on a process that already went quiet — and keeps doing so **essentially
forever**, because a cumulative average over a growing horizon can barely fall. Interval
differencing sees it idle immediately.

**Their framing of the payoff is the one to carry to the janitor**, because it names the real harm:
not merely *"stops alarming on bursts that ended"* but *"stops alarming FOREVER on a process that
ran hot once"* — **which is the failure mode that trained the fleet to dismiss these alarms in the
first place, and dismissal is what nearly buried the one real case tonight.**

Their escalation needed no retraction: it was correct when made, and the load ended. **The process
changed, not the measurement** — a distinction worth stating, since "I was wrong" and "it stopped"
look identical from the outside.

**Meanwhile this heartbeat's own `[system-daemon-runaway]` line read:** *"JumpConnect (pid 3459)
CPU 167% (**a lifetime average, not a live sample**; over the bar on 2 consecutive checks)"* — the
retracted mechanism, verbatim, shipped, firing at me while the correct measurement sat in the same
context window. Already reported to the janitor session (their repo, their call; three tests in the
installed 3.3.11 pin the wrong string, so correcting it breaks them). Recorded here because a false
mechanism that reaches an alarm's own text is teaching it to every session on the machine on every
fire.

### The hub's axis 4 — skill-name collisions, which no plugin session can see from inside its own repo

Axis 4 names *"conflicts with other plugins (same command name, same file, same settings key)"*.
That is unmeasurable from inside one repo by construction, so it is hub work. Scanned all installed
plugin skills in `~/.claude/plugins/cache`.

**The first run was wrong and its own output said so.** It reported `janitor-memory-harvest (13)`
and 51 other "collisions" — but the cache nests `<marketplace>/<plugin>/<VERSION>/`, so **13 cached
VERSIONS of one plugin inflate every skill it ships into a 13-way collision.** It measured version
multiplicity, not conflict. Deduped by `(skill, marketplace/plugin)`: **596 distinct pairs across
39 plugins**, and the picture changes completely.

**Finding 1 — three `temp_git_*` / `temp_github_*` checkouts are living in the plugin cache.** One
is dated **today 17:52**, holds **29 `SKILL.md` files**, and has **no `.claude-plugin/` manifest**.
They duplicate the full skill sets of `ai-maestro-plugin` and `code-auditor-agent`. Manifest-less,
so probably not loaded — *probably* is doing work there and I have not measured it — but they are
install scratch in a shared cache, and they inflate every cache-based measurement anyone takes
(they produced 39 "plugins" against the reload's 38). Cache hygiene is the janitor's.

**Finding 2 — OURS: `emasoft-plugins/llm-externalizer` collides with `claude-plugins-official/huggingface-skills` on 4 skill names.**
`hf-cli` · `huggingface-best` · `huggingface-community-evals` · `huggingface-local-models`.
Verified first-hand rather than counted: both `huggingface-local-models/SKILL.md` files exist and
`cmp` says **DIFFERENT content** — 3780 bytes (official 1.0.23) vs 4071 (ours 13.5.1 and 13.5.2),
with different `description:` lines. **Two distinct skills, same name, both installed.**

Recorded as a CANDIDATE with the unmeasured part named, per this programme's own rule: plugin
skills are namespaced `plugin:skill`, so both are *addressable* — what is unmeasured is whether a
bare-name invocation or the skills listing can resolve to the wrong one, and that is the whole
severity question. Whoever takes it measures that first rather than renaming four skills on the
strength of a collision count.

**ANSWERED by llm-externalizer, and the answer changes the action.** I logged the resolution
question as unmeasured; they had the instrument I did not — **their own skill listing IS the
resolver state.** All four colliding names appear there **only fully qualified**
(`huggingface-skills:hf-cli` / `llm-externalizer:hf-cli`, and so on), with **no bare entry for any
of them**. I verified the other half myself, from my own Skill tool's contract: *"Plugin skills use
`plugin:skill`."* So a bare-name invocation has **no target at all** and cannot silently land on
the wrong plugin. **My worst case does not obtain.** Not a mis-resolution bug.

**What survives is a MENU-AMBIGUITY bug, and namespacing does nothing to it.** Both descriptions
cover the same ground in near-identical words — select GGUF/quantization for llama.cpp on CPU / Mac
Metal / CUDA / ROCm, quant trade-offs, serving, conversion. A model choosing from the listing has no
principled basis to prefer either, so it is a coin flip between two skills whose *content* differs.
**Namespacing makes both ADDRESSABLE; it does not make the choice INFORMED.**

Action revised accordingly: **do NOT rename the four skills.** Renaming is a breaking change for
anyone invoking `llm-externalizer:hf-cli` today, and it would be four renames aimed at a resolution
bug that measurement says does not exist. The cheap correct fix is to **differentiate the
DESCRIPTIONS** so the choice is informed — and only our side can move, since the official plugin is
not ours. Whether this plugin should ship four HF skills at all is a Phase-2 scope decision; nobody
is making it in discovery.

**The generalization is worth more than the finding, and it indicts my own scan.** I keyed on
**NAME** and the real defect is in **DESCRIPTION**. Two skills with *different* names and
near-identical descriptions produce the identical coin-flip — and a name-collision scan is blind to
every one of them. So this was found by luck: the name collision was a symptom that happened to sit
beside the defect. **The general form needs a description-similarity sweep, which nobody has run.**
Same family as the standing lesson that a detector keyed on a symbol NAME goes blind the moment
something is renamed — here it was never able to see the class at all.

**Not ours, recorded for completeness:** `GhostScientist-skills/design-skills` and
`.../research-skills` ship **11 identical skill names** between two sibling plugins of one
marketplace (a third-party packaging defect); `skill-creator` appears in 3 plugins; `nanobanana-skill`
and `morning-ai` in 2 each.

### The hub's axis 3, part 2 — 8 executables on PATH that NO repo in the fleet ships

Extending the `trddgrep` check to the whole installed family (`~/.local/bin/*` whose content
mentions aimaestro — 59 files) re-runs the deployment census the standing lesson says never to
quote from memory. **The recorded tally was `55 identical / 25 stale / 7 never-deployed`; measured
now it is `38 identical / 0 DIFFERS / 21 no-counterpart`.** Nothing is stale. That supersedes the
recorded number, which is the whole reason the lesson says to re-run it.

The 21 without a `scripts/<same-name>` resolve into three buckets, and only the third is a finding:

| bucket | n | what |
|---|---|---|
| launcher → target | 9 | `trddgrep`/`prrdgrep`/`specgrep` → `.mjs`; `aimaestro-agent` + 5 `amp-*` → `.sh`. Correct by design. |
| `.bak-20260808_153204+0200` | 3 | backups of `aimaestro-continuity/panel/session.sh` sitting **on PATH**. Inert (nothing invokes a `.bak` name) but they make any future census ambiguous. |
| **UNOWNED** | **8** | `aimaestro-agent-bash`, `aimaestro-agent.py`, `docs-helper.sh`, `graph-helper.sh`, `kanban-sync.py`, `kanban-sync.sh`, `memory-helper.sh`, `watch-inbox.sh` |

The 8 are absent from this repo **and from every repo under `~/Code` at depth 4** (positive
controls: `trddgrep.mjs` found here; `publish.py` found in two repos at two different nesting
depths, so the depth covers both shapes). They date from Dec 2025 to Aug 2026 — `aimaestro-agent.py`
is 47 KB from **Feb 2026**. Executable, on PATH, maintained by nothing.

**They are not merely litter: instructions still point at them.** Bounded to this repo +
`~/.claude/rules`, 5 of the 8 are still named in md files (`memory-helper.sh` twice). The
unbounded `~/Code` sweep timed out at 8m20s having returned **17 md files for
`aimaestro-agent-bash` alone**, so the real instruction surface is much larger than the local
count — an agent following those docs invokes a script no repo owns. That is the
`check-all-files-after-breaking-change` failure mode: prose naming a deleted thing still executes.

Phase-2 work, this repo. Deliberately not repaired here (deleting an executable other sessions may
be invoking is not a Phase-1 act, and RULE 0 wants them committed or trashcanned, not `rm`-ed).

### visual-comunicator's G1 — hub-verified CONFIRMED, and the fleet sweep inverted the finding

The peer nominated one citation as the one to check if I check only one. Both halves verified
first-hand in `~/Code/visual-comunicator/scripts/publish.py`:

- `:164-183` — `_read_remote_latest_tag()` returns `None` on **any** non-zero exit, with a comment
  that says so outright (*"Network failure / no remote — caller treats as 'no remote tag known'"*).
- `:255-268` — `_gate_version_bump()`: `if remote is None: PASS (no remote tag yet); return True`.
- `:170-172` — the docstring states the retry wrapper exists so a glitch *"shouldn't make G1
  falsely think there's no remote tag (which would let a duplicate-version push slip through)"*.

So on a **persistent** outage the retries exhaust, `None` is returned, and the gate passes for
exactly the reason its own docstring names as the thing to prevent. Their report is verbatim
correct.

**The fleet sweep then inverted it into a bigger finding.** I expected a third template-wide
defect and got the opposite: **only 1 of 22 `publish.py` copies has this function — and only 1 of
22 has a version-bump gate of any kind.** I broadened past the function NAME deliberately (the
standing lesson that a name-keyed needle goes blind after a rename) to `_gate_version_bump|def
.*version_bump|G1: version`, and to how each learns the remote version (`ls-remote` / `gh release`
/ `git tag -l` / `describe --tags`) — same answer, and the needle finds the one that has it, so the
control holds. **21 of 22 carry no duplicate-version guard at all.**

That is a CANDIDATE, not a confirmed defect, and the missing determination is stated rather than
assumed: whether those 21 can even *produce* a duplicate version, given `bump-version.sh` and the
"every PR bumps" convention, is unmeasured. A pipeline where duplicates are impossible by
construction needs no G1. Whoever takes it measures that first.

## Approval log

- 2026-08-16T16:53:19+0200 — MANDATE issued by the USER (min-approval-requirement: none).
  Pre-approved: the issuer is the USER, above every agent rung. No approval request was sent.
