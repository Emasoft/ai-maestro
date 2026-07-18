<!-- ai-maestro:installed-dep-rule -->

# ai-maestro overlay — the multi-agent kanban

> **DEP overlay — installed by the ai-maestro server** into each
> registered agent workdir's `.claude/rules/`. It EXPANDS the IND base
> `universal-kanban.md` (the mono-agent 17-column board over the TRDD
> corpus — shipped globally by the ai-maestro-janitor and assumed
> present); base content is NOT restated here. This overlay turns the
> same board multi-agent: shared per project, many assignees, edited
> under title authority, mirrored to the dashboard and GitHub.

## The TRDDs ARE the kanban; every board is a cache of them (USER, 2026-07-10)

The board is not *stored* anywhere. A card **is** a TRDD, and a card's
position and owner **are** two of that TRDD's frontmatter fields:

| The statement | The fact on disk |
|---|---|
| "this task is in column *blocked*" | the TRDD's `column: blocked` |
| "this task is assigned to agent X" | the TRDD's `assignee: X` |

`column:` is the kanban column (17 ratified values); `assignee:` is the
agent it is assigned to. Nothing else records either fact, so nothing
else can disagree about it. To move a card you edit one line of one
file; to render the board you `grep -H "^column:" design/**/*.md`.

### The index document is a buffer, not a board

Rescanning every agent's `design/` tree on every question is expensive,
so a **kanban index document** is maintained as a cache: one row per
TRDD carrying its id, title, `column:`, `assignee:`, and blockers,
across every open project. A subconscious agent or a script refreshes
it; the MANAGER and the ORCHESTRATOR read it to plan. The same is true
of the GitHub Project board and the dashboard's kanban view.

**All three are proxies, and a proxy is allowed to be stale.** The
discipline that keeps a cache from quietly becoming a second source of
truth:

- **Regenerable.** Delete the index and nothing is lost — it is rebuilt
  from the TRDDs. If rebuilding it would lose information, something was
  written *only* to the index, which is the bug.
- **Never authored.** No decision lands in the index. No agent edits it
  to change a column; it edits the TRDD, and the refresher catches up.
- **Never trusted when it matters.** Plan from the index; **act from the
  TRDD**. Before a transition, an approval, or anything irreversible,
  read the file. A stale row is expected, not a defect.
- **Mirror writes flow backwards.** A drag on the GitHub board or in the
  dashboard is applied by writing it into the TRDD (`column:` edit +
  folder `git mv`); it is never left living in the mirror alone.

## The three kanbans — one QUERY per scope (USER, 2026-07-18)

There is not one board but **three**, one per TRDD **scope**, and each is a
**QUERY over the TRDD corpus**, never a store. The TRDDs are the blood cells of
the circulatory system; a kanban is just the set of them matching
`(scope, discriminator)`:

| kanban | filter | cardinality | where its TRDDs live | pushed? |
|---|---|---|---|---|
| **local / agent** | `scope: local` ∧ `created-by == <agent>` (author **==** assignee — self-assigned) | **1 per AGENT** | `~/.claude/projects/<agent-slug>/design/` | **NO** (machine-private) |
| **project / team** | `scope: project` ∧ `project-id == <project>` | **1 per Project = Team** | each project repo's `<repo>/design/` | yes (git-tracked) |
| **user / host** | `scope: user` ∧ `host-id == <host>` | **1 per HOST** | the host-level user store (mirrors USER memory) | host-only |

- **local / agent** — the agent's OWN self-assigned chores and local-repo matters.
  Not pushed, not orchestrated by the central board — the agent runs it itself.
- **project / team** — the shared team board. A project may span **N GitHub repos**
  but is **ONE kanban**; each card carries a **`repo:`** annotation naming which
  repo it touches. `project-id` is the discriminator; `repo` is per-card metadata.
- **user / host** — the global board: cross-project / cross-team mandates, issues,
  and proposals. No `project-id`.

