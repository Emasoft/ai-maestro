---
trdd-id: RE9AVNJF
title: server tick never mirrors the live credential into its own slot, so every slot goes refresh-dead after hours live
column: backburner
created: 2026-09-09T14:19:35+0200
updated: 2026-09-09T17:11:24+0200
implementation-commits: [5aa945c1, 48e839b6]
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: bugfix
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: governance-rules-session
approval-datetime: 2026-09-09T14:19:35+0200
labels: [oauth-rotator, continuity]
external-refs: [TRDD-CVQJNW3A, TRDD-MN0Q1IA2, TRDD-X4RK1NUW, TRDD-8148P30S]
---

# server tick never mirrors the live credential into its own slot, so every slot goes refresh-dead after hours live

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

Minted after the owner rotated by hand for the third time (2026-09-09 13:40, 13h40m unrotated
with a usable alternate). Root cause verified in code + logs (below).

**CODE LANDED 14:25** — `reconcileLiveEmail` now mirrors a drifted live credential into its
EXISTING slot (`lib/oauth-rotator/tick.ts`), `nowLocalTz` exported from slots.ts, 3 tests in
`tests/unit/oauth-rotator-tick.test.ts`. Measured: tick file 40/40, the 29-file oauth-rotator set
436/436, `tsc --noEmit` 0 errors; three neuters each reddened exactly one named test (Verification).

**Review verdict (per-turn fork, pre-write) — accepted:** scope the mirror to EXISTING slots
(the rationale never required enrolling a new account; an unenrolled one-off `/login` must not
become a rotation target) — pinned by test 3 / neuter N3; ONE narrowing of `state.slots`
(`??=`) instead of a typed-optional chain plus a dead guard; positive control asserting the ban
is PRESENT before the tick; honest `RequestInfo | URL` cast in the test stub; no line-range
citation in the comment; log line carries the email once. **Rejected: none.** Not a code change
but recorded here from the review: the F1 path (`resolveUntrustedLive`, primary keychain item
unreadable) never reaches this mirror — the server reads the primary (reconcile logged 13:40:32
today), and F1 is the janitor daemon's context, whose own `cmd_capture` is the mirror there;
`switchLiveTo` needs no write (it stamps `live_fp` from the slot it copied, so the next tick sees
no drift); the janitor daemon's tick running beside the server (5 takeover episodes 09-08,
TRDD-8148P30S) writes the same slot + meta last-writer-wins — pre-existing, and this adds ONE
MORE writer to the live account's meta (post-write review, finding 1).

**Post-write review (fork over commit 5aa945c1):** accepted — test 3's `readSlot(...)===null`
line was vacuous under backend `none` (dropped; N3's captured failing frame is the `slots`
expect — `oauth-rotator-tick.test.ts:733`, `expected { 'other@x': … } to not have property
"other@x"`);
under N1 test 1 fell on its FIRST expect (`slotToken`), so `fp`/`via`/the two absences are
pinned transitively by the one atomic `slots[realEmail] = {…}` assignment, not each on its own;
"restored" is proven by `git diff … | grep -c NEUTER` = 0, not the file grep; the "rotator set"
was two measurements, not one derived from the other: vitest reported 29 files for the PREFIX
filter `tests/unit/oauth-rotator-` + `statusline-admissible`; separately, `find -maxdepth 1
-name 'oauth-rotator-*.test.ts'` counts 28 on disk. The filenames vitest ran were not listed. Rejected: "the refused-path log carries no email" — `writeSlot`'s own
message names the slot, so `${exc.message}` carries it exactly once; "tick box 3, the full
suite exited 0" — it did NOT (17 failed / 6814 passed, wrapper exit was the `tail`'s); no
`--amend` of the landed commit for wording. `implementation-commits:` lists commits that change
`lib/` or test BEHAVIOUR; comment-only and card-only commits are excluded by this policy.

NEXT ACTION: nothing in this session's hands. Box 4 is the owner's `yarn build` + `pm2 restart`
(the `server.mjs` hold, TRDD-8148P30S STATE); box 5 is a post-deploy observation. Until deployed
the live server still runs the pre-fix bundle — a slot going stale before then is expected.

