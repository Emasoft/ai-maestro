---
trdd-id: HF2DY4VT
title: The settings-edit API and CLI report success true while carrying auditOk false in the same object
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-29T07:48:30+0200
updated: 2026-08-29T08:12:30+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-29T07:48:30+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: major
effort: S
labels: [settings-gate, json-io, api-honesty]
external-refs: [TRDD-TS4G74XA, TRDD-PE54D95Q]
---

## Problem

`lib/json-io.ts::updateJson` runs a **post-commit audit**: after the atomic swap it re-reads the
file and compares it byte-for-byte against what it wrote (`:427`). A mismatch means *the write did
not land as intended*. It deliberately does **not** roll back — `:327-331` argues that restoring
the backup would destroy a legitimate write by a non-participating writer (the `claude` CLI takes
no lock of ours), and **that reasoning is correct and is not what this card disputes**. Instead it
returns `auditOk: false` and logs, on the stated contract:

> We surface `auditOk: false` and log loudly; **the caller decides.**

**No caller decides.** Measured 2026-08-29 under TRDD-TS4G74XA: 38 direct `updateJson` call sites
across 10 files plus 3 indirect ones through `editSettings`, and **not one branches on the flag**.
33 of the 38 discard the return value entirely, so they cannot read it under any spelling.

That alone is a design question, and it belongs to TS4G74XA. **This card is the part that is not a
question — it is already shipping to external consumers:**

- `app/api/settings/edit/route.ts:112` → `NextResponse.json({ success: true, ...result })`
- `scripts/aimaestro-settings-cli.mjs:134` → `console.log(JSON.stringify({ success: true, ...result }))`

Both **spread the whole result**, so `auditOk: false` is emitted **inside an object whose other
field says `success: true`** — into an HTTP response body and onto a CLI's stdout. A client reading
`success` is told the edit worked; the contradicting evidence is a sibling key it was never told to
look at, and which appears in no API documentation.

So the contract is honoured in the most literal and least useful way: *the caller decides* is
implemented by delegating the decision past every layer that could act on it, out to a consumer who
does not know the field exists.

## Why this is worth a card rather than a line in TS4G74XA

TS4G74XA owns the seven-step editor spec, and its GAP A / GAP B are about the *transaction*. This
is about the *response*, it is on a shipped public surface, and its fix is independent of both
gaps. A finding recorded only inside a ticked acceptance box stops being worked — that is precisely
the shape this project keeps rediscovering (a WARN dressed as a verification; a post-condition that
does not gate the result).

## Proposed fix — the options, not a decision

The right answer is a judgement about the API contract, so this card records the choices rather
than pre-empting them:

1. **Make the response honest at the boundary.** `success` reflects the audit: `auditOk: false` ⇒
   the response says so plainly (a distinct `status`/`warning`, or `success: false` with a typed
   `errorType: 'audit-mismatch'`). Strongest for the consumer; **changes a shipped response shape**,
   so it is a breaking public-API change and needs owner sign-off.
2. **Keep the shape, document the field.** `auditOk` stays a sibling of `success: true` but becomes
   part of the documented contract, so a consumer is told to read it. Cheapest; leaves the trap
   that any consumer who does not read it believes a possibly-unlanded write succeeded.
3. **Stop promising "the caller decides".** If no layer will ever act on the flag, `json-io.ts:331`
   should say what actually happens (detect + log + surface) rather than describe a delegation that
   does not exist. Cheapest of all and strictly an improvement, whatever else is chosen.

Option 3 is not exclusive with 1 or 2 and can land first.

## Verification

- A test driving `POST /api/settings/edit` with the audit forced to mismatch asserts the response
  does **not** claim unqualified success (shape per whichever option is chosen).
- A neuter: restore the current behaviour and that test must redden.
- The existing json-io and settings-gate suites stay green — no change to the write path, the
  backup policy, or the no-auto-rollback decision.

## Estimated risk

LOW to investigate. Option 1 is a breaking response-shape change (owner sign-off); options 2 and 3
are documentation-only and carry no runtime risk.

## Acceptance

