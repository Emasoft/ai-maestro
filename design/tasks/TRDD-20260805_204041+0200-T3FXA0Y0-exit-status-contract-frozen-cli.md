---
trdd-id: T3FXA0Y0
title: Establish and enforce an exit-status contract across the frozen CLI
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T20:40:41+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:40:41+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [manager-filed, testbot-session, owner-ours]
external-refs: [Emasoft/ai-maestro#121]
---
# Establish and enforce an exit-status contract across the frozen CLI

## Problem

`aimaestro-agent.sh` returns an exit status that is uncorrelated with the
outcome, in all three possible directions. Three sightings, two verbs:

| verb | observed | actual outcome |
|---|---|---|
| `list --status online` (#114) | exit **0**, empty | the filter can never match — not "no agents" |
| `create <name> --title autonomous` | exit **1** | complete success, every field verified set |
| `plugin marketplace add <a> <src>` | exit **1**, no message | genuine failure, cause undiagnosable |

The fleet drives these scripts non-interactively and R23 makes the CLI the
only sanctioned surface, so the exit status is the fleet's single machine-
readable success signal. Today that signal is unusable: `0` does not mean
success, `1` does not mean failure, and a `1` may arrive with no message
attached.

The second-order harm is the one that matters. A CLI that exits non-zero on
success trains every caller — human and agent — to stop branching on the
exit code. Once they do, the exits that ARE real become invisible, and the
`cmd || exit 1` guard the shell rules mandate turns into a liability: it
aborts correct runs, so it gets deleted, so nothing catches the real
failures.

## Scope

This is one task, not three bug fixes: define the contract once, then make
every verb obey it.

1. **Define the contract.** Exit `0` if and only if the requested state
   change is committed and verifiable. Non-zero otherwise. Every non-zero
   exit prints at least one line to **stderr** naming what failed and why.
   No verb exits non-zero without a message; no verb exits zero on a no-op
   the caller asked to be an op.
2. **Audit every verb** in `aimaestro-agent.sh`, `aimaestro-teams.sh`,
   `aimaestro-governance.sh`, and the `amp-*` scripts against it. The three
   sightings above are a sample from two verbs, found incidentally during
   unrelated work — they are not the result of a search, so assume more
   exist.
3. **Fix the sampled three**, including the swallowed error in
   `plugin marketplace add`. The trigger for that one is unidentified, and
   fixing the silence does not require identifying it — surfacing the
   underlying error is what makes the next occurrence self-diagnosing.
4. **Document the contract** where the CLI's consumers will read it, so
   role-plugin authors can rely on it.

## Acceptance criteria

- [ ] The exit-status contract is written down in the repo, not only in
      this TRDD.
- [ ] Every verb audited against it; findings recorded even where no change
      was needed (a verified non-defect is evidence, and stops the next
      audit re-deriving it).
- [ ] `create` with a valid spec exits 0.
- [ ] A failing `plugin marketplace add` prints the underlying error to
      stderr and exits non-zero.
- [ ] `list --status` no longer silently returns empty for an advertised
      value that cannot match (#114 — fold it in or keep it separate, your
      call).
- [ ] A regression test asserts exit status, not just output, for at least
      the sampled verbs. Without this the contract decays back to today's
      state, because nothing observes an exit code that nobody branches on.

## Non-goals

- Changing any verb's flag surface or output format. This is about the exit
  status and the presence of an error message, nothing else.
- Identifying the `marketplace add` trigger as a precondition for fixing
  the silence. If the audit finds it, good; the fix must not wait on it.

## Verification

Drive each audited verb twice — once in its success path, once in a forced
failure path — and assert the exit status and the presence of a stderr line
in the failure case. Assert on the **exit code**, never on stdout text
alone; an assertion that only reads stdout is exactly the check that let
all three of these ship.