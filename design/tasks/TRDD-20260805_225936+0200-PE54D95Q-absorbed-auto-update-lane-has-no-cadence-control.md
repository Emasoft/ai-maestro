---
trdd-id: PE54D95Q
title: The absorbed auto-update lane has no cadence control and retries permanent failures hourly
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T22:59:36+0200
updated: 2026-08-05T22:59:36+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
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

## Proposed fix

1. **Give the absorbed lane its own cadence setting** — e.g. `absorbedIntervalMinutes`,
   clamped with a floor that keeps the duty meaningful (the pre-absorption janitor cadence
   of 3600 s is the natural default, so behaviour is unchanged unless asked). This must NOT
   be gated on `enabled`; it is a *rate* control, not an off switch, which is exactly the
   distinction #102's rationale draws.
2. **Back off permanently-failing targets.** After N consecutive failures with a
   not-found-shaped error, drop the target to a long retry (or surface it once for the user
   to prune). Same freshness for the 42 that work; ~79% fewer connections.
3. **Make the state file answer the question it is asked.** `lastRunAt` should not read
   `null` while a lane of the same service ran an hour ago — either record the absorbed
   lane's own `lastRunAt`, or name the field so it cannot be read as "this service is idle".

## Non-goals

- Disabling marketplace/plugin auto-update, or letting `enabled: false` reach the absorbed
  lane. The USER stated plainly that these updates are necessary; #102's rationale says the
  same thing from the other direction. **Less often, never off.**
- Fixing the individual not-found plugins. That is the user's own plugin hygiene; this card
  is about the retry policy that makes each one cost a connection every hour forever.

## Acceptance criteria

- [ ] The absorbed lane's cadence is settable, with the current 3600 s as the default, and a
      changed value demonstrably changes the observed interval.
- [ ] `enabled: false` still does NOT stop the lane (a test pins this — the #102 rationale
      is the thing most likely to be "simplified" away by someone reading only this card).
- [ ] A target failing with a not-found-shaped error N times is no longer retried hourly;
      pinned by a test that counts invocations across simulated ticks.
- [ ] A reader of `~/.aimaestro/auto-update-settings.json` can tell that the absorbed lane
      ran, without inferring it from `lastRunSummary` timestamps.
- [ ] Measured after the change: hourly `claude plugin update` invocations on a host with
      158 permanently-failing targets drop by roughly that proportion.

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
