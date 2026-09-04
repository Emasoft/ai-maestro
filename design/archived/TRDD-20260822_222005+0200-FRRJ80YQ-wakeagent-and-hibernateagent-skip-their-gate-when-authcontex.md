---
trdd-id: FRRJ80YQ
title: wakeAgent and hibernateAgent skip their gate when authContext is absent — the bypass element-management already abolished
column: complete
created: 2026-08-22T22:20:05+0200
updated: 2026-09-04T18:11:38+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:20:05+0200
implementation-commits: [a11c7126]
---

# wakeAgent and hibernateAgent skip their gate when authContext is absent — the bypass element-management already abolished

## Problem

`wakeAgent` and `hibernateAgent` in `services/agents-core-service.ts` take `authContext` as an
**optional** field of their params object, and their authorization gate is CONDITIONAL on its
presence. `hibernateAgent`'s own comment states the affordance outright:

> // When authContext is provided (route call), check caller permissions.
> // When absent (internal call), skip — backward compatible.
>     if (authContext) { if (!authContext.isSystemOwner) { … authorize('hibernate-agent', …) } }

`wakeAgent` is the same shape in one line: `if (authContext && !authContext.isSystemOwner) { … }`.
`WakeAgentParams.authContext` and `HibernateAgentParams.authContext` are both declared `?:`.

**This is the exact shape that `element-management-service.ts` abolished**, and that file records
why in `gate0Auth`'s own comment:

> Security invariant (Apr 2026): authContext is MANDATORY for every call. There is no "internal
> call" bypass anymore — internal callers (server startup, scheduled tasks, tests) MUST construct
> a SystemAuthContext via `buildSystemAuthContext()`. **Previously, a missing authContext was
> silently treated as "authorized" which allowed any route that forgot to pass it to bypass all
> security checks.**

So the repo holds three patterns for one question, and two of the three are right:

| module | on a missing `authContext` |
|---|---|
| `element-management-service.gate0Auth` | MANDATORY — the param is non-optional |
| `agents-messaging-service.sendMessage` | MANDATORY — `if (!authContext) return 401` at `:315`, before the sender-mismatch check at `:318` |
| **`agents-core-service.wakeAgent` / `hibernateAgent`** | **SKIP THE GATE** — and a comment advertising that as supported |

## This is NOT a live hole — and that is a measurement, not an assumption

Every production caller of both functions passes a context. Enumerated 2026-08-22 across
`app lib services components scripts server.mjs`:

- the three routes (`wake`, `hibernate`, `continuity/ensure-resume`) pass `auth.context`
- `services/headless-router.ts:1307,1313` pass `buildAuthContext(auth)`
- six `element-management-service` call sites pass `options.authContext` / a named gate context
- the two genuinely-internal callers pass `authContext: { isSystemOwner: true }` —
  `lib/fleet-hard-recovery-runner.ts:52` and `services/boot-restore-service.ts:181`

Those last two are the interesting ones: they are exactly the "internal call" the comment says may
omit the context, **and they do not omit it.** They already do the right thing. So the bypass the
comment describes is a path NOTHING TAKES, and no external caller can choose to take it — a route
cannot decline to pass what it already passes.

## Why file it anyway

The risk is the NEXT caller. The type permits omission, the gate rewards it with a skip, and the
comment tells a reader it is the supported way to make an internal call. That is three
independent invitations to reintroduce a bypass that a sibling module already paid to remove —
and the failure mode is silent, because omitting the context produces a SUCCESS.

## Proposed fix

Make `authContext` REQUIRED on `WakeAgentParams` and `HibernateAgentParams`, drop the presence
condition so the gate is unconditional, and delete the "backward compatible" comment rather than
leaving prose that documents an affordance the code no longer has. Internal callers already pass
`{ isSystemOwner: true }`, which the gate short-circuits on exactly as `gate0Auth` does — so this
should be a pure tightening with ZERO call-site changes, the same shape as TRDD-JWE3CFLV.

**Verify that claim before relying on it**: re-enumerate the callers at implementation time rather
than trusting this list, and let `tsc` prove the zero-call-site-change property.

## Verification

- A test calling `wakeAgent`/`hibernateAgent` with NO `authContext` is REFUSED rather than
  silently authorized. That test cannot be written today — the omission is legal and returns
  success — which is itself the finding.
- A MEMBER-title context is refused; a MANAGER context is allowed (positive control).
- NEUTER: restore the presence condition and the no-context test must redden.
- `tsc --noEmit` clean with no call-site edits.

## How this was found

Working TRDD-CAVCTULL's box *"the 12 forward-only routes verified against their pipelines' Gate
0"*. A sub-agent correctly reported all four `agents-core-service` routes as COVERED — which is
true, and was the question asked. Checking REACHABILITY rather than PRESENCE (a gate inside a
conditional is not a gate, per TRDD-JWE3CFLV) surfaced this one layer down. **The brief's scope,
not the worker's error:** I asked "does this route reach an authorize call", not "is that call
unconditional".

## Estimated risk

