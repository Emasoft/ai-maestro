---
trdd-id: FFHZM7XV
title: The absorbed version-update lane is cadence-driven not detection-driven, and its trail cannot measure publish-to-installed latency
column: refused
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:10:57+0200
updated: 2026-09-05T10:20:41+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: manager
mandate: false
approved: rejected
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: moderate
labels: [absorbed-chore, janitor-coordination, instrumentation]
external-refs: [TRDD-A70YJLXN, TRDD-PE54D95Q, TRDD-FXPV7L4D]
approval-judge: manager
approval-datetime: 2026-09-05T10:24:06+0200
---

## Problem

Raised by the ai-maestro-janitor session (its card: TRDD-A70YJLXN) against an owner directive:
*"No matter what daemon of the two is running, the ai-maestro plugin must be updated as soon as a
new version is detected on the marketplace."* Their central claim — *"your absorbed-duty tick does
not run `claude plugin update` at all"* — is **FALSE**, and correcting it exposed two defects that
are ours, one of which neither side predicted.

### Their claim, refuted first-hand

`services/auto-update-service.ts:727-753` — the absorbed `version-update` step actively updates:

```ts
const r = await ChangePlugin(null, {
  name: JANITOR_PLUGIN_NAME, marketplace: MARKETPLACE_NAME,
  action: 'update', scope: 'user', rolePluginSwap: true,
}, SYSTEM_AUTH_CONTEXT)
```

**They quoted our source accurately and about the wrong chore.** The *"stopped consuming the plugin
lists… nothing left to iterate"* comment is step **3**, `user-plugins-update`, whose loop left WITH
its claim (TRDD-PE54D95Q AC6). `version-update` is step 2 and is very much alive. Two adjacent
chores in one function; the quote belongs to the one that was removed.

### FINDING 1 — cadence, not detection. Their guarantee point survives.

`ABSORBED_DUTY_INTERVAL_MS = 4h` (`:116`), polled every 15 min (`:136`), and
`absorbedDutyIsOverdue` (`:305`) decides **purely on elapsed time**. So worst-case
publish→attempt is ~4 h. The janitor's own lane was detection-driven. **"As soon as detected" is
not what a 4-hour cadence provides**, so the directive is not met — for a different reason than
they gave.

**And the detection signal ALREADY EXISTS on our side and is inert as a trigger.**
`version-update-requested.flag` is raised by their per-session detector and consumed by us
clear-before-run (`:727`) — but only *inside* a tick the cadence has already decided to run.
Nothing consults it to DECIDE. So we receive the detection event and act on it up to 4 hours later.

**That makes a third option neither of us listed, and it is cheaper than both of theirs:** let a
pending work request make the lane overdue. The 15-min poller already exists, so the fix is a
disjunction in one pure function, worst case drops 4 h → ≤15 min, no new machinery, no re-porting
of their mechanism, and their lane stays down (no two writers on `claude plugin update`).

### FINDING 2 — the trail says `updated` unconditionally, so it cannot measure anything

Read from `~/.aimaestro/auto-update-settings.json` (`lastRunSummary`, cap 200), the instrument they
asked for:

```
janitor rows: 40    span 2026-08-18T14:16 -> 2026-08-26T13:48
status tally: Counter({'updated': 40})        <-- 40 of 40. ZERO 'already-current'.
```

40 consecutive `updated` across 8 days is impossible if the plugin is genuinely current between
publishes. The reason is in the branch: `already-current` is reachable **only when `ChangePlugin`
FAILS** with an `/idempotent|already.*installed|no.?op/` message. A success is reported `updated`
whether or not a byte moved.

**So `updated` means "the update command ran", not "a new version was installed".** Same class as
the `export/jobs` correction earlier today (a signature read as a behaviour) and as
TRDD-FXPV7L4D's *"Refreshed every registered marketplace"* — a status asserting more than the code
established.

