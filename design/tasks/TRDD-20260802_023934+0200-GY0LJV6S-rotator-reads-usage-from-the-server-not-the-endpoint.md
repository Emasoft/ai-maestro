---
trdd-id: GY0LJV6S
title: The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook
column: blocked
pre-block-column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T02:39:34+0200
updated: 2026-08-02T02:39:34+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-02T02:39:34+0200
severity: critical
effort: medium
relevant-rules: [R16]
npt: [D8OYFG35]
eht: []
blocked-by: [D8OYFG35]
release-via: none
labels: [oauth, rotator, statusline, continuity, incident-followup]
---

# The rotator takes the live account's usage from the ai-maestro API, fed by the statusline hook

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

USER directive, verbatim: *"the rotator must get its info from the api of ai-maestro server. and the
api must get the info from the statusline hook of ai-maestro. is that clear? if the statusline reads
98% or more in the 5h or 7d window it must immediately rotate to another account oauth with still
headroom."*

**Blocked on [[D8OYFG35]]**, which builds the wrapper → `POST /api/statusline/ingest` → state-file →
`GET` half. This card is the CONSUMER: it re-points the rotator's LIVE read at that API and makes
the trigger push-driven instead of a 60 s poll.

**NEXT ACTION:** wait for D8OYFG35 to land `types/statusline.ts` + the ingest state shape, then wire
`tick.ts:422` (see the seam table below). Do not start before that — the state shape is the contract.

## The incident this comes from (2026-08-02, ~02:26)

Every session on the host stalled at the window limit; the USER had to rotate by hand, and a large
amount of in-flight sub-agent work was lost. **The rotator was not asleep** — its own decision log:

```
02:26  live ipazia 5h=97% 7d=93% ... all paid accounts maxed; waiting for a window to reset
02:28  live ipazia 5h=100% 7d=93% ... all paid accounts maxed
       reauth-needed: 1 alternate slot(s) have a dead refresh — a human must re-login
```

It detected the limit at its 97 % threshold and re-tried every 60 s. It refused to rotate because
every alternate was either maxed or held a DEAD credential, and rotating onto a dead credential
fails every call — refusing was correct.

**So the trigger was never the failure**, and this card alone would not have prevented the incident.
It is still worth building (it removes ~420 endpoint calls/hour and cuts detection latency from 60 s
to one assistant message), but the two things that actually caused the loss are separate:

- the escalation `a human must re-login` was logged **4 506 times over 4 days** into `pm2-out.log`
  with **no delivery channel to the human** — [[RFQFCCU4]], filed separately and the real cause;
- the rotator **rotated away from a nearly-empty account** (`fmuaddib`, 5h=9 % 7d=38 %) purely
  because its token was expiring, draining its own escape hatch — see the drain-guard note below.

Both are recorded here so the next reader does not mistake this card for the fix.

## The seam — which reads move, and which structurally cannot

`usageRequest()` is called at THREE sites in `lib/oauth-rotator/tick.ts`:

| site | what it reads | after this card |
|---|---|---|
| `:422` | the **LIVE** account's 5h/7d | **statusline-fed, via the ai-maestro API.** Free (Claude Code already paid for the number), refreshed on every assistant message. |
| `:496` | a **CANDIDATE** alternate's usage | **stays `/api/oauth/usage`** — see below |
| `:509` | the same candidate after a refresh | **stays `/api/oauth/usage`** |

**Why the candidates cannot come from the statusline, and this is not a shortcut.** The statusline is
Claude Code's feed for the session that is RUNNING. An account that is not live is not running, so it
emits no statusline. "Rotate to another account **with headroom**" requires the headroom of accounts
that are not live, and the only source for that is the endpoint with each alternate's own token.

The economics still land where the USER wants them: the *continuous* read (the live account, every
few seconds, forever) becomes free, and the endpoint is touched only in the seconds around an actual
rotation — a handful of calls, rarely, instead of ~420/hour.

## The payload carries NO account identity — the server must stamp it

Verified against the shipped schema (`downloads_dev/statusline.md`): the payload has `session_id` and
`session_name`, and **nothing identifying the account, org, or user**. Consequences, both mandatory:

1. **Stamp at ingest.** The server records the live account fingerprint (`state.live_fp`) with each
   report, at the moment it arrives.
2. **The rotator MUST ignore any report whose stamp is not the currently-live fingerprint, or whose
   timestamp precedes `last_switch_at`.** Without this, reports still arriving from sessions running
   on the OLD credential are attributed to the NEW live account immediately after a switch — the
   rotator reads ~98 % on a fresh account and rotates straight back out of it. A rotation loop that
   burns every remaining account in minutes.

## Threshold: keep 97, do not raise it to 98

The USER said "98 % or more". `SWITCH_AT_5H` / `SWITCH_AT_7D` are already **97**, which fires
EARLIER and therefore satisfies "at ≥98 it must rotate" strictly. Setting them to 98 would make the
rotator *less* eager than it is today — a regression against the directive's intent. Leave them.

## Push-triggered, not polled — and what "immediately" can mean

`server-tick.ts` runs `autoRotate` on a 60 s timer. This card adds an **ingest-triggered evaluation**:
a report at/over threshold calls the same `autoRotate` path at once. The 60 s timer STAYS as the
floor (a host with no live statusline — a hibernated fleet, a crashed wrapper — must still rotate).

Honest limit on "immediately": a rotation swaps the credential on disk. Sessions already running hold
their token in memory, so they are not retro-fixed; the rotation protects the next turn and every new
session. That is how the rotator already behaves and is not changed here.

## Also required — the drain-guard (from the incident)

Do NOT rotate off a low-usage account for LOCAL EXPIRY alone when the target would become the last
healthy slot. On 2026-08-01 the rotator did exactly that twice (01:03 and 10:09), moving off
`fmuaddib` at 39 %/24 % and then 9 %/38 % because its token was expiring — and when the target maxed
out there was no way back, because `fmuaddib`'s stored credential was by then 10.9 days expired with
69 consecutive refresh failures. The account had headroom the whole time; the rotator's *copy of the
key* was dead.

## Verification

- Unit: a stamped report at 98 % on the live fingerprint triggers `autoRotate`; the same report
  stamped with a NON-live fingerprint, or dated before `last_switch_at`, triggers nothing.
  **Neuter: drop the fingerprint check → the post-switch loop test reds.**
- Unit: with the ingest path fed, the live-account `usageRequest` is NOT called; the candidate
  `usageRequest` calls still are. **Neuter: revert `:422` to the endpoint → the "no live endpoint
  read" test reds.**
- Unit: the 60 s timer still rotates when no statusline report has ever arrived (fail-safe floor).
- Contract: a report missing `five_hour`/`seven_day` is treated as UNKNOWN and never as 0 — an
  unknown window must not read as "plenty of headroom".

## Acceptance

- [ ] `tick.ts:422` reads the live 5h/7d from the ai-maestro API (statusline-fed), not the endpoint
- [ ] candidate reads at `:496`/`:509` unchanged, and documented as structurally endpoint-only
- [ ] ingest stamps the live fingerprint; the rotator rejects non-live-stamped and pre-switch reports
- [ ] an at/over-threshold ingest triggers `autoRotate` immediately; the 60 s timer remains the floor
- [ ] the drain-guard: no expiry-only rotation off a low-usage account onto the last healthy slot
- [ ] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green

## Approval log

- 2026-08-02T02:39:34+0200 — USER MANDATE, issued verbatim (above) after the live incident.
  Authority: USER >= any required approver, so this is authored directly in `design/tasks/`.
