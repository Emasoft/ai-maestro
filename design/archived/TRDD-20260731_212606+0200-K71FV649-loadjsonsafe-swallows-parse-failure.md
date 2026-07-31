---
trdd-id: K71FV649
title: loadJsonSafe returns an empty object on a PARSE failure, so every verification built on it reads unreadable as absent
column: completed
scope: project
project-id: ai-maestro
created: 2026-07-31T21:26:06+0200
updated: 2026-07-31T22:07:28+0200
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
npt: []
eht: [CS25TA6W]
blocked-by: []
implementation-commits: [69e801a9, 6c175813, a044f390]
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

**THE WRITE SIDE WAS WORSE THAN THE BLINDNESS — `6c175813`.** This card was filed about
verifications reading *unreadable* as *absent*. Auditing the WRITE side found the same reader doing
something the card had not imagined: **21 of 21** `saveJsonSafe` calls in the service are
read-modify-write fed by `loadJsonSafe` of the SAME path, and **4 target `~/.claude/settings.json`**
— the human user's own global Claude Code config. On a corrupt file the read answers `{}`, the
caller builds a minimal object out of nothing, and the atomic write REPLACES the file. `G10` is the
worst shape: reads `{}`, concludes *"plugin missing after install"*, logs `writing safeguard`, and
truncates the file. **The ops line reads like a repair.**

The guard went into `saveJsonSafe`, not the 21 call sites, for one decisive reason (the advisor's,
and it is the argument that settles it): **the R51 compensations call the writer DIRECTLY with a
snapshot.** `ChangeHook`'s undo writes `c.prior`, `structuredClone`d from the same blind read — so on
a corrupt file the ROLLBACK restores `{}` and destroys the file it exists to protect. A per-call-site
read guard cannot see that path. The write primitive is the only choke point both the forward and
undo paths traverse, and it covers every FUTURE call site.

**And it is not new policy.** `lib/claude-settings-enforcer.ts:112-119` already ruled exactly this
(*"Corrupt JSON — NEVER overwrite … would destroy whatever the user actually has"*), with its own
test. The ruling simply was never extended to this family. Finding the project's own ratified answer
beat both my reasoning and the advisor's.

**Two more holes closed in the same slice:**
- `readJson`'s `data: Record<string, unknown>` was a **type LIE I shipped at `69e801a9`** — `[]`,
  `null`, `42` and `"str"` all PARSE, and the caller's `settings.enabledPlugins = ep` then attaches
  a key to an array (or throws on null) and writes the result. Now `unreadable`, per the enforcer's
  `:121-128`.
- `PG03` / `PG07` both already CONTAIN the honest message (*"Could not check user scope"*) in a
  `catch` that could never fire, because `loadJsonSafe` does not throw. A corrupt
  `~/.claude/settings.json` therefore reported *"User scope clean"* about a file it never read.
  Reading strictly makes the branch that was always meant for this case **reachable**. That is the
  vacuous half of the defect — nothing destroyed, a clean verdict asserted on no evidence.

**PG01 AND G11 ARE DECIDED — `a044f390`, and PG01 turned out to be a LIVE BUG, not a blocked
promotion.** It was never a mere WARN: every arm sets `result.success = false`, PG02 turns that into
`corePluginMissing: true` in the registry, and the wake route refuses to start the agent on it. So a
corrupt `settings.local.json` made a correct install report FAILURE and brick the agent's wake. The
rule the fix encodes — **an invariant may abort on a positive VIOLATION and never on an UNKNOWN** —
is the one this card had been circling from the start. Full verdicts, including why PG01 still stays
OUTSIDE the R51 window and why G11's sibling defect became `TRDD-RO90UCKQ`, are in the Acceptance
section rather than repeated here.

