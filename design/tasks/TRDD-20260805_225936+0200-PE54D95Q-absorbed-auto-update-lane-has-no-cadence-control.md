---
trdd-id: PE54D95Q
title: The absorbed auto-update lane has no cadence control and retries permanent failures hourly
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T22:59:36+0200
updated: 2026-08-05T23:14:18+0200
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
ordered — an inter-restart delay (or a token-budget-aware drip) sized against the transcript
resend, not against how long a restart call takes to return. Restarting 13 agents is not an
operation to perform in one pass at all; a flag flip that lands session-by-session as each
agent naturally restarts is strictly safer than any fleet-wide sweep, and costs only time.
That may well be the right answer: **the flag does not need to take effect everywhere at
once.**

## Non-goals

- Disabling marketplace/plugin auto-update, or letting `enabled: false` reach the absorbed
  lane. The USER stated plainly that these updates are necessary; #102's rationale says the
  same thing from the other direction. **Less often, never off.**
- Fixing the individual not-found plugins. That is the user's own plugin hygiene; this card
  is about the retry policy that makes each one cost a connection every hour forever.

## Acceptance criteria

- [ ] The marketplace refresh is **one** `claude plugin marketplace update` invocation with
      no arguments — pinned by a test asserting the exact argv and that the per-target loop
      is gone. Counting invocations is the assertion; asserting "it succeeded" would pass
      over a 200-call loop unchanged.
- [ ] Cadence is **3 hours**. Pinned against the constant, not against an observed run —
      a wall-clock test would take 3 h and would still only prove one interval.
- [ ] Exactly **one** executor. A test proves N concurrent sessions produce N=1 refresh, not
      N — this is the half that scales into the rate limit and the half a per-session
      implementation passes trivially by testing a single session.
- [ ] `enabled: false` still does NOT stop the lane (a test pins this — the #102
      "consent-to-add is not consent-to-remove" rationale is the thing most likely to be
      "simplified" away by someone reading only this card).
- [ ] A reader of `~/.aimaestro/auto-update-settings.json` can tell that the absorbed lane
      ran, without inferring it from `lastRunSummary` timestamps.
- [ ] Measured after the change on this host: `claude plugin update` invocations per hour
      drop from **200** (158 of them failing) to **0**, and marketplace refreshes drop from
      hourly-per-session to one every 3 h machine-wide.
- [ ] The per-plugin-update question in "One thing to resolve" above is answered by the
      USER before any code lands, and the answer is recorded here.

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
