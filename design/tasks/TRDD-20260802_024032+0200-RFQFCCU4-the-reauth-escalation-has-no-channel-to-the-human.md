---
trdd-id: RFQFCCU4
title: The rotator's reauth escalation has no channel to the human — it logged 4506 times over 4 days
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T02:40:32+0200
updated: 2026-08-02T02:40:32+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T02:40:32+0200
severity: critical
effort: small
relevant-rules: [R16]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth, rotator, escalation, continuity, incident-followup]
---

# The rotator's reauth escalation has no channel to the human

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

**This is the defect that actually caused the 2026-08-02 loss**, not the rotation trigger (that is
[[GY0LJV6S]], and it behaved correctly throughout).

**NEXT ACTION:** give `reauth-needed` a delivery path to the human. Smallest correct version first —
an OS notification via the existing `lib/setup-bootstrap.ts` channel (already used for the
governance-password one-shot code, so the plumbing exists and is proven), plus a tmux inject into
live agent panes. Fail-soft: no channel available ⇒ log as today, never crash the beat.

## The measurement

The supervisor emitted, into `logs/pm2-out.log` and nowhere else:

| line | first seen | times |
|---|---|---|
| `reauth-needed: N alternate slot(s) have a dead refresh — a human must re-login` | 2026-07-29 09:58 | **4 506** |
| `auto: … all paid accounts maxed; waiting for a window to reset` | 2026-07-29 15:14 | **217** |

Four days. Four thousand five hundred requests for one human action. The human found out when every
session on the host stalled at once and a large amount of in-flight sub-agent work was lost.

Grepped `lib/oauth-rotator/server-supervisor.ts` and `supervisor.ts` for any delivery mechanism —
notification, `osascript`, `terminal-notifier`, tmux inject, AMP message, webhook, push. **There are
none.** The supervisor builds alert objects (`out.push({...})`) and prints them.

**A guardian that can only whisper into a logfile nobody tails is not a guardian.** The detection was
perfect and the delivery did not exist, so the system had exactly the same outcome as no detection at
all — while looking, in the code and in the tests, like a working alerting path.

## Why the alert mattered so much here

The account that would have resolved the outage (`fmuaddib`) had a nearly empty window the entire
time — after the human's manual `/login` it read `5h=0 % 7d=38 %`. The rotator could not reach it:
its stored credential had expired 10.9 days earlier and its refresh token was dead (69 consecutive
failures). Only a human browser login could revive it.

So the whole outage reduces to: **one human action, requested 4 506 times, never delivered.**

## Scope

- A delivery path for the supervisor's alerts, at minimum for `reauth-needed` and
  `all paid accounts maxed`.
- **Escalating cadence, not per-beat spam.** 4 506 identical lines is itself part of the failure: an
  alert that repeats every minute forever trains its reader to ignore it. First occurrence, then
  backoff (e.g. 1 min → 15 min → hourly), with the age of the outstanding request in the message.
- **The message must name the ACTION, not the condition.** "a human must re-login" does not say which
  account or how. It should name the account and the exact command.
- Fail-soft everywhere: an unavailable channel degrades to the log, never breaks the beat.

## Verification

- Unit: an alert with no prior sighting delivers immediately; the same alert one minute later does
  NOT re-deliver; after the backoff window it does. **Neuter: remove the backoff → the
  no-spam test reds.**
- Unit: a throwing/absent notification channel leaves the beat's return value unchanged and still
  writes the log line. **Neuter: let the channel error propagate → the fail-soft test reds.**
- The delivered message names the account and the command to run.

## Acceptance

- [ ] `reauth-needed` and `all paid accounts maxed` reach the human outside the log file
- [ ] escalating backoff — no per-beat repetition; the message carries how long it has been pending
- [ ] the message names the specific account and the exact command
- [ ] fail-soft: no channel ⇒ log only, beat unaffected
- [ ] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green

## Approval log

- 2026-08-02T02:40:32+0200 — Tier-0 self-mandate: a bugfix inside this project's own scope, filed
  from a live incident. `min-approval-requirement: none`, so authored directly in `design/tasks/`.
