---
trdd-id: VXFI1BR5
title: switchLiveTo discards a working credential at rotate-off instead of snapshotting it back to the outgoing slot
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-02T15:04:49+0200
updated: 2026-08-02T15:04:49+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: user
approved: false
severity: critical
effort: medium
relevant-rules: [R16]
npt: []
eht: []
blocked-by: []
release-via: none
labels: [oauth, rotator, credentials, incident-rootcause]
---

# switchLiveTo discards a working credential at rotate-off instead of snapshotting it back to the outgoing slot

## The defect, measured

`lib/oauth-rotator/rotate.ts:31-56`. `switchLiveTo` reads the CURRENT live blob for exactly one
purpose — to preserve the user's `mcpOAuth` and any other top-level keys — then replaces
`claudeAiOauth` with the incoming slot's and writes it:

```ts
const live = readLiveBlob() ?? {}
const merged: Record<string, unknown> = { ...live }
merged.claudeAiOauth = cred   // replace ONLY claudeAiOauth
writeLiveBlob(merged)
```

**Nowhere does it write the OUTGOING `claudeAiOauth` back into the outgoing account's slot.** At the
moment of every rotation the rotator is holding a live, working credential for the account it is
leaving, and it throws that credential away. The outgoing account's slot keeps whatever copy it had
from whenever it was last captured or keepalive-refreshed.

## Why this is the 2026-08-01 incident's actual mechanism

[[GY0LJV6S]]'s incident record: the rotator rotated off `fmuaddib` at 39 %/24 % and again at
9 %/38 % for local expiry, and when the target maxed out there was no way back because `fmuaddib`'s
**stored** credential was by then 10.9 days expired with 69 consecutive refresh failures.

The account had headroom the whole time. What was dead was the rotator's copy of the key — and it
was dead precisely because the working copy it held at rotate-off was discarded, leaving a stale one
to rot behind a refresh grant that later failed. `keepaliveRefresh` is the only thing that maintains
an alternate slot afterwards, and it cannot recover a slot whose refresh grant has died.

## Relationship to the drain-guard ([[GY0LJV6S]] box 5) — do not mistake one for the other

The drain-guard makes the *trigger* rare: it refuses the expiry-only rotation that started this.
It does **not** close this mechanism, and it slightly ENTRENCHES it: the guard defers rotation to
the moment the token actually fails (401), which is exactly the moment the outgoing credential is
worthless and there is nothing useful left to snapshot. So the two are complementary, and shipping
only the guard leaves the fleet one unguarded rotation away from the same dead end.

Found by adversarial review (Fable advisor) while reviewing the drain-guard; verified first-hand
against `rotate.ts` before filing.

## Why this is NOT a same-turn patch — the race that makes it non-trivial

The obvious fix ("write the outgoing `claudeAiOauth` into the outgoing slot before overwriting the
live blob") is not obviously safe:

- **The live grant is single-use and rotating.** `keepaliveRefresh` documents exactly this as the
  reason it never refreshes the live account (`tick.ts:469` — *"Claude Code owns its single-use
  rotating grant"*). Adopting that grant into a slot means two owners for one single-use token.
- **In-memory sessions are not retro-fixed.** Sessions running through an A→B switch keep A's token
  in memory and may refresh it themselves. If the slot now holds the same grant, whichever side
  refreshes first invalidates the other — and the loser records a refresh failure against a
  credential that was fine.
- **Overwrite risk.** A snapshot that is WORSE than the copy already in the slot (older, or a token
  the session has since rotated past) would be a regression, so the write needs a
  freshness comparison rather than an unconditional overwrite.

## Sketch of the shape (NOT a decision — the approver's call)

Likely: snapshot only when the outgoing blob is strictly fresher than the slot's stored copy, record
provenance so a later refresh failure can be attributed, and leave `mcpOAuth` untouched (slots are
`claudeAiOauth`-only by `writeSlot`'s contract). Whether the single-use grant can be safely shared
at all is the open question and may force a different answer entirely — e.g. capturing at rotate-off
only when no session is live on the outgoing account.

## Why `min-approval-requirement: user`

This modifies the one irreversible primitive the whole subsystem exists to protect (the credential
write), and it writes SHARED CREDENTIALS — both named in the objective-floor table as USER-tier.
It is filed as a proposal rather than authored into `design/tasks/` for that reason, per the
conservative-escalation rule.

## Acceptance

- [ ] the outgoing account's slot is no worse after a rotation than before it, with the
  freshness comparison that guarantees it
- [ ] the single-use-grant race is either resolved or explicitly ruled out by construction, with
  the reasoning recorded — not left as an assumption
- [ ] tests + at least 2 measured neuters recorded BY NAME; `tsc` 0
- [ ] the drain-guard's `## ⛔ NOT THE ROOT CAUSE` section in [[GY0LJV6S]] is updated to point at
  the landed fix

## Approval log

- 2026-08-02T15:04:49+0200 — FILED as a proposal. Intake is exempt; EXECUTION is USER-tier
  (shared credentials + irreversible write). Awaiting the USER.
