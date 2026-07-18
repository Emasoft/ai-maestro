---
trdd-id: U9UNWXMV
title: three-tier TRDD scope↔kanban model — user/host, project/team (multi-repo), local/agent + per-TRDD project-id & repo
column: design
created: 2026-07-18T10:08:19+0200
updated: 2026-07-18T10:08:19+0200
current-owner: ai-maestro
task-type: docs
scope: project
min-approval-requirement: user
mandate: false
approved: false
relevant-rules: []
labels: [governance, trdd, kanban, scope, three-tier, ind-base, dep-overlay, cross-repo]
external-refs: []
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: []
---

# three-tier TRDD scope↔kanban model — user/host, project/team (multi-repo), local/agent

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-18

**USER-SPECIFIED design (stated 3× this session, stable).** This TRDD is the SPEC + implementation
plan. **No rule edits have been made** — they are gated on the USER's explicit go AND on confirming
the one open assumption (A1 below). column: design. min-approval-requirement: user (governance change
spanning an IRON/IND-base rule).

**THE MODEL.** Every TRDD has a SCOPE, and its scope binds it to exactly one KANBAN at one LEVEL:

| scope | kanban | cardinality | design root (where its TRDDs live) | pushed? |
|---|---|---|---|---|
| **user** | global / host-wide | **1 per HOST** | janitor host-level store (mirrors USER memory) | host-only, not per-project |
| **project** | project / team | **1 per Project = Team** | canonical = team server store `~/.aimaestro/teams/tasks-<teamId>.json`, FED BY each project repo's `<repo>/design/` | git-tracked + pushed per repo |
| **local** | local | **1 per AGENT** | `~/.claude/projects/<agent-slug>/design/` (already machine-private in the IND base) | NOT pushed |

- **user-scoped** = cross-project / cross-team: global issues, proposals, mandates. No `project-id`.
- **project-scoped** = belongs to ONE project/team/kanban. Carries `project-id`. A project may span
  **N GitHub repos** but is ONE kanban — each task annotates its `repo`.
- **local-scoped** = single-agent: local-repo matters, self-assigned chores. No `project-id`, NOT
  pushed, orchestrated by the agent's OWN local kanban, never the central one.

**GENUINELY NEW (everything else already exists — see Reconciliation):**
1. **`project-id:` per-TRDD frontmatter field** — project scope only; ABSENT for user/local.
2. **`repo:` per-TRDD annotation** — which of the project's N repos this task touches.
3. **`user` as the 3rd TRDD scope** (today the IND base has only `project | local`) + a host-wide
   design root (mirrors the USER-memory store).
4. **Formalize the scope→kanban binding**: user→host kanban, project→team kanban (multi-repo,
   canonical = team store), local→agent kanban.

**A1 — THE ONE OPEN ASSUMPTION (confirm before implementing):** the canonical PROJECT kanban for a
multi-repo project is the **TEAM SERVER STORE** (`tasks-<teamId>.json`, already 1-per-team), with each
repo's `design/` FEEDING it and a task's `repo:` tag naming which repo — i.e. the project kanban is
NOT physically inside a single repo, it is the team board, mirrored out to each repo's `design/` + the
GitHub Project. **Proposed default; USER to confirm or override.** Chosen because it is the EXISTING
reality (the team store is already 1-per-team = 1-per-project), not a speculative new store.

**NEXT ACTION:** get the USER's (a) go to implement + (b) A1 confirmation. THEN execute the phases
below — DEP overlay edits land in this repo; the IND-base delta is a cross-repo janitor proposal
(never a unilateral edit of `~/.claude/rules/trdd-design-tasks.md`).

## Reconciliation — most of this already has a home (verified on disk)

- ✓ The 3 scopes ARE the memory model (LOCAL / PROJECT / USER) 1:1 — `markdown-memory-recall.md`.
  This change gives TRDDs the SAME taxonomy memory already uses.
