---
trdd-id: WMNE9OU3
title: ai-maestro-plugin kanban-sync install gap and the superseded model both scripts teach
column: todo
created: 2026-08-22T19:01:15+0200
updated: 2026-08-22T19:02:52+0200
current-owner: user
created-by: user
task-type: docs
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T19:01:15+0200
assignee: ai-maestro-hub
priority: 2
labels: [cross-repo, kanban, owner-act, scripts]
external-refs: [TRDD-GIONLYAF]
---

# ai-maestro-plugin kanban-sync install gap and the superseded model both scripts teach

# `ai-maestro-plugin` — the `kanban-sync` install gap, and the superseded model both scripts teach

Descoped out of **TRDD-GIONLYAF** (OWNER DECISION 2). Two findings for ONE repo, both
verified first-hand 2026-08-22, neither actionable from here: the fix belongs in
`ai-maestro-plugin`, and reaching another project's tracker under the shared owner GitHub
identity needs the owner's word (`~/.claude/rules/how-to-fix-issues-of-other-projects.md` —
*"Wait for explicit direction before touching PROJECT B in any way"*).

## Finding 1 — the skill declares a tool that no repo installs

`ai-maestro-plugin/skills/team-kanban/` names `kanban-sync.py` in four places at current
source HEAD (`~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/skills/team-kanban/SKILL.md`):

| site | what it says |
|---|---|
| `SKILL.md:5` | `allowed-tools: … Bash(kanban-sync.py:*)` — a **declared tool** |
| `SKILL.md:34` | *"For GitHub sync: `gh` CLI authenticated, `kanban-sync.py` at `~/.local/bin/`"* |
| `SKILL.md:11` | *"GitHub-sync (`kanban-sync.py`, `gh`) is OUT OF SCOPE — keep"* — a recorded decision to retain |
| `SKILL.md:36`, `:50` | worked invocations of `kanban-sync.py link <team-id> <owner/repo> <project-number>` |
| `references/github-sync.md:203-205` | `kanban-sync.sh` — *"still exists for backward compatibility"* |

The file exists on THIS machine (`~/.local/bin/kanban-sync.py`, 11661 B, dated 2026-03-15)
and **nothing ships it**: a symlink-aware byte-compare census over `~/Code` + `~/ai-maestro`
(3.7M files indexed, controls `publish.py`=42 / `trddgrep.mjs`=1) finds **no same-named file
anywhere in the fleet**, and `git log --all --diff-filter=AD` finds no add and no delete.

So the plugin tells the user the file must be at `~/.local/bin/` and ships nothing that puts
it there. On any other machine the skill's GitHub-sync path is a command-not-found.

## Finding 2 — both scripts teach the INVERSE of the ratified kanban model

|  | the script | the ratified rule |
|---|---|---|
| source of truth | `kanban-sync.py` docstring line 5: *"GitHub is the sole source of truth."* | `aimaestro-kanban-multiagent.md`: *"Sync is one-way authoritative: the internal board is truth"* |
| column vocabulary | `kanban-sync.sh:108` — `local init_status="backlog"` | the ratified 17 columns begin at `backburner`; `backlog` is not among them |

Both are dated **2026-03-15**; the overlay that ratified the model landed **2026-07-08**. They
are stale-by-supersession, not rogue — nothing removed them when the model changed.

This is `check-all-files-after-breaking-change` one level BELOW prose: a superseded model
shipped as a runnable file, where no linter, type-check or test can see it. An agent that
finds `kanban-sync.py` on PATH and reads its docstring learns the exact inversion of the rule
it is meant to obey.

## Why this is not a disposal question

**GIONLYAF ruled KEEP on both files** — deleting either would make a shipped skill's own
documentation false, and neither exists in any git history, so the removal is unrecoverable.
The defect is CONTENT in files the `team-kanban` skill owns. Fixing it is that repo's call.

## What the owner has to decide

1. Whether to open an issue on `Emasoft/ai-maestro-plugin` carrying both findings (an
   outward-facing write under the shared identity).
2. Whether GitHub-sync should still be offered at all, given the ratified model — a DESIGN
   question for that plugin's session, which `SKILL.md:11` currently answers "keep".

If the answer to (1) is yes, the issue body is essentially this card. Per PRRD G1.1 it must
open with a plain-words self-identification line and carry **no `@`**.

## Acceptance

- [ ] The owner rules on whether to file the cross-repo issue
- [ ] If filed: the issue carries BOTH findings (install gap AND superseded model), not just the first
- [ ] `ai-maestro-plugin` either ships `kanban-sync.py` or removes the four declarations that promise it

## Approval log

- 2026-08-22T19:01:15+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