LOW severity today (no reachable bypass), LOW to fix. Priority is prophylactic: it removes a shape
that has already caused one measured incident in this repo.

## GUARD LANDED — 2026-08-22T22:43:38+0200 — and my cost estimate was WRONG

This card said the fix "should be a pure tightening with ZERO call-site changes … **Verify that
claim before relying on it**." Verified, and it does not hold: **34 call sites omit `authContext`,
32 of them TESTS** (`tests/services/agents-core-service.test.ts` alone has 27). True of
production, false overall. The caveat earned its keep.

That changes the right fix. Making the field required would churn 32 assertions that pin real
behaviour, to close a bypass no production caller uses. **The risk this card actually names is
"the NEXT caller" — so the fix is a guard against the next caller**, not a type change:
`tests/unit/wake-hibernate-authcontext-required.test.ts`, 3 cases.

PROVEN IN BOTH DIRECTIONS, because a source-scanning guard that passes proves nothing:
seeding `lib/zz-probe-wake-no-ctx.ts` with a context-less `wakeAgent` call turned it RED and
NAMED the file; moving the probe to `scripts_dev/probes/` (moved, not deleted — RULE 0) turned it
green again. Plus a walker floor (>200 files, and `agents-core-service.ts` by name) so a mis-joined
root cannot report clean by scanning nothing, and a >=6 call-site floor so a broken extractor
cannot report clean by finding nothing.

Two traps it had to handle, both of which produced false readings first:
- **Comments.** `app/api/agents/[id]/ensure-core/route.ts:61` says *"it never calls wakeAgent"*
  inside a doc comment; a naive needle counts it as a call. Sixth use-vs-mention this session.
- **Multi-line calls.** Every real caller spans several lines, so a line-scoped needle reports
  ALL of them as omitting the field. The extractor counts bracket depth.

Its one known limit is stated in the file rather than hidden: stripping `//` also blanks that
sequence inside a string literal, which can only make the guard MISS a call, never invent one.

## Acceptance

- [x] measure the real blast radius before editing — 34 omitting sites, 32 of them tests
- [x] a guard that fails when a production caller omits `authContext`
- [x] PROVEN to fire on a seeded violation, and to go green when it is removed
- [x] positive controls on both the walker (scan set non-empty) and the extractor (finds >=6)
- [x] comment-stripping, so the guard cannot report prose as a call
- [x] ~~OPTIONAL, deliberately deferred~~ **DONE 2026-09-04** — `authContext` is now REQUIRED on
      both param types, both Gate 0s are unconditional, and 33 test call sites were migrated to
      `authContext: SYS_CTX` (`{ isSystemOwner: true }`). See the closing section below.
