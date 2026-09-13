---
trdd-id: 5Y7IKVLW
title: Is the subagent write-guard hook ever invoked, and its two checks disagree about the project root
column: todo
created: 2026-09-13T20:35:41+0200
updated: 2026-09-13T20:35:41+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-13T20:35:41+0200
---

# Is the subagent write-guard hook ever invoked, and its two checks disagree about the project root

## Problem

Two questions about `.claude/scripts/subagent-write-guard.sh`, both unanswered, the first load-bearing for every "subagents are contained" assumption in this repo.

**1. Is the hook ever invoked?** The project rule file records this as open under workspace trust, noting that "the guard went inert" is indistinguishable from "the guard allowed the write" from outside. No config read answers it. Proving it needs a real agent spawn attempting a write outside the project and outside `/tmp`, spawned by BARE name (a plugin-namespaced name resolves to the plugin's copy, whose frontmatter `hooks:` Claude Code ignores, so the probe would prove nothing). If it never fires, the script is dead code.

**2. Two checks inside the guard disagree about the project root.** Measured 2026-09-13, driving the script directly with `CLAUDE_PROJECT_DIR=<repo>`:

| Bash command, same target file | verdict |
|---|---|
| `echo x >> <repo>/design/requirements/PRRD.md` | exit 0 — allowed |
| `tee -a <repo>/design/requirements/PRRD.md` | exit 2 — `Rule 0: write op references forbidden tree: <repo>` |
| `cp /tmp/a <repo>/design/requirements/PRRD.md` | exit 2 — same reason |

Rule-0c hardcodes `$HOME/ai-maestro/` as a forbidden tree and pairs it with a literal verb list (`rm mv cp mkdir rmdir touch tee chmod chown install ln dd truncate shred`). The redirection check (#3) routes through `is_allowed_path`, which permits the project root. So 0c forbids the very tree the allowlist exists to permit, and which answer you get is decided by which verb you type. There is no precedence between the two.

## Root cause

Both defects are the same class as ai-maestro#161: policy expressed as a hand-maintained list of literal strings, drifted from the property it encodes. 0c was written when the guard served scenario agents whose project root was NOT the ai-maestro tree; for an agent whose root IS that tree the prefix is self-contradictory.

## Proposed fix

Not decided. 0c's intent (stop a scenario agent mutating the user's real trees) is legitimate; the bug is that it applies the prefix unconditionally instead of relative to the resolved root. Candidate: skip a forbidden-tree prefix when it is a prefix of, or equal to, `PROJECT_ROOT_ABS`. Do not touch this before question 1 is answered — fixing a guard nothing invokes is wasted work.

## Verification

Question 1: spawn a hooked agent by bare name, have it attempt a write to a path outside the project and outside `/tmp`, and record whether the block fires. Question 2: extend `.claude/scripts/test-subagent-write-guard.sh` with the three rows above; neuter the fix and confirm the named cases redden.

## Estimated risk

LOW to investigate. Question 1 has no safe shortcut — it needs a real spawn. Question 2's fix is MED because loosening 0c is a weakening of a guard whose invocation status is unknown.

## Scoping correction owed

An earlier version of ai-maestro#161's comment thread published this guard's behaviour as a single table three separate times. It is not one table: the verdict depends on whether the agent's `CLAUDE_PROJECT_DIR` is the main tree or a worktree, and the four agents declaring the hook split two and two. Measured both ways 2026-09-13; the live comment now carries the scoped version.

## Acceptance

- [ ] Question 1 answered by a real BARE-NAME agent spawn attempting a write to a disposable dir under $HOME created for the probe, outside the project and outside /tmp, with the observed outcome recorded here. A plugin-namespaced spawn proves nothing — Claude Code ignores frontmatter hooks on plugin-shipped agents.
- [ ] The branch that question 1 selects is carried out in full — hook fires => the question-2 inconsistency fixed, with a neuter naming the reddened tests; hook does not fire => every rule and doc claiming subagent containment corrected to say so
- [ ] The branch NOT taken recorded here as not-applicable with its reason, and any disposable probe target removed
- [ ] `.claude/rules/prevent-subagents-to-write-outside.md` "Still open" section updated to cite this card

## Approval log

## Approval log

- 2026-09-13T20:35:41+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
