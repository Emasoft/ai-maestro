---
trdd-id: 1LFRP6GJ
title: The Haephestos persona has no credential so its two documented API calls are refused 401
column: todo
created: 2026-09-04T13:43:38+0200
updated: 2026-09-04T13:43:38+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
priority: 2
severity: medium
effort: medium
min-approval-requirement: manager
derived: true
derived-kind: eht
parent-trdd: DQVPODKW
labels: [security, haephestos, auth, carved-from-dqvpodkw]
---

# The Haephestos persona has no credential so its two documented API calls are refused 401

## Problem — the persona's own instructions describe a path that cannot work

`agents/haephestos-creation-helper.md` tells the persona to reach the server with two bare curls:

```bash
curl -s -X POST http://localhost:23000/api/agents/creation-helper/element-descriptions ...
curl -s -X POST http://localhost:23000/api/agents/creation-helper/publish-plugin ...
```

Neither carries an `Authorization` header or a cookie. Measured 2026-09-04, first-hand:

| fact | measurement |
|---|---|
| the persona's curls carry a credential | NO — read the two blocks in the persona file |
| `services/creation-helper-service.ts` injects one into the session | NO — **0** hits for `AID_AUTH\|Bearer\|Authorization\|aim_tk` |
| `middleware.ts` lets a credential-less `/api/*` through | NO — `hasCredential` refuses with 401 before any handler |

So the persona's documented fallback path is **already broken**, and has been since the
credential-less bypass was closed. It is a live defect, not merely a prerequisite.

## Why this is its own card

It was the (a) half of TRDD-DQVPODKW's final box, which said "both halves in one change …
or the wizard breaks". That coupling was **void by that card's own measurement** — recorded
two lines below the coupling: the wizard's persona path is already broken, so the (b) half
(owner-gating six wizard-only routes the persona never calls) could not break it further.
(b) shipped as `85865270`. This is the (a) half, standing on its own because it is a real
defect rather than a precondition.

## The decision this needs

Two shapes, and the choice is not obvious:

1. **Give the spawned Haephestos session a credential** — an AID token or a session cookie
   injected by `creation-helper-service` at launch. Makes the curls work as documented, and
   raises the question of what that credential may do (it must NOT be a general agent token
   with the wizard's own destructive routes in reach).
2. **Move the two lookups off the API** — to files/stdin, the way `raw-materials-state.json`
   already works. No credential to scope, no token to leak into a persona transcript, and the
   two routes could then be owner-gated with the other six.

Option 2 is the smaller surface and is consistent with an existing pattern in the same
subsystem. Option 1 preserves the documented interface. **Rule before coding.**

## Verification

- The persona's documented path is exercised end to end and SUCCEEDS (today it 401s) — or
  the persona file is corrected in the same change so it no longer documents a dead path.
- Whichever is chosen, a test pins that the persona surface works AND that the credential (if
  any) cannot reach the six owner-gated wizard routes.

## Estimated risk

MEDIUM. Option 1 mints a credential inside a persona session, which is a surface that must be
scoped deliberately; option 2 changes a documented interface.

## Acceptance

- [ ] the shape is RULED between "give it a credential" and "move the lookups off the API",
      with the reason recorded here
- [ ] the persona's documented path either works or is corrected — no shipped instruction may
      describe a call that 401s
- [ ] if a credential is minted, a test proves it CANNOT reach the six owner-gated routes
- [ ] neuter observed and recorded

## Approval log

- 2026-09-04T13:43:38+0200 — MANDATE issued by ai-maestro-hub-session as a derived carve-out of TRDD-DQVPODKW's
  final box. Not pre-approved above tier: min-approval-requirement stays `manager`.