- [x] delete the "When absent (internal call), skip — backward compatible" comment, which
      advertises an affordance nothing takes — **DONE 2026-08-29T07:24:02+0200.** It was a single
      site, `services/agents-core-service.ts:2604` (hibernateAgent's Gate 0), and it is now
      replaced by what is actually true and enforceable: every production caller passes
      `authContext`, and `tests/unit/wake-hibernate-authcontext-required.test.ts` fails the build
      if one stops — so reaching the `if` with it undefined means the caller is a test, not that
      a bypass is sanctioned. **wakeAgent's Gate 0 (`:2135`) was fixed in the same pass** although
      the box named only one comment: it carried the same "when authContext is provided" line
      **duplicated verbatim on the next line**, which is the same misleading contract stated
      twice; leaving it would have preserved the affordance at the twin site the card is titled
      after.
      **CORRECTION, same day, from the review of this turn: "duplicated verbatim" (as the commit
      message `4577400e` and this box first read) is FALSE.** The two lines were
      `// When authContext is provided (route call), check caller permissions.` and
      `// Gate 0: Authorization — when authContext provided, check RBAC` — the same contract
      stated **twice in different words**, a paraphrase, not an exact duplicate. The finding and
      the fix stand; the exact-string claim was asserted from a glance at a `sed` window and is
      corrected forward here because the commit message is already history.
      **The guard was NEUTERED against the CURRENT tree, not trusted on the 08-22 record.** That
      matters specifically because this turn edited comments *inside a file the guard scans*, so
      a stale comment-stripper view was a live risk. `cp scripts_dev/probes/zz-probe-wake-no-ctx.ts
      lib/` ⇒ exit 1, **1 failed / 2 passed**, naming `lib/zz-probe-wake-no-ctx.ts :: wakeAgent(…)`;
      removing the copy ⇒ exit 0, 3/3. So the new comment's claim that the build fails when a
      production caller omits `authContext` is measured, not inherited — and the green run alone,
      which was my first evidence, would not have shown it.
      **The first neuter was WEAKER than I claimed, and a second one closed the gap.** It seeded a
      **single-line** call in **`lib/`** — while this card itself records that every real caller is
      **multi-line** and the guard scans **four** roots. So it proved the guard is wired, not that
      it catches the shape a real violation will take. Second probe: a multi-line
      `hibernateAgent(…)` in **`services/`** (other function, other root, other shape) ⇒ exit 1,
      1 failed / 2 passed, naming
      `services/zz-probe-multiline-no-ctx.ts :: hibernateAgent( 'some-id', { sessionIndex: 0, }, …)`
      — so the bracket-depth extractor really does span lines. Removed ⇒ 3/3.
      To check the paraphrase claim later, read the PRE-fix text: `4577400e` rewrote both lines, so
      it takes `git show 4577400e^:services/agents-core-service.ts`.
      Comments-only is proven by `git show 4577400e -- services/agents-core-service.ts` filtered
      to non-comment changed lines ⇒ **empty**; `tsc --noEmit` exit 0 was the weaker instrument I
      reached for first (it passes on plenty of behaviour changes). That empty result carries a
      POSITIVE CONTROL, because empty also reads as "the chain matched nothing": the identical
      chain over the whole commit emits **16** lines and over the `.ts` alone **0**.
      **RULE-0 note — my stated reason for `rm`-ing the probe copies was wrong.** I called the
      source "a committed file in `scripts_dev/probes/`"; `scripts_dev/` is **gitignored and
      untracked**, so nothing in it is committed. Nothing was lost — the real reason is that each
      `rm` removed a COPY whose source still sits on disk — but the premise was false, and applied
      to a file that is *not* duplicated it would have authorised real loss.
      **The only remaining box is the OPTIONAL one below**, so nothing non-optional is left here.

## CLOSED 2026-09-04 — the deferred type change landed, and it found a test asserting a false premise

The optional box is done. What shipped, and what it cost:

**Source (`services/agents-core-service.ts`).** `WakeAgentParams.authContext` and
`HibernateAgentParams.authContext` are now `authContext: AuthContext`, not `?:`. Both Gate 0s
lost their presence condition: `if (authContext && !authContext.isSystemOwner)` and
`if (authContext) { if (!authContext.isSystemOwner) … }` became a **401 refusal** followed by an
unconditional check. The 401 is deliberate rather than relying on the type alone — it is the
`agents-messaging-service.sendMessage` pattern (the third row of this card's own table, and the
strongest of the three), and it is what stops the callers `tsc` cannot see: `.mjs`, `scripts/`,
and anything reaching the service past a cast.

**Cost, measured not estimated.** `tsc --noEmit` after the type change: **33 errors, every one in
a test, zero in production** — which confirms the card's original "zero production call-site
changes" claim while vindicating the 2026-08-22 caveat that it was false *overall*. Migration is
behaviour-preserving by construction: Gate 0 short-circuits on `isSystemOwner`, so
`{ isSystemOwner: true }` and the old omission take the identical path. Measured: the three
touched suites were 177/177 green before and after.

**The behavioural pin this card asked for and could not have.** The Verification section said *"A
test calling wakeAgent/hibernateAgent with NO authContext is REFUSED rather than silently
authorized. **That test cannot be written today** — the omission is legal and returns success —
which is itself the finding."* It can be written now, and it is:
`tests/services/agents-core-service.test.ts`, two cases (`refuses a wake/hibernate whose caller
passed NO authContext`), each casting past the type to model the caller the type cannot reach.
**NEUTER (run, not assumed):** restoring both presence conditions reds **exactly those 2** of 104
— attributed one per gate — and restoring the fix returns 104/104.

**THE FIND — a governance test whose premise this fix invalidated.** The full suite (504 files)
surfaced `tests/governance/r10-wake-gates.test.ts::refuses an internal call that passes no
authContext at all`, which failed 401-vs-403. It was **not** a regression. That case exists to pin
that **Gate 1** (the manager gate) runs even for callers Gate 0 exempts, and it used `{} as never`
— *omission* — as its stand-in for "an internal call". That stand-in was only ever valid while
omission skipped Gate 0; with the bypass closed, the case would have asserted 403 on a request
that never reaches Gate 1 — **testing Gate 0 while claiming to test Gate 1**. Rewritten to
`{ authContext: { isSystemOwner: true } }`, which is what the two real internal callers pass and
what actually exercises the claim. Its subject is unchanged; only its false premise is gone.

Worth stating because it is the general lesson: `as never` is exactly why `tsc` could not find
this one. **The type change was caught by the TEST SUITE, not the type checker** — a cast is a
hole in the instrument that is supposed to prove the migration complete, so "tsc clean" was a
necessary and insufficient verification here.

**The source-scanning guard STAYS**, with its header corrected rather than left asserting the old
world (it said the fields are `?:` and gated `if (authContext)` — both now false, and a guard
whose stated reason is stale is worse than none). Its reason is now the one that survives: `tsc`
binds only the callers it checks, and this walker accepts `.mjs` and scans `scripts/`, neither of
which is type-checked. Three layers over one invariant — type, runtime refusal, source scan — and
only the first is visible to `tsc`.

**Implementation commit:** `a11c7126`.

**Verification:** `tsc --noEmit` exit 0 · full suite **504 files / 6622 passed / 2 skipped**,
exit 0 · both neuters run and attributed. No advisor verdict was obtained: the Fable weekly
window measured `exhausted` (100%), which the advisor policy names as a sanctioned skip.

## Approval log

- 2026-08-22T22:20:05+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
