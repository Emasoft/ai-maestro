---
trdd-id: K71FV649
title: loadJsonSafe returns an empty object on a PARSE failure, so every verification built on it reads unreadable as absent
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T21:26:06+0200
updated: 2026-07-31T21:34:48+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-31T21:26:06+0200
relevant-rules: [R51]
blocked-by: []
implementation-commits: [69e801a9]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body)

**THE DECISION IS MADE AND THE READER LANDED — `69e801a9`.** Filed 2026-07-31 because the same
defect blocked TWO separate promotions in one session, an hour apart, on two different pipelines.
Each instance was measured while doing other work, and in each the honest move was to leave a
verification *un-promoted* rather than build on a reader that cannot fail.

**SHAPE CHOSEN: a fourth one the card did not list — derive the LENIENT reader from a STRICT one.**
`readJson()` returns `{ok:true,data} | {ok:false,reason:'missing'|'unreadable',error}`, and
`loadJsonSafe` is now `read.ok ? read.data : {}`. This has neither cost the listed options carried:
the `{}` default is byte-identical for all **36** callers so **none is touched** (option 1's problem
— several sit inside `withSettingsLock` callbacks where a throw aborts a write path that used to
proceed), and there is exactly ONE parse in one place so the strict and lenient answers **cannot
drift** (option 3's problem). Options 1 and 2 are REJECTED on those grounds; option 3 is superseded
by this stronger form of itself.

**SO THE AUDIT SHRANK, and that is the real finding.** "Audit 36 call sites" was the right worry for
a shape that changes the lenient contract. Deriving it changes nothing for them, so what remains is
per-verification: *which checks should ask the sharper question* — one decision per promotion, each
needing its own evidence, not a sweep.

**NEXT ACTION.** `ChangePlugin`'s G11 is the first consumer and now reports *"exists but does not
parse — state is UNKNOWN, not absent"* as its own case; it is deliberately still a WARN. Decide
whether that case should now GATE (and whether G11 can become an R51.7 invariant given it), then
`InstallElement`'s PG01 on the same terms. **The 4 copy-pasted twins are untouched** —
`lib/client-plugin-adapters/claude-adapter.ts`, `services/plugin-storage-service.ts`,
`services/role-plugin-service.ts` — and each needs the same treatment or an explicit "lenient by
design" note.

## Problem

```ts
// services/element-management-service.ts:362-370
async function loadJsonSafe(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) return {}
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}          // ← a PARSE failure and a MISSING FILE are the same answer
  }
}
```

A missing settings file legitimately means "no plugins enabled" — that `{}` is correct and every
first-run path depends on it. A file that EXISTS and does not parse means something else entirely:
the state is unknown. Collapsing the two makes every caller that asks *"is key X present?"* read a
corrupt file as a confident **no**.

**This is the shape `.claude/rules/lessons-verification.md` already records:** *"A reader that
returns `[]` on an I/O error turns its gate into one that passes because it read nothing — separate
ENOENT (legal absence) from every other errno (a fault), or 'clean' and 'unread' are the same
answer."* Here the fault is a parse error rather than an errno, and the consequence is worse than a
vacuous pass, because the answer is then used to DECIDE.

## Why it matters — two measured instances, both from 2026-07-31

| where | what it blocked |
|---|---|
| `InstallElement` PG01 (`:1191`) | Advisor review recommended wiring PG01's Claude branch into the R51 window's `invariants` hook, on the premise *"the read-failure case is already a separate WARN"*. It is not: PG01's `catch` fires only if `loadJsonSafe` itself throws, which it never does. A corrupt `settings.local.json` therefore reads as "key absent" — and an aborting PG01 would **uninstall a working plugin because a file was unreadable**. Recommendation declined (`TRDD-YAGRX7W3`). |
| `ChangePlugin` G11 (`:4888`) | Same reader, same question, same conclusion: left as a WARN instead of being promoted to an R51.7 invariant, because a corrupt settings file would **roll back a correct plugin change** (`TRDD-DQ6XN2VP`). |

So the defect is not merely latent: it is actively holding back two verifications that R51 says
should gate their pipelines' results. Every future promotion built on a settings read hits it too.

## Proposed fix (decide before writing)

The reader must distinguish **legal absence** from **a fault**. Three shapes, pick one and say why:

1. **Throw on a parse failure, keep `{}` for ENOENT.** Smallest change, and it makes every caller's
   existing `try` meaningful. But 36 + N call sites currently cannot throw, and some are inside
   `withSettingsLock` callbacks where a throw now aborts a write path that used to proceed.
2. **Return a discriminated result** (`{ ok: true, data } | { ok: false, reason }`). Explicit and
   audit-friendly; every call site must be touched, which is the cost AND the point.
3. **A second entry point** (`loadJsonStrict`) used only by verifications, leaving the lenient
   reader for the write paths that legitimately want a default. Cheapest to land safely; risks
   becoming two readers that drift.

**Whichever wins, the audit is the work, not the helper.** A caller that legitimately wants the
default must be *left alone deliberately*, not by omission — and the 4 copy-pasted twins must end
as one implementation or be named as intentionally separate.

## Verification

- The chosen reader distinguishes ENOENT from a parse failure, pinned by a test that seeds BOTH a
  missing file and a corrupt one and asserts the two answers DIFFER. (A test that only seeds the
  corrupt case passes on a reader that throws for everything.)
- Every call site audited, with the lenient ones named — a count of "callers updated" is not an
  audit.
- `InstallElement` PG01 and `ChangePlugin` G11 each re-examined against the new reader: either
  promoted (with the neuter that reds) or left un-promoted for a NEW stated reason.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; `yarn test` at or above the baseline of
  the day (re-measure, do not quote).

## Estimated risk

**MED.** The helper is trivial; the blast radius is not. It sits under settings reads on the
install/uninstall paths of every pipeline, so a shape that turns a previously-silent default into a
throw changes failure semantics for callers nobody has enumerated yet — which is exactly why the
audit, not the edit, is the deliverable.

## Acceptance

- [x] The failure mode DECIDED and recorded here, with the rejected shapes and why — `69e801a9`,
      and the shape that won was a fourth one this card did not list
- [x] The reader distinguishes ENOENT from a parse failure, pinned by a test that seeds both and
      asserts the answers differ (`tests/unit/read-json-distinguishes-unreadable.test.ts`, neuter
      **N10** collapses them back and reds exactly the unreadable case + the distinction)
- [ ] All call sites audited — **the service's 36 need no change** (the lenient contract is
      byte-identical, which is why this shape was chosen); what remains is the **4 copy-pasted
      twins**, each either derived the same way or named as deliberately lenient
- [ ] `InstallElement` PG01 and `ChangePlugin` G11 re-examined and their verdicts recorded
- [ ] tsc clean · suite at/above baseline · `trddgrep validate` exit 1 with only the two known cards

## Approval log

- 2026-07-31T21:26:06+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, filed from two first-hand measurements taken while completing
  TRDD-YAGRX7W3 and TRDD-DQ6XN2VP. Pre-approved: issuer authority >= required approver.