- [x] The audit-mismatch path is reachable in a test (forced), and the current response is captured
      verbatim as the baseline
      **DONE 2026-08-29T07:58+0200 — `tests/unit/json-io-auditok-baseline.test.ts`, 2 cases.**
      The mismatch is forced by simulating the non-participating writer at its narrowest: `rename`
      is wrapped so the REAL rename happens and then one extra key is written to the target, which
      is what the audit read at `json-io.ts:427` then sees. Nothing in `updateJson` is stubbed —
      the lock, the write, the backup and the audit all run for real against a `mkdtemp` dir.
      BASELINE PINNED: a write that does not land returns **`changed: true` AND `auditOk: false`,
      and does NOT throw** — so no caller's `catch` runs and the only signal is the field none of
      them reads. That is the shape the two spreading consumers inherit verbatim, which is why the
      HTTP client and the CLI are handed `success: true` beside `auditOk: false` in ONE object.
      It also pins the interfering write SURVIVING, so the deliberate no-auto-rollback decision
      (`json-io.ts:327-331`) cannot be reversed by accident — that reasoning is correct and is not
      what this card disputes.
      POSITIVE CONTROL: with no interfering writer the same path returns `auditOk: true`, so the
      mismatch case cannot be passing because the audit always reports false.
      **NEUTER — and the one first recorded here was a TAUTOLOGY.** Flipping the injection flag off
      inside the test reddens the mismatch case, but that only proves the injection is load-bearing
      for the injection; it says nothing about whether the assertions are pinned to the audit
      comparison at `json-io.ts:427`. The real neuters mutate THAT line, and they come as a pair
      with **DISJOINT red sets**: `const auditOk = true` reds ONLY the BASELINE case, `const auditOk
      = false` reds ONLY the POSITIVE CONTROL. Either alone leaves the other green, so neither
      assertion can be deleted without a neuter noticing. Restored after each; 2/2.
      Measured the mock's blast radius too, since `vi.mock('fs/promises')` sits over a module the
      sibling suites also load: the three `json-io-*` files run together **18/18**, so it does not
      leak. **Full suite: 497 files, 6568 passed, 2 skipped, 0 failed.**
      The most durable line in the file is not an `auditOk` assertion — it is *"the interfering
      write SURVIVES"*, which converts the no-auto-rollback ARGUMENT at `:327-331` from prose into a
      check that fails if anyone reverses it.
      This asserts NO opinion on options 1/2/3 — whichever lands will change these expectations
      deliberately, with this file as the record of what it changed FROM.
- [ ] The USER picks option 1, 2 or 3 (option 1 alone needs their sign-off — it changes a shipped
      response shape)
      **STILL OPEN — asked 2026-08-29T08:0x, no answer within the prompt window (owner away).**
      Proceeding on the Tier-0 subset only: **option 2's documentation half landed** (see the box
      below). Option 1 was NOT taken and must not be taken without them — it is a breaking
      response-shape change.
- [x] Option 2, documentation half: the two spreading consumers now TELL the reader that
      `success` does not imply the audit agreed
      **DONE 2026-08-29T08:0x+0200.** `app/api/settings/edit/route.ts` and
      `scripts/aimaestro-settings-cli.mjs` both carry it in their header: the response/stdout
      SPREADS `UpdateJsonResult`, so `auditOk` is a sibling of `success`; a mismatch is not an
      error, nothing throws, and the caller still gets `success: true` / exit 0; a client reading
      only `success` will believe a possibly-unlanded write succeeded.
      Deliberately written as **what ships today, taking no position on the shape** — so it stays
      true if the USER picks option 1 (only the closing sentence, which points here, would change).
      Documentation-only: `tsc --noEmit` 0 errors, `node --check` on the CLI clean. Chosen over
      converging or deleting anything because it is the one move that is strictly an improvement
      under EVERY outcome of the open decision above.
- [x] `json-io.ts:331`'s "the caller decides" is either made true or replaced by what actually
      happens — this is option 3 and lands regardless of the choice above
      **DONE 2026-08-29T07:50:12+0200.** Replaced, not deleted: the line now records the measurement
      (0 of 41 sites branch; 33 discard the result outright), names what actually happens (two
      indirect consumers SPREAD the result to an HTTP client and a CLI beside `success: true`), and
      points at this card for the open decision. The no-auto-rollback argument above it is
      untouched — it was never the part that was wrong. Comment-only: `tsc --noEmit` 0 errors,
      `tests/unit/json-io-update.test.ts` 13/13 green.
      **PINNED, because the census had a half that was not a measurement.** The counts are dated
      and cite this card, so their rot is visible — but *"ZERO branch on the flag"* is an INVARIANT,
      and it fails in the reassuring direction: after someone adds a branch, the comment still says
      nobody does, and a reader who believes it may delete the flag or the audit as dead code. This
      repo already pins exactly this shape (`MIN_WITH_INVARIANTS` in `r51-7-invariants.test.ts`), so
      the census now lives in `tests/unit/json-io-auditok-consumers.test.ts` — 3 cases, with
      positive controls on the walker (>200 files, the definition by name) and the extractor (≥10
      caller files, three by name). NEUTER RUN: seeding `lib/zz-probe-auditok-consumer.ts` with
      `if (!res.auditOk) throw` reddens it and names the file; removing the probe returns 3/3.
      ⚠ The test is an IDENTIFIER scan and pins *"nobody BRANCHES"* only — the two spread consumers
      receive the field without naming it, so a green run must never be read as "no consumer".
      **If the USER picks option 1**, the comment's paragraph describing delegation-to-the-consumer
      as the status quo needs rewriting; this box is settled for options 2 and 3, not permanently.
- [ ] The chosen behaviour is pinned by a test with a recorded neuter run
- [ ] `tsc --noEmit` clean; json-io + settings-gate suites green

## Approval log

- 2026-08-29T07:48:30+0200 — MANDATE (self, min-approval-requirement: none). Filed from a finding
  measured under TRDD-TS4G74XA's `auditOk` caller sweep. Tier 0 to investigate and to land option 3;
  option 1 is a breaking public-API change and is marked for USER sign-off in the box above rather
  than assumed.