**COLUMN IS UNRESOLVED AND IS THE OWNER'S CALL — I have been wrong about it twice in 90 minutes
and am not choosing a third time.** It is at `backburner` (moved 2026-09-09T17:06 out of `dev`,
where it had sat since 14:25 with nobody working it). The third review then faulted `backburner`
too, and the objection is good: this card's ONLY remaining work is the owner's (boxes 4 and 5),
and `backburner` is the one column the drain rule EXEMPTS — so the human's own pending action is
now filed where nothing surfaces it. It is also the FIRST column in the chain, so it positionally
asserts *not begun* about a card carrying `implementation-commits: [5aa945c1, 48e839b6]` and three
checked boxes. Candidates, none applied: **`human_review`** (forward, the remaining gate really is
a USER decision, and not a WIP column so it claims no activity), **`dev` + this note** (stale but
visible), or leaving it here. `complete` is unavailable — the checklist gate, two boxes open.

**Whichever column is picked, the WAIT CONDITION needs a machine-readable home again.**
`unblock-when: [decision: owner authorises yarn build + pm2 restart]` was TRUE — `decision:` is
the documented human-only kind that never auto-clears — and it went out in the same edit as the
false `blocked-by`. It is scoped to `blocked` cards, which is why it was not simply re-added here;
that coupling is why this is one decision, not two.

**Recorded, not repairable:** commit `5a579206`'s message says *"a watchdog walking the graph would
have concluded 'work 8148P30S to unblock RE9AVNJF'"*. No such watchdog is known to run on this
corpus — that is a mechanism invented to add force to a conclusion the definition of `blocked-by`
already carries on its own. It is the same defect the sibling commit `8fac9203` removed from the
other two cards, committed in the same turn. No `--amend` for wording.

**It went through a WRONG intermediate, recorded because that one landed in a commit
(`11bebaf3`): `column: blocked` with `blocked-by: [TRDD-8148P30S]`.** That edge is FALSE.
`blocked-by` means *cannot proceed until that one resolves*, and 8148P30S can sit at `todo`
indefinitely while this card becomes workable the moment the owner builds. I wrote it to satisfy
the linter's demand for a non-empty `blocked-by` — optimising for the instrument over the fact —
and a prose caveat in a STATE block does not un-say a machine-read frontmatter field: a watchdog
walking the graph would have concluded *"work 8148P30S to unblock RE9AVNJF"*. `backburner` is a
resting state the pipeline rule already exempts from drain pressure, so it needs no edge and
asserts nothing untrue.

Box 5's deploy check, kept here as a RECIPE and deliberately NOT as a `blocker-probe:` —
`grep -rl --include='*.js' --exclude='*.map' live-mirror .next` — the string literal this fix
introduces, from the emitter (`lib/oauth-rotator/tick.ts:801`). Its limits, because a check that
fails toward *keep waiting* looks correct forever: grep exits **2** for a missing directory and
**1** for a stale build, so "not deployed" and "could not look" are the same answer; `.js.map`
embeds original source, hence the exclude; and it witnesses the BUILT artifact, never a RUNNING
one — `pm2 restart` is what makes it execute. So read box 5 off the EFFECT (a slot's
`captured_at` advancing after Claude Code refreshes the live account), not off the bundle.

## Problem

MEASURED 2026-09-09 (janitor DATA `oauth-rotator/state.json`, `rotator.log`, `logs/pm2-out.log`):
all three slots `captured_at 2026-08-26`, all three `refresh_dead_fp == fp`,
`last_refresh_failure: credential-dead` (11 / 5 / 13 failures). The server rotator logged
"exhausted … all paid accounts maxed" every minute from 00:00 to 13:39 while
`emanuele.sabetta` sat at 5h=0% 7d=60%. The owner logged in by hand at 13:40 (beacon change).

## Root cause

Claude Code refreshes the LIVE account on its own; the grant is single-use rotating (tick.ts
module header, reauth-flow.ts:20-21). Every such refresh leaves that account's SLOT holding a
pre-rotation pair, which the endpoint rejects as `invalid_grant` the moment the tick switches
away and tries to renew it. The janitor's `cmd_capture` (rotator.py:1537) is exactly the
live→slot mirror that prevents this — and in daemon context it is skipped every tick
("primary live credential unreadable — skipping capture (F1)", every tick in rotator.log). The
server port `reconcileLiveEmail` (tick.ts:764-786) fixes `state.live_email/live_fp` on drift and
never calls `writeSlot`; the only server `writeSlot` sites are the refresh paths
(`refreshAndHealSlot`, `keepaliveRefresh`), which by design never touch the live account. So on
this machine NO path re-mirrors the live credential, and every account that is live for a few
hours comes back with a dead slot. The cookie-based re-mint legs that would recover a dead slot
are all off: janitor auto-bootstrap opt-in never set; the server's unbrowse re-auth leg
flag-disabled by the owner 2026-08-07 (TRDD-MN0Q1IA2 — zero successes ever, TRDD-CVQJNW3A).

