---
trdd-id: 9HVPW12Z
title: The agent-facing governance-request route still demands the governance password after R32 superseded it
column: backburner
created: 2026-08-04T15:07:19+0200
updated: 2026-08-04T15:07:19+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: security
min-approval-requirement: manager
approved: false
mandate: false
derived: false
priority: 1
severity: high
effort: medium
release-via: none
relevant-rules: [28, 32]
labels: [governance, security, r32, frozen-cli, api]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/76, https://github.com/Emasoft/ai-maestro/issues/64]
---

# The agent-facing governance-request route still demands the governance password after R32 superseded it

## Problem

`POST /api/v1/governance/requests` hard-requires a governance password in the request body,
with **no AID path at all**:

```
app/api/v1/governance/requests/route.ts:95-96
    if (!body.password || typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Missing required field: password' }, { status: 400 })
```

The frozen CLI mirrors it — `scripts/aimaestro-governance.sh:178-181` refuses to run without
`--password`.

This route is **agent-facing by construction**: its own body schema carries `requestedBy` and
`requestedByRole` (`scripts/aimaestro-governance.sh:193-196`). An agent is the expected caller,
and the only way for an agent to call it today is to hold the governance password.

That is the exact shape **R32 revoked** (`docs/GOVERNANCE-RULES.md:1342-1350`, CRITICAL — IRON,
USER-set):

- **R32.1** — *"Agents **never** require sudo gates / sudo tokens. They authenticate with their
  **AID**; the server derives identity + title + portfolio tokens from it (per R28)."*
- **R32.2** — *"A sudo password may be requested **only of the USER**, and **only via the UI**."*
  A CLI flag is neither.
- **R32.3** — strict routes stay sudo-gated **for USER/UI callers**; for **agent** callers the
  gate is the R28 three-check (AID → title → token).

So the defect is not that a governance write is gated — it is that the gate is the *superseded*
mechanism, on the one path agents are supposed to use.

## Why this matters beyond the one route

An agent that must hold the governance password to file a request keeps that secret in the
agent-side loop **permanently** — which is what R32 exists to eliminate. It also puts the
credential into every script, prompt and log on the path to that call. This project has already
shipped the governance password into a public repo once (`TRDD-44RGLOO8`), and the standing
invariant is that the value never passes through a model. A route that *requires* agents to
supply it is a structural pressure toward exactly that failure.

## Root cause

R32 landed as a **rule** and as a policy layer (`lib/authorization.ts`), but the pre-R32
password check on this route was never migrated to the R28 three-check. It is residue, not a
deliberate exception — nothing in R32 or R28 carves this route out.

## The fix already exists in-tree — copy it, do not invent it

The AID-only shape is **shipped and proven** in the same CLI family:

```
scripts/aimaestro-teams.sh:122
    --cos UUID | --remove-cos   assign/clear the chief-of-staff (#64; MANAGER by AID, no password)
```

So a governance-class write authenticated purely by AID already works in production here. This
card is migrating one more route onto that established path.

## Proposed fix

1. Accept `AID_AUTH` on `POST /api/v1/governance/requests` and resolve identity + title +
   portfolio/mandate token **server-side** per R28's three-check.
2. Keep the password path for **USER/UI** callers only (R32.3 preserves it there) — this is a
   widening, not a swap, so the dashboard is unaffected.
3. Drop `--password` from `aimaestro-governance.sh request`, replacing it with the AID the
   script already sends on every other verb (`AID_AUTH`, per `scripts/aimaestro-teams.sh:139`
   — *"Bearer token for agent callers (REQUIRED — no localhost exemption)"*).
4. **Leave `approve` / `reject` password-required.** They are USER/UI-only by design; COS
   confirmed on `#76` that it does not call them, and R32.3 explicitly keeps strict routes
   sudo-gated for USER/UI callers. Widening those would be a real security regression.

## Scope boundary — verified vs not

- ✓ **VERIFIED** — `POST /api/v1/governance/requests` requires `body.password`, no AID path
  (read first-hand, `route.ts:95-96`).
- ✗ **NOT AUDITED** — whether other agent-facing routes carry the same pre-R32 residue. The
  sibling `approve`/`reject` routes are *correctly* password-gated, so the residue is not
  uniform and a sweep cannot be assumed from this one instance. **An EHT should sweep the
  agent-facing route surface for the same shape before this is called closed.**

## Verification

- An agent caller with a valid `AID_AUTH` and no password can file a governance request.
- A caller with **neither** AID nor password is refused — the widening must not become a hole.
- A USER/UI caller with the password still succeeds unchanged (no dashboard regression).
- `approve`/`reject` still refuse without `--password` — assert this explicitly, or the fix
  silently widens them too.
- The negative test must pin the **reason** for refusal, not merely that it failed: an
  anonymous call must be refused *by the R28 check*, not by some earlier missing-field 400,
  or the test passes against a deleted gate.

## Estimated risk

**MEDIUM.** The mechanics are small and the pattern is already shipped. The risk is entirely in
the auth surface: widening a governance-write route is only safe if the AID path is a genuine
R28 three-check and not an unauthenticated bypass. Ship the check with the widening, in one
commit, with the negative test above.

## Provenance

Found 2026-08-04 while answering `Emasoft/ai-maestro#76` (the CHIEF-OF-STAFF's 6-class
frozen-CLI gap list). COS filed op 1 as *"an AID-only approval status-PATCH is missing"* and
scoped it to `approve`/`reject`. Verifying that claim showed the real blocker is one layer
down and on **our** side: the request-**creation** path COS actually needs is itself still on
the pre-R32 model. COS did not flag it, and it is not something they can work around.

Queued onto `#64` (the CORE frozen-CLI build queue) in the same reply.

## Approval log
