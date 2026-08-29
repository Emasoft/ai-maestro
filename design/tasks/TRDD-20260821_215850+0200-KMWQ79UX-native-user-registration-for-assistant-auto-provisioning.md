---
trdd-id: KMWQ79UX
title: Native-user registration so ASSISTANT auto-provisioning has something to gate on
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-30T01:03:33+0200
blocker-probe: sh -c 'echo PROBE-RAN; grep -rl "^export async function POST" app/api/users app/api/governance/users 2>/dev/null || echo no-registration-endpoint'
blocker-probe-canary: match:PROBE-RAN
blocker-holds-if: match:no-registration-endpoint
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:58:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: medium
effort: L
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#39]
---

## ⏵ STATE — 2026-08-30: the blocker now has a runnable probe, and the root cause is narrower than written

**Premise re-checked, and it HOLDS — but not for the reason the card gives.** "This server has
no concept of a native user" is too strong. Measured today:

- `app/api/governance/users/route.ts` **exists** and its GET returns `{ users, modelEnabled }`,
  so a user-authority model IS present — behind a feature flag that returns
  `{ users: [], modelEnabled: false }` when off.
- `app/api/users/me/presence/route.ts` exists, also GET.
- **Both are GET-only. There is no POST anywhere under either path**, so there is no
  registration EVENT for auto-provisioning to hook — which is the actual root cause, and it is
  what the card needs.

So the correction is: not *"no user concept"* but *"a read surface and an authority model, with
no registration write and the model flag off by default."* That is a smaller gap than the card
implied, and it changes where the work starts.

**Probe added** (the linter's `BLOCKED-WITHOUT-PROBE` rule — a parked card whose blocker is a
value with a silent timestamp rots while reading as current):

```
blocker-probe: sh -c 'echo PROBE-RAN; grep -rl "^export async function POST" app/api/users app/api/governance/users || echo no-registration-endpoint'
blocker-probe-canary: match:PROBE-RAN
blocker-holds-if: match:no-registration-endpoint
```

Dry-run today → `no-registration-endpoint`, so the blocker genuinely holds, and it lifts by
itself the day a registration endpoint lands rather than waiting for someone to re-read this.

**The canary is not decoration, and the linter refused the probe without it.** My first version
was `match:no-registration-endpoint` with no canary — **fail-OPEN**: a timeout, a moved path or
a drifted emitter produces no match, and "no match" reads as *blocker cleared*. `PROBE-RAN` is
the string a healthy run always emits, so an unreachable probe is distinguishable from a
satisfied one. Same shape as positive-controlling `lsof` before trusting its silence: an
instrument that fails toward the answer you want is worse than one that fails loudly.

**Still owner-gated on scope.** The card's own fix step 1 says the auth/SSO decision is "scope
TBD, may be a separate TRDD". That is a design ruling, not agent work.

## Problem

The `ai-maestro-assistant-role-agent` plugin (title ASSISTANT, per USER-ratified governance
principle 14, 2026-06-18) is built and published. Its intended lifecycle is: **every
non-MAESTRO native user gets one ASSISTANT agent auto-created and auto-assigned at
user-registration time.** That trigger does not exist — this server has no concept of a
"native user" separate from the single MAESTRO owner identity, so there is nothing for the
auto-provisioning logic to hook.

## Root cause

The server's identity model was built single-owner-first (one MAESTRO user, N agents). Multi-user
registration (sign-up, login, per-user session scoping) was never implemented, so "at
user-registration time" has no corresponding event.

## Proposed fix

1. Design a minimal native-user registration surface: a user record (id, display name, auth
   credential or SSO binding — scope TBD, may be a separate TRDD), distinct from the MAESTRO
   owner and from agents.
2. On successful registration, auto-create + auto-assign one ASSISTANT agent bound to that user,
   per principle 14's constraints: no team affiliation ever, obeys only its own user + MAESTRO,
   messaging restricted to those two parties, self-mutation forbidden (name/title/role-plugin/
   identity token locked).
3. Wire the profile-panel UI behavior: only the viewer's own ASSISTANT shows a working
   terminal/chat; every other agent (including another user's ASSISTANT) shows read-only.
4. All API ops the ASSISTANT performs authenticate via AID (per principles 3 & 7) — no sudo gate
   for it.

## Verification

- Registering a new native user creates exactly one ASSISTANT agent, visible only to that user
  and to MAESTRO.
- The ASSISTANT cannot join a team, cannot message any third party, cannot rename/retitle/
  reassign itself.
- A second user's profile view of someone else's ASSISTANT is read-only (no terminal, no editable
  panel).

## Acceptance

- [ ] Native-user registration event exists and is documented
- [ ] Auto-create + auto-assign ASSISTANT fires on that event, skips the MAESTRO user
- [ ] No-team / obey-only-user-and-MAESTRO / messaging-restriction enforced server-side, not just by convention
- [ ] Self-mutation lock (name/title/role-plugin/identity) enforced server-side
- [ ] Profile-panel UI behavior (own ASSISTANT = live, others' = read-only) implemented
- [ ] Comment posted on Emasoft/ai-maestro#39 confirming the card and status

## Approval log
