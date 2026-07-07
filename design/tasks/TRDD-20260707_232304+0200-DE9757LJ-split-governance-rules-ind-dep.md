---
trdd-id: DE9757LJ
title: Split the 3-pillars governance rules into IND (janitor-global) and DEP (ai-maestro-workdir) sets
column: dev
created: 2026-07-07T23:23:04+0200
updated: 2026-07-08T00:26:41+0200
implementation-commits: [618f7044, 313fd7a3]
external-refs: ["github.com/Emasoft/ai-maestro-janitor/issues/73", "github.com/Emasoft/ai-maestro-orchestrator-agent/issues/27"]
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: XL
labels: [governance-rules, rules-refactor, kanban, janitor, cross-repo]
task-type: refactor
parent-trdd: null
npt: []
eht: []
relevant-rules: []
---

# TRDD-DE9757LJ — Split the 3-pillars governance rules into IND (janitor-global) and DEP (ai-maestro-workdir) sets

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-07

**▶ UPDATE 2026-07-08T00:26 — Phases 1-3 DONE (ai-maestro side complete):**
- **Phase 1 DONE** (`618f7044`): all 7 rule files authored. IND →
  `design/rules-refactor/independent/` (trdd-design-tasks.md with the merged
  folder lifecycle + neutral transition table, prrd-design-rules.md,
  universal-kanban.md). DEP → `rules/aimaestro/` (aimaestro-trdd-approval.md
  with the new Part B2 transition-authority table, aimaestro-manager-approval-
  defaults.md, aimaestro-prrd-governance.md, aimaestro-kanban-multiagent.md),
  each marker-stamped (`ai-maestro:installed-dep-rule`) + EXPANDS header.
  Zero-duplication verified by grep.
- **Phase 2 DONE** (`313fd7a3`): `lib/agent-rules-seed.ts`
  (ensureAgentRules — content-idempotent, marker-guarded, user-file-safe),
  wired at CreateAgent G05b + ensureCorePluginInstalled (the wake-path
  monitor covering wakeAgent / New Session / ensure-core POST) + importAgent.
  Repo self-governs via 4 symlinks `.claude/rules/aimaestro-*.md →
  rules/aimaestro/`. 5 unit tests; gate green (tsc, server, vitest 2046/2).
- **Phase 3 DONE**: janitor issue filed —
  github.com/Emasoft/ai-maestro-janitor/issues/73 (ship the 3 IND rules via
  rules_installer; includes the marker-vs-unmarked-takeover question the
  implementer must answer). Phase 4 rides the EXISTING orchestrator issue
  #27 (extended with the DEP-contract comment) — no duplicate filed.

**NEXT ACTION:** wait on janitor#73 (IND ships globally) and orch#27
(script rewire) — both other-repo work. THEN Phase 5, ONLY with explicit
USER ok: back up + remove the orphaned global `trdd-approval-tiers.md` +
`manager-approval-defaults.md` from `~/.claude/rules/` (the other two
global copies are superseded by the janitor's IND versions — takeover
semantics per the janitor#73 answer).

**SUPERSEDED — do NOT carry forward:** "No code/rule files touched yet"
(pre-Phase-1 state below).

**Original state (2026-07-07):** DESIGN agreed with the USER (this is a
USER-directed task). This TRDD is the plan-of-record.

**Load-bearing facts:**
- 4 governance rule files currently live ONLY at global `~/.claude/rules/`
  (hand-placed by the USER; mtimes Jun 2 / Jun 23). They pollute EVERY project
  on the machine. Verified the janitor did NOT install them — janitor ships +
  installs only its own 4 rules (commit-discipline, janitor-footprint,
  markdown-memory-recall, use-safe-delete) via `scripts/lib/rules_installer.py`
  on SessionStart. That installer + the shipped `rules/` dir is the EXISTING
  mechanism the IND set plugs into.
- The 4 source files: `trdd-design-tasks.md`, `trdd-approval-tiers.md`,
  `prrd-design-rules.md`, `manager-approval-defaults.md`. (The phantom
  `trdd-design-tasks.v1-backup.md` was deleted by the USER — all `.md` in a
  rules dir load regardless of name, so a backup there was a live duplicate.)
- Rule-file LOADING ignores the filename — only the body is injected into
  context. So filenames are a human/git convenience only.

**[HISTORICAL — completed by the 2026-07-08 update above] NEXT ACTION
(Phase 1):** the rule-by-rule classification + both rule sets, done in
`618f7044`.

## Problem

ai-maestro's governance rules (TRDD lifecycle, PRRD, approval tiers, the
universal kanban) are installed at **global user scope** (`~/.claude/rules/`),
so they load into every unrelated Claude Code project — including projects that
have no ai-maestro core plugin and are not agent workdirs. Yet many of the
USER's non-ai-maestro projects already depend on the *universal* half of these
rules (the 3-pillars task/design structure). Naively removing the global copies
would break those projects; leaving them global wrongly imposes ai-maestro's
server/AID/title-dependent governance on projects that can't satisfy it.

