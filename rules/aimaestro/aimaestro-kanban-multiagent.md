<!-- ai-maestro:installed-dep-rule -->

# ai-maestro overlay — the multi-agent kanban

> **DEP overlay — installed by the ai-maestro server** into each
> registered agent workdir's `.claude/rules/`. It EXPANDS the IND base
> `universal-kanban.md` (the mono-agent 17-column board over the TRDD
> corpus — shipped globally by the ai-maestro-janitor and assumed
> present); base content is NOT restated here. This overlay turns the
> same board multi-agent: shared per project, many assignees, edited
> under title authority, mirrored to the dashboard and GitHub.

## What changes when the project is an ai-maestro agent workdir

The board's substrate is unchanged — the cards are still the TRDDs and
the internal universal kanban (the `column:` field over `design/`)
remains the **single source of truth**. The overlay adds:

1. **Shared per-project board.** The board is one-per-PROJECT, not
   one-per-agent. Every agent working the project reads and mutates
   the same board (through the same git-tracked `design/` tree — pull
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
