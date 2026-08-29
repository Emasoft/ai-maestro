---
trdd-id: TS4G74XA
title: Bring the settings safe-editor to the USER's seven-step transaction spec
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T23:49:52+0200
updated: 2026-08-29T12:44:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
priority: 1
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
implementation-commits: [471c4c4b, b8fe744a]
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

**Boundary RESOLVED (USER, 2026-08-06):** *"if one step failed for more than 3 times (that
is, at the 4th attempt: the first + the 3 retries) then the whole transaction fails. but if
it succeed at the 4th attempt, the next step with the error counter is evaluated
independently in the same way. the errors do not compound across steps. … multiple steps
with 3 errors each, even if cumulatively they amount to 6 errors, they do not trigger the
failure, since they are relative to different issues."*

So, exactly: **the counter is keyed PER STEP** (the latest ruling's key — the earlier
"(step, error)" phrasing collapses to this); a step gets **4 attempts** (first + 3
retries); the **4th failure of the same step** fails the transaction; a **success at the
4th attempt is a valid success** and hands over to the next step with ITS OWN untouched
counter. Cross-step totals are meaningless — 3+3 errors across two steps is a passing
transaction if each step eventually succeeded.

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

- [x] Pre-lint retries: a read that parses on attempt 2 or 3 SUCCEEDS the transaction; one
      unparseable on all 3 fails with `UnreadableTargetError`. Pinned with a fixture whose
      reads are injected (attempt-counted), not chmod-based.
      **DONE 2026-08-29 — `471c4c4b`**, `tests/unit/json-io-prelint-retry.test.ts`. Reads are
      served from a test-controlled plan (the ONE seam mocked); every other operation is real.
- [x] Retry restarts the WHOLE transaction: the retried attempt operates on a FRESH read,
      never the discarded copy — pinned by a fixture whose file content CHANGES between
      attempts and an assertion that the committed result derives from the newest content.
      **DONE 2026-08-29 — `471c4c4b`.** The mutator records the base it was handed; it runs
      exactly ONCE, on the retry, against the fresh read. The failed attempt never reaches it,
      which is what "the copy is discarded" means.
- [x] PER-STEP budgets, independent: a transaction whose step 2 fails 3× then succeeds on
      its 4th attempt, and whose step 5 then fails 3× and succeeds on ITS 4th, COMMITS —
      6 cumulative errors, zero steps at 4. A shared global counter fails this test.
      **DONE 2026-08-29 — the gap flagged earlier the same day is now closed.** The read plan
      interleaves both steps' faults across 7 passes (3 torn reads, then 3 staleness misses
      against a file another writer moved, then a stable pass), and the transaction COMMITS at
      `attempts: 7` with neither step reaching its limit. A shared counter aborts at the 4th
      fault and reddens it.
- [x] The 4-attempt boundary, both directions: a step succeeding on its 4th attempt is a
      VALID success (the transaction proceeds); a step failing its 4th attempt fails the
      whole transaction, reported to the caller with the step named.
      **DONE 2026-08-29 — `471c4c4b`**, both sides pinned. Also FIXED a real off-by-one: the
      shipped `attempt >= maxAttempts` gave 3 attempts, not the spec's first-plus-3-retries.
