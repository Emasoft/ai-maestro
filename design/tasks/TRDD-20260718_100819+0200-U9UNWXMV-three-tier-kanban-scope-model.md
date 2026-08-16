---
trdd-id: U9UNWXMV
title: three-tier TRDD scope↔kanban model — user/host, project/team (multi-repo), local/agent + per-TRDD project-id & repo
column: design
created: 2026-07-18T10:08:19+0200
updated: 2026-08-16T17:46:11+0200
current-owner: ai-maestro
task-type: docs
scope: project
min-approval-requirement: user
mandate: false
approved: true
approval-judge: user
approval-datetime: 2026-07-18T10:08:19+0200
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
| **project** | project / team | **1 per Project = Team** | TRDDs live in each project repo's `<repo>/design/`; the team server store `~/.aimaestro/teams/tasks-<teamId>.json` + GitHub Project are MIRRORS of the query, not the source | git-tracked + pushed per repo |
| **local** | local | **1 per AGENT** | `~/.claude/projects/<agent-slug>/design/` (already machine-private in the IND base) | NOT pushed |

- **user-scoped** = cross-project / cross-team: global issues, proposals, mandates. No `project-id`.
- **project-scoped** = belongs to ONE project/team/kanban. Carries `project-id`. A project may span
  **N GitHub repos** but is ONE kanban — each task annotates its `repo`.
- **local-scoped** = single-agent: local-repo matters, self-assigned chores. No `project-id`, NOT
  pushed, orchestrated by the agent's OWN local kanban, never the central one.

**THE KEYSTONE (USER, 2026-07-18): a kanban is a QUERY, not a store.** Everything lives inside the
TRDDs; a kanban is simply the set of TRDDs matching `(scope, discriminator)` — the IND
`universal-kanban` principle ("the cards ARE the TRDDs; a corpus-backed board cannot drift") made
concrete as three filters:

```
kanban(local,  agent) = { TRDD | scope=local   ∧ author=agent   (author == assignee) }
kanban(project, proj) = { TRDD | scope=project ∧ project-id=proj }
kanban(user,   host)  = { TRDD | scope=user    ∧ host-id=host }          (1 per host)
```

The team server store (`tasks-<teamId>.json`), the GitHub Project, and the dashboard board are all
**MIRRORS** of these queries — never the canonical source (`aimaestro-kanban-multiagent` already:
"proxies… allowed to be stale… regenerable… mirror writes flow backwards"). **A1 (an earlier
"which store is canonical?" question) is therefore DISSOLVED — the QUERY is canonical, every store is
a cache of it.**

**GENUINELY NEW — the whole delta is 3 small frontmatter additions; the discriminators mostly EXIST:**

| scope | discriminator | new? |
|---|---|---|
| local | `created-by` (== `assignee`) | **already exists** — no new field |
| project | `project-id` | **NEW** — the only genuinely-new discriminator |
| user | `host-id` | NEW-ish — implicit from the host store, or a field for greppability |

So the frontmatter change is: **`scope:` gains `user`** (today `project | local`) · **`project-id:`**
(project discriminator) · optionally **`host-id:`** (user discriminator; else implicit) · **`repo:`**
(per-card metadata for a multi-repo project — NOT a discriminator, the `project-id` is). Everything
else (author, assignee, the mirror stores) is unchanged.

**USER GAVE THE GO (2026-07-18): implement — update the governance rules + 3-pillars specs to make the
3 kanbans clearer.** Topology check found the IND-base HANDOFF SOURCE in this repo
(`design/rules-refactor/independent/`) is STALE vs the janitor's shipped `~/.claude/rules/` (trdd 951
diff lines) — so do NOT edit it or the shipped copies; the IND delta goes to the janitor as a proposal.

**⚠ USER DIRECTIVE (2026-07-18): STOP auto-firing the janitor reload trigger — `reload_trigger.py`
types `/reload-plugins --force` into the USER's pane and was corrupting their live typing. On a
`[janitor-reload]` marker: NOTIFY the pending version and let the USER run it; do NOT inject.**

**PROGRESS — Phase 1 (both DEP overlays) + Phase 2 DRAFT COMPLETE:**
- ✅ Phase 1a (`06d9f439`) — `aimaestro-kanban-multiagent.md`: the explicit 3-kanban section
  (three queries: local/agent, project/team multi-repo, user/host; discriminators; buffers=mirrors;
  platelets=derived TRDDs) + scoped the "one-per-project" line to the project board.
- ✅ Phase 1b (`ab749309`) — `aimaestro-trdd-approval.md`: the per-TRDD scope-discriminator table
  (project→project-id+repo, user→host-id, local→created-by==assignee) + `user` scope; project MUST
  carry project-id, user/local MUST NOT.
- ✅ LOCAL feedback memory note written (reload-injection-stop directive) —
  `feedback-janitor-reload-no-inject-while-typing.md`.
- ✅ Phase 2 DRAFT authored + HELD (2026-07-21) — the cross-repo janitor coordination issue body is
  ready at `docs_dev/20260721_101004+0200-janitor-proposal-ind-base-user-scope-project-id.md`
  (gitignored dev scratch). Targets `Emasoft/ai-maestro-janitor`; asks to co-ratify into IND-base
  `trdd-design-tasks.md`: `scope:user` + `project-id`/`host-id`/`repo` field defs + the host-wide
  user design root. Additive/backward-compat (38/38 live TRDDs are `scope: project`, none carry the
  new fields). **NOT posted** — posting is an outward-facing shared-identity publish, USER go required.

