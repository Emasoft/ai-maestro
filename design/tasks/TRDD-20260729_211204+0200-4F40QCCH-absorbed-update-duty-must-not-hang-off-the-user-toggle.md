---
trdd-id: 4F40QCCH
title: Absorbed update duty must not hang off the user-facing auto-update toggle
column: dev
scope: project
created: 2026-07-29T21:12:04+0200
updated: 2026-07-29T21:12:04+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T21:12:04+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: eht
npt: []
eht: []
severity: major
priority: 1
release-via: none
relevant-rules: [R16]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102, https://github.com/Emasoft/ai-maestro-janitor/issues/134]
---

# Absorbed update duty must not hang off the user-facing auto-update toggle

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The invariant:** absorption transfers a DUTY; it never cancels it. When the ai-maestro
server is live, the janitor daemon stands down and yields ALL absorbed chores — including
keeping its own plugin current. The server then does not run them, because they sit under a
user-facing master toggle that ships OFF. The duty is owned by nobody.

**Measured first-hand 2026-07-29 21:07 (not accepted from the report — re-verified):**

| fact | value |
|---|---|
| `~/.claude/janitor-control/version-update-requested.flag` | PRESENT, body `{"set_at":1785352055,"by":"version-update.py:37702","reason":"0.64.1->0.65.0"}` |
| janitor cached versions | tops out at **0.64.1** |
| latest published | **v0.65.0** (2026-07-29T18:55Z) |
| `~/.aimaestro/server-liveness.json` | `{"capabilities":["family-a"]}` — updates NOT claimed |
| `lib/auto-update-settings.ts:104` | `DEFAULT_SETTINGS.enabled: false` |
| `~/.aimaestro/auto-update-settings.json` | **does not exist** → the default holds → the scheduler never ticks |

The flag's `reason` has ADVANCED since the issue was filed (`0.60.1->0.64.1` then, `0.64.1->0.65.0`
now), which is live proof the detector keeps re-raising and nothing drains it.

**NEXT ACTION:** implement the split described under *Proposed fix* — `runAbsorbedUpdateChores()`
in the auto-update service, driven from the server tick, independent of `settings.enabled`.

**Load-bearing facts / gotchas**
- Control-plane flags live at the FIXED path `~/.claude/janitor-control/`, **never** under the
  plugin DATA dir. The janitor's own architecture doc says a foreign reader that guesses a rung of
  `global_state_dir()`'s ladder "fails silently as flag-absent, i.e. ignores the control plane
  while looking healthy" — and that is exactly what happened once already on this thread, in the
  step the janitor had called *"the most actionable single detail"*.
- **Clear the flag BEFORE running, not after** (janitor ask). The janitor's daemon does it in that
  order deliberately: a crash mid-update then re-raises on the next detector pass instead of being
  swallowed.
- The duty is the TRIO — `version-update`, `marketplace-refresh`, `user-plugins-update`. A version
  check against a stale marketplace manifest cannot see a new release, so version-update alone is
  not a fix.
- `currentCapabilities()` (`lib/server-liveness.ts:59-66`) computes `family-a` only. Its own
  comment says the other tokens are "deliberately NOT computed until their chores are live" — so
  adding the token is part of landing the chore, not a separate cosmetic step.

**SUPERSEDED — do NOT carry forward**
- The reading that TRDD-YLCTM8EU closed this. It closed **candidate-set inclusion** (the janitor
  IS dynamically in `aiMaestroMarketplace`, verified) and explicitly left the master toggle as
  "the remaining lever… a deliberate human opt-in". That framing is what this card overturns: the
  lever is correct for the USER's plugins and wrong for a duty the server took over.

## Problem

The janitor used to keep itself current. The server absorbed that chore (TRDD-KCRMSNL7), which
makes the janitor daemon exit whenever a live server is detected — a binary yield on liveness
(TRDD-LU0C5KAR, owner directive). The server then gates the work behind
`AutoUpdateSettings.enabled`, which ships `false` so that "first-boot is silent and the user must
opt in deliberately".

