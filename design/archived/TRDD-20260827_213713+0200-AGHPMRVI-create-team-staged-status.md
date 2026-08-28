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
> MORE, not less. A user watching this create sits on `Installing chief-of-staff role-plugin` for
> 27 s, which is exactly the window a binary spinner makes indistinguishable from a hang.

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