## Proposed fix (one change)

In `reconcileLiveEmail`, once the drifted live credential's account is resolved, mirror it into
that account's slot (`writeSlot`) and REPLACE the slot meta (`captured_at`, `fp`, `expires_at`,
`via: 'live-mirror'`) — same REPLACE rule as `fileSlot`, so the superseded token's
`refresh_failures` / `refresh_dead_fp` ban is dropped. Keyed on `meta.fp !== realFp`, so it costs
one keychain write per genuine drift and nothing in steady state. Fail-soft on
`SlotKeychainWriteError` like `refreshAndHealSlot` (the state reconcile still runs). Export
`nowLocalTz` from slots.ts for the `captured_at` stamp. No new module, no new flag.

## Verification

- `tests/unit/oauth-rotator-tick.test.ts`: (1) slot holds OLD + branded dead (asserted present
  BEFORE the tick — the positive control), live file holds a rotated pair, `/roles` resolves the
  same email → after `runTick` the slot holds the new pair, meta fp/via replaced,
  `refresh_dead_fp` and `refresh_failures` gone, `live_fp` reconciled; (2) slot already equals
  the live pair, only `state.live_fp` stale → state reconciled, slot NOT rewritten (`via` stays
  `test`); (3) live is an account with NO slot → `live_email` follows it, no slot is created.
- Neuters, MEASURED 2026-09-09 14:2x (1 failed | 39 passed each, exit 1): N1 `if (false && …)`
  on the mirror guard → only (1) red; N2 `if (meta)` (fp compare dropped) → only (2) red; N3
  `if (meta?.fp !== realFp)` (existing-slot guard dropped) → only (3) red. Restored: 40/40.
- `tsc --noEmit` 0 errors; oauth-rotator set 29 files / 436 green; full `yarn test` — box 3.

## Risk

LOW. Adds one keychain write per live-credential drift (Claude Code refreshes roughly per
access-token lifetime). A wrongly-resolved email would file the live pair under the wrong slot —
the same exposure `reconcileLiveEmail` already carries for `state.live_email`, unchanged.
Untestable in this harness: the `SlotKeychainWriteError` branch (backend `none` cannot refuse),
exactly like the existing branch in `refreshAndHealSlot`.

## Out of scope (recorded, not done here)

- The false "all paid accounts maxed" wording when the cause is dead credentials — own card.
- Re-arming the unbrowse re-auth leg (`~/.aimaestro/oauth-reauth-repair.enabled`) — owner
  decision; it has never completed a live consent run.
- Today's three dead slots: this fix prevents recurrence, it does not resurrect them —
  `/janitor-refresh-cc-logins` re-mints from the live cookies (valid until 2026-09-23).

## Acceptance

- [x] mirror block in `reconcileLiveEmail` + `nowLocalTz` export landed (14:25)
- [x] three tests landed; three neuters run, each reddened exactly the test it should (Verification)
- [x] `tsc --noEmit` 0 errors; oauth-rotator set 29 files / 436 green (14:2x)
- [ ] full `yarn test` green — MEASURED 14:26 (the `exit=` line the command wrote for itself; the
      background-task notification's "exit 0" was the trailing `tail`'s): 17 failed / 6814
      passed in 5 files, none of which imports the
      rotator DIRECTLY (grep over the 5 files; transitive reach through the createagent
      pipeline unchecked) (`tests/governance/enforcement-coverage` map drift R31/R50;
      `tests/integration/createagent-g05c-gitignore`, `-g08-cross-client`, `-g11-r17-core`;
      `tests/services/change-title-window`). Not attributed to this change by a direct-import grep;
      not proven pre-existing either (no clean-baseline run — the tree carries the owner's
      uncommitted governance edits). Owned by whoever picks those files up, not this card.
- [ ] owner built + restarted (on the owner's hold — not this session's to lift)
- [ ] observed: a slot's `captured_at` advances after the live account is refreshed by Claude Code

## Approval log

- 2026-09-09T14:19:35+0200 — MANDATE issued by governance-rules-session (min-approval-requirement: none). Tier 0: in-scope bugfix, reversible, no governance change. No approval request was sent.
