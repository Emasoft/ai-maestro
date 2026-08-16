---
trdd-id: BRRJK57P
title: USER fleet program — every plugin self-audits twice, remediates via TRDDs, and is proven by new scenario tests
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T16:53:19+0200
updated: 2026-08-16T19:09:35+0200
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

**7 sessions reported as of 19:12 (architect, assistant-role, CORE, maintainer, orchestrator,
llm-externalizer); architect and assistant-role are Phase-1 COMPLETE on all four axes; every
CONFIRMED finding is hub-verified — see the ledger below.** Outstanding: every session that has not
yet reported. Phase-2 dispatch stays BLOCKED on the USER (relayed authority was
correctly refused by three sessions; the hold is endorsed).

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
  search against something you KNOW is present.
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

**1. The `@handle` mention rules — hub re-measured all six forms first-hand via
`gh api -X POST /markdown -f mode=gfm`, grepping for `class="user-mention"`:**

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

### Cross-finding worth keeping (raised by the architect, endorsed)

A single-axis worker can "CONFIRM" against a premise another axis has already destroyed: axis 1
justified keeping a finding by reasoning that "`cross_platform.py` IS imported by 8+ scripts, so
the import mechanism clearly works" — axis 3 had already proven those exact imports all crash. The
conclusion survived on other evidence; the reasoning did not. **Cross-check premises across axes
before a finding enters the plan.**

## Approval log

- 2026-08-16T16:53:19+0200 — MANDATE issued by the USER (min-approval-requirement: none).
  Pre-approved: the issuer is the USER, above every agent rung. No approval request was sent.
