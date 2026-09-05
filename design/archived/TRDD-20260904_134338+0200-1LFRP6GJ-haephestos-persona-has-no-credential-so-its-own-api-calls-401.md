---
trdd-id: 1LFRP6GJ
title: The Haephestos persona has no credential so its two documented API calls are refused 401
column: complete
created: 2026-09-04T13:43:38+0200
updated: 2026-09-05T10:59:09+0200
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
implementation-commits: [e768504e]
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

- [x] the shape is RULED between "give it a credential" and "move the lookups off the API",
      with the reason recorded here
- [x] the persona's documented path either works or is corrected — no shipped instruction may
      describe a call that 401s
- [x] if a credential is minted, a test proves it CANNOT reach the six owner-gated routes
- [x] neuter observed and recorded

## Approval log

- 2026-09-04T13:43:38+0200 — MANDATE issued by ai-maestro-hub-session as a derived carve-out of TRDD-DQVPODKW's
  final box. Not pre-approved above tier: min-approval-requirement stays `manager`.
- 2026-09-05T09:52:55+0200 — column → dev by manager. RULED option 2 (move the two lookups off the API to files, the raw-materials-state.json pattern): no credential to scope, nothing leaks into a persona transcript, the two routes join the six owner-gated in 85865270. The author's own lean and the smaller surface. Authorization: USER /goal 2026-09-05 'complete all TRDD and pending tasks'. Implementation delegated; assignee ai-maestro-hub-session.
- 2026-09-05T10:59:09+0200 — COMPLETE by manager. Landed in e768504e. DEVIATION from the ruling's letter, recorded not silent: element-descriptions did not go to a FILE — the persona now execs the PSS binary directly (the route only ever shelled out to it; reuses the persona's own Step-2 mechanism, smaller than inventing file IPC for a pure read). publish-plugin follows the file pattern exactly (request/response in ~/agents/haephestos/, 2 s poller in creation-helper-service, same validation function in-process via services/haephestos-publish-service.ts); its trust boundary moved from HTTP auth to write access on ~/agents/haephestos/, consistent with raw-materials-state.json, so quad-identity validation inside publishHaephestosPlugin is now the only gate on a file any agent can write. Box 3 ticked as VACUOUS — no credential was minted. Verified first-hand: tsc 0; 4 files / 84 tests; TWO complementary neuters (publish-plugin gate → null reddens exactly its 2 cases + the sibling case; element-descriptions gate → null reddens exactly its 2 + the sibling), each restored. NOTES for the next reader: (1) the persona Step 8 still PREFERS /aim-publish-plugin, which exists nowhere in the cached ai-maestro-plugin 3.2.2 (find + grep of the route path both empty) — the file fallback is the real path; a future plugin version shipping a curl to this route would 401; (2) the single shared workdir makes the publish request/response single-session — two Haephestos sessions would clobber each other, a pre-existing property of the raw-materials pattern; (3) the persona's 30 s response poll is shorter than a slow publish that ends with a CLI refresh; (4) "TomlPreviewPanel unaffected" in the commit message is EXPECTED (same-origin owner cookie, as the six 85865270 routes), not exercised against a real cookie. No boot re-arm needed for the poller: server.mjs:2276 kills any orphaned persona session at startup and createCreationHelper restarts both watchdog and poller. Headless router does not reimplement either route (grep lib/ + server.mjs: only reserved-name hits)..
- 2026-09-05T11:04:58+0200 — follow-ups after close, recorded here because implementation-commits is frozen: c8da6532 (re-arm watchdog + publish poller on the already-running branch; found by post-close review) and 458ecc52 (guard that re-arm on the timer variables — the unconditional form reset lastHeartbeat and cleared publishInFlight on every call). Semantics for a persona that outlived a server restart, measured: the next createCreationHelper call (POST creation-helper/session) arms a fresh 120-minute window (WATCHDOG_TIMEOUT_MS; startWatchdog sets lastHeartbeat = now) plus the poller; the window is refilled only by POST creation-helper/heartbeat, whose sole caller is HaephestosEmbeddedView.tsx:135 — with the wizard tab open the survivor lives and can publish, without it the watchdog kills it after 120 min, the zombie semantics the watchdog exists for. The ensure-persona route touches only the filesystem and never reaches the branch. Coverage: the reuse branch has a return-value test (creation-helper-service.test.ts:117) that now ENTERS the guarded arm, so the test file gained an afterEach teardown via deleteCreationHelper; nothing pins the timer state — both follow-ups are unpinned.
