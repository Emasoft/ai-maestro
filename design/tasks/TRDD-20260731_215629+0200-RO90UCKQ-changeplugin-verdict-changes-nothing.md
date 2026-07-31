---
trdd-id: RO90UCKQ
title: ChangePlugin G11 verifies the final state and its verdict changes nothing
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-31T21:56:29+0200
updated: 2026-08-01T00:44:35+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-31T21:56:29+0200
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body)

**THIS CARD'S ORIGINAL PREMISE WAS FALSE, AND I WROTE IT.** Filed an hour earlier claiming
*"`result.success` is assigned exactly twice, both times to `true`, so ChangePlugin never reports
failure"*. That sentence is literally true about ASSIGNMENTS and completely wrong about BEHAVIOUR:
**`result` is INITIALIZED `success: false`** (`:4617`). So every gate that does
`result.error = …; return result` returns a failure, and the two `= true` assignments are the two
EXCEPTIONS — the no-op path (`:4745`) and the terminal success path (`:5001`) — not the rule.

Refuted three independent ways, all first-hand: the initializer; the exit trace (15 `return result`,
all but the success paths leaving `success` at its `false` default with an error set); and **12
existing tests already assert `ChangePlugin(...).success === false`.**

*Grepping assignments to a field answers nothing about a field whose INITIALIZER is the value you
are asking about.* That is now a lesson in `.claude/rules/lessons-verification.md`.

**THE CALLER AUDIT — the work this card said it was — IS DONE, and it inverts the risk.** All **15**
production call sites already handle `success === false`, every one deliberately:

| caller | on failure |
|---|---|
| `app/api/agents/[id]/local-plugins/route.ts:81` | HTTP 400 with `result.error` |
| `app/api/agents/role-plugins/install/route.ts:68` · `:122` | HTTP 400 |
| `app/api/settings/global-plugins/route.ts:234` | HTTP 400 |
| `app/api/settings/marketplaces/route.ts:886` · `:897` | retries the next candidate key, then HTTP 500 |
| `services/auto-update-service.ts:312` · `:337` · `:474` | ledger entry `failed` (or `already-current` on an idempotent-looking message) |
| `services/element-management-service.ts:3726` | records only on success (inside an uninstall loop) |
| `services/element-management-service.ts:3795` · `:3932` | pushes to `problems[]` |
| `services/element-management-service.ts:5115` · `:5174` · `:5232` | records `success:` per target in the returned report |

Not one is written on the assumption that this pipeline cannot fail — which was the card's stated
MED-HIGH risk. **That risk is refuted; the remaining question is narrow.**

## The defect that DOES survive

G11 (`:4898`-`:4922`) only `ops.push`es. Execution continues past it to `result.success = true`
(`:5001`), so a **genuine** `finalState !== expectedState` — on a settings file that read cleanly —
returns SUCCESS. The verdict is computed, printed, and wired to nothing.

That is the same asymmetry `InstallElement`'s PG01 carries a comment about having already fixed one
gate over: *"Was WARN-only while install/enable above set success=false. That asymmetry meant an
uninstall which left the plugin installed reported SUCCESS: the UI cleared, the caller moved on, and
the plugin kept loading."* PG01 flips `success` on three of its four arms; `ChangePlugin`'s G11 on
none of its arms.

Note G10 runs immediately before and force-writes the missing key, so reaching a G11 mismatch means
**both** the CLI/adapter and the G10 safeguard failed. That is a genuinely broken state, not a
routine one — which is an argument for wiring it, and also why nobody has hit it.

## THE FLIP WAS TRIED AND REVERTED — and the reason is the finding

Wiring G11 to fail on a genuine mismatch was implemented, run, and **reverted the same session**.
It reddened **15 tests**, and 13 of those were fixture artifacts worth fixing (their mocked `fs`
never persists the write, so G11 legitimately mismatched and the old WARN hid it — those tests
literally assert that an install whose settings file lacks the plugin afterward is a SUCCESS).

**The other 2 were not artifacts, and they settle the question:**