## The split axis — IND vs DEP

Every rule in the 4 files is exactly one of:

- **IND (ai-maestro-INDEPENDENT)** — works in ANY Claude Code project with no
  core plugin, no server, no AID, no multi-agent. The universal 3-pillars task/
  design system.
- **DEP (ai-maestro-DEPENDENT)** — needs the ai-maestro server, AID/mandate
  verification, governance TITLES (MANAGER/COS/…), or the multi-agent model.

**Invariant:** IND is the base, assumed ALWAYS present. DEP is an EXPANSION that
references IND and is added ONLY inside a registered-agent workdir. DEP must
never restate IND — each DEP file opens with a header: "EXPANDS the IND
`<file>`; assumed present; not restated here."

## The 3 pillars, each split

### Pillar 1 — TRDD
- **IND:** filename/8-char-id, frontmatter schema, the 14+3 `column:` vocab,
  STATE block, report→TRDD conversion, the folder lifecycle
  (`proposals/→tasks/→archived/`+`refused/`, proposal/planned/refused/cancelled/
  completed/superseded overlay values, git-mv promotion/refusal/archival
  mechanics, "OPEN = in tasks/", failed-is-retryable), grep cheat-sheet,
  anti-patterns.
- **DEP:** the transition-AUTHORITY table (which governance TITLE may trigger
  each column move); Tier 0-3 approval authority; COS/MANAGER/USER routing
  (R6 v3); `$AID_AUTH`; the classification watchdog; emergency rules; the
  ratified baseline rulesets; multi-agent `assignee:` semantics.

### Pillar 2 — PRRD
- **IND:** PRRD file location/anatomy, golden/silver CONCEPT, rule identity/
  versioning/promote-demote mechanics, citation grammar, mirror discipline,
  bootstrap.
- **DEP:** MANAGER-vs-USER authority ENFORCEMENT, `caller_is_manager`/
  `$AID_AUTH`, the COS-routed proposal queue.

### Pillar 3 — KANBAN (universalized — permanent task system)
- **IND (MONO-agent):** a basic universal kanban task manager, self-managed by
  the SAME claude that is also the ONLY assignee. One project = one claude =
  one schedule; every task's assignee is the current project's claude. No
  multi-agent assumed. This is the fallback that lets non-ai-maestro projects
  use the 17-column kanban standalone.
- **DEP (MULTI-agent):** extends the IND kanban to a shared-per-project board
  with multiple agent assignees, edited by the agent itself / the project's
  ORCHESTRATOR agent / (if not in a team) the MAINTAINER, AUTONOMOUS, or
  MANAGER; managed via the ai-maestro UI; and synced to the ai-maestro
  dashboard kanban + the GitHub Project kanban (a mirror of the internal
  universal kanban). **Downstream:** implementing the multi-agent-assignee
  editing requires REWIRING the orchestrator-plugin scripts (separate repo —
  handled as its own issue/PR, not a direct edit from this session).

## Naming (loader ignores filenames — this is a human/git signal only)

- **IND (janitor-shipped, global):** plain names — `trdd-design-tasks.md`,
  `prrd-design-rules.md`, `universal-kanban.md`.
- **DEP (ai-maestro-server-installed, workdir-local):** `aimaestro-` prefix so
  it is obvious at a glance which rules are the server overlay —
  `aimaestro-trdd-approval.md`, `aimaestro-manager-approval-defaults.md`,
  `aimaestro-prrd-governance.md`, `aimaestro-kanban-multiagent.md`.
  (`manager-approval-defaults.md` is entirely DEP; it becomes
  `aimaestro-manager-approval-defaults.md`.)

