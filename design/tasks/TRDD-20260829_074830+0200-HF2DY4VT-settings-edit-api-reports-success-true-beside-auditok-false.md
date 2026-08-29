---
trdd-id: HF2DY4VT
title: The settings-edit API and CLI report success true while carrying auditOk false in the same object
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-29T07:48:30+0200
updated: 2026-08-29T07:48:30+0200
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

- [ ] The audit-mismatch path is reachable in a test (forced), and the current response is captured
      verbatim as the baseline
- [ ] The USER picks option 1, 2 or 3 (option 1 alone needs their sign-off — it changes a shipped
      response shape)
- [ ] `json-io.ts:331`'s "the caller decides" is either made true or replaced by what actually
      happens — this is option 3 and lands regardless of the choice above
- [ ] The chosen behaviour is pinned by a test with a recorded neuter run
- [ ] `tsc --noEmit` clean; json-io + settings-gate suites green

## Approval log

- 2026-08-29T07:48:30+0200 — MANDATE (self, min-approval-requirement: none). Filed from a finding
  measured under TRDD-TS4G74XA's `auditOk` caller sweep. Tier 0 to investigate and to land option 3;
  option 1 is a breaking public-API change and is marked for USER sign-off in the box above rather
  than assumed.
