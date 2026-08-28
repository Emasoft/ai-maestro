---
trdd-id: AGHPMRVI
title: Create Team dialog shows a binary spinner for 30-60s while the auto-COS and its role-plugin are built
column: complete
created: 2026-08-27T21:37:13+0200
updated: 2026-08-28T06:26:58+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-27T21:37:13+0200
derived: true
derived-kind: eht
parent-trdd: JU6Y2V7X
priority: 2
severity: minor
effort: medium
labels: [scenario-improvement, scen-001, ui]
---

## Problem

`components/teams/TeamCreationWizard.tsx` (~:1057) renders a single `Creating...` label with a
spinner for the whole CreateTeam pipeline. On a real host that pipeline takes **30-60 s**: it
creates the team, creates the auto-COS agent, and installs `ai-maestro-chief-of-staff` at that
agent's local scope. The team and COS are in `teams.json` long before the dialog closes, so with
no progress detail the state is indistinguishable from a hang — and a scenario runner that gives
up mid-wait leaves a half-built team on the host (SCEN-001, 2026-07-29 run).

## Root cause

A synchronous create path doing network work behind a binary spinner. The pipeline already
emits NO ops log at all — CORRECTED 2026-08-28 by measurement: `grep -c "ops.push"
services/teams-service.ts` = 0, against 558 in `services/element-management-service.ts`. Those 558
belong to the AIO pipelines; CreateTeam lives in teams-service and instruments nothing. So the fix
must CREATE the stage signal, not merely route one that already exists — strictly more work than
this card assumed when it was written.

## Proposed fix