## Install channels

- **IND → janitor.** The janitor already ships a `rules/` dir + installs it into
  global `~/.claude/rules/` via `scripts/lib/rules_installer.py` at SessionStart.
  The IND files are ADDED to that shipped set. The janitor is the only plugin
  that runs both WITH and WITHOUT ai-maestro installed, so it is the correct
  owner of the always-present base. **The janitor's Claude implements this**, not
  this session — I provide the requirements + the IND files via a NEW ISSUE on
  the janitor repo (per how-to-fix-issues-of-other-projects: file an issue, never
  edit another project's tree).
- **DEP → ai-maestro server.** The ai-maestro server API writes the DEP files
  into each agent workdir's local `.claude/rules/` when a project folder is
  imported or an agent workdir is created, plus a monitor re-seeds any DEP file
  missing from an existing agent workdir. **This session implements this.** DEP
  files are git-tracked in the ai-maestro repo (only ai-maestro can track them).

## Division of labor (hard constraint from the USER)

| Work | Owner |
|---|---|
| Rule-by-rule split; author BOTH the IND and DEP sets (cross-refs, no dup) | THIS session |
| ai-maestro server API install of DEP rules into workdirs + missing-rules monitor | THIS session |
| Migrate the ai-maestro repo to be self-governing (carry its own DEP overlay) | THIS session |
| Update ai-maestro docs | THIS session |
| Install the IND rules globally via the janitor | **Janitor's Claude** (via a GitHub issue I file) |
| Update janitor docs | **Janitor's Claude** (same issue) |
| Rewire orchestrator-plugin scripts for multi-agent kanban editing | **Orchestrator-plugin's Claude** (its own issue/PR) |
| Remove the 4 redundant global copies from `~/.claude/rules/` | THIS session — ONLY after IND+DEP verified live, with explicit USER ok + backup |

## Phased plan

- **Phase 1 [this session, awaiting GO]** — rule-by-rule classification; author
  the IND set + the DEP set with cross-references and zero duplication; commit
  drafts to a staging dir in this repo. No install code, no janitor issue yet.
- **Phase 2 [this session]** — ai-maestro server API installs DEP rules into
  `~/agents/<name>/.claude/rules/` on CreateAgent/import + a missing-rules
  monitor; migrate the ai-maestro repo to self-govern; update ai-maestro docs.
- **Phase 3 [janitor's Claude, via issue I file]** — janitor adds the IND files
  to its shipped `rules/` + `rules_installer.py`; updates janitor docs.
- **Phase 4 [orchestrator-plugin's Claude, via issue]** — rewire orchestrator
  scripts for multi-agent kanban editing (the DEP kanban's editing surface).
- **Phase 5 [this session, explicit USER ok only]** — after IND (janitor) + DEP
  (ai-maestro) verified live, back up + remove the 4 redundant global copies.

## Verification

- A fresh non-ai-maestro project (janitor present, no core plugin) has the IND
  base (TRDD/PRRD/universal mono-agent kanban) in `~/.claude/rules/` and can run
  the 3-pillars structure standalone with itself as the sole assignee.
- A registered agent workdir additionally has the `aimaestro-` DEP overlay in
  its local `.claude/rules/`, unlocking approval tiers, multi-agent assignees,
  and dashboard/GitHub-Project sync — with no duplicated text between the two
  layers.
- Removing an agent from ai-maestro (or opening a non-workdir project) leaves
  only the IND base, and nothing breaks.

## Estimated risk

HIGH. Touches the governance-rule substrate that this project and the USER's
other projects depend on; spans 3 repos (ai-maestro, janitor, orchestrator
plugin); the DEP kanban's multi-agent editing needs an orchestrator-script
rewire. Mitigations: strict IND-base/DEP-overlay layering (no duplication), the
global copies are removed LAST and only after both channels are verified live,
and the cross-repo work is delegated via issues (not direct edits).

## Approval log

- 2026-07-07T23:23:04+0200 — USER-DIRECTED (the USER specified this entire
  design across two messages and delegated the naming decision). Authored as the
  plan-of-record. Phase 1 (the rule-by-rule refactor) awaits the USER's explicit
  "GO" before execution; no rule files, install code, or cross-repo issues are
  touched until then.