```
tests/integration/change-marketplace-rollback.test.ts
  × reinstalls every plugin the cascade uninstalled when the CLI refuses to deregister
  AssertionError: expected 'CRITICAL — THE COMMAND FAILED AT GATE…' to contain 'NO CHANGES WERE MADE'
```

`ChangeMarketplace::remove`'s **R51 compensation reinstalls plugins by calling `ChangePlugin`**. With
G11 failing, the ROLLBACK reports failure — which does not surface as "the reinstall did not verify",
it escalates to R51.5: *"THE SYSTEM IS IN AN INVALID STATE … Manual repair is required — do NOT retry
the command"* — about a system that was in fact restored.

**That is the same failure mode `TRDD-K71FV649` established one card earlier**: a verification wired
to abort turns a recoverable situation into a reported catastrophe. I argued PG01 must not do it and
then did it to G11.

**So the answer differs by CALLER, not by action** — which is not what this card assumed:

| caller kind | a G11 failure is |
|---|---|
| the four user-initiated HTTP-400 routes | **right** — the user asked for a change that did not land, and 400 is the truthful answer |
| the R51 compensation path (`ChangeMarketplace::remove` → reinstall) | **wrong** — it converts a successful rollback into a CRITICAL "unrecoverable" verdict |

Telling those apart is a **signature change across 15 call sites** (an explicit "this call is a
compensation" flag, or a separate verify-and-report entry point). Until that is designed, **a WARN
that under-reports is strictly better than a failure that declares a recovered system unrecoverable**
— and that is now recorded in the code at G11, so the next reader does not re-try it blind.

## What remains to decide

1. **How a caller declares itself a COMPENSATION** — the blocker the flip found. Options: an
   explicit `isCompensation` flag on the `desired` object (15 call sites to audit, but only one to
   set); a separate `verifyOnly`/`skipVerify` entry point; or moving the verdict out of `ChangePlugin`
   into the callers that want it. Whichever wins, the compensation path must NOT be able to report
   R51.5 CRITICAL because a read-back disagreed.
2. Only then, per action (`install` / `uninstall` / `enable` / `disable` / `update`): is a G11
   mismatch a FAILURE? The evidence says yes for user-initiated calls — PG01 concluded both
   directions of a lifecycle must fail by the same rule.
3. The 13 fixture tests that assert "install succeeded with the plugin absent from settings" need
   their mocks to MODEL the write. They currently encode the bug, which is the shape
   `.claude/rules/lessons-verification.md` records as "a test propped up by the very bug you are
   fixing" — fix the fixture, never weaken the guard.
4. Should it ABORT (roll back) rather than merely report? Still open, still larger; unchanged.

**The `unreadable` case must NOT gate**, whatever is decided. `TRDD-K71FV649` settled that — an
invariant may abort on a positive VIOLATION and never on an UNKNOWN — and G11 already reports the
unreadable case as its own distinct WARN (`69e801a9`). A fix that collapses the two re-opens what
that card closed.

## Verification

- A test driving `ChangePlugin` to a G11 mismatch with a READABLE settings file, asserting
  `success === false` (today `true`), plus the symmetric uninstall case.
- POSITIVE CONTROL: a matching settings file still succeeds — the change must not be "fail always".
- POSITIVE CONTROL: an UNREADABLE settings file still succeeds with the K71FV649 WARN. The two cases
  must stay distinguishable; a fix that collapses them re-opens a closed card.
- The neuter: revert the flip, name the tests that red.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above the day's baseline
  (re-measure, never quote: 320 files / 4567 passed / 2 skipped at `6d818c12`).

## Estimated risk

**LOW-MED, downgraded from MED-HIGH by the audit.** The feared blast radius — callers assuming this
pipeline cannot fail — does not exist: all 15 already branch on it, and 12 tests already exercise the
failure path. What is left is the semantic call in step 1, plus whatever step 2 decides.

## THE SHAPE THAT WORKED — `verified`, reported not folded (UNCOMMITTED, see below)

`ChangePluginResult.verified?: 'ok' | 'mismatch' | 'unknown'`, set by G11's three arms; `success` is
untouched. **Fail-safe by construction:** a caller that ignores it behaves exactly as before, so the
compensation path needs no change and cannot regress. The rejected `isCompensation` INPUT flag has
the inverse property — a compensation that forgets to set it gets the catastrophic behaviour.

**Three values, not a boolean:** `mismatch` (read cleanly, the change did not land — a positive
VIOLATION) and `unknown` (unreadable) are the two things `TRDD-K71FV649` separated. A boolean
collapses them.

Wired at the three user-initiated routes that return a simple result — `local-plugins`,
`role-plugins/install` (POST + DELETE), `global-plugins` — **409 on `mismatch`, never on `unknown`**.
Every check is `=== 'mismatch'` and not `!== 'ok'`, so the idempotent no-op path (which returns
before G11 and leaves the field unset) can never read as a violation.

**Neuters: N17** fold the verdict into `success` → reds the load-bearing test AND both R51 rollback
tests, printing the exact catastrophe the design avoids. **N18** the route stops reading the field →
reds only the 409 test. N17 is the one that proves the DESIGN rather than the field.

⚠ **UNCOMMITTED AT 22:21** — `git commit` was blocked by a live `git difftool -y -x vimdiff HEAD`
(pid 93643, 2h15m old, an iTerm session) holding `.git/index.lock`. The lock is NOT stale, so it was
left alone. The work is complete and verified on disk (tsc 0 lines; suite **322 files / 4577 passed
/ 2 skipped**). Run `.janitor/state/PENDING-COMMIT.sh` once that difftool is closed — it re-checks
the lock, stages the six files BY NAME, and commits the prepared message.

## `settings/marketplaces` — MY OWN HYPOTHESIS IS REFUTED, and the real answer is a third thing

I filed the box saying a `mismatch` there *"plausibly means: this key shape did not take, try the
next"*. **The control flow refutes it.** `dispatchUserPluginAction` (`:875`-`:905`):

```ts
for (const mkt of candidateMarkets) {
  const r = await ChangePlugin(null, { name: pluginName, marketplace: mkt, action, scope: 'user' }, auth)
  if (r.success) return { ok: true, pluginKey: `${pluginName}@${mkt}` }   // :889
  lastErr = r.error || 'unknown'                                          // :891 — advance ONLY on failure
}
```

**The retry advances only on `success === false`.** A `mismatch` rides on `success: true` (that is the
whole design), so `:889` returns immediately and **the next candidate is never reached**. A mismatch
therefore cannot mean "try the next shape" — by the time it exists, the loop has already decided this
shape was the right one. Its meaning here is identical to the three wired routes: *the operation ran
and the change did not land*. (Its return type at `:880` has no `verified` field at all, so today the
verdict is discarded before any handler could see it.)

Nor can a WRONG key shape produce a `mismatch`: it either fails the CLI/gates (`success: false` → the
loop advances) or takes the write-back path and lands, which reads back as `ok`.

**But wiring a 409 is still the wrong copy — for a different reason, and this is the finding.**
`handleInstall` (`:945`-`:995`) carries a stale-state recovery that is gated on `!r.ok`: wipe the
dangling `enabledPlugins` entry + the cache folder, then retry once (`:988`). A `mismatch` — the
settings file read CLEANLY and the plugin is not in the expected state — is *precisely* the dangling
-entry symptom that path exists to repair. So on install, a bare 409 would report a condition the
route already knows how to FIX. `handleEnable`/`handleDisable`/`handleUpdate` have no such recovery,
so for them the 409 is right.

**Decision: the box is DECIDED, and it splits.** Not one wiring but two — 409 for
enable/disable/update, and route the mismatch INTO the existing stale-cleanup retry for install.
That second half is a change to a recovery path with its own failure modes, so it needs its own tests
and its own neuter; it is NOT this card's shape applied a fourth time. Recorded here rather than
implemented, because the tree is blocked (below) and `PENDING-COMMIT.sh` stages BY NAME — adding
files to a blocked tree without updating that script is exactly the silent-drop bug already caught
once this session.

## ABORT-vs-REPORT — decided: REPORT, and the reason is STRUCTURAL, not a preference

The box asked whether G11 should ABORT (roll back) rather than merely report. **The question
presupposes a window that does not exist at G11.**

`ChangePlugin` contains exactly ONE `runGateSequence` (`:4855`), and it is narrow: two gates, `EXE-a`
(uninstall, undo = reinstall) and `EXE-b` (reinstall), wrapping ONLY the `action: 'update'`
uninstall-then-reinstall pair. It is awaited and **closed at `:4874`**. G11's mismatch is at
**`:4960`** — 86 lines and several gates AFTER the transaction has already returned. G10, G11, G11b,
G12 and G13 all sit outside it, and for `install`/`uninstall`/`enable`/`disable` the EXE work is not
in a transaction at all (the window is inside the update branch).

So there is nothing for G11 to abort INTO. Making it abort means WIDENING the window to span
EXE→G11 across all five actions, each EXE step gaining a registered compensation. That is a
different card, and a much larger one.

**Three independent reasons the answer is REPORT even then:**

1. **No window at G11** (above). The cheap-looking change is not the change.
2. **`ChangePlugin` is itself an R51 COMPENSATION** — `ChangeMarketplace::remove`'s undo reinstalls
   through it. A pipeline that aborts, called as an undo, is the exact R51.5 catastrophe **already
   measured and reverted** here (neuter **N17** reproduces it on demand). Widening the window does
   not fix that; it makes the abort easier to reach.
3. **The undo would be reasoning from the evidence that just failed.** A mismatch means the settings
   read-back disagrees with what we did. The only available compensation is to reverse the action —
   decided from the same file whose contents just proved untrustworthy. And for local
   install/uninstall, G10 has ALREADY force-written the key, so reaching a G11 mismatch means the
   CLI **and** the safeguard both failed: a state where "undo it" is a guess, not a repair.

**Decision: REPORT (the shipped `verified` tri-state). NOT NOW for abort — and if anyone picks up
the widen-the-window alternative, that IS an architectural decision and goes to the advisor first.**
Recording a no-op needs no advisor; implementing that one does.

## The 13 fixture tests — WHERE they are, and why they are not named yet

The box has never named them, which makes it un-actionable by anyone but the session that measured
them. Narrowing them WITHOUT re-running the neuter (read-only, safe under the lock):

| candidate file | `it()` | readFile mocks | `success).toBe(true)` |
|---|---|---|---|
| `tests/services/element-management-service.test.ts` | **102** | **31** | **39** |
| `tests/services/element-management-assistant-title.test.ts` | 11 | 2 | 5 |
| `tests/services/element-management-service.UninstallPlugin.test.ts` | 6 | 0 | 4 |
| `tests/integration/element-mgmt-user-scope-iron.test.ts` | 10 | 4 | 0 |
| `tests/integration/element-mgmt-gate0-required.test.ts` | 15 | 4 | 0 |
| `tests/governance/r17-r11-core-plugin-binding.test.ts` | 21 | 0 | 1 |

They concentrate in the first file. A test reds under **N17** iff it (a) reaches G11, (b) G11 reads
the settings file CLEANLY and finds the key absent, and (c) it asserts success — so the two
zero-`success-true` files are out, and the two zero-readFile-mock files cannot satisfy (b).

**THE EXACT METHOD, and why it is not run tonight.** Apply **N17** (fold `verified` into `success`),
run the suite, read the red NAMES, revert N17. That is how the 13 were counted originally. It
requires a TEMPORARY mutation of `services/element-management-service.ts` — and while
`.git/index.lock` is held there is **no git safety net**: `git stash` and `git checkout` both fail on
the lock, so a turn that dies mid-neuter (rate limit, compaction, heartbeat boundary) leaves the
neuter in a 10k-line file that is already modified, with no clean way to tell neuter from work. That
is a shipped bug waiting on an interruption, and the user is away. **Run it as the first thing after
the commit lands**, when `git checkout -- <file>` is available again.

## ⚠ A GAP IN MY OWN WORK — wired at FOUR sites, pinned at ONE

Found by RE-READING the two route edits I had not laid eyes on since the compaction, while claiming
"verified" from a pre-compaction measurement. The re-read is what caught it.

All four sites are correct and consistent — `=== 'mismatch'` (never `!== 'ok'`), 409, `unknown` does
not gate — and the **precedence is right everywhere**: the `!result.success` → 400 check precedes the
mismatch → 409 check at every one (`local-plugins` 89<103 · `install` POST 76<83 · `install` DELETE
139<146 · `global-plugins` 241<248). That ordering is the one thing `tsc` cannot see: reversed, a
genuine failure would 409 instead of 400, and the message would blame the read-back for a gate denial.

**And exactly ONE of the four is pinned.** `tests/api/local-plugins-verified-mismatch.test.ts`
carries the positive control *"a genuine failure still 400s, so 409 is not swallowing it"* — for
`local-plugins` only. Reverse the two checks in `install/route.ts` (either verb) or
`global-plugins/route.ts` and **nothing reds**. This is this file's own recorded shape: *count the
clauses, then count the cited SITES* — a design wired at N places and pinned at one.

**NOT fixed tonight, deliberately.** The natural home is that test file, but its NAME describes one
route, and the fix wants a rename (`plugin-routes-verified-mismatch.test.ts`) — a `git mv`, which the
index lock denies. Writing three routes' tests into a file named for one, staged by a script under a
commit message that describes it by its current scope, buys coverage with a lie about where it lives.
**After the commit: `git mv` the file, then add the 2 assertions × 3 sites (mismatch → 409, genuine
failure → 400).**

## THE 13 ARE FIXED — and the fix was ONE harness change, not 13 test edits

Named by running **N17** and reading the red names: all 13 in
`tests/services/element-management-service.test.ts`, all under `ChangePlugin`. The cause was ONE
thing, so the fix was one thing.

**The overlay modelled EXISTENCE but not CONTENT.** The file already had an in-memory fs overlay
whose own comment says why it exists — *"a mocked write is a no-op, so no post-install assertion in
this file could ever discriminate"*. It tracked which paths exist and never what they contain, so a
write still never fed back into a read. The same defect its author fixed one layer down.

Three layers had to model the write, and each was found by the tests, not by reading:

| layer | why it was needed |
|---|---|
| `writeFile` records the body; `readFile` consults it before the per-test baseline; `rename` MOVES it | `saveJsonSafe` writes `<path>.tmp.N` then renames — content must travel, or the atomic write lands an existing-but-empty file |
| a successful `claude plugin <verb>` applies the CLI's OWN settings effect | **13 → 11 → 6**: user-scope writes are done BY THE CLI, so modelling `writeFile` cannot help — nothing calls it on that path |
| …for LOCAL scope too, keyed on the **spawn cwd** | `claude` has no `--cwd` flag; the agent dir arrives as the cwd, and local install goes through the CLI as well |

**Result: 103/103 green WITH N17 still applied** — the fixtures now model the write, so G11 finds
nothing to mismatch even while it is wired to fail. Then N17 reverted.

**A test I broke, and a requirement I invented.** The accurate CLI model broke
`should clean up settings.local.json`, which asserted that a `writeFile` HAPPENED — true only
because the CLI mock was a no-op, so the service's safeguard sweep was the only thing that could
remove the key. It now asserts the OUTCOME, and the safeguard got its own test. My first draft of
that test asserted the sweep removes a DIFFERENTLY-SPELLED key; it failed, correctly — the code says
it *"only removes a key the CLI was already asked to remove"*. **The requirement was mine, not the
service's.** Rewritten as the real fallback case (the CLI THROWS, the key must still go), and
neutering the sweep reds that test and only that test — so the safeguard block, which nothing pinned
before, is now pinned.

## THE 409 IS PINNED AT ALL FOUR SITES

`tests/api/local-plugins-verified-mismatch.test.ts` → **`plugin-routes-verified-mismatch.test.ts`**
(`git mv`), plus 3 tests × the 3 unpinned sites. The tests immediately found that **the four routes
do not share one guard** — `local-plugins` uses `requireAuth`, `role-plugins/install` gates on a
SUDO TOKEN first (both verbs), `global-plugins` is system-owner-only. Mocking only `requireAuth`
produced a 401 and a missing-export error: each route naming its own door.

**The neuter is the point.** Reversing the two early-returns at all three sites (so `mismatch` is
checked before `!success`) reds **exactly the 3 ORDER tests, one per site**, and nothing else. That
ordering is invisible to `tsc` — both branches type-check and both return a Response — and reversed
it reports a gate denial as "the change did not take effect".

## Acceptance

- [x] Every caller of `ChangePlugin` enumerated with what it does on `success === false` — **15
      production sites, all handling it deliberately** (table in the STATE block). This is what
      refuted the card's own premise and its MED-HIGH risk rating
- [x] Per-action verdict recorded — and the audit found the axis is **not per-action but
      PER-CALLER**: a failure is right for the four user-initiated routes and wrong for the R51
      compensation path, where it escalates to "the system is unrecoverable". Measured by
      implementing the flip and reading what broke; reverted, with the reasoning left at G11 in the
      code so the next reader does not re-try it blind
- [x] The compensation blocker is SOLVED, and by inverting the question: no caller declares
      anything. `verified` is reported, `success` is untouched, and the compensation path is
      unaffected because it does not read the field — fail-safe rather than declare-or-else.
      Pinned by **N17**, which reds both R51 rollback tests
- [x] The 13 fixture tests now MODEL the write — **all 13 named** (N17 → red names → revert), all in
      `tests/services/element-management-service.test.ts` under `ChangePlugin`, and all fixed by ONE
      harness change: the fs overlay tracked existence but not CONTENT, and the CLI's own settings
      effect was unmodelled for both scopes. **103/103 green with N17 still applied.** Section above
- [x] The `unreadable` case still does NOT gate — pinned twice: `verified === 'unknown'` at the
      service, and a route case asserting 200 on `unknown`
- [x] Abort-vs-report (the R51 window question) — DECIDED: **REPORT**, on a structural fact rather
      than a preference. `ChangePlugin`'s ONLY `runGateSequence` (`:4855`) wraps the update path's
      `EXE-a`/`EXE-b` and **closes at `:4874`**; G11's mismatch is at **`:4960`**, outside it — so
      there is no window for G11 to abort into, and "make it abort" is really "widen the window
      across five actions", a different card. Plus the two reasons that survive widening: this
      pipeline is itself an R51 compensation (N17 reproduces the catastrophe), and the undo would be
      decided from the same read-back that just proved untrustworthy. Section above
- [x] Tests + neuters recorded by name (**N17**, **N18**) · tsc 0 lines · suite **322 files / 4577
      passed / 2 skipped**, up from 320/4567/2
- [x] `settings/marketplaces` — DECIDED on its own evidence, and **my stated hypothesis was wrong**:
      the retry advances only on `success === false` (`:889`), so a `mismatch` returns immediately and
      never reaches the next candidate — it cannot mean "try the next key shape". It is still not a
      copy of the pattern, for a reason the investigation surfaced instead: `handleInstall`'s
      stale-cleanup retry is gated on `!r.ok`, and a mismatch is exactly the dangling-entry symptom
      that path repairs. So the wiring SPLITS — 409 for enable/disable/update, stale-cleanup for
      install — and the install half is its own work with its own tests. Section above
- [x] The 409 wiring is pinned at ALL FOUR sites — `git mv`'d to `plugin-routes-verified-mismatch`
      and 3 tests added per unpinned site. The ORDER neuter (reverse the two early-returns) reds
      exactly the 3 ORDER tests, one per site. Section above
- [x] COMMIT THE WORK — the 22:21 `.git/index.lock` was STALE AND MINE (an interrupted `git commit`;
      0 bytes, no holder). I misattributed it to the user's `git difftool` sessions for 1h44m without
      ever checking their `cwd` — **three of the four were in other repositories**. Landed as
      `886a8a36` + `3d478407` + `6f0460a5`

## Approval log

- 2026-07-31T21:56:29+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, found while auditing TRDD-K71FV649 and deliberately filed
  separately because it is independent of that card's reader. Pre-approved: issuer authority >=
  required approver.
