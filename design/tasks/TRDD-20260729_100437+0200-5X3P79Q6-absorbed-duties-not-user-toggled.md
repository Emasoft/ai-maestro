---
trdd-id: 5X3P79Q6
title: An absorbed duty must not be gated on a user-facing preference the original owner never had
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-29T10:04:37+0200
updated: 2026-07-29T10:04:37+0200
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
duty transfer, and the two vocabularies do not line up (see §Open question).

**Load-bearing facts:**
- Root cause is ONE line: `lib/auto-update-settings.ts:104` — `DEFAULT_SETTINGS.enabled: false`.
  The master toggle gates the whole scheduler, so every category under it is inert.
- Measured 2026-07-29: janitor cached **0.60.1**, published **v0.64.1**;
  `version-update.last-run.ts` = 2026-07-25 23:01 +0200 (**82.9 h** stale).
- `lib/auto-update-settings.ts:45-47` ALREADY documents this exact failure, three days before it
  was filed against us — *"closing the window where the janitor daemon exits (server up) but its
  self-updates never land — **once auto-update's master toggle is on**"*. The design was correct;
  the condition was never satisfied and nothing reported it as unmet.

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

- [ ] `#99` read; each absorbed update chore classified duty-vs-added, with the pre-absorption gate quoted
- [ ] With the master toggle OFF and the janitor armed, a stale janitor plugin is updated within one beat
- [ ] With the master toggle OFF and the janitor NOT armed/installed, nothing runs (the consent that gated it before is absent, so the duty is absent too)
- [ ] The added-behaviour categories remain inert while the master toggle is OFF — proven by a test, since this is the exact regression the split risks
- [ ] `version-update-requested.flag` is consumed clear-before-run
- [ ] Concurrent-run test: two processes contend on `marketplace-op.lock`, one runs
- [ ] A neuter run per new guard (break it → the NAMED test fails; read the test COUNT, never the exit code)

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