Both halves are individually defensible. Together they mean the janitor cannot update itself and
nothing else does either — silently, with no actor reporting the gap. Observed: 4 releases behind
for 3.5 days, then a 5th while the thread was open.

## Root cause

`lib/auto-update-settings.ts:104` — `DEFAULT_SETTINGS.enabled: false` gates the WHOLE scheduler,
so every category under it is inert, including the one that updates the janitor.

Our own source already documented the bug three days before it was filed
(`lib/auto-update-settings.ts:45-47`): *"a running server thus keeps the janitor current — closing
the window where the janitor daemon exits (server up) but its self-updates never land — **once
auto-update's master toggle is on**."* We wrote the failure down and shipped the toggle off. It is
not a missing design; it is a documented conditional whose condition nobody ever satisfied, and
nothing anywhere reported the condition as unmet.

## Proposed fix

**The split, and why it is narrow enough to be Tier 0.** The user-facing toggle keeps governing
everything the user's opt-out is actually about: role-plugins, dependency plugins, and the
agent/user-scope sweeps. What moves out from under it is ONLY the component whose daemon the
server silenced.

This RESTORES the status quo ante rather than adding unattended behaviour: before absorption the
janitor updated itself unconditionally. A server that stops another actor's self-maintenance and
then declines to perform it has broken a handoff, and repairing its own handoff is in scope.

1. **`runAbsorbedUpdateChores()`** in the auto-update service — runs the absorbed trio regardless
   of `settings.enabled`, driven from the server tick (pattern: `startOauthRotatorTick` /
   `startServerLiveness` / `startAgentInvariantsWatchdog` in `server.mjs`).
2. **Consume the request flag clear-before-run**, so a crash re-raises instead of being swallowed.
3. **`currentCapabilities()` advertises the chore class it actually executes.** Even under today's
   binary yield rule this costs nothing and makes the mismatch auditable from outside — which is
   the only reason this gap was findable at all.

NOT in scope, deliberately: changing the binary liveness→yield rule. That is a ratified owner
directive, and changing it unilaterally risks two actors updating concurrently. Re-instating
per-class capability gating is the janitor's #134 and is the owner's call, not mine.

## Verification

- A unit test drives `runAbsorbedUpdateChores()` with `settings.enabled === false` and asserts the
  janitor-plugin update is attempted anyway — the whole point, and it fails against HEAD.
- A test asserts the request flag is cleared BEFORE the update call, not after (assert call order,
  not merely that both happened).
- A test asserts the user-facing categories are NOT run by this path — the split must not become a
  back door that updates the user's plugins behind their opt-out.
- `currentCapabilities()` includes the new token only when the chore is wired.
- Live: with v0.65.0 published and the server running, the cached janitor reaches 0.65.0 and the
  control-plane flag is drained.

## Estimated risk

MEDIUM. It performs a plugin install the user did not opt into, so the blast radius is real and
the narrowness of the split is what keeps it defensible — a wider reading (running the whole
scheduler regardless of the toggle) would be a genuine violation of the user's choice and is
explicitly rejected above. Dependencies: none blocking; `lib/janitor-control.ts` already reads the
fixed control path.

## Approval log

- 2026-07-29T21:12:04+0200 — SELF-MANDATE by ai-maestro (min-approval-requirement: none).
  Tier 0: a defect in this repo's own absorbed duty, inside the authoring agent's assignment
  scope, reversible and local. Provenance note for honesty: ai-maestro#102 reports the invariant
  as USER-directed; I have not heard that from the USER first-hand, so the authority recorded here
  is my own Tier-0 scope plus my prior acceptance of the defect on that thread (2026-07-29T08:03Z),
  NOT a USER mandate I cannot verify.

## Acceptance

- [ ] `runAbsorbedUpdateChores()` runs the absorbed trio with the master toggle OFF
- [ ] The control-plane request flag is consumed clear-before-run
- [ ] The user-facing categories are provably NOT run by this path
- [ ] `currentCapabilities()` advertises the executed chore class
- [ ] Unit tests cover all four, each with a recorded neuter run
- [ ] Live: cached janitor reaches the latest published release and the flag drains
- [ ] ai-maestro#102 answered with the landed behaviour