- [x] The retry is of the READ only — a neuter proving no write occurs on any failed
      pre-lint path (the file's bytes are untouched after 3 failures).
      **DONE 2026-08-29 — `471c4c4b`.** After an exhausted pre-lint the on-disk bytes are
      asserted byte-identical to the pre-transaction read.
- [ ] Post-edit schema lint: a `set` op writing a schema-invalid value for a covered key
      FAILS the transaction with a typed error, no retry, file untouched.
- [ ] Schema lint is NARROW: a pre-existing oddity in an UNRELATED key does not block an
      edit to a covered key (pinned — this is the boundary most likely to be widened).
- [x] Existing conformant behaviour unchanged: staleness-gate retry, queue isolation,
      atomic swap, backups — the current test suite stays green.
      **DONE 2026-08-29 — `471c4c4b`.** Full suite: **497 files / 6577 passed / 2 skipped**,
      `tsc --noEmit` 0. One unrelated failure, `statusline-capture-wrapper` asserting a
      detached spawn returns inside 2 s and reading 17.7 s — a LOAD flake under full-suite
      parallelism on a box also running a 5.2 GB `alcore`; it passes 21/21 in isolation and
      touches nothing in `json-io`.
- [x] The `auditOk` caller sweep (carried from TRDD-PE54D95Q): establish whether the ~30
      gate callers branch on it; unchecked callers named.
      **DONE 2026-08-29 — the answer is ZERO, and every caller is an unchecked caller.**
      **38 production `updateJson` call sites across 10 files**, and **not one of those files
      mentions `auditOk` anywhere** (the card's "~30" was close):
      `services/element-management-service.ts` **22** · `app/api/settings/marketplaces/route.ts` 5 ·
      `services/role-plugin-service.ts` 3 · `lib/client-plugin-adapters/claude-adapter.ts` 2 ·
      `services/plugin-storage-service.ts` · `lib/user-scope-plugin-whitelist.ts` ·
      `lib/statusline-store.ts` · `lib/settings-gate.ts` · `lib/oauth-rotator/alert-delivery.ts` ·
      `lib/agent-plugin-whitelist-store.ts` (1 each).
      Method: grep `updateJson(` over `app lib services components scripts server.mjs` (all
      extensions the runtime uses — `.mjs` included, since `server.mjs` and `lib/*.mjs` load outside
      the bundle), excluding the definition file and doc-comment lines; then grep each of the 10
      caller files for `auditOk`. Outside `lib/json-io.ts` the identifier appears **only in tests**,
      where every occurrence but one is a mock return value being constructed.
      **The consequence is a finding, not just a count.** `lib/json-io.ts:331` states the contract
      as *"We surface `auditOk: false` and log loudly; the caller decides."* **No caller decides.**
      The post-commit audit at `:427` re-reads the file and compares it byte-for-byte against what
      was written — so it detects precisely the case where a write did not land as intended — and
      its entire effect today is a `console.warn`. That is the WARN-dressed-verification family
      this project keeps finding (R51.7's "a post-condition that does not gate the result is a log
      line that reads like one"), here at the layer every settings write goes through.
      **NOT proposing auto-rollback** — `:327-331` argues at length that restoring the backup would
      destroy a legitimate non-participating write by the `claude` CLI, and that reasoning stands.
      The gap is that "the caller decides" was never built on the caller side: the flag is returned,
      documented, and read by nobody. Whether the 38 sites should branch, or the contract should
      stop promising they do, is a design call for this card's spec work — it is named here rather
      than answered, because the box asked for the sweep and this is the sweep.
      **⚠ MATERIAL CORRECTION, same session — "no consumer" was literally right and materially
      MISLEADING, and the identifier grep is what made it so.** Two gaps in that sweep, the second
      found only after closing the first:
      **(i) The census enumerated DIRECT callers and concluded about CONSUMERS.**
      `lib/settings-gate.ts:212` does `return updateJson(…)` — it **propagates** the result out of
      `editSettings`, so every caller of `editSettings` receives `auditOk` while never appearing in
      a `updateJson(` census. There is exactly **one** such propagation site, and `editSettings` has
      **4 caller files** (`app/api/settings/edit/route.ts:110`, `lib/agent-invariants.ts:177`,
      `services/auto-update-service.ts:553`, `scripts/aimaestro-settings-cli.mjs:133`), none of
      which mentions `auditOk`. Set now closed: 38 direct + 3 indirect call sites, 14 files.
      **(ii) And two of those indirect consumers SPREAD the whole result — the exact case
      `grep auditOk` cannot see.** `app/api/settings/edit/route.ts:112` returns
      `NextResponse.json({ success: true, ...result })` and
      `scripts/aimaestro-settings-cli.mjs:134` prints `JSON.stringify({ success: true, ...result })`.
      **So `auditOk` IS surfaced — into an HTTP response body and onto a CLI's stdout — beside
      `success: true`.** No code branches on it, but "nobody sees it" is false: the contract's
      *"the caller decides"* is honoured by delegating the decision all the way out to an API/CLI
      consumer, undocumented, in the same object that says the write succeeded.
      That reframes the design question this box hands to the GAP work. It is not only *"should the
      38 sites branch?"* but *"is `success: true` beside `auditOk: false` an honest API response?"* —
      and the second is the sharper one, because it is already shipping to external consumers.
      **Method note, since this is the third instrument correction on one box:** the census that
      settles it is not a needle at all — classify each site by WHAT IT DOES WITH THE RETURN VALUE.
      **33 of the 38 direct sites are a bare `await updateJson(…)` with the result DISCARDED**, so
      they cannot read the flag under any spelling; that is proof by construction. Only the 5 that
      bind or destructure it, plus the 3 indirect sites, could consume it — and of those 8, two
      spread it outward. A grep for an identifier answers "does this spelling appear"; the box asked
      "does anyone act on it", and only the value-flow classification answers that.

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