**This is what actually blocks their acceptance criterion**, which is right and which I want to
keep: *"any fix shows a MEASURED publish-to-installed latency, not a design argument that it should
be fast."* With this trail, **no fix can be measured** — before or after. Fixing the instrument is
therefore the FIRST step, not a nicety.

### On their 36 h figure

Their method caveat is correct and they stated it themselves: a cache-dir mtime is an upper bound.
Our trail shows ~8 attempts in the window they measured 36 h across (8-21 04:41 through 8-22 13:10,
every one `updated`), so the attempts were happening. **I cannot tell from either instrument
whether those attempts were no-ops or whether the mtime simply did not move** — which is Finding 2
restated. I am not going to defend a number my own trail cannot produce.

## UPDATE 2026-08-26T14:2x — the instrument exists, and using it found a THIRD actor

The janitor replied accepting both refutations and pointing at an instrument that is not mine:
`~/.claude/plugins/installed_plugins.json`. **Every figure they gave reproduces here exactly**,
re-derived rather than taken:

```
user-scope records: 75      with lastUpdated: 75      >= 30 days old: 50
ai-maestro-janitor@ai-maestro-plugins  3.3.26  lastUpdated 2026-08-21T00:31:07.623Z
v3.3.26 publishedAt (gh api, independent)      2026-08-21T00:23:45Z
```

**Their positive control is sound and it is the right shape:** if `lastUpdated` were rewritten on
every no-op, all 75 would be recent; 50 are ≥30 days stale, so the field moves only on a real
version change. That is exactly the discrimination `lastRunSummary` lacks, on a file neither of us
writes.

**It also confirms FINDING 2 harder than my own trail could.** The janitor's registry record is
FROZEN at 2026-08-21 through **~40 of my `updated` rows** running to 2026-08-26T13:48. Two
independent instruments, one conclusion: those 40 rows installed nothing, and `updated` is not a
claim about installation. Finding 2 stands, and the gating argument does not — a latency is
readable today.

### THE NEW FINDING — my lane did not perform the install they measured

Their 7 m 22 s is real and is **not evidence about either daemon.** My absorbed-lane attempts
BRACKET the install rather than containing it:

```
my tick   2026-08-21T00:40:02+0200   updated
INSTALL   2026-08-21T02:31:07+0200   (registry, = 00:31:07Z)
my tick   2026-08-21T04:41:39+0200   updated
```

Publish 02:23:45+0200 → install 02:31:07+0200. **Nothing of mine ran in that window**, and their
lane stands down because we claim the chore. The remaining actor is the harness itself:
`known_marketplaces.json` has `ai-maestro-plugins autoUpdate: true` (refreshed today
2026-08-26T11:48:48Z), which is the condition our own step 1 maintains.

**Stated at the strength the evidence supports:** I have PROVEN my lane did not install it; I have
not proven which actor did. Claude Code's own auto-update is the only remaining candidate I know
of, and that is an inference, not a measurement.

**The janitor supplied the other half, so the elimination is now complete rather than half-argued**
(2026-08-26): their `version-update.last-run.ts` reads **2026-07-25T21:01Z — 26 days before** the
install, their lane standing down exactly as designed because we claim the chore. They also tried
to convert the remainder into positive evidence and could not (`~/.claude/logs` holds nothing for
that window). So: **PROVEN neither lane installed 3.3.26; NOT PROVEN which actor did**, and both
cards carry the inference labelled rather than promoted.

**Their sentence for the guarantee is better than mine and is the one to put to the owner:**
*"≤4 h, with two usually-faster paths that give no signal when they stop."* Defensible as a design;
simply not the same sentence as *"updates as soon as a new version is detected"*.

**One asymmetry worth wiring in if option 4 is taken:** the two silent failures are not equally
silent. The harness stopping is invisible to both sides by construction (FXPV7L4D found it 11–155
days deep). A host with **no armed janitor session** is observable — so the trigger degrading to the
4 h floor should be something the lane SAYS, not something discovered later.

### What that does to the fix — it strengthens option 4's ARGUMENT and weakens its headline

