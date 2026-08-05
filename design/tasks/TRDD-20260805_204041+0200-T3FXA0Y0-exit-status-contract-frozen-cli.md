---
trdd-id: T3FXA0Y0
title: Establish and enforce an exit-status contract across the frozen CLI
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T22:32:10+0200
implementation-commits: [0d31e3bc]
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
eht: [3KJW8P6R]
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

- [x] The exit-status contract is written down in the repo, not only in
      this TRDD. — `docs/SCRIPT-MANIFEST.md` **§6.4**, beside the identity,
      environment and authorization conventions the same consumers already
      read. Three rules, each closing a way the signal has already broken
      here, plus the second-order harm as the reason it exists.
- [x] Every verb audited against it; findings recorded even where no change
      was needed. — `--help` across all **50 deployed** CLIs: **29 violated**,
      21 clean. The audit is recorded twice on purpose: as prose in §6.4, and
      executably as `KNOWN_VIOLATORS` in the ratchet, so it cannot rot into a
      stale paragraph. **28 of the 29 share one root** and are now
      **TRDD-3KJW8P6R** (this card's EHT).
- [ ] `create` with a valid spec exits 0. — NOT verified. It needs a live
      authenticated session and it CREATES AN AGENT, so it is not something to
      fire off at the end of a session; it wants a disposable target and a
      cleanup path.
- [ ] A failing `plugin marketplace add` prints the underlying error to
      stderr and exits non-zero.
- [ ] `list --status` no longer silently returns empty for an advertised
      value that cannot match (#114). — The fix IS in the deployed source
      (`agent-commands.sh:87-96` rejects `hibernated` with a reason naming the
      cause). NOT ticked, because I could not observe it end-to-end: the API
      gate answers 401 before argument validation is reached, so the branch is
      unproven from outside. Proving it needs an authenticated run.

      **UPDATED 2026-08-05 — this is not merely an observability problem, it is
      the SAME defect as `--help`, and there is a third instance.** §6.4 says a
      LOCAL, OFFLINE operation must not be gated on the server. Rejecting an
      argument the grammar cannot accept is exactly that: `--status hibernated`
      is invalid on a host with no network at all, and the CLI already knows it
      — `check_api_running` just answers first. So a caller who typos an
      argument is told *"the API is not reachable"*, which is false and aims
      them at the wrong thing. The third instance is the dispatcher's own
      `*) Unknown command` arm (`aimaestro-agent.sh:132`): a nonexistent verb
      also cannot be reported without a live server.

      **Fix shape (not applied — deliberately, see below).** Hoist the
      *recognition* pass above `check_api_running`, keeping the dispatch below
      it: verb membership first, then any verb-local argument grammar, then the
      gate, then execution. The trap to avoid is the obvious implementation —
      a second `case` listing the verbs above the gate — because that is two
      enumerations of one fact and they drift the first time a verb is added.
      It needs ONE list consulted twice, and that is a real restructure of
      `main()`, not a move. It was NOT attempted at the end of a session with
      little context left: a half-landed dispatcher rewrite is worse than a
      recorded finding, and this card's whole subject is CLIs that mislead
      their callers.

      Once hoisted, the box becomes checkable offline and needs no
      authenticated run at all — which is the second reason to prefer the fix
      over chasing a live session to observe the current shape.
- [x] A regression test asserts exit status, not just output, for at least
      the sampled verbs. — `tests/unit/cli-help-exit-contract.test.ts`, **56
      tests** (was 28 when this box was first ticked; the EHT's fix moved 27
      scripts from the known-violator list into the asserted set, and the count
      is restated here rather than left to rot into a wrong number beside a
      ticked box). 53 compliant scripts asserted individually, both ratchet
      directions (a NEW violator fails; a FIXED one fails with "delete this
      line"), two scan-liveness guards, and the true-positive gate test.
      Neuters recorded, both observed: restoring `check_api_running` ahead of
      the help dispatch reddens exactly `aimaestro-agent.sh --help exits 0`;
      and `s/exit 1/exit 0/` on the amp identity abort reddens exactly the
      true-positive test — 1 of 56, which is what proves the 55 help
      assertions cannot stand alone.

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