- ✓ IND base already has `scope: project | local`, the LOCAL root
  `~/.claude/projects/<slug>/design/` (machine-private, NOT pushed), and the PROJECT root
  `<repo>/design/`. Local-scope "not pushed, own board" is already true; we add the explicit
  scope→kanban wording.
- ✓ `aimaestro-kanban-multiagent.md` already: "one kanban per project", team 1:1 project, TRDDs ARE
  the board, mirrored to dashboard + GitHub Project. The team server store `tasks-<teamId>.json`
  already exists and is 1-per-team.
- ✓ `aimaestro-trdd-approval.md` already defines `project-id` (registered w/ AI Maestro, in PRRD
  frontmatter) + the `<project-id>:TRDD-<id8>` citation + `findtrdd --project`, and already notes
  "a project may span more than one GitHub repo." We PROMOTE `project-id` to a per-TRDD field and ADD
  the `repo` annotation + the `user` scope.
- ✓ 38/38 live TRDDs use `scope: project`; none carry a `project-id`/`repo` field yet — clean rollout,
  additive/optional (absent = today's behavior).

## Coordination split (load-bearing)

| Change | Layer | Where it lands | How |
|---|---|---|---|
| add `user` to the `scope:` enum; the `project-id:`/`repo:` field definitions; the host-wide (user) design root | **IND base** `trdd-design-tasks.md` | JANITOR-owned (`~/.claude/rules/`, shipped by the plugin) | **cross-repo proposal to the janitor** (co-ratify like BSW) — NEVER edit their file here |
| team 1:1 project 1:1 kanban; multi-repo → one team-store kanban + per-task `repo`; user→host / project→team / local→agent kanban binding | **DEP overlays** `aimaestro-trdd-approval.md` + `aimaestro-kanban-multiagent.md` | THIS repo (git-tracked, self-governed via symlinks) | I draft + edit here |
| `--project` / `--repo` flags on the task-creation CLI + the TRDD frontmatter schema | server + `amp-kanban-*` | THIS repo (ai-maestro owns the scripts) | derived EHT (see below) |

## Phases (≤5 files each; all gated on the USER go + A1)

- **Phase 1 (this repo, DEP overlays)** — extend `aimaestro-trdd-approval.md` (per-TRDD `project-id`
  + `repo`; the 3-tier scope→kanban binding; multi-repo canonical-store rule) and
  `aimaestro-kanban-multiagent.md` (user/host + local/agent boards alongside the project board).
- **Phase 2 (cross-repo, janitor)** — a coordination issue/PR proposing the IND-base delta: `user`
  scope, the `project-id`/`repo` fields, the host-wide root. Held as a DRAFT until the USER approves
  posting (outward-facing).
- **Phase 3 (derived EHT — its own TRDD)** — server + `amp-kanban-create-task` gain `--project` /
  `--repo`; TRDD frontmatter schema + `lib/trdd-store.ts` parse the new fields; the memory note
  `reference_kanban_task_creation_contract` records the new contract.
- **Phase 4 (derived EHT)** — routing: a project-scoped TRDD without a resolvable `project-id`, or a
  `repo` not in the project's repo set, is a lint target; a `user`/`local` TRDD carrying a
  `project-id` is a lint target.

## Verification

- Rules-only phases: internal consistency + the DEP-must-not-restate-IND invariant; the operating-file
  size budget is untouched (this edits governance overlays, not `aimaestro-agent-rules.md`).
- Phase 3/4: `tsc`/`yarn test`/`yarn build` green; the CLI help block re-verified against source
  (per the kanban-contract memory lesson — verify the DEPLOYED verb, not memory).
- Do NOT push (app + rules); the janitor proposal is coordinated, not pushed unilaterally.

## Approval log

- 2026-07-18T10:08:19+0200 — Authored as a DESIGN spec from the USER's 3× stated model. NOT a mandate
  to implement: min-approval-requirement is `user` (governance change spanning the IRON/IND base), and
  the rule edits + the cross-repo janitor proposal await the USER's explicit go + the A1 confirmation.
  Authoring this design doc is the reversible plan step ("plan and build are separate").
