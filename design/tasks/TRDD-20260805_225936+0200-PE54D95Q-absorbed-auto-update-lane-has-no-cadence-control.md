---
trdd-id: PE54D95Q
title: The absorbed auto-update lane has no cadence control and retries permanent failures hourly
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-05T22:59:36+0200
updated: 2026-08-06T10:09:11+0200
implementation-commits: [4e66947e, 793b866c, 7c104ba4, 15f752d3]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T22:59:36+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [auto-update, github, rate-limit, owner-ours]
external-refs: [Emasoft/ai-maestro#102]
---
# The absorbed auto-update lane has no cadence control and retries permanent failures hourly

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-06

**LANDED: the cadence only.** `4e66947e` — `ABSORBED_DUTY_INTERVAL_MS` 1 h → **3 h**
(`services/auto-update-service.ts:111`), pinned by *"arms its timer at exactly 3 hours"* in
`tests/services/auto-update-absorbed-duty.test.ts`. Neuter observed via `scripts/dev/neuter`:
reverting the constant reds exactly that one test, 13 green, restore blob-verified. AC2 closed.

**NPT(1) — ANSWERED, and the card's own worry was wrong.** It asked whether any production
caller reaches `restartHarnessFleet`. Measured: it has ZERO callers outside
`lib/fleet-restart-fanout.ts`, but that wrapper IS reached — `server.mjs:1824`
(`restartFleetForSessions`, wired into `startAutoUpdateScheduler`) and `server.mjs:1852`
(`restartEntireHarnessFleet`, wired into `startAbsorbedDutyScheduler`). So the chain
server.mjs → fanout → driver is live. The card looked for "an `app/api` route among the hits",
found none, and concluded UNKNOWN; the caller is the **server itself**, which is why an
API-route search could never have found it. **NPT(1) is closed; NPT(2) (a flag written before a
restart is honoured by the instance that returns) still needs an operator and still gates `dev`.**

**6 of 7 acceptance boxes are closed.** AC1 (`7c104ba4`) — the refresh is ONE argless
`claude plugin marketplace update` via the new `RefreshAllMarketplaces`, down from 275 CLI
processes per tick; the argless form was verified against the CLI's own `--help` first. The
autoUpdate flip (`793b866c`) keeps every marketplace in `extraKnownMarketplaces` at
`autoUpdate: true` through `lib/settings-gate::editSettings`. AC5 (`15f752d3`) gives the lane
its own `lastAbsorbedRunAt`. AC3 is pinned by driving the lock-CONTENTION case, AC4 and AC7 were
already satisfied and are now cited rather than assumed. Every guard carries an observed neuter.

**SUPERSEDED — do NOT carry forward:**
- *"BLOCKER FOUND for AC1 — there is no argless refresh path to call"* — there is now;
  `RefreshAllMarketplaces` is it. The observation that `ChangeMarketplace` hardcodes the name is
  still true and is WHY it is a separate function.
- *"⚠ SEQUENCING HAZARD — do NOT implement AC6 next"* — the hazard was that 0 of 275
  marketplaces had `autoUpdate` on, so deleting the per-plugin loops would strand everything.
  The flip closed exactly that. AC6 is now gated on EVIDENCE, not on ordering (below).

**⚠ READ BEFORE TOUCHING THIS LANE — it wrote the USER'S REAL `~/.claude/settings.json` once.**
`ensureMarketplaceAutoUpdate`'s path argument DEFAULTS to that file, and every absorbed-duty
test drives the tick body, so adding the step made the suite rewrite all 257 of the user's
marketplace entries while reporting **35/35 GREEN** — nothing there asserts on that file. Fixed
two ways: `settingsPath` is threaded through `AbsorbedDutyDeps` and injected at all 11 call
sites, and the repo's `guardRealUserSettings` tripwire — which was OPT-IN and covered **6 of
385** suites — now runs from `vitest.config` `setupFiles` for all 385. Proven to fire, not
assumed (a probe appending one byte reds with `MODIFIED it (51541 → 51542 bytes)`; it is parked
in `tests_dev/`). Any future step here takes its path as a parameter, never a default.

**NEXT ACTION — AC6, and it is BLOCKED ON EVIDENCE THAT DOES NOT EXIST YET.** Removing the two
per-plugin loops (`auto-update-service.ts` steps 2 and 3) is only safe once the harness is
demonstrably upgrading plugins from the refreshed catalogs. Measured 2026-08-06 08:00, and it
is not yet demonstrable:

| file | `autoUpdate: true` | mtime |
|---|---|---|
| `~/.claude/settings.json` → `extraKnownMarketplaces` | **257 / 257** | 07:46 |
| `~/.claude/plugins/known_marketplaces.json` (runtime registry) | **0 / 275** | **07:08** |

The registry has not been written since BEFORE the flip, because the flag is read at instance
LOAD and no Claude Code instance has started since. So the card's open question — *which
direction does the harness sync these two files* — is still unanswered, and AC6 rests on it.

**Re-measured 08:17 — a data point that NARROWS it without settling it.** The registry's mtime
had moved to **08:09:56** (from 07:08), i.e. something wrote it AFTER the 07:46 flip, and
`autoUpdate: true` was still **0 / 275**. That is evidence against "settings.json → registry
sync", but it is NOT decisive and must not be recorded as such: a write that only refreshes
`lastUpdated` is a CATALOG REFRESH, which is a different event from an instance BOOT reading
`settings.json`. Only the boot re-derives the flag. Do not close AC6 on this.

### ⚠ 2026-08-06 09:50 — EVERY MEASUREMENT ABOVE WAS TAKEN AGAINST A SERVER RUNNING PRE-FIX CODE

**None of this card's four commits were deployed.** `.next` was built **07:08:18** and pm2 started
**07:08:27**; the cadence commit `4e66947e` landed **07:26:25**. So the build predates the first fix
by 18 minutes, and `services/auto-update-service.ts` is BUNDLED — it does not go live on a restart
alone. Three independent confirmations, none of them a timestamp:

- `~/.aimaestro/auto-update-settings.json` carried **no `lastAbsorbedRunAt` key** (the field
  `15f752d3` adds);
- its `lastRunSummary` held **200 rows of the OLD per-plugin shape**
  (`claude plugin update <x> <y> --scope user`), not the single `absorbed:marketplace-refresh`
  row `7c104ba4` emits — and **every one of the 200 was `failed`**, i.e. the rate-limit symptom
  this card exists to fix was still occurring, live, at 09:10:13;
- the registry was being stamped **hourly on the `:09:56` mark**, which is the OLD 1-hour cadence.

**The mis-attribution is the reusable part.** The gate above says *"the check to run when a session
has started after 07:46"* — I was waiting on a Claude Code BOOT to explain the registry writes. The
writer was **our own undeployed lane**, refreshing catalogs every hour. I had correctly ruled out
"this is a boot" (lines above) and then never asked *who else it could be*, so the observation was
filed against the wrong actor and the wait had no end condition. Ruling out one cause is not
identifying one.

**Deployed 09:50** — `bash scripts/with-node.sh yarn build` (exit 0, 0 errors, 180s) + `pm2 restart`
(build 09:50:28, pm2 09:50:39, both now after 07:26:25). Verified in the ARTIFACT THAT EXECUTES,
not by `git log`: `absorbed:marketplace-refresh` and `lastAbsorbedRunAt` are both present in
`.next` (1 file each, with `absorbed:` as the positive control proving the grep works). Note the
numeric-constant grep is NOT a valid instrument here — `10800000` and `3600000` both return **0**
files, because the source writes `3 * 60 * 60 * 1000` and the bundler keeps the expression. All 3
tmux agents survived (they are independent processes; only the dashboard WebSocket reconnects).

### CORRECTION to the paragraph above — this module has TWO live copies, with different deploy mechanics

The conclusion ("not deployed") was right; the MECHANISM recorded for it was wrong, and it is
wrong in `c5fad115`'s commit message too. `services/auto-update-service.ts` is reached two ways:

| copy | who loads it | goes live on |
|---|---|---|
| **scheduler** — `startAbsorbedDutyScheduler`, `stopAbsorbedDutyScheduler` | `server.mjs:1813/1845/2305`, via `await import('./services/auto-update-service.ts')` — the **TypeScript source**, transpiled at runtime (tsx headless, Next's transpiler in full mode) | **`pm2 restart` ALONE — no build** |
| **route** — the same service imported by API routes | bundled into `.next` | **`yarn build` + restart** |

So "`services/*.ts` is BUNDLED, so a restart alone never loads it" is false for the half that
actually runs this lane. What made the fixes undeployed was simply that the process had imported
the module at **07:08:27**, before any of them existed — a running process does not re-read source.
The rebuild was not wasted (it updated the route copy), it just was not what mattered here.

**This also downgrades `c5fad115`'s own verification.** Finding
`absorbed:marketplace-refresh` + `lastAbsorbedRunAt` in `.next` proved the ROUTE copy was current
and said nothing about the scheduler copy. Two greps that returned **0** are the tell, and one of
them was a positive control: `absorbedDutyIsOverdue` (a function NAME — minified away) and
`'Absorbed-duty tick threw'` (a pre-existing string that is only ever in the scheduler path, hence
never in `.next` at all). The honest proof for the scheduler half is RUNTIME behaviour, and it now
exists — see below.

**RUNTIME PROOF (10:02:31).** After the restart at 10:00:28, `ps` showed **one** process,
`claude plugin marketplace update`, **argless**, started ~10:02:31 — i.e. exactly at
boot + `ABSORBED_DUTY_BOOT_SETTLE_MS`. That single fact carries three claims at once: the boot
catch-up fired; the new single-call refresh replaced the per-name loop (the old lane would have
shown `… update <name>`); and the scheduler copy is genuinely the new code. The state file is
written only after the refresh returns, so an early check reads "nothing happened" — a full sweep
takes minutes (the 07:08 one ran 07:08:39→07:09:56+).

**A NEW fact that weakens the "registry is authoritative" branch below.** Only **15 of 275**
registry entries carry an `autoUpdate` key AT ALL (all 15 `false`); the other 260 have no such
key, and the entries also carry `source` / `installLocation` / `lastUpdated`. A field absent from
260 of 275 entries cannot be the authority for those 260 — that shape reads as a runtime CACHE
holding an add-time snapshot, not as a declaration. Three marketplaces disagree outright
(`awesome-claude-code-plugins`, `emasoft-plugins`, `huggingface-skills`: settings `true`, registry
`false`), and the first two were re-stamped at 07:08:5xZ *after* the flip without adopting it.

**The check to run when a session has started after 09:50** (unchanged in substance, now measurable
for the first time — the previous attempts were all reading a pre-fix server): re-read the registry.
If its entries now carry `autoUpdate: true`, the sync is settings → registry and the flip works;
then AC6 may proceed. If they do NOT, the remaining question is a READ-ORDER question — *which file
does Claude Code consult at startup* — which static inspection cannot answer and which is a
governance matter about a harness-owned file with **no sanctioned writer** (the settings gate
refuses that path by basename and parent dir). Do not delete the loops until one is established.

## Problem

The USER reported GitHub rate-limiting them for "too many connections". Found by
investigation on 2026-08-05; the mechanism is ours.

`services/auto-update-service.ts` runs **two** timers. The first is gated on the user's
master toggle. The second — the **absorbed-duty lane** (ai-maestro#102, TRDD-5X3P79Q6) —
is deliberately not:

```js
// It runs UNCONDITIONALLY at boot (never torn down by the user's `enabled: false`)
const ABSORBED_DUTY_INTERVAL_MS = 60 * 60 * 1000
```

**The rationale for ungating it is sound and must be preserved** ("consent-to-add is not
consent-to-remove" — `lib/janitor-presence.ts`): these duties were never subject to a user
preference before this server absorbed them from the janitor daemon, so absorbing them must
not silently let a pre-existing `enabled: false` switch them off.

What is missing is the other half: the lane has **no cadence control of its own**. The one
knob the user has, `intervalMinutes` (clamped `[5, 1440]` in `lib/auto-update-settings.ts`),
governs only the gated scheduler. So a user who wants this traffic *less frequent* — not
off — has no way to ask for it, and the interval they set has no effect on the lane that is
actually running.

## Measured (this host, 2026-08-05)

| quantity | value |
|---|---|
| `~/.aimaestro/auto-update-settings.json` → `enabled` | **false** |
| → `lastRunAt` (the gated lane) | **null** — never ran |
| → `lastRunSummary` targets, at 19:55 the same day | **200** |
| of those, `status: failed` | **158 (79%)** |
| of those, `status: updated` | 42 |
| marketplace git clones under `~/.claude/plugins/marketplaces` | **288** |
| absorbed-lane cadence | **3600 s, hardcoded** |

So ~200 `claude plugin update` invocations per hour, each a git operation against GitHub.

The failures are not transient — they are shaped like permanent misconfigurations:

```
Command failed: claude plugin update open-code-review open-code-review --scope user
✘ Failed to update plugin "open-code-review": Plugin "open-code-review" not found
```

A target that cannot be found this hour cannot be found next hour either, yet it is retried
every hour indefinitely. **79% of the connections buy nothing.**

## Why it was invisible, which is the part worth keeping

Every quota meter read clean throughout, and each reading was true:

- `gh` authenticated core **12/5000**, then **23** and **FLAT across 16 samples / 4 minutes**
- graphql **118/5000**, unauthenticated **2/60**, no Tailscale exit node

**Git-protocol operations count against no API quota**, so `git fetch` traffic is invisible
to every counter GitHub exposes and to `gh api rate_limit` entirely. A 150 s `ps`/`lsof`
sampler also under-counts by construction — a `gh`/`git` invocation completes in well under
the sampling interval.

Worse, the two fields an operator would naturally check to answer *"is auto-update running?"*
both say no: `enabled: false` and `lastRunAt: null`. Only `lastRunSummary`'s timestamps
reveal that a different lane ran three hours earlier. **The state file is honest per-field
and misleading as a whole**, which is what made this take six wrong hypotheses to find.

## The fix — USER ruling, 2026-08-05

Verbatim: *"the marketplace updates should simply be executed once every 3 hours by the
daemon. not by every agent! one single command: `claude plugin marketplace update`.
nothing else."*

**This costs nothing, and that is the whole point — do not read it as a tradeoff.** USER,
correcting this card's first draft: *"its not aggressive, its just right. it is useless to
run that command multiple times! the claude code plugins can only be updated once!"*

An update either applies (a newer version exists and is fetched) or is a no-op. Running it
again inside the same window cannot make a plugin fresher than the first run already did —
it re-asks a question whose answer has not changed, and pays a connection for the answer.
So the *only* thing frequency buys is latency against upstream publishing, and past that
point every extra invocation is pure waste, not margin.

That reframes the measurement above. The **200 invocations/hour, 158 of them failing** are
not "a load level to tune down" — the loop had no freshness to trade away in the first
place. Which is why the three constraints below give up nothing:

**A guardrail for whoever reads this later:** if you are tempted to raise the frequency
back up "to keep plugins fresher", it will not. Re-running is idempotent; you would be
buying zero freshness with N× the connections, which is exactly the state this card exists
to end.

Three constraints:

1. **ONE command, no per-target loop.** `claude plugin marketplace update` with no
   arguments refreshes every registered marketplace in a single invocation. The current
   shape — 200 per-target `claude plugin update <plugin> <marketplace> --scope user` calls,
   158 of them failing — is replaced, not throttled. This alone removes the 79% waste
   without any backoff logic, because there are no longer per-target invocations to fail.
2. **Cadence: 3 hours.** Not the 3600 s the lane hardcodes today, and not a user-facing
   knob — the ruling names the interval directly.
3. **The DAEMON executes it, once. Not every agent, not every session.** This is the
   load-bearing half: a per-session duty multiplies by the number of live sessions (13 here)
   and by project count (53 janitor dirs), which is the same per-instance-interval-against-a
   -per-account-limit error filed as `Emasoft/ai-maestro-janitor` #215. One executor, one
   schedule.

### Superseded by the above

The original proposal (kept so the reasoning is auditable, NOT to be implemented): a
per-lane `absorbedIntervalMinutes` setting, a consecutive-failure backoff for not-found
targets, and a `lastRunAt` fix. Items 1 and 2 are moot once there is a single command with
no per-target loop. The **state-file honesty problem survives** and is still worth fixing —
`enabled: false` + `lastRunAt: null` beside a lane that ran an hour ago is what made this
take six wrong hypotheses — so it is retained as an acceptance box below.

### RESOLVED — the per-plugin loop is redundant, not merely wasteful (USER, 2026-08-05)

I had flagged this as the one thing not to guess at: does dropping the per-plugin
`claude plugin update` calls strand installed plugins with nothing updating them?

It does not. USER, verbatim: *"actually it only updates the marketplaces. but if the plugin
has the option 'auto-update' on, then if the updated marketplace is reporting a new version
of a plugin, the claude code harness will automatically update the plugin too."*

So the upgrade path already exists **inside the harness**: refresh the catalog, and Claude
Code updates every auto-update-ON plugin whose newer version the refreshed catalog now
reports. The loop was not doing work the harness omits — it was **duplicating** work the
harness already performs, 200 invocations at a time.

That strengthens the ruling rather than qualifying it. There is no residual duty to
re-home, no follow-up card, and no coverage gap to argue about: **one command, and the
harness does the rest.** Recorded in USER-scope memory as `claude-marketplaces#ATOM-BPYR-XUUH`
so it outlives this card.

One boundary worth stating, since it is the only thing the catalog refresh cannot reach:
plugins whose auto-update is **OFF** are not upgraded by it. Per the existing
`claude-marketplaces#auto-update` atom that is the default for third-party and local-dev
marketplaces. Those were equally unserved by the 158 failing per-target calls, so nothing
regresses — but "the harness does the rest" means *for auto-update-ON plugins*, and a
future reader should not widen it.

### The missing half — the refresh currently upgrades NOTHING (measured 2026-08-05)

USER: *"the janitor should turn auto-update on for every plugin, since it is off by
default."* Measured on this host, in `~/.claude/plugins/known_marketplaces.json`:

| quantity | value |
|---|---|
| registered marketplaces | **275** |
| entries carrying an `autoUpdate` key at all | **15** |
| of those, `autoUpdate: true` | **0** |

The other 260 have no key and fall to the default, which for third-party and local-dev
marketplaces is OFF (`claude-marketplaces#auto-update`). So **today the catalog refresh
does the entire network cost and produces zero upgrades** — nothing is opted in for the
harness to act on. Fixing the cadence without fixing this ships a cheaper version of a
no-op.

`autoUpdate` is a plain field beside `source` / `installLocation` / `lastUpdated`, so it is
settable non-interactively; the `/plugin` menu is one writer of that file, not the only one.

### Two constraints on writing that file — neither is optional

USER: *"it reads only at the moment it loads the claude code instance."*

1. **No "apply now".** An external edit reaches only the **NEXT** session. That is coherent
   with auto-update being STARTUP-only — the same boot that reads the flag is the one that
   acts on it — but it means a fleet-wide flip is a fleet-wide restart, or it lands session
   by session as each starts. Do not report the flip as effective when it is merely written.
2. **Lost-update race.** A running instance holds an in-memory copy and writes the file back
   (`lastUpdated` proves it does). With 13 concurrent sessions, whichever writes last wins —
   **with the copy it read at ITS boot**, silently reverting the janitor's edit. So the
   writer must re-verify the flag survived rather than assume the write took, and ideally
   write when the fleet is quiet.

Recorded in USER memory as `claude-marketplaces#ATOM-KDMD-BPXI` so it outlives this card.

### The restart is already an API capability — but it is UNTESTED (NPT)

USER: *"its not that bad, its just the reason i've added the option to the ai-maestro api to
restart automatically the client. never tested, though."*

That softens constraint 1 considerably: a flag flip does not require a manual fleet-wide
restart, because the server can restart the client itself. The read-at-load semantics stop
being a blocker and become a **sequencing** requirement — write the flag, then restart, in
that order.

**But "never tested" makes this a prerequisite, not a given.** This card's design would
depend on a path nobody has exercised, and a dependency you cannot demonstrate is
indistinguishable from one that does not work. It must be verified BEFORE the janitor flips
275 entries, or the fleet ends up with flags written and never read — which looks exactly
like the flip having failed.

What I verified myself, and what I did not:

- ✓ The restart routes exist: `app/api/sessions/[id]/restart/route.ts` and
  `app/api/sessions/me/restart/route.ts` (both `strict` under sudo-mode).
- ✓ The plumbing that would drive it exists: plugin-mutating routes return `restartNeeded`
  (`app/api/agents/role-plugins/install/route.ts`, `app/api/agents/[id]/local-plugins/route.ts`)
  explicitly "so the UI can queue a stop+restart".
- ✓ **FOUND, on a wider search — the symbol is `restartHarnessFleet`**
  (`lib/fleet-restart-driver.ts:89`), with a fan-out wrapper in
  `lib/fleet-restart-fanout.ts` that injects it as a dependency. My first four guesses
  (`autoRestart`, `auto_restart`, `restartClient`, `restartAfter`) all missed because the
  feature is named for the FLEET, not for the auto-ness — a reminder that guessing a symbol
  from the feature's description fails whenever the author named it for its object instead.

What remains unverified, and it is the part that matters:

- **Test coverage is ONE file** (`tests/unit/fleet-restart-driver.test.ts`) and it pins the
  **R42.7(c) safe-state gate** — that a busy session is not restarted. That is a refusal
  test. It does not demonstrate that a restart, when permitted, actually restarts a client
  and that the new instance re-reads `known_marketplaces.json`. So the USER's "never tested"
  is accurate about the thing this card needs, even though the symbol is not untested.
- **Production callers not counted.** The grep surfaced only `lib/` and the test file — no
  `app/api` route among the hits. Whether an API route reaches it is UNKNOWN and is exactly
  the shape that has bitten this repo before (a well-tested symbol with zero production
  callers is indistinguishable from a wired one until you count).

The NPT therefore stands and narrows to two checks: **(1)** count `restartHarnessFleet`'s
production callers in `app lib services` minus the defining file, and **(2)** demonstrate
once, end to end on a single agent, that a flag written to `known_marketplaces.json` before
a restart is honoured by the instance that comes back. The parent cannot proceed past `dev`
until both pass.

### HARD CONSTRAINT — a simultaneous fleet restart is an ANTHROPIC rate-limit ban

USER, 2026-08-05: *"you cannot restart the whole fleet at the same time! it will immediately
trigger a rate limit ban! because each claude code will resend the full conversation to the
server, that is 1m tokens per agent and subagent."*

**This is a different limit from the GitHub one this card is about, and a far more severe
one.** A resumed Claude Code instance re-sends its whole transcript; at ~1M tokens per agent
**and per subagent**, restarting N agents together is an N-million-token burst at the
Anthropic API. The fix for a GitHub connection limit must not be implemented in a way that
trips an Anthropic token limit — that is trading a throttle for a ban.

Measured in the driver, and the answer is half-good:

- ✓ **It is sequential, not parallel.** `lib/fleet-restart-driver.ts:78` — *"Restart every
  target that is safe to restart, sequentially"* — and the body is a `for (const target of
  targets)` loop, not `Promise.all`. So despite `fleet-restart-fanout.ts` being named for
  the shape that would be worst here, it does not spawn a thundering herd.
- ✗ **There is no PACING.** Neither file contains a delay, sleep, interval, or concurrency
  cap: `grep -nE "stagger|delay|sleep|concurren|batch|interval"` returns nothing across
  both. Sequential-without-delay still fires restarts back to back as fast as each returns.

And the loop awaits the **restart operation**, not the resumed conversation's token resend.
So instance N+1 can begin while instance N is still streaming its transcript — the bursts
overlap even though the restarts do not. Sequential is necessary here and not sufficient.

**Consequence for this card:** the write-then-restart step must be *paced*, not merely
ordered — an inter-restart delay sized against the transcript resend, not against how long a
restart call takes to return.

#### The pacing constant: ≥ 60 s between agents (USER, 2026-08-05)

*"you must wait at least 60 seconds between each agent"* — a floor, not a target.

At 13 live agents that is **≥ 13 minutes** for one fleet pass, and the true figure is higher
because the USER's token estimate counts *subagents* too: the unit being paced is every
process that resends a transcript, not every named agent. So the loop must pace on
**restarts issued**, not on entries in the agent registry.

⚠ **This CONTRADICTS the 3-second figure in `~/.claude/rules/workflows-rules.md`**
(*"wait 3 seconds before spawning/restarting the next"*), and the difference is 20×. Both
are right for their own case and the rule does not say which case it means: 3 s paces a
**cold spawn**, which starts from an empty context; 60 s paces a **restart**, which resumes
and re-sends up to ~1M tokens. Anyone implementing this from the global rule alone will
under-pace the fleet by a factor of twenty and get the ban this section exists to prevent.
Whoever lands the fix should carry the distinction back into that rule — the current wording
is a trap for exactly the person following it correctly.

#### The option that needs no sweep at all

Restarting 13 agents is not an operation to perform in one pass. A flag flip that lands
**session-by-session, as each agent naturally restarts**, is strictly safer than any
fleet-wide sweep and costs only time. Given the downside here is a *ban* rather than a
throttle, that is probably the right answer: **the flag does not need to take effect
everywhere at once.** Prefer it, and treat a paced sweep as the fallback for when a change
genuinely cannot wait.

### "Safely" is the open question — TWO files, and one belongs to the human

USER: *"so now the ai-maestro daemon will edit (safely, i hope) the settings.json and ensure
that every plugin has the auto-update value on true?"*

Two corrections to that shape before any code is written, and a hazard that outranks both.

**It is per MARKETPLACE, not per plugin.** The flag lives on the marketplace entry; plugins
inherit from the catalog they came from. "Every plugin" is not a thing the field can express.

**It is TWO files, and they do not agree** (measured 2026-08-05):

| file | entries | `autoUpdate: true` |
|---|---|---|
| `~/.claude/plugins/known_marketplaces.json` (runtime registry) | **275** | **0** (15 keyed, all `false`) |
| `~/.claude/settings.json` → `extraKnownMarketplaces` (declarative) | **257** | **0** (256 absent, 1 `false`) |

The 18-entry gap proves they are not mirrors. **Which one is authoritative is UNKNOWN and
must be established first** — edit the wrong one and the flip either does nothing or is
overwritten by the other on the next load, in both cases looking exactly like the write
having failed.

**The hazard that outranks both: `~/.claude/settings.json` is the HUMAN USER'S file.** It is
900+ lines of their own Claude Code configuration, not a machine registry. A daemon doing
read-modify-write on it is precisely the shape of the `lenient-json-reader-destroys-the-file`
incident this project has already suffered — a tolerant reader returns `{}` on a parse it
cannot handle, the writer serialises that, and the user's config is replaced by a nearly-empty
object while the operation reports success. Any writer here MUST refuse to write when the
read did not yield the expected shape, rather than treating an unparseable file as an empty
one. Backing it up first is not sufficient and not the point: the write must not happen.

Compounded by the lost-update race already recorded above — 13 sessions each hold and rewrite
their boot-time copy.

#### CORRECTION — the safe writer already exists; I was re-deriving it

USER: *"you forgot that we created a special safe function to edit the settings.json,
because it ends corrupted most of the time (multiple actors try to update it, including each
claude code itself)"* — and *"all the functions in ai-maestro MUST use that safe-editor."*

It is **`lib/settings-gate.ts::editSettings`** (TRDD-RYFP030K), whose own header calls it
*"the ONE transport-agnostic entry point"* and *"the ONE gate between a caller outside
`lib/json-io.ts`'s own module and the settings file on disk"*. It takes a serialisable
**ops grammar** (`set` / `delete` on a nested key path) precisely so an HTTP body or a shell
argv can carry the edit across a process boundary — which a raw mutator function cannot.
Both `app/api/settings/edit/route.ts` and `scripts/aimaestro-settings-cli.mjs` already route
through it, and ~30 call sites were migrated onto it.

So the paragraph above was re-specifying requirements a solved component already meets. **The
requirement collapses to one line: the daemon calls `editSettings` with a `set` op** — it
does not touch `fs`, does not call `updateJson`, does not implement its own guard. This is
now a standing invariant for every ai-maestro function, not advice for this card.

#### But the gate covers only ONE of the two files — and that decides the design

`resolveSettingsPath` refuses any path whose basename is not `settings.json` /
`settings.local.json`, AND whose parent directory is not `.claude`:

| file | through the gate? |
|---|---|
| `~/.claude/settings.json` | **accepted** |
| `~/.claude/plugins/known_marketplaces.json` | **REFUSED** — wrong basename *and* parent is `plugins/` |

So the "which file is authoritative" fork now has a sharp consequence:

- **If `settings.json` is authoritative** → the work is small and fully sanctioned: one
  `editSettings` `set` op per marketplace entry, done.
- **If `known_marketplaces.json` is authoritative** → **there is no sanctioned writer for it
  at all**, and the USER's invariant cannot be satisfied without either extending the gate to
  cover it or ruling the file off-limits as harness-owned. Note the shape of the risk: that
  file is written by Claude Code itself (its `lastUpdated` timestamps prove it), so it is the
  same multi-actor corruption problem the gate was built for — arriving at a file the gate
  deliberately excludes.

**Resolve the authority question first.** It is no longer a detail: one branch is a
half-hour's work, the other is a governance decision about a file we may not own.

#### The ops grammar is a TRANSACTION, and it dissolves the lost-update race

USER: *"this will also help to queue the edits and execute them as a series or ordered
transactions."* Correct, and the gate already implements it — verified, not assumed:

```ts
export async function editSettings(rawPath: string, ops: SettingsOp[], opts = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new TypeError(...)
  const path = resolveSettingsPath(rawPath)
  return updateJson(path, data => { applySettingsOps(data, ops) }, {...})
}
```

`ops` is an **array**, and every op in it is applied inside a **single `updateJson` mutator
callback** — so N edits are ONE locked read-modify-write, applied in order, not N races.

That is the property this card needed and I had been treating as an open risk. Flipping 257
marketplace flags is **one transaction**, not 257 chances to lose the boot-copy race
recorded above. A serialisable op is also a *storable* one, so edits can be accumulated
across callers and drained as one ordered batch — which is what makes "queue them" more than
a convenience: it is how concurrent writers stop competing.

And the reader half is already correct too: `readSettings` delegates to `readJson`, which
per its own comment *"distinguishes 'missing' from 'unreadable' rather than collapsing both
to `{}`, so a caller can tell a first-run file from a corrupt one"* — precisely the
refuse-on-unexpected-shape guard I was specifying two sections above. Also already solved.

**Net effect on this card:** for the `settings.json` branch there is no remaining safety work
to design. One `editSettings` call, one ops array, one transaction. The only open question is
still which file is authoritative — and if it is `known_marketplaces.json`, none of the above
applies to it, which is now the strongest argument for settling that first.

## Non-goals

- Disabling marketplace/plugin auto-update, or letting `enabled: false` reach the absorbed
  lane. The USER stated plainly that these updates are necessary; #102's rationale says the
  same thing from the other direction. **Less often, never off.**
- Fixing the individual not-found plugins. That is the user's own plugin hygiene; this card
  is about the retry policy that makes each one cost a connection every hour forever.

## Acceptance criteria

- [x] The marketplace refresh is **one** `claude plugin marketplace update` invocation with
      no arguments — pinned by a test asserting the exact argv and that the per-target loop
      is gone. Counting invocations is the assertion; asserting "it succeeded" would pass
      over a 200-call loop unchanged.
      DONE `7c104ba4`: new `RefreshAllMarketplaces` (element-management-service), a separate
      function because `ChangeMarketplace`'s `name` is load-bearing in G01/G02 and its ops
      lines. **The argless form was VERIFIED against `--help`** (`[name]` optional, "updates
      all if no name specified"), not assumed. Argv pinned in its OWN file
      (`tests/services/refresh-all-marketplaces.test.ts`) because the lane's test mocks the
      module and cannot see argv; neuter adding a name back reds exactly that test (1/5).
- [x] Cadence is **3 hours**. Pinned against the constant, not against an observed run —
      a wall-clock test would take 3 h and would still only prove one interval.
      DONE `4e66947e`: `services/auto-update-service.ts:111`, pinned by *"arms its timer at
      exactly 3 hours"*; neuter reds exactly that test (1 red / 13 green), restore blob-verified.
- [x] Exactly **one** executor. A test proves N concurrent sessions produce N=1 refresh, not
      N — this is the half that scales into the rate limit and the half a per-session
      implementation passes trivially by testing a single session.
      DONE: the mechanism is `withMarketplaceLock` returning null when another process holds
      it, and the test drives that CONTENTION case (a single-session test does pass trivially,
      exactly as this box warns). Neuter dropping the lock — `withMarketplaceLock(() => body())`
      → `body()`, i.e. the per-process regression itself — reds exactly that test (1/16).
- [x] `enabled: false` still does NOT stop the lane (a test pins this — the #102
      "consent-to-add is not consent-to-remove" rationale is the thing most likely to be
      "simplified" away by someone reading only this card).
      DONE (pre-existing, verified rather than assumed): *"appends run entries into
      auto-update-settings.json WITHOUT touching `enabled`"* runs the tick against a settings
      file at the shipped default (`enabled: false`), asserts `result.ran === true` AND that
      `enabled` is still false afterwards. The lane never reads that field at all.
- [x] A reader of `~/.aimaestro/auto-update-settings.json` can tell that the absorbed lane
      ran, without inferring it from `lastRunSummary` timestamps.
      DONE `15f752d3`: `lastAbsorbedRunAt`, stamped by the absorbed tick, additive at
      `version: 1`. The test asserts BOTH halves — the new field parses as a timestamp AND
      `lastRunAt` stays null on an absorbed-only run, because conflating the two lanes would
      make the file lie in the other direction. Neuter dropping the stamp reds exactly that
      test (1/15), and the test's pre-existing assertions all survive the drop — which is why
      they were never sufficient alone.
- [ ] Measured after the change on this host: `claude plugin update` invocations per hour
      drop from **200** (158 of them failing) to **0**, and marketplace refreshes drop from
      hourly-per-session to one every 3 h machine-wide.
- [x] The per-plugin-update question in "One thing to resolve" above is answered by the
      USER before any code lands, and the answer is recorded here.
      DONE — answered verbatim in the "RESOLVED — the per-plugin loop is redundant, not merely
      wasteful" section: the harness upgrades any auto-update-ON plugin whose newer version a
      refreshed catalog reports, so the loop DUPLICATED work rather than doing work the harness
      omits. Note the boundary recorded there survives: that holds for auto-update-ON plugins,
      which is why the flip had to land before AC6 can.

## Verification

The instrument matters here, because the wrong one reads clean:

```bash
# WRONG — git traffic counts against no API quota; this stays flat regardless.
gh api rate_limit --jq '.resources.core.used'

# RIGHT — count the actual invocations the lane makes, from its own summary.
jq -r '.lastRunSummary | group_by(.status) | .[] | "\(.[0].status): \(length)"' \
  ~/.aimaestro/auto-update-settings.json
```

## Notes

Found while investigating a USER-reported GitHub rate limit. Two other suspects were
examined and are NOT the cause, recorded so nobody re-derives them: the janitor's
`marketplace-refresh` / `github-config-audit` chores (dormant 15 days, and the daemon
explicitly logs `chore-coordination: yielding to active ai-maestro server`), and
`gh-reply-watch`, whose 900 s interval is honoured correctly. A genuine but separate
scaling gap in the latter — a per-project interval enforced against a per-account GitHub
limit — was filed as `Emasoft/ai-maestro-janitor` **#215**, explicitly not claimed as this
cause.

The causal link between this lane and the USER's throttling is **not proven**: it is the one
mechanism whose traffic is invisible to every meter that read clean, at a volume that fits
the symptom. Raising the cadence and watching whether the throttling clears is the
confirming experiment.

## Verification of the safe editor against the USER's stated contract (2026-08-05)

Asked: *"it should retry after every lint error, and if 3 retry failed, it should skip the
edit transaction and execute the next one, while reporting the failed transactions to the
callers."* Verified by a full read of `lib/json-io.ts` (524 lines), each part to a line:

- **3 retries then give up** — HOLDS for the conflict case: `retries ?? 3` (:348), backoff
  `200ms × attempt` (:416), `ConcurrentModificationError` (:411).
- **Skip failed, run next** — HOLDS: the per-path queue awaits the prior holder with
  `.catch(() => {})` (*"a previous holder's failure must not cascade"*, :229); lock released
  in `finally` (:234); next edit proceeds on a fresh read.
- **Report failures to callers** — HOLDS via typed throws (`UnreadableTargetError`,
  `ConcurrentModificationError`, `KeyLossRefused`); success carries `attempts` + `auditOk`.
- **Next edit always finds a valid file** — HOLDS BY CONSTRUCTION, stronger than a lint:
  fsync-tmp + atomic rename (:404,:420); a failed transaction removes its tmp and never
  renames (:410,:422); the post-commit re-read (:426-427) re-parses after every commit.

**The one deviation: a LINT error is not retried — it refuses immediately** (`parseOrRefuse`
throws on attempt 1, :367). Correct for corrupt-AT-REST (same bytes, same failure; and
overwriting an unknown state is the `{}`-rebuild incident this module prevents). GAP inside
it: a transient TORN READ from a non-atomic non-participating writer (the claude CLI takes
no lock of ours, :133-137) presents as the same lint error and WOULD be cured by a retry.
Whether that can occur depends on the CLI's write atomicity — unverifiable from this repo.
If ever fixed: retry the READ N times before refusing; never retry the write.

**SUPERSEDED IN PART by the USER's clarification (2026-08-05), which dissolves the
"deviation".** The intended contract's retry was never about the lint — it is about the
**verification of the edited lines**: between copying the file and swapping it back, any of
the 20+ concurrent Claude Code instances can write settings.json, so the pre-swap check
finds changes beyond the ones the transaction was called to make, the swap is cancelled,
and the transaction retries against a fresh copy. THAT is the common failure, and THAT
retry **IS implemented**: the staleness gate (:408-417) re-reads immediately before the
rename and cancels + retries (3 attempts, 200ms×attempt backoff, lock held) whenever the
bytes changed since transaction start. The lint is refuse-only by design — also as the USER
describes: it exists to stop invalid inserted content, not to be retried.

One implementation difference, equivalent in effect and worth stating so nobody "fixes" it:
the shipped check is a **whole-file byte-compare** (now vs transaction start), not a
line-diff of the edited copy. Both cancel the swap on ANY concurrent write; the other half
of a diff-check — "did my edit touch only the intended lines" — is delivered by
construction (the bounded set/delete ops grammar cannot touch lines it was not aimed at)
plus the post-commit content-equality audit (:426-427).

**The residual TRUE gap, verified in `applySettingsOps` (:151-181): the lint checks JSON
validity only — there is NO claude-code-SCHEMA validation of inserted values.** JSON
validity of the output is guaranteed by construction (`JSON.stringify` of an object), but
`op.value` is assigned verbatim: a `set` op writing a value Claude Code itself would reject
(wrong type, unknown enum) commits cleanly and the invalidity surfaces only when a session
next loads the file. The USER's description names "invalid claude code syntax" as something
the lint should catch; today it does not. Candidate enhancement, its own card if wanted —
the schema source of truth (what Claude Code accepts) is the design question in it.

Two caveats, recorded not fixed: `auditOk` is a returned field nobody is forced to branch on
(deliberate — auto-rollback would destroy a legitimate CLI write, :327-331), and the ~30
gate callers' handling of it is unaudited. `editSettings` does not forward `retries`; gate
callers are pinned at 3 (conformant with the contract, not tunable).

Also verified: `editSettings`' `allowKeyLoss: true` default is safe BECAUSE the ops grammar
is bounded — only an explicit `delete` op can drop a key, so the bypassed tripwire cannot
fire accidentally through the gate.

## The two-file split is WORSE than either branch — neither contains the other (measured)

The subset test refutes the clean declarative→runtime story:

| set | count |
|---|---|
| `settings.json` keys NOT in `known_marketplaces.json` | **2** |
| `known_marketplaces.json` keys NOT in `settings.json` | **20** |

Overlapping sets, each holding entries the other lacks. Editing `settings.json` alone
misses 20 marketplaces; the registry alone misses 2 — and only the first has a sanctioned
writer. "Pick the authoritative file" is not available as a strategy; the authority
question is now: what RELATIONSHIP does Claude Code maintain between them, and in which
direction does it sync? That must be answered empirically (flip one entry in each, restart
a disposable session, observe) before any bulk flip.