Give the dialog a staged status ("creating team… creating chief-of-staff… installing
role-plugin…") sourced from the create pipeline's own phases. This needs a progress
channel from the create pipeline to the dialog — the reason it is a separate card from
`TRDD-JU6Y2V7X` rather than a line in it: the parent card's other two items were pure scenario
authoring and shipped in one commit; this one touches the pipeline/UI seam and its own risk
rating is LOW-MED.

## Verification

Create Team's dialog text changes at least twice before it closes.

## Acceptance

- [x] The dialog's status text changes at least twice during a real CreateTeam.
- [x] The stages named correspond to real pipeline gates, not a timer.
- [x] A test pins that the status is sourced from the pipeline (a stub pipeline emitting two
      stages produces two distinct labels), with a neuter run recorded.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Split out of TRDD-JU6Y2V7X on implementation: that card's items (1)+(2) were scenario
  authoring and landed; this item is a feature with a pipeline seam and is scoped on its own.
- 2026-08-28T02:11:26+0200 — column → testing by ai-maestro-hub-session. implementation + tests landed in a5aba784; box (a) needs a live governance-authenticated UI run
- 2026-08-28T06:26:58+0200 — box (a) TICKED, column → complete by ai-maestro-hub-session. Live
  UI run performed against the dashboard on this host; see `## Live verification of box (a)` below
  for the measurement, the two false starts that preceded it, and a correction to this card's
  30-60 s premise.

## Live verification of box (a)

Run: 2026-08-28 ~06:20+0200, dashboard on this host, headless dev-browser, team
`aghpmrvi-stage-probe`, COS = auto-create, no repos, local kanban — the exact path this card
describes. Sampled the wizard submit button's label every 100 ms from an in-page interval, so a
stage shorter than one poll could still be caught.

Observed, in order:

| # | label | t (ms) |
|---|---|---|
| 1 | `Creating...` | 101 |
| 2 | `Creating chief-of-staff agent` | 301 |
| 3 | `Installing chief-of-staff role-plugin` | 402 |

Two changes, three distinct labels, both stage labels matching literals emitted by
`services/teams-service.ts` — so the text is pipeline-sourced, not a timer. Box (a) met.

### The build had to be made first — the running server did not have the fix

`components/` and `services/` are bundled into `.next`; a `pm2 restart` alone does not rebuild.
At the start of this run the bundle was 3.5 h older than a5aba784 and carried none of the stage
literals (`grep -rli 'Installing chief-of-staff role-plugin' .next/` = 0, against 1 in source as a
positive control). Verifying box (a) against that server would have measured the OLD binary
spinner and read as "the fix does not work". Rebuilt, re-grepped (1 hit in
`.next/server/chunks/9792.js`), restarted, then measured.

### Two false starts, both instrument bugs, recorded so the next run skips them

1. **First bundle grep used `creating chief-of-staff` (lowercase) and returned 0** — which is the
   same answer a missing fix gives. The literal is `Creating chief-of-staff agent`. The zero was
   right by accident; the needle was wrong. Re-run with the literal taken from the diff, plus a
   source-side positive control.
2. **First live attempt showed `Creating...` for 120 s, then the dialog reset, and the error read
   `sudo_required`.** That is not a defect: `POST /api/teams/create-with-project` is sudo-strict and
   `requireSudoToken` runs at route line 49, *before* any streaming — deliberately, so the 403
   still reaches `sudoFetch` as a real HTTP status rather than being buried in a 200 stream. The
   run simply never answered the sudo modal. Handling it (structural detect → fill → Confirm) made
   the same click succeed. **Any future live check of this dialog must answer that modal.**

## Second measurement — 2026-08-28T06:39-06:40, the dwell MEASURED rather than inferred

The retraction above replaced a false claim with an unverified one: it asserted "a user sits on
`Installing chief-of-staff role-plugin` for 27 s", which was **inferred** by joining a client-side
label array (last entry t=402 ms) to two server log lines 27 s apart. Nothing had observed the DOM
after 402 ms. Three different behaviours produce that identical array — the label holding, the
dialog closing early, or `setCreateStage(null)` reverting it — so the claim was a proxy again, in a
new costume. A second adversarial fork named it.

Re-ran the create with a collector that records each label's LAST-SEEN time and the dialog's close
time, both of which the first run lacked (team `aghpmrvi-dwell-probe`, same path, then deleted):

| label | first seen | last seen | dwell |
|---|---|---|---|
| `Creating...` | 101 ms | 302 ms | 0.2 s |
| `Installing chief-of-staff role-plugin` | 402 ms | 31901 ms | **31.5 s** |

`closedAt` **32001 ms**; 322 polls at 100 ms ≈ 32.2 s, so the collector ran continuously and the
window is fully observed rather than sampled at its ends.

**Independent corroboration.** The server log for the same run reads
`06:39:43 Auto-created COS agent` → `06:40:15 Installed ai-maestro-chief-of-staff` = **32 s**. The
client-observed dialog lifetime and the server-side pipeline span agree to within one second, from
two records that share no mechanism.

So the dwell claim is now MEASURED and true at ~31.5 s, and the whole create is **~32 s
end-to-end** — no longer a floor assumed to be a total. The card's original **30-60 s premise is
directly CONFIRMED**, not merely unrefuted.

**One honest difference between the runs:** this one captured only TWO labels, not three —
`Creating chief-of-staff agent` fell entirely inside a sub-100 ms gap between polls. Box (a) asks
for at least two changes and is satisfied either way, but a 100 ms sampler is not guaranteed to see
every stage, and a future run that sees two labels instead of three has not regressed.

### ~~Correction to this card's premise~~ — RETRACTED 2026-08-28T06:41+0200

> **THIS SECTION IS WRONG AND IS KEPT ONLY AS THE RECORD OF THE ERROR. The card's 30-60 s figure
> was RIGHT.** Measured from the server log after an adversarial review challenged it:
> `06:22:57 Auto-created COS agent` → `06:23:24 Installed ai-maestro-chief-of-staff` — **27 s for
> the install phase alone**, on a host where the plugin was already cached.
>
> The `~0.4 s` below is not a completion time. It is the timestamp of the **last label CHANGE**.
> Stages are emitted at each phase's START, so the third label appeared at 402 ms and then
> correctly never changed again while the install ran for the next 27 seconds. My collector only
> appended on change, and I had dropped the `closedAt` field the failed run had carried — so no
> completion timestamp existed anywhere in the successful run. I read "no further change" as
> "finished". A proxy read in place of the thing.
>
> The consequence runs the other way from what this section claimed: the staged status is worth
> MORE, not less — the pipeline really does spend tens of seconds in a single phase, which is the
> window a binary spinner makes indistinguishable from a hang.
>
> **SECOND CORRECTION, same day, same failure axis — separating what was MEASURED from what was
> INFERRED.** A review challenged the retraction itself, correctly:
> - **MEASURED (server-side, two log lines):** `06:22:57 Auto-created COS agent` →
>   `06:23:24 Installed …` = 27 s. This is solid and is what refutes the `~0.4 s` claim.
> - **A FLOOR, NOT A TOTAL:** 06:22:57 is the COS-creation phase, i.e. the *second* of the
>   pipeline's phases. The team-creation phase before it was never bounded, so the create took
>   **at least** 27 s. "~27-30 s for the whole create" was an assumption and is withdrawn.
> - **INFERRED, NOT OBSERVED:** that the dialog *displayed* `Installing chief-of-staff role-plugin`
>   for those 27 s. Nothing observed the DOM after t=402 ms — the screenshot loop only fired on a
>   stage-count change and `closedAt` was not recorded in this run. Reading the client code says
>   the label persists until `onCreated` closes the dialog, but that is a code reading, not a
>   measurement, and an early `done` frame or a `setCreateStage(null)` would produce the identical
>   captured array. Treat the dwell as unmeasured.
>
> Settling it would need a re-run that samples the label until the dialog closes and records
> `closedAt`. Deliberately NOT re-run: the dwell is not load-bearing — box (a) does not depend on
> it, and neither does the refutation of the `~0.4 s` claim — so it does not justify creating and
> deleting another live team. The gap is recorded instead of quietly closed.

The card says the pipeline takes **30-60 s**. On this host, with the role-plugin already cached and
no GitHub linking, the whole create completed in **~0.4 s** — so on a warm host the staged status
is nearly invisible. That does not weaken the fix (the 30-60 s case is a cold role-plugin install
plus GitHub work, and that is when a binary spinner is indistinguishable from a hang), but the
"30-60 s" figure should not be quoted as if it were universal. It is an upper case, not the case.
A consequence worth noting: screenshot evidence for the successful run is a single frame, because
the run outlived only one poll of the screenshot loop. The label array, not the screenshots, is
the evidence here.

### Cleanup

Team and auto-COS deleted through the UI (Delete team + "Delete member agents too"). Verified by
absence, not by intention: team absent from `teams.json`, agent absent from the registry (13
entries, identical to the pre-run count), `~/agents/cos-aghpmrvi-stage-probe/` gone, no cemetery
entry, no persisted session, no tmux session. One intermediate read showed the team still present
with the agent's title already reverted to `autonomous` — the delete pipeline simply outlived a
20 s wait, and reporting from that read would have been a false "delete failed".

- 2026-08-28T06:41:00+0200 — RETRACTION appended by ai-maestro-hub-session (Approval log is the
  append-only channel a terminal card keeps; the body section above is marked superseded in place,
  not deleted). The `~0.4 s` completion figure in `## Live verification of box (a)` is FALSE and the
  premise it "corrected" was sound. Box (a) itself is UNAFFECTED — three distinct pipeline-sourced
  labels were observed and that is all box (a) asserts. Only the timing claim, which box (a) never
  required, is withdrawn. Caught by an adversarial review fork, not by me.
- 2026-08-28T06:48:00+0200 — SECOND correction appended by ai-maestro-hub-session. The retraction
  above overstated in the opposite direction: it asserted a 27 s on-screen DWELL that was inferred
  from client code, never observed, and called 27 s the whole create when it bounds only the
  COS-creation→install span. Both are now marked as floor/inferred in place. The measured refutation
  of `~0.4 s` is unchanged and stands. Caught by a second adversarial review fork — the same proxy
  shape, wearing the correction as its costume.
- 2026-08-28T06:45:00+0200 — SECOND correction appended by ai-maestro-hub-session. The retraction
  itself carried an unmeasured claim (the 27 s dwell) and has now been measured: dwell 31.5 s,
  dialog closed at 32.0 s, corroborated by a server span of 32 s. Both errors were caught by an
  adversarial review fork rather than by me, and both were the same shape — a client-side proxy
  standing in for an interval nobody observed. A correction is exactly when that scrutiny is least
  likely to be applied, because it arrives feeling like the careful move.
- 2026-08-28T06:52:00+0200 — THIRD correction by ai-maestro-hub-session, again from an adversarial
  fork. **The "independent corroboration" in the section above is WITHDRAWN.** Client `closedAt`
  and the server's `Installed …` log line are NOT two records sharing no mechanism — they are one
  event observed twice. Verified in `components/teams/TeamCreationWizard.tsx`: `evt.done` sets
  `finalStatus` (:450) and `onCreated(...)` closes the dialog (:471), and the server sends `done`
  only after the pipeline it just logged. Their agreement is guaranteed by construction. Both
  server stamps are 1-second resolution too, so "within one second" is the resolution floor, not a
  precision result. Same failure family as the first two, third costume: a downstream CONSEQUENCE
  promoted to a corroborating WITNESS.
  **What survives, unchanged:** the dwell of ~31.5 s (`lastSeen` 31901 is a direct observation) and
  the continuity check (a `setInterval` cannot outrun its period, so a stall shows as a poll
  DEFICIT; 322 against an expected ~320 shows none).
  **What is weakened:** "the create is ~32 s end-to-end" is n=1, and the two runs measured **27 s**
  and **32 s**. So the card's 30-60 s premise is the right ORDER OF MAGNITUDE and my "~0.4 s" is
  definitively dead — but "CONFIRMED" was too strong, since 27 s sits below the stated range.
  **One real product finding, deliberately NOT filed as a card:** `setCreateStage(evt.stage)`
  (:457) runs inside the per-frame loop, so several SSE frames arriving in one read chunk collapse
  into a single render and only the LAST is displayed — the missing `Creating chief-of-staff agent`
  may never have been shown at all, rather than merely missed by a 100 ms sampler. This is
  self-limiting and needs no fix: a stage that gets batched away is by definition one that lasted
  less than a frame, while a SLOW stage — the only kind the binary spinner made painful — arrives
  alone and always renders. Recorded so the next reader does not re-derive it as a bug.