"4 h is too slow" is the wrong case to make, because the usual path is already ~7 minutes and is
not ours. **The real case is that the harness path fails silently and we are the backstop that
does not notice.** TRDD-FXPV7L4D measured exactly that failure: 10 marketplaces had not refreshed
in 11–155 days while the lane printed `Refreshed every registered marketplace`. When the fast path
stops, a 4 h floor gated on elapsed time — never on detection — is what remains, and the detection
signal is already crossing the boundary unread.

**Their caveat, accepted, and it composes into the honest design.** The flag comes from a
per-SESSION janitor heartbeat, so a host with no armed session gets no early trigger. Three actors
with three properties, which the card should say out loud rather than leave implicit:

| actor | latency | fails when |
|---|---|---|
| Claude Code auto-update | ~7 min observed (n=1) | silently, per FXPV7L4D |
| absorbed lane + flag trigger (option 4) | ≤15 min | no armed janitor session on the host |
| absorbed lane cadence | ≤4 h | never — this is the floor |

Option 4 is still right. It is right as a **detection-driven backstop under an unreliable fast
path**, not as a speed-up of a slow one.

## Proposed fix

0. **NOT a blocker any more.** The registry gives a real latency today, so the trigger change no
   longer waits on the trail. Fix the trail anyway — a status that cannot say "nothing moved" is a
   defect on its own — but use the registry as its POSITIVE CONTROL.
1. **Instrument.** Record the version BEFORE and AFTER (`ChangePlugin` already resolves it,
   or read the cache dir), and emit `already-current` on an unchanged version rather than only on a
   matching failure string. Then `updated` is falsifiable and a latency can be computed.
2. **Trigger on detection.** Make `absorbedDutyIsOverdue` (or its caller) also return true when a
   work request is pending, so the existing 15-min poller acts on the flag. **Keep clear-before-run
   ordering** — a request raised mid-run must survive to the next pass.
3. NOT proposed: un-claiming `version-update` (their option 2). The claim/work pairing rule is
   satisfied — we do the work — and un-claiming would hand back a chore we perform correctly.
4. NOT proposed: relaxing the directive (their option 3) before the instrument exists, because we
   would be relaxing it on unmeasured grounds.

## Verification

- A test proving a pending work request makes the lane run at the next poll, with a neuter.
- A test proving an unchanged version reports `already-current`, with a neuter — **and a positive
  control that a genuinely new version still reports `updated`**, since a fix that always says
  `already-current` would pass the first test alone.
- Then the MEASUREMENT their card asks for: publish→installed latency from the corrected trail.

## Acceptance

- [ ] Instrument fixed: `updated` vs `already-current` decided by observed version, not by a
      failure string
- [ ] Neuter recorded for both directions (unchanged → `already-current`; new → `updated`)
- [ ] Detection trigger wired; worst case ≤15 min; clear-before-run preserved
- [ ] Neuter proving a pending request alone causes a run
- [x] **Measured publish→installed latency obtained 2026-08-26** — 7 m 22 s for v3.3.26, from the
      install registry, publish time cross-checked against `gh api`. **But it measures the HARNESS,
      not our lane** (our ticks bracket it), so it is not yet the number that validates a fix
- [ ] Post-fix latency attributable to OUR lane, reported back on TRDD-A70YJLXN
- [ ] Reply sent to the janitor session correcting the mechanism claim

## Approval log

- 2026-08-26T14:10:57+0200 — FILED. Prompted by a cross-session message from the
  ai-maestro-janitor Claude carrying an owner directive and its own measurement. Their mechanism
  claim was refuted by reading `auto-update-service.ts` first-hand; their *guarantee* claim
  survived and is Finding 1. Finding 2 is ours alone and neither session predicted it — it surfaced
  only because their card demanded a MEASURED latency, which sent me to the trail.
  **My own first read of that trail returned "0 janitor rows" because I keyed on `name` and the
  field is `target`** — a zero that would have inverted the whole answer, caught by a positive
  control asking what names the trail actually contains.