**NEXT ACTION — none on this card's own work; every box but one is closed.** What remains is its EHT
`TRDD-CS25TA6W`: the 3 copy-pasted twins, carrying 6 more read-modify-writes, 3 of them on
`~/.claude/settings.json`, and two of the three readers do not even check `existsSync` — so ENOENT
and a parse failure are collapsed there by construction. `claude-adapter.ts` is the urgent one: it
sits in `ChangePlugin`'s OWN call path, so the guard this card landed is bypassed one layer down on
every adapter install. **Per the completion gate a parent whose flock is open is `blocked`, never
`complete`** — so this card moves to `blocked` (`blocked-by: [CS25TA6W]`) the moment someone would
otherwise close it, and its own work is finished now.

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
- [x] All call sites audited — and the audit found what the card had not: the **READ** sites need no
      change (the lenient contract is byte-identical), while **21/21 WRITE** sites were destructive
      on an unreadable file and are now guarded at the primitive (`6c175813`). The 3 copy-pasted
      twins are `TRDD-CS25TA6W`, an EHT of this card
- [x] The write path can no longer destroy a file it could not read — pinned by
      `tests/unit/save-json-safe-refuses-clobber.test.ts` on REAL files (the byte-identical
      assertion is the load-bearing one; a mocked `fs` has no disk). Neuters: **N11** delete the
      guard → 7 red, BOTH positive controls green · **N12** collapse the non-object check → exactly
      4 red · **N13** add the forbidden import → the absence test reds, naming the offender
- [x] `InstallElement` PG01 and `ChangePlugin` G11 re-examined and their verdicts recorded:
      **PG01 — did not need PROMOTING, it needed FIXING** (`a044f390`). It was never a mere WARN:
      every arm sets `result.success = false`, PG02 turns that into `corePluginMissing: true` in the
      registry, and the wake route refuses to start the agent on it — so a corrupt
      `settings.local.json` made a CORRECT install report failure and brick the agent's wake. Live,
      not blocked. Fixed by the general rule the card was circling: *an invariant may abort on a
      positive VIOLATION and never on an UNKNOWN.* Neuter **N14** reds exactly the two behavioural
      tests, both positive controls green.
      **PG01 stays OUTSIDE the R51 window, for a sharper reason than before.** The write guard does
      NOT clear the way: on a corrupt file an aborting PG01 runs the window's undo, which uninstalls
      the plugin via CLI/adapter — real destruction no settings guard prevents — and its settings
      restore would now additionally REFUSE, producing an R51.5 CRITICAL over a byte-untouched disk.
      **G11 — the unreadable case correctly stays a WARN**, and is now principled rather than forced
      by a blind reader (same rule as PG01). Auditing it found something else: measured across
      `ChangePlugin`'s whole span, `result.success` is assigned twice and **both times to `true`** —
      so a genuine "final state != expected" on a perfectly readable file also reports success.
      Independent of the reader (it would be equally true with a perfect one), so filed as
      **`TRDD-RO90UCKQ`** rather than folded in — hiding a false-success behind a reader fix is
      exactly the conflation this card exists to avoid.
- [x] tsc clean (0 lines) · suite **319 files / 4560 passed / 2 skipped** at `6c175813`, up from
      317/4547/2 with zero regressions — the advisor's named risk (a site depending on lenient
      overwrite) did not materialise
- [x] `trddgrep validate` exit 1 with only the 2 known pre-existing BODY-STATE-CLAIM ERRORs on
      archived cards frozen by rule 12 — neither this card nor its EHT appears in any finding

## Approval log

- 2026-07-31T21:26:06+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, filed from two first-hand measurements taken while completing
  TRDD-YAGRX7W3 and TRDD-DQ6XN2VP. Pre-approved: issuer authority >= required approver.
- 2026-07-31T22:07:28+0200 — COMPLETED by ai-maestro. All 7 boxes closed. Own work landed at `69e801a9` (the reader),
  `6c175813` (the write guard + the reader's non-object hole + PG03/PG07), `a044f390` (PG01, which
  turned out to be a live wake-bricking bug rather than a blocked promotion). The completion gate is
  satisfied: its only EHT, `TRDD-CS25TA6W`, reached `completed` at `6d818c12`. Two independent
  findings were filed rather than folded in — `TRDD-RO90UCKQ` (ChangePlugin never reports failure)
  stays open.
