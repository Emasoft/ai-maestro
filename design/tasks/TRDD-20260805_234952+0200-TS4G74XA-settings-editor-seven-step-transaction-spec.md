---
trdd-id: TS4G74XA
title: Bring the settings safe-editor to the USER's seven-step transaction spec
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T23:49:52+0200
updated: 2026-08-05T23:55:16+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T23:49:52+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [settings-gate, json-io, safe-editor, owner-ours]
external-refs: []
---
# Bring the settings safe-editor to the USER's seven-step transaction spec

## The normative spec (USER, 2026-08-05, verbatim)

> Every edit transaction should happens this way:
> 1. the original settings.json is copied as settings.json.copy (overwriting existing with
>    the same name)
> 2. the copy is linted to verify it was valid to begin with (if not, it will retry the
>    transaction up to 3 times, then it will fail the transaction and report the error to
>    the caller)
> 3. the copy is edited with the mandated changes
> 4. the edited copy is linted again to ensure that after the changes it is still valid
>    json and valid claude code settings file (if not, it will fail the transaction and
>    report the error to the caller, no retry here)
> 5. the edited copy is diffed against the original settings.json to ensure that the diff
>    matches exactly the mandated changes (if not, it will retry the transaction up to 3
>    times, then it will fail the transaction and report the error to the caller)
> 6. the edited copy is finally swapped with the original copy
> 7. the editor reports a successful transaction to the caller, and then it goes on
>    executing the next transaction in queue

## Retry semantics clarified (USER, 2026-08-06, verbatim)

> note that when i say 'retry' i mean the whole transaction. from the beginning at step 1.
> in other words: the copy is discarded (it will be overwritten anyway), and a new copy is
> made and the sequence is attempted again. if the same error at the same step repeats more
> than 3 times, then no more retry, but the transaction is declared failed.

Two consequences, one already true and one that changes GAP A's design:

1. **The retry UNIT already conforms.** The shipped staleness-gate retry restarts the whole
   transaction: `continue` (:417) loops to the top, re-reads the file (the fresh copy),
   re-clones, re-applies the ops against the NEW base. It never patches the stale copy. No
   change needed — recorded so nobody "fixes" it into a per-step resume.
2. **The budget is per (step, error), not one global attempt counter.** Today only one step
   retries, so the shipped single `attempt` counter is indistinguishable from the spec. Once
   GAP A makes step 2 retryable too, the counters MUST be separate: a transaction that
   burned one attempt on a transient step-2 torn read has NOT spent any of step 5's budget.
   A shared counter would fail a transaction that never repeated the same error 3 times —
   stricter than the spec, and precisely on the contended hosts the retry exists for.

Boundary to pin in a test, because the prose admits two readings: *"repeats more than 3
times"* — the transaction fails on the 4th occurrence of the same (step, error); three
repeats still retry. If implementation prefers the stricter fail-on-3rd, that is a
deviation to surface, not to silently pick.

Step 4 remains NO-retry per the spec's own step text — a deterministic re-edit reproduces
the same invalid result, so its failure is never "the same error repeating" in the
transient sense; it is the same error guaranteed.

## Conformance of the shipped editor (`lib/json-io.ts::updateJson`, verified 2026-08-05)

| step | shipped | verdict |
|---|---|---|
| 1 — copy the original | in-memory read + `structuredClone`; original bytes preserved on disk by `keepBackup` (:400) as timestamped `.aim-bak-*`, newest 10 kept | ✓ equivalent-or-stronger (10 recoverable backups vs one overwritten `.copy`) |
| 2 — pre-lint, **retry ×3** | `parseOrRefuse` (:367) — refuses on attempt 1, **NO retry** | ✗ **GAP A** |
| 3 — apply mandated changes | bounded `set`/`delete` ops on the clone | ✓ |
| 4 — post-lint: valid JSON **and valid claude-code settings**, no retry | JSON validity by construction (`JSON.stringify` of an object); **NO schema validation** — `applySettingsOps` (:151-181) assigns `op.value` verbatim | ✗ **GAP B** (JSON half ✓; schema half missing) |
| 5 — diff == mandated changes, **retry ×3** | staleness gate (:408-417): whole-file byte-compare vs transaction start, retry ×3 with `200ms × attempt` backoff, lock held, then `ConcurrentModificationError` | ✓ equivalent instrument — any concurrent write cancels the swap; "only my lines" is delivered by the bounded ops grammar by construction + the post-commit audit (:426-427) |
| 6 — atomic swap | fsync-tmp + `rename` (:404,:420) | ✓ stronger (durability barrier before the swap) |
| 7 — report + next in queue | typed result/throws to THIS caller; queue isolates failures (`.catch(() => {})` :229, `finally` unlock :234) so the next transaction always runs | ✓ |