- 2026-08-26T16:33:33+0200 — MOVED to `design/proposals/`, `column: proposal`. It was filed in
  `design/tasks/` at `column: todo` while carrying `approved: false` — the authorized-work zone, on
  a card saying nobody had ruled. Caught by `trdd:doctor`'s APPROVAL-UNAPPROVED-IN-WORK-ZONE run
  against my own artifact: 7 hits, all 7 mine, against a 19-for-19 convention in
  `design/proposals/`. Zone only — no content changed and nothing withdrawn. **The janitor session
  is waiting on this card's reply (TRDD-A70YJLXN); the move does not change that owing.**
- 2026-09-05T10:20:41+0200 — REFUSED by emanuelesabetta (min-approval-requirement: manager). REFUSED as stale:  fixed by commit `9725bebf` (present in this session's own `git log`) — the flag is now peeked on the next poll, not the next 4h tick . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.

## Cross-project update — 2026-08-26 (from the janitor session, recorded not adjudicated)

**Cross-link: janitor TRDD-5ZVS1DDP** ("One daemon per host — the janitor daemon exits while an
ai-maestro server is running"), currently `column: blocked`, `blocked-by: [publish-of-AWXK0RFT]`.
Both sides read as the same shared-contract ruling seen from opposite ends. Adjacent on their
board: TRDD-AM8JD9SG (harness preparedness), TRDD-2C8XFOW9 (restart after settings changes).

**The option set narrowed, by an OWNER statement, not by anyone's reasoning.** Quoted by the
janitor from the owner this session:

> "is the janitor daemon (both this from the plugin and the one from ai-maestro when the
> ai-maestro server is running) automatically updating the janitor plugin if a new version is
> detected? … the ai-maestro plugin must be updated as soon a new version is detected on the
> marketplace."

That kills option 3 (relax to Claude Code's cadence) and any answer whose guarantee is a 4 h
elapsed-time floor. **Live options are 1 (port the work), 2 (un-claim the chore), 4 (consume the
detection flag in the overdue predicate) — all three are OURS.**

The janitor's reading that option 4's shape matches the directive's wording is recorded as THEIR
reading, not as an owner quote. The quoted text above is the quote; the inference is not.

**What option 4 needs, verified live by them rather than recalled:**

```
~/.claude/janitor-control/version-update-requested.flag
```
canonical path (control_dir; dual-read against the older pre-control-dir location, prefer this
one). Raised by `global_state.request_version_update()`, cleared by
`clear_version_update_request()`, presence-tested by `version_update_requested_present()`.
Written atomically with a provenance body.

**Rider, and it is ours:** their flag is raised from a per-SESSION heartbeat, so a host with no
armed janitor session never raises it and silently falls back to the 4 h floor. That degradation
is OBSERVABLE, unlike the harness auto-update stopping (invisible by construction — TRDD-FXPV7L4D
found that class 11 to 155 days deep). So option 4 must SAY OUT LOUD when its trigger degrades to
cadence; an observable degradation nobody surfaces is the same failure class with a shorter fuse.

**Deliberately NOT done on their side:** no janitor fallback that runs the update anyway while we
hold the chore. TRDD-LU0C5KAR's binary rule removed exactly that guard and two writers on
`claude plugin update` is the issue-#7 pile-up. **If we take none of 1/2/4, the correct outcome is
that the directive goes UNMET and the owner is told — not that they quietly re-arm.**

Also confirmed and not to be re-diagnosed: their `version-update.last-run.ts` frozen at 2026-07-25
is CORRECT for an absorbed chore, not a dead lane. It has already misled one reader on this host.

**Not adjudicated here.** This card is manager-tier and the owner is away; picking between 1/2/4
would be self-approval. Recorded so the option set, the flag path and the rider survive to the
ruling.

## Acceptance — added by the option-4 rider

- [ ] IF option 4 is chosen: the lane emits an explicit, surfaced signal when the detection
      trigger is unavailable and it has fallen back to the cadence floor.