**The discriminator is a frontmatter field, and mostly already exists:** local keys
off the existing `created-by` (== `assignee`); project keys off **`project-id:`**;
user keys off **`host-id:`** (or is implicit from the host store). A project-scoped
TRDD MUST carry `project-id`; a user/local TRDD MUST NOT. (`scope: user` and the
`project-id`/`host-id`/`repo` fields are a proposed addition to the IND base
`trdd-design-tasks.md` — coordinated with the ai-maestro-janitor; this overlay
documents the fleet model that rests on them.)

**The buffers are caches, never ground truth.** The GitHub Project board, the
ai-maestro dashboard kanban, and any `trddgrep`/index document are **mirrors** of
these three queries — they go stale on every TRDD edit and are constantly
re-derived. The query over the TRDDs is the only ground truth (this is the
"index is a buffer" discipline above, applied to all three scopes). And the
**derived TRDDs (NPT/EHT) are the platelets** — they cover and fix the holes a
parent TRDD's change opens, so a board is never just its cards but its cards plus
the platelets closing their wounds.

## What changes when the project is an ai-maestro agent workdir

The board's substrate is unchanged — the cards are still the TRDDs and
the internal universal kanban (the `column:` field over `design/`)
remains the **single source of truth**. The overlay adds:

1. **Shared per-project board.** The PROJECT-scope board is one-per-PROJECT
   (the per-agent `local` board and the per-host `user` board are the other
   two scopes above). Every agent working the project reads and mutates
   the same project board (through the same git-tracked `design/` tree — pull
   before acting, push after each change).
2. **Multiple assignees.** `assignee:` names any registered agent, not
   just "this Claude". Assignment happens at `dispatch → dev` per the
   transition-authority table in `aimaestro-trdd-approval.md`.
3. **Editor authority.** A card may be edited (moved, re-assigned,
   annotated) only by:
   - the card's **assignee agent** itself (its own work states),
   - the project's **ORCHESTRATOR** (dispatch, priorities, re-assignment),
   - when the project has no team: the **MAINTAINER**, the
     **AUTONOMOUS** agent, or the **MANAGER** directly,
   - the **USER**, always — via the ai-maestro dashboard UI, which is
     the human's management surface for the multi-agent board.
   Column-transition authority (which TITLE may trigger which move)
   is the Part B2 table in `aimaestro-trdd-approval.md` — this rule
   adds no second matrix.

## The three mirrors (sync topology)

```
internal universal kanban (TRDD column: over design/)   ← SSOT
        │
        ├──▶ ai-maestro dashboard kanban (per-project board in the UI;
        │     server task registry) — the USER's live management view
        │
        └──▶ GitHub Project kanban — a MIRROR of the internal board
              (Status field options = the 17 ratified labels)
```

- Sync is **one-way authoritative**: the internal board is truth; the
  dashboard and the GitHub Project reflect it. A mutation made in a
  mirror (a user dragging a card in the UI, a Status change on the
  GitHub Project) is applied by writing it BACK to the TRDD (`column:`
  edit + folder `git mv`) — never by letting the mirror diverge.
- The server `TaskStatus` vocabulary is 1:1 with the 17 columns; every
  consumer (dashboard boards, GitHub Project mirrors, `amp-kanban-*.sh`,
  role-plugins) aligns TO the ratified vocabulary, never the reverse.

## The CLI surface

Agents mutate the board via the `amp-kanban-*.sh` scripts (the
decoupling layer — never the server API directly). Task creation
carries the full TRDD field contract (`--parent`, `--npt`, `--eht`,
`--supersedes`, `--relevant-rules`, `--severity`, `--effort`,
`--release-via`, `--status` with the 17-column vocabulary).

## Orchestrator-plugin alignment (the contract downstream tools must satisfy)

The ORCHESTRATOR role-plugin's kanban scripts MUST:

- use the ratified 17-column vocabulary verbatim (no renames, no
  divergent column sets, no parallel task stores);
- treat the TRDD corpus as the SSOT — every board mutation lands in the
  TRDD file (and its folder), not only in a mirror;
- respect the editor-authority list above (an ORCHESTRATOR moves and
  re-assigns; it does not silently perform USER- or MANAGER-gated
  transitions);
- round-trip GitHub-Project mirror changes back to the TRDDs.
