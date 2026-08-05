---
trdd-id: T3FXA0Y0
title: Establish and enforce an exit-status contract across the frozen CLI
column: blocked
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-06T00:44:42+0200
implementation-commits: [0d31e3bc, 51db1b8a, f2abd10d]
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
blocked-by: [YU37A3M4]
pre-block-column: dev
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
- [x] `list --status` no longer silently returns empty for an advertised
      value that cannot match (#114). — The fix IS in the deployed source
      (`agent-commands.sh::validate_status_value` rejects `hibernated` with a
      reason naming the cause).

      *Originally left unticked, because the branch could not be observed from
      outside: the API gate answered 401 before argument validation was reached.
      The two updates below are why it is ticked now — the answer was to move
      the validation, not to find an authenticated session to watch it from.*

      **UPDATED 2026-08-05 — this is not merely an observability problem, it is
      the SAME defect as `--help`, and there is a third instance.** §6.4 says a
      LOCAL, OFFLINE operation must not be gated on the server. Rejecting an
      argument the grammar cannot accept is exactly that: `--status hibernated`
      is invalid on a host with no network at all, and the CLI already knows it
      — `check_api_running` just answers first. So a caller who typos an
      argument is told *"the API is not reachable"*, which is false and aims
      them at the wrong thing. The third instance is the dispatcher's own
      `*) Unknown command` arm in `aimaestro-agent.sh::main()`: a nonexistent
      verb also cannot be reported without a live server. (Cited by function,
      not by line — the fix below MOVED that arm, so a line number written here
      would already be pointing at unrelated working code.)

      **HALF DONE — the verb half is fixed and pinned (`51db1b8a`).** `main()`
      now runs `dispatch check "$@"` BEFORE `check_api_running`, so an unknown
      verb is reported locally: `aimaestro-agent.sh nonsense` exits 1 with
      `Unknown command`, zero mentions of the server, **with no credential and
      no live API**. Verified through the bare command name after deploying to
      `~/.local/bin` (backup `cli-backup-20260805_223553+0200`), not only from
      the repo path.

      ONE verb list, consulted twice: `dispatch()` takes a mode — `check`
      answers "is this a verb?" and runs nothing, `run` executes — and both read
      the same case arms. This is the whole design constraint. A second `case`
      above the gate would be two statements of one fact, and they drift the
      first time someone adds a verb to only one: then either a real verb is
      rejected as unknown, or an unknown one reaches the gate and gets the
      misleading message back.

      Two implementation traps, both hit: the arms must be `|| cmd_x "$@"` on a
      guard (see the `--status` half below for which guard — this originally read
      `[ "$mode" = check ]` and that polarity turned out to be the third trap),
      never `&& return 0` — `set -euo
      pipefail` is on, and a bare `cond && return 0` whose condition FAILS makes
      the statement's status 1 and kills the shell, breaking every run-mode
      dispatch. And the test must assert the server is **not blamed**, not
      merely that the command failed: exit 1 was already correct before the fix
      (the gate exits 1 too), so a status-only assertion passes either way and
      pins nothing.

      Neuter OBSERVED (`scripts/dev/neuter`, restore blob-verified): putting the
      gate back in front of recognition →
      **1 red / 56 green — `an UNKNOWN VERB is reported locally, without blaming
      the server`, and only it.**

      **DONE — the `--status` half (`f2abd10d`).** `dispatch()` gained a third
      mode, `validate`, on the SAME verb list, called between recognition and the
      gate. Measured on PATH with no credential: `list --status hibernated` exits
      1 naming the real reason, **zero** mentions of the server; `list --status
      active` (valid) passes validation and reaches the gate. The valid set now
      lives in one `validate_status_value()` called by both `cmd_list`'s parser
      and the pre-gate `validate_list_args()`.

      **The guard polarity was the trap.** Every other arm had to change from
      `[ "$mode" = check ] ||` to `[ "$mode" != run ] ||`. With `= check`, a third
      mode falls THROUGH to executing the command — adding `validate` would have
      made `dispatch validate list` actually list: a validation pass performing
      the operation it exists to pre-screen. A mode nobody wired up must be inert.

      **A vacuous test, caught by its own neuter — worth recording because the
      assertion looked obviously right.** The polarity test asserted the output
      blamed the server, and reverting the guard reddened NOTHING: `cmd_show`
      executing ALSO fails with 401, so no pattern matching *any* 401 can separate
      "fell through to the gate" from "ran the command and it failed at the same
      server". The discriminator is `cmd_show`'s OWN diagnostics (`Search agents
      failed`, `Get agent by ID failed`), which the gate never emits — asserting
      their ABSENCE, with the 401 match kept as the non-vacuity guard since a
      purely negative assertion also passes when nothing ran at all.

      Three neuters OBSERVED, each reddening exactly its own test and nothing
      else: skip the validate pass → the invalid-`--status` test; revert the
      polarity → the not-executed test; gate before recognition → the
      unknown-verb test.

      **Recorded, not built — the structurally correct successor.** There is no
      shared `api_request()` in `agent-commands.sh`; 11+ verbs call `curl`
      directly. So the gate cannot yet live at the point of network use, which is
      where it belongs and which would make any pre-gate pass unnecessary. Until
      then `validate_list_args` is a second walk over the same argv and must
      consume value-taking flags exactly as `cmd_list` does (`list --format
      --status` otherwise diverges) — stated in a comment at both ends. Extracting
      `api_request()` from a frozen CLI is its own card.
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