**PROGRESS — Phase 2 POSTED (2026-07-21, USER go):**
- ✅ The IND-base kanban proposal is POSTED → **`Emasoft/ai-maestro-janitor#103`**. Awaiting the
  janitor's co-ratification + plugin release of the `scope:user`/`project-id`/`host-id`/`repo` delta.

**NEXT ACTION:**
- WAIT for janitor#103 to be co-ratified + shipped in a plugin release (`~/.claude/rules/trdd-design-tasks.md`
  picks up the delta) — THEN Phase 3/4 EHTs unblock.
- Phase 3/4 — derived EHTs (CLI `--project`/`--repo`; frontmatter schema in `lib/trdd-store.ts`;
  routing-lint) — own TRDDs, gated on #103 SHIPPING. On the USER's word.

**CORE-PLUGIN SYNC LOOP (USER directive 2026-07-21):** the core plugin `ai-maestro-plugin` owns the
SKILLS agents use to drive the frozen CLI (`team-kanban`, `ama-kanban-render`, …); ai-maestro owns
the CLI script layer. So EVERY agent-facing script/command change MUST be communicated to the core
Claude (skill sync) AND documented. Opened **`ai-maestro-plugin#31`** — heads-up that `amp-kanban-create-task`
will gain `--project`/`--repo` (Phase 3, pending #103 ratification) so `team-kanban`/`ama-kanban-render`
can plan; also flagged the continuity verbs; established the standing loop + asked for the core's
prioritized needs list. Background watcher `bxpwdyaur` notifies on the core's reply. **STANDING RULE:
when I land the Phase-3 CLI flags, ping #31 with the exact help-block text before/as they deploy.**

**SEPARATE THREAD (not this TRDD — belongs to Family-A / TRDD-KCRMSNL7):** posted a daemon-update
request on `janitor#100` (comment 5037238511) asking the janitor Claude for a consolidated CURRENT
daemon snapshot (v0.57.0, thread at rev-5) before advancing the server-side Family-A mirror. Per the
USER: HOLD all daemon-mirror work until the janitor's consolidated reply. Background watcher
`bzp9y16au` will notify on their reply. (Continuity verbs also flagged to core on #31.)

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
| kanban = a QUERY `(scope, discriminator)` over the corpus; team 1:1 project 1:1 kanban; multi-repo → ONE project query + per-task `repo` (stores are mirrors); user→host / project→team / local→agent binding | **DEP overlays** `aimaestro-trdd-approval.md` + `aimaestro-kanban-multiagent.md` | THIS repo (git-tracked, self-governed via symlinks) | I draft + edit here |
| `--project` / `--repo` flags on the task-creation CLI + the TRDD frontmatter schema | server + `amp-kanban-*` | THIS repo (ai-maestro owns the scripts) | derived EHT (see below) |

## Phases (≤5 files each; all gated on the USER go + A1)

- **Phase 1 (this repo, DEP overlays)** — extend `aimaestro-trdd-approval.md` (per-TRDD `project-id`
  + `repo`; the 3-tier scope→kanban binding; kanban-is-a-query + stores-are-mirrors for the multi-repo
  case) and `aimaestro-kanban-multiagent.md` (the three filters — user/host, project/team,
  local/agent — as queries over the corpus, alongside the existing project board).
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

## Acceptance

- [ ] `Emasoft/ai-maestro-janitor#103` (the IND-base coordination proposal: `scope:user` +
      `project-id`/`host-id`/`repo` field definitions) reaches co-ratification and ships in a
      janitor plugin release.
- [ ] Phase 3 EHT (server + `amp-kanban-create-task` gain `--project`/`--repo`; TRDD frontmatter
      schema in `lib/trdd-store.ts` parses the new fields) is authored as its own TRDD once
      #103 ships.
- [ ] Phase 4 EHT (routing lint: unresolvable `project-id`, unlisted `repo`, or a `user`/`local`
      TRDD carrying `project-id`) is authored as its own TRDD once #103 ships.
- [ ] `ai-maestro-plugin#31` (the core-plugin skill-sync heads-up) is closed once the deployed
      CLI help-block text is pinged to it, per the STANDING RULE in the STATE block.
- [ ] The A1 "which store is canonical?" open assumption is confirmed dissolved (recorded above
      as "the query is canonical, every store is a cache of it") with no outstanding objection.

## Approval log

- 2026-07-18T10:08:19+0200 — Authored as a DESIGN spec from the USER's 3× stated model. NOT a mandate
  to implement: min-approval-requirement is `user` (governance change spanning the IRON/IND base), and
  the rule edits + the cross-repo janitor proposal await the USER's explicit go + the A1 confirmation.
  Authoring this design doc is the reversible plan step ("plan and build are separate").
- 2026-08-16T17:46:11+0200 — `approved` corrected true (was stale `false`): the card's own STATE block
  records "USER GAVE THE GO (2026-07-18): implement", and Phase 1a/1b already landed under that go
  (`06d9f439`, `ab749309`). `approval-judge: user`, `approval-datetime` set to the card's own
  `created:` timestamp (the only ISO datetime on record for that day's go — no finer-grained time is
  recorded anywhere on the card).
