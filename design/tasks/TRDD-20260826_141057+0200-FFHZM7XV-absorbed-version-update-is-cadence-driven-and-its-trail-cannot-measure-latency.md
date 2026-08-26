---
trdd-id: FFHZM7XV
title: The absorbed version-update lane is cadence-driven not detection-driven, and its trail cannot measure publish-to-installed latency
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:10:57+0200
updated: 2026-08-26T14:22:10+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: moderate
labels: [absorbed-chore, janitor-coordination, instrumentation]
external-refs: [TRDD-A70YJLXN, TRDD-PE54D95Q, TRDD-FXPV7L4D]
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
