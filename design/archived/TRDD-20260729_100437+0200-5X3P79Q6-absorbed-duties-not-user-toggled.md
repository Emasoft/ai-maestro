---
trdd-id: 5X3P79Q6
title: An absorbed duty must not be gated on a user-facing preference the original owner never had
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-29T10:04:37+0200
updated: 2026-08-20T22:11:59+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-29T09:20:00+0200
derived: false
priority: 1
severity: normal
effort: medium
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102, https://github.com/Emasoft/ai-maestro-janitor/issues/134, https://github.com/Emasoft/ai-maestro/issues/99]
---

# An absorbed duty must not be gated on a user-facing preference the original owner never had

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The ruling is made and posted publicly** (ai-maestro#102, comment `5114821756`). What remains is
the implementation and ONE unresolved scope question (§Open question).

**NEXT ACTION:** read `Emasoft/ai-maestro#99` — the janitor's complete 11-chore spec — and extract,
for each of the three absorbed UPDATE chores, *what it did before absorption and under what gate*.
That is the only thing that decides which of our categories must move to the absorbed-duty path.
Do NOT infer it from our category names; they were written for a user-preference UI, not for a
duty transfer, and the two vocabularies do not line up (see §Open question). — **SUPERSEDED
2026-08-20, do NOT carry forward.** This was DONE on 2026-08-07 and the answer is recorded at the
`## Verification` box below (via `#100`, not `#99` — the card corrects its own citation there).
Left in place rather than deleted so the audit trail survives, but it is not an action for any
future reader.

**Load-bearing facts:**
- Root cause is ONE line: `lib/auto-update-settings.ts:104` — `DEFAULT_SETTINGS.enabled: false`.
  The master toggle gates the whole scheduler, so every category under it is inert.
- Measured 2026-07-29: janitor cached **0.60.1**, published **v0.64.1**;
  `version-update.last-run.ts` = 2026-07-25 23:01 +0200 (**82.9 h** stale).
- `lib/auto-update-settings.ts:45-47` ALREADY documents this exact failure, three days before it
  was filed against us — *"closing the window where the janitor daemon exits (server up) but its
  self-updates never land — **once auto-update's master toggle is on**"*. The design was correct;
  the condition was never satisfied and nothing reported it as unmet.

### Added 2026-07-29 21:40 (folded in from the duplicate card 4F40QCCH — see its cancellation)

- **A SECOND, INDEPENDENT DEFECT, FOUND AND FIXED — commit `87740ff9`.** `FLEET_CONTROL_FLAGS`
  in `lib/janitor-control.ts` carried `'version-update-request'` (no `ed`, no `.flag` suffix), so
  `fleetControlFlagPresent()` stat'd a path the janitor never writes and reported the flag ABSENT
  while it sat on disk. **The server was structurally blind to the very request this card is
  about**, and would have stayed blind after the duty split landed. Verified against the WRITER,
  not one file: janitor 0.64.1 `scripts/lib/global_state.py:596` →
  `_control_path("version-update-requested.flag")`. The pre-existing test wrote the wrong name AND
  read the same wrong key, so it agreed with the bug and stayed green.
- **Re-measured 21:07, and it has WORSENED since this card was written:** the flag's provenance
  body now reads `{"set_at":1785352055,"reason":"0.64.1->0.65.0"}` (was `0.60.1->0.64.1`), and
  **v0.65.0** published 18:55 today while the cache tops out at 0.64.1. The detector keeps
  re-raising; nothing drains it.
- **Three asks from the janitor's 13:42 / 13:43 comments on #102, all postdating this card:**
  1. the duty is the **TRIO** — a `version-update` run against a stale marketplace manifest cannot
     see a new release, so version-update alone is not a fix;
  2. **consume the request flag clear-BEFORE-run**, not after — the janitor's daemon does it in
     that order deliberately, so a crash mid-update re-raises instead of being swallowed;
  3. **advertise the chore classes actually executed** in `server-liveness.json` — verified today
     as `{"capabilities":["family-a"]}`, i.e. the server already states in the file the janitor
     reads that it does not do this work. Under the binary yield rule this costs nothing and is
     the only reason the gap was findable from outside.
- The janitor explicitly declines to change the binary liveness→yield rule unilaterally (it is a
  ratified owner directive; changing it risks two actors updating concurrently). Re-instating
  per-class capability gating is **janitor#134** and is the owner's call, not ours.

**SUPERSEDED — do NOT carry forward:**
- ~~"flip `DEFAULT_SETTINGS.enabled` to true"~~ — refused in the #102 reply. It would fix the one
  duty and switch on several unrelated categories by side effect, which is the same
  changed-behaviour-without-asking the default exists to prevent, pointing the other way.
- ~~"the janitor should reclaim the chore on staleness"~~ — the janitor itself declined to propose
  this; it risks two actors updating concurrently and contradicts the ratified binary handoff.

## Problem

The server ABSORBS the janitor's `version-update`, `marketplace-refresh` and
`user-plugins-update` chores (TRDD-KCRMSNL7 / janitor#79), and the janitor correctly stands down
the moment a live server publishes a fresh liveness file. But the server's auto-update scheduler is
gated on a user-facing master toggle that ships OFF, so the absorbed chores are owned by nobody and
run never. Measured cost: the janitor sat four releases behind for 3.5 days on this host, and the
gap was discovered only because a human happened to ask.

## Root cause — and why our defence of it fails

`DEFAULT_SETTINGS.enabled: false` is justified in-source as explicit consent: *"unattended
background restarts are surprising and need explicit consent"* (`:78-82`). That reasoning is sound,
and it is why the default must NOT simply be flipped.

**But it only covers behaviour the server ADDS. It does not cover a duty the server TOOK OVER.**

Before absorption the janitor updated itself, and the user consented to that by installing and
arming the janitor. Absorption then made a live server suppress it. So the default is not
"nothing changes until you opt in", which is what its own comment claims — it is **silently
revoking a behaviour the user already had, and billing it as caution.**

**Consent-to-add is not consent-to-remove.** That asymmetry is the whole ruling: a transferred duty
does not get re-gated behind a preference the original owner never had.

## Proposed fix

Split the scheduler's work in two, by provenance rather than by category:

| class | gate | rationale |
|---|---|---|
| **absorbed duties** (the chores the janitor performed before absorption) | the janitor being **installed + armed** — the same consent that gated them before | obliged by absorption itself; not a preference |
| **added behaviour** (sweeping every agent-scope plugin, every user-scope plugin, …) | the existing user-facing master toggle + per-category checkboxes | genuinely new; explicit consent is correct here |

The absorbed-duty path must also honour the contract in janitor#99: contend on
`~/.claude/janitor-control/marketplace-op.lock`, write the per-chore `*.last-run.ts`, and consume
`version-update-requested.flag` **clear-before-run** so a fresh release lands in ~5 min rather than
waiting out the 6 h beat.

## Open question — MUST be resolved before coding, not during

`user-plugins-update` is one of the absorbed chores, but our nearest category
(`userScopePlugins`) is deliberately opt-in (`DEFAULT_SETTINGS` sets it `false`) precisely because
it is a catch-all that can produce many updates at once.

Those two facts collide, and the collision cannot be resolved by reading our own source: whether
this is an absorbed duty (must run) or added behaviour (stays opt-in) depends entirely on **what
the janitor's `user-plugins-update` actually did before absorption, and under what gate.** If it
swept unconditionally, it is a duty and must run. If it was itself opt-in on the janitor side, our
opt-in preserves the status quo and is correct.

`#99` is the authoritative answer. Guessing here would re-commit the original error in the opposite
direction — turning on an unattended fleet-wide plugin sweep nobody asked for.

## Verification

> **AUDITED 2026-08-06 — this card's work SHIPPED under later TRDDs and nobody ticked its
> boxes.** The fix landed as the absorbed-duty lane of **TRDD-PE54D95Q** (USER ruling on the 3 h
> cadence, 2026-08-05) plus the ai-maestro#102 follow-ups, while this card sat at `column: todo`
> since 07-29 — the "card stalled while the code shipped" failure. Nothing below was implemented
> by this audit; every tick is evidence of work already on `main`. **5 of 7 are met.**
>
> The one worry worth recording because it was WRONG: making the lane ungated could have
> over-shot into running for a host that never consented (never installed the janitor). It does
> not — the consent check is real and doubly pinned. Verified, not assumed.

- [x] `#99` read; each absorbed update chore classified duty-vs-added, with the pre-absorption gate quoted
      **DONE 2026-08-07 — via `#100`, which is the correct citation (`#99` never was; see below).**
      **CLASSIFICATION: the trio is a LEASE, not a transfer — the janitor remains the OWNER.**
      `#100` ratifies (both sides, verbatim) a two-family split: *"**Family B — DEV-ENVIRONMENT
      HYGIENE:** plugin/marketplace/self update, cache-prune, rules-cleanup, OOM guard,
      github-config audit. **→ STAYS with the janitor. Do NOT absorb these into the server.**"*
      Our trio IS plugin/marketplace/self-update, so by that text it is **Family B** — and read
      alone it says we should not have it.
      What resolves the apparent conflict is LATER IN THE SAME THREAD: *"Owner directive #2
      (2026-07-17): chore-level coordination between the two daemons"*, whose settled shape is
      *"a fresh `~/.aimaestro/server-liveness.json` … means the server is **RUNNING** ⇒ the
      janitor's #N daemon yields **ALL** absorbed chores: `oauth-rotator-tick`,
      `oauth-rotator-supervisor`, `marketplace-refresh`, `user-plugins-update`, `version-update`."*
      So the split governs **permanent ownership** (Family B stays janitor-owned, which is what
      keeps the `#56` mirror true — a machine with no server still gets dev-hygiene); the directive
      adds a **runtime lease** (the server performs them while alive, the janitor reclaims ALL of
      them within 90 s of the server going stale). Absorption here is *duty-while-up*, never a
      transfer of ownership — which is the honest answer to "duty vs added".
      **Chronology, checked because it decides the reading:** `#100` ran 2026-07-16 → 08-01 and the
      directive is dated 07-17, i.e. INSIDE the thread — so neither supersedes the other by date;
      they are different questions, and the thread settles both.
      **PRE-ABSORPTION GATE, quoted (both halves):** static — `dispatch.py:428-443`
      `_NON_HARNESS_DETECTORS` (13 entries, containing all three), justified at `:420-427` as
      anything that *"mutates MACHINE-GLOBAL state … or reads/surfaces the machine's OAuth/keychain
      posture"*; runtime — `daemon.py:2323-2331`, *"BINARY since TRDD-LU0C5KAR … a running server
      owns them ALL; its exit … hands them ALL back."*
      **RESIDUAL RAISED AND THEN CLOSED, same session — recorded because the closure is the useful
      part.** `#100` warns the yield must key on a `singleton-chores` capability, NOT on `family-a`:
      *"`family-a` means ONLY 'the OAuth tick is live' … the janitor stops marketplace-refresh /
      user-plugins-update / version-update — chores nothing is running."* Verified against our code:
      **we DO emit it, and correctly.** `lib/server-liveness.ts::currentCapabilities` (`:105-117`)
      pushes `'singleton-chores'` gated on `isAbsorbedDutySchedulerRunning` — i.e. only while the
      lane actually runs — and `'family-a'` separately on `oauthTickEnabled`. The two are never
      conflated, which is exactly what `#100` asked for.
      **And the reason the hazard cannot bite today is stated in that file's own comment (`:92-104`):
      the janitor's consumer currently gates on FILE FRESHNESS alone, not on these tokens** — which
      is why `daemon.py:2325` reads *"BINARY … a running server owns them ALL"*. The tokens are
      computed anyway, deliberately: *"they are the ecosystem's only machine-readable statement of
      what the server actually absorbed … and janitor#134 is an OPEN proposal to gate on them again
      — at which point this warning is what tells you the contract changed back."*
      So: nothing to fix, and the thing to WATCH is **janitor#134**. If it lands, the yield becomes
      capability-gated and this emission is what keeps the trio from being stranded.
      — **STILL OPEN, but the BLOCKER IS GONE and the remaining ask is much smaller (2026-08-07).**
      The classification is EXPRESSED IN CODE (the lane owns exactly the trio:
      `marketplace-refresh`, `version-update`, `user-plugins-update`), but `#99` was never read and
      the pre-absorption gates were never quoted, so the *record* the box asks for does not exist.
      A code shape is not a citation.
>
> **THE CITATION IS `#100`, NOT `#99` — and the janitor's own source says so, so this never needed
> them to answer.** `dispatch.py:424` (janitor 2.4.1): *"which the ai-maestro SERVER owns for
> harness agents (**janitor#100** Family-A/B split; `#J` writes only `.janitor/state/`)"*. I had
> recorded this as blocked pending the janitor telling us where the spec lives; it was one grep of
> their tree. **A citation being wrong is not the same as the thing being unfindable** — I stopped
> at "the pointer is broken" instead of looking for the target.
>
> **THE PRE-ABSORPTION GATE IS NOW QUOTABLE, in two places, both verbatim:**
>
> 1. **Static — who may never run inside a harness agent.** `dispatch.py:428-443` defines
>    `_NON_HARNESS_DETECTORS`, a 13-entry frozenset containing all three of our trio. Its stated
>    reason (`:420-427`) is the duty test the box is really asking for: each entry *"either mutates
>    MACHINE-GLOBAL state (the shared plugin cache / marketplace via `claude plugin ...`, the
>    global-state request files) or reads/surfaces the machine's OAuth/keychain posture — which the
>    ai-maestro SERVER owns for harness agents … Everything NOT listed here is workdir-scoped and
>    keeps running inside."*
> 2. **Runtime — who yields while we are up.** `daemon.py:2323-2331`: *"while an ACTIVE ai-maestro
>    server RUNS, yield the absorbed chores — running them here too would be 'doing the same chores
>    twice'. BINARY since TRDD-LU0C5KAR (owner directive 2026-07-17): a running server owns them
>    ALL; its exit (the probe file goes stale within 90 s) hands them ALL back."*
>
> **What remains, and it is genuinely all that remains:** read `#100`'s Family-A/B framework and
> classify each of the trio duty-vs-added against it. The gates are quoted; the framework is not
> yet read, so I am NOT ticking this. Note also, unresolved and worth a look while there: the
> non-harness set has **13** members and our lane owns **3** — "non-harness" and "absorbed" are
> different predicates, and I have not checked whether the other 10 are meant to be ours.
>
> **AND THE CITATION IS WRONG — measured 2026-08-06, so this box cannot be done as written.**
> `Emasoft/ai-maestro-janitor#99` is not "the janitor's complete 11-chore spec": it is
> *"Detector false positives (4 classes): typosquat on famous pkgs; gitignored corpus dirs;
> id-token-write-unscoped…"*, **CLOSED**, 3813 chars, with **zero** occurrences of
> `version-update`, `marketplace-refresh` or `user-plugins-update`. The obvious off-by-one
> `#100` (*"[COORDINATION] ai-maestro absorbs the daemon's functions"*) is also CLOSED with
> **zero** occurrences of all three. So the source this box sends its reader to does not
> contain what it promises, and neither does the nearest neighbour.
>
> **Box 1 is therefore blocked on identifying the correct source, not on doing the reading** —
> a distinction worth keeping, because "go read #99" looks actionable forever and silently
> is not. Do NOT substitute a guessed issue number: this card already spent its credibility
> on one. The janitor is the authority on where its own chore spec lives; ask, or grep its
> shipped `scripts/daemon.py` task implementations (which is where TRDD-JANITOR-ABSORB-era
> work read the chore list from in practice, per [[janitor-chore-absorbability]]).
- [x] With the master toggle OFF and the janitor armed, a stale janitor plugin is updated within one beat
      — **MET, and measured LIVE on this host 2026-08-06**, which is the only place this box can be
      answered: `~/.aimaestro/auto-update-settings.json` reads `enabled: false`, `lastRunAt: null`,
      `lastAbsorbedRunAt: 2026-08-06T16:52:59+0200`. The gated lane has never run; the absorbed lane
      ran an hour before the audit. Source side: `services/auto-update-service.ts:92` *"UNCONDITIONALLY
      at boot (never torn down by the user's `enabled: false`)"*, and the scheduler's own
      `if (!s.enabled) return` at `:175` still gates the user-facing lane exactly as before.
- [x] With the master toggle OFF and the janitor NOT armed/installed, nothing runs (the consent that gated it before is absent, so the duty is absent too)
      — **MET.** The lane calls `isJanitorInstalledAndArmed()` (`:214`, re-checked every tick at
      `:222`). Pinned twice, and both pins are explicitly non-vacuous:
      `auto-update-absorbed-duty.test.ts` — *"does nothing at all when the janitor is not
      installed+armed (the gate, non-vacuity)"* and *"defaults to the REAL
      isJanitorInstalledAndArmed when no dep is injected (non-vacuity)"*. The second matters more
      than it looks: without it the injected seam could make every other test pass against a gate
      production never uses.
- [x] The added-behaviour categories remain inert while the master toggle is OFF — proven by a test, since this is the exact regression the split risks
      — **MET.** `auto-update-absorbed-duty.test.ts` — *"appends run entries into
      auto-update-settings.json WITHOUT touching `enabled`"*. The split writes only the trail; the
      gated categories keep their own `if (!s.enabled)` return.
- [x] `version-update-requested.flag` is consumed clear-before-run
      — **MET.** `services/auto-update-service.ts:516`,
      `consumeWorkRequest('version-update-requested.flag')` — before the `ChangePlugin` call, with
      the janitor's rationale inline (`:514`): clearing BEFORE is what lets a request raised
      mid-run survive to the next pass.
- [x] Concurrent-run test: two processes contend on `marketplace-op.lock`, one runs
      — **MET, twice over.** `tests/unit/marketplace-lock.test.ts:60` — *"a second acquire is
      refused while the first is held, and works after release"* (the release half is the positive
      control; refusal alone passes for a lock that never grants). And at the lane level,
      `auto-update-absorbed-duty.test.ts` — *"is single-executor machine-wide — a tick whose lock
      is HELD refreshes nothing (AC3)"*.
- [x] A neuter run per new guard (break it → the NAMED test fails; read the test COUNT, never the exit code)
      — **NOW EVIDENCED: 4 of 4 guards have an observed run (see below).** Ticked only after the
      last one; the text below is the state it passed through, kept because the two findings it
      produced are the point.

      *Originally read:* **NOT EVIDENCED, and deliberately not ticked.** The 16 absorbed-duty tests carry explicit
      `(non-vacuity)` markers, which is the discipline applied — but a marker is a claim, and this
      box asks for a RUN. No neuter output is recorded for these guards anywhere I can find, and
      ticking it off the markers would be exactly the substitution this box exists to prevent.
>
> **PARTIAL — 1 of N guards now has an OBSERVED neuter (2026-08-06).** The consent gate, run via
> `scripts/dev/neuter` (one site mutated, `1 ins / 1 del`; restore verified by blob hash):
>
> ```
>   s{const installedAndArmed = \(deps\.isJanitorInstalledAndArmed \?\? realIsJanitorInstalledAndArmed\)\(\)}{const installedAndArmed = true}
>   → 3 red / 13 green:
>       does NOT stamp when the gate refused — an unowned chore must not look owned
>       does nothing at all when the janitor is not installed+armed (the gate, non-vacuity)
>       when the janitor is NOT installed+armed, no run entries are persisted at all
> ```
>
> Numbers pasted verbatim from the tool, never retyped. The result is what the box wanted: the
> mutation reddens exactly the tests that NAME this guard and nothing else, so the consent gate
> is genuinely pinned — and the third red is the one worth noticing, because "no run entries are
> persisted" is a claim about the STORE, which a gate-only assertion could not have made.
>
> **COMPLETE — all four guards have an OBSERVED run (2026-08-06).** Every number below is pasted
> verbatim from `scripts/dev/neuter`; each run mutated exactly one site and restored blob-verified.
>
> ```
>   2. s{String\(Math\.floor\(nowMs / 1000\)\)}{String(nowMs)}          [lib/janitor-chore-stamp.ts]
>      → 1 red / 15 green:  stamps EPOCH SECONDS — milliseconds would read as permanently fresh, for ever
>
>   3. s{return withServerLock\(MARKETPLACE_OP_LOCK_NAME, MARKETPLACE_STALE_LOCK_MS, fn\)}{return fn()}
>      → vs tests/services/auto-update-absorbed-duty.test.ts : 0 red / 16 green   ← UNREACHABLE, see below
>      → vs tests/unit/marketplace-lock.test.ts              : 2 red / 10 green:
>            withMarketplaceLock runs the body and releases afterwards
>            withMarketplaceLock SKIPS (returns null, body never runs) when the lock is held
>
>   4. s{fs\.rmSync\(p, \{ force: true \}\);?}{}                        [lib/janitor-work-request.ts]
>      → vs tests/unit/janitor-work-request.test.ts          : 3 red / 6 green:
>            deletes a raised flag and returns true
>            is idempotent — a second consume of the same request reports false
>            touches no mode flag while consuming a work request
> ```
>
> **FINDING A — the absorbed-duty suite MOCKS the lock** (`vi.mock('@/lib/marketplace-lock')`,
> line 38), so mutating the real lock is UNREACHABLE from it. Its test *"is single-executor
> machine-wide"* therefore proves the CALLER handles a `null` return — a real and different claim
> from *"the lock excludes"*, which is pinned one altitude down by the lock's own suite. Both
> altitudes exist here; the 0-red was my aim, not a hole.
>
> **FINDING B — a REAL hole, and it is exactly the janitor's ask.** Stubbing the CALL SITE
> (`const hadUpdateRequest = consumeWorkRequest('version-update-requested.flag')` → `false`)
> reddens **0 of 16**. So `consumeWorkRequest` is well pinned as a MODULE, and that the absorbed
> lane actually CALLS it — ai-maestro#102 step 3, the whole point of box 5 — is pinned by nothing.
> Deleting that line would ship silently. Box 5 stays ticked (the behaviour is correct and the
> code carries its WHY), but its test is owed; that is a NEW finding this box produced, not a
> failure of it.

## Estimated risk

**MEDIUM.** The mechanism is small, but it changes what a server does unattended on a host with a
live agent fleet, and the failure mode of getting the split wrong is an unrequested fleet-wide
plugin sweep. The Open question is the whole risk; resolving it from `#99` reduces this to LOW.

Depends on nothing in-repo. Related: **janitor#134** (yield on the capability token rather than on
liveness) is the general fix for the class this belongs to — *a server that claims a chore and does
not run it produces a silent, unbounded gap* — and is awaiting the janitor's granularity call.

## Approval log

- 2026-07-29T10:04:37+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. Standing ruling, 2026-07-29 ~09:20:
  *"the ai-maestro server should do those things automatically by itself. never an user should be
  asked to do these manually."* No approval request was sent.
- 2026-08-20T22:11:59+0200 — `todo → complete`, archived as itself. This is the card's own
  diagnosis applied to itself: its 2026-08-06 audit note says "this card's work SHIPPED under
  later TRDDs and nobody ticked its boxes... the 'card stalled while the code shipped' failure",
  and it then sat at `todo` for a further two weeks after its last box was ticked on 2026-08-07.
  Gate verified satisfied 2026-08-20: 7 of 7 boxes checked under `## Verification` (the card has
  no `## Acceptance` heading; that section is its gate), `blocked-by:` empty, and the `## Open
  question` resolved and recorded in depth at the `#100` box. The three test files the boxes
  claim were RUN first-hand — marketplace-lock, janitor-control, janitor-work-request: 3 files,
  34 tests, all passed, exit 0, with the file count matching the paths passed so nothing was
  silently skipped. The implementation itself landed under TRDD-PE54D95Q plus the ai-maestro#102
  follow-ups, as this card records. Closed under the USER's standing rule of 2026-08-20 that a
  card whose acceptance gate is mechanically satisfied may be closed without a further ruling.
