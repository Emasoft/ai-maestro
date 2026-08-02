---
trdd-id: SIV45HOG
title: Statusline ingest must stamp the live account fingerprint, or the rotator burns every account
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T11:04:52+0200
updated: 2026-08-02T11:04:52+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T11:04:52+0200
derived: true
derived-kind: npt
parent-trdd: GY0LJV6S
severity: critical
effort: small
relevant-rules: [R16]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth, rotator, statusline, safety, derived]
---

# Statusline ingest must stamp the live account fingerprint

## Why this exists (found by verification, 2026-08-02 11:04)

[[GY0LJV6S]] records this as **mandatory**, in its own words:

> **The payload carries NO account identity — the server must stamp it.** … The rotator MUST ignore
> any report whose stamp is not the currently-live fingerprint, or whose timestamp precedes
> `last_switch_at`. Without this, reports still arriving from sessions running on the OLD credential
> are attributed to the NEW live account immediately after a switch — the rotator reads ~98 % on a
> fresh account and rotates straight back out of it. **A rotation loop that burns every remaining
> account in minutes.**

[[D8OYFG35]] built the whole ingest pipeline and **does not implement this** — and it was never asked
to. Measured, not inferred:

| check | result |
|---|---|
| `grep -rn 'live_fp\|liveFp\|fingerprint'` over `lib/statusline-*.ts`, `types/statusline.ts`, `app/api/statusline/` | **0 hits** |
| `grep -rn 'accountId\|account_id\|liveEmail\|liveAccount'` over the store + routes | **0 hits** |
| `grep -niE 'fingerprint\|live_fp\|stamp\|account identity'` over D8OYFG35's own card | **0 hits** |

`StatuslineSnapshot` is `{ sessionId, capturedAt, source, rateLimits, session, context, cost }`.
There is nowhere for an account identity to live.

So this is **not** a defect in D8OYFG35 — every acceptance box it owns is delivered. It is a
prerequisite nobody owned, sitting between a finished producer and an unstartable consumer. Filed as
an NPT of GY0LJV6S rather than as an edit to a card at `human_review`, per the depth-1 derived rule.

**The failure this prevents is the worst one available to this subsystem.** It is not "a stale
number": it is an actuating loop that consumes the very accounts it is trying to preserve, at 60 s
per iteration, unattended, while the human sees only a healthy-looking rotation log. GY0LJV6S must
NOT be wired until this lands — and that is the whole reason it is now blocked on this card rather
than merely sequenced after it.

## Scope

1. **Stamp at ingest.** `POST /api/statusline/ingest` records the live account fingerprint with each
   report, resolved **server-side at arrival time** — never taken from the payload, which is
   attacker-shaped input from a console-local process and carries no identity anyway.
2. **Stamp the switch.** Persist `last_switch_at` where the rotator can read it, so a report can be
   rejected on age as well as on identity. The two guards are not redundant: identity catches a
   report from a different account, age catches a report from the SAME account emitted before the
   switch (a session that had not yet noticed).
3. **Reject, do not repair.** A report failing either guard is DISCARDED, not reinterpreted. A
   mis-attributed usage number is worse than no number — the rotator's fail-safe on absent data is
   already "do not rotate", which is the correct outcome here.

## The reuse question, to answer before writing code

`lib/oauth-rotator/` already resolves a live fingerprint (`fp-differs` appears in the rotator's own
slot reporting, and `state.live_fp` is named in GY0LJV6S). **Find that existing resolver and call
it** — do not write a second one. Two fingerprints computed two ways is precisely how the guard
would come to disagree with the thing it guards, and it would fail OPEN (a mismatch reads as "not
the live account" → discard → rotator sees no data → does not rotate). Safe, but it would silently
disable the whole feature and look like a working system.

## Verification

- Unit: a report stamped with the CURRENT live fp is accepted.
- Unit: a report stamped with a DIFFERENT fp is discarded. **Neuter: drop the identity check → this
  test reds.**
- Unit: a report whose `capturedAt` precedes `last_switch_at` is discarded even when its fp matches.
  **Neuter: drop the age check → this test reds** (and it must NOT be caught by the identity test,
  or the two guards are not independent).
- Unit: a payload that *claims* an account identity cannot influence the stamp — server-side
  resolution wins. This is the one that matters if the ingest is ever reachable beyond the console.
- The fingerprint is obtained from the EXISTING rotator resolver, asserted by the test importing the
  same symbol the rotator uses.

## Acceptance

- [ ] ingest stamps a server-resolved live fingerprint on every stored report
- [ ] `last_switch_at` is persisted and readable by the rotator
- [ ] a report failing EITHER guard is discarded, and the discard is observable (counter or log)
- [ ] the fingerprint comes from the rotator's existing resolver, not a second implementation
- [ ] tests + at least 2 neuters recorded BY NAME; `tsc` 0; full suite green
- [ ] [[GY0LJV6S]] unblocked and its `blocked-by` cleared

## Approval log

- 2026-08-02T11:04:52+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Pre-approved: Tier 0 self-mandate, a derived NPT wholly inside this agent's own assignment scope.
  No approval request was sent.