**Steps 1, 3, 5, 6, 7 conform** (5 by an equivalent instrument — byte-compare instead of a
line-diff; do not "fix" that, it has the same cancellation power and fewer moving parts).

## The two gaps — this card's work

### GAP A — the pre-lint does not retry (spec step 2)

Shipped behaviour refuses on the FIRST unparseable read. Correct for corrupt-at-rest, but
the spec's retry exists for the other cause of the same symptom: a TORN READ while a
non-participating writer (the `claude` CLI, 20+ agent instances) is mid-write. Those are
transient; a re-read cures them.

**Fix shape: retry the READ, never the write.** On `parseOrRefuse` failure, re-read up to 3
times with backoff; if still unparseable, fail the transaction with `UnreadableTargetError`
to the caller (never overwrite — the `{}`-rebuild incident stands). The retry loop already
exists for the staleness gate; this extends the same counter/backoff to the initial read.

### GAP B — no claude-code-schema lint of the edited copy (spec step 4)

`op.value` is committed verbatim: a value Claude Code itself would reject (wrong type,
unknown enum) lands cleanly and surfaces only when a session next loads the file. Spec
step 4 requires the edited copy to be "valid json AND valid claude code settings file".

Design question inside it: **what is the schema source of truth?** Candidates: a vendored
JSON-schema for the settings surface we edit (narrow — only the keys our ops touch), or
`claude`'s own validation if any CLI surface exposes one. Keep it NARROW: validating only
the keys the transaction touched matches step 4's intent without making the gate reject
unrelated pre-existing oddities in the user's file (which would turn every edit into a
whole-file audit and brick edits on files Claude Code itself accepts).

Per the spec: **no retry on step 4** — a deterministic re-edit yields the same invalid
result. Fail and report.

## Acceptance criteria

- [ ] Pre-lint retries: a read that parses on attempt 2 or 3 SUCCEEDS the transaction; one
      unparseable on all 3 fails with `UnreadableTargetError`. Pinned with a fixture whose
      reads are injected (attempt-counted), not chmod-based.
- [ ] Retry restarts the WHOLE transaction: the retried attempt operates on a FRESH read,
      never the discarded copy — pinned by a fixture whose file content CHANGES between
      attempts and an assertion that the committed result derives from the newest content.
- [ ] Per-(step, error) budgets: a transaction that spends 1 attempt on a step-2 torn read
      and then hits step-5 conflicts still has step 5's FULL budget — a shared global
      counter fails this test. The >3 boundary pinned: 3 repeats retry, the 4th fails.
- [ ] The retry is of the READ only — a neuter proving no write occurs on any failed
      pre-lint path (the file's bytes are untouched after 3 failures).
- [ ] Post-edit schema lint: a `set` op writing a schema-invalid value for a covered key
      FAILS the transaction with a typed error, no retry, file untouched.
- [ ] Schema lint is NARROW: a pre-existing oddity in an UNRELATED key does not block an
      edit to a covered key (pinned — this is the boundary most likely to be widened).
- [ ] Existing conformant behaviour unchanged: staleness-gate retry, queue isolation,
      atomic swap, backups — the current test suite stays green.
- [ ] The `auditOk` caller sweep (carried from TRDD-PE54D95Q): establish whether the ~30
      gate callers branch on it; unchecked callers named.

## Non-goals

- Changing the byte-compare staleness instrument to a literal line-diff (step 5 verdict:
  equivalent, fewer moving parts).
- Auto-rollback on post-commit audit mismatch (documented hazard — would destroy a
  legitimate non-participating writer's change, json-io.ts:327-331).
- Whole-file schema auditing (see GAP B's narrowness requirement).

## Cross-references

- TRDD-PE54D95Q — the auto-update card whose settings.json branch consumes this editor;
  its verification section holds the line-cited conformance evidence this card builds on.
- TRDD-RYFP030K — the gate this extends. TRDD-CS25TA6W / TRDD-K71FV649 — the json-io
  consolidation and strict-reader cards whose invariants this must not weaken.
