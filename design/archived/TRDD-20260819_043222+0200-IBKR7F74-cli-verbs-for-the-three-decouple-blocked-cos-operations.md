---
trdd-id: IBKR7F74
title: CLI verbs for the three DECOUPLE-BLOCKED COS operations
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-19T04:32:22+0200
updated: 2026-08-25T19:55:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
npt: []
eht: []
blocked-by: []
pre-block-column: null
release-via: none
relevant-rules: []
labels: [cli-surface, decoupling, cos, fleet-reported, owner-ours]
external-refs: [Emasoft/ai-maestro#76]
---
# CLI verbs for the three DECOUPLE-BLOCKED COS operations

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-25

**DONE — the one op that was still a gap is BUILT; the other two resolved elsewhere.**
The recorded blocker (K2WJH7RF "column: dev") was STALE: that card is archived `completed`
(all three parts shipped). The #76 thread then split this card's three ops:

- **(a) add-agent with metadata** — BUILT elsewhere: `82839c34` made `--dir` optional
  (defaults `~/agents/<name>/`); `--title/--team/--plugin` already existed. Not this card's.
- **(b) generic agent-status-set** — **RULED AGAINST** (#76, 2026-08-05): the registry must
  reflect reality, never be independently writable; use the lifecycle actions
  (hibernate/wake/delete). The COS marker at `amcos_team_registry.py:596` should be rewritten
  from "Pending MANAGER design call" to REFUSED-use-the-actions (COS's side).
- **(c) password-less AID path for governance requests** — **BUILT HERE, commit `b2afaa15`**
  (this repo, `governance-rules`): `submit`/`approve`/`reject` accept an AID-authenticated
  agent with NO password, per the K2WJH7RF-affirmed shape (R32 / RIFM4UXN Option A — server
  resolves AID → title; self-approval banned on the AID path; requestedBy forced to the
  authenticated identity; the in-band forgery of the passwordless path is impossible by
  construction — vouching is out-of-band). Both transports + CLI + 8 seeded-both-directions
  tests (2 neuter runs attributed: self-ban → exactly 1 red; AID-skip → exactly the 3
  AID-approve tests red). CLI deployed byte-identical to `~/.local/bin`, bare-name `--help`
  verified.

**Residue (not this card's):** the server bundle must be BUILT for the route halves to serve
(`yarn build` run at close; a `pm2 restart` alone does not pick up `app/`+`services/`).
COS repoints its three DECOUPLE-BLOCKED markers: `approval_manager.py:223` +
`team_registry.py:596` → the shipped AID verbs / the (b) refusal; ping sent at close.

## Problem

The COS role-plugin correctly refuses to call the server API directly (the no-direct-API
decoupling rule), which leaves three operations with NO working path for a running COS agent —
marked DECOUPLE-BLOCKED at their `scripts/amcos_team_registry.py:314,596` and
`amcos_approval_manager.py:223` with graceful degradation. Degradation is not a path, and the
USER's harness-readiness goal makes COS responsible for handing teams correctly-configured
agents. Reported by the COS session 2026-08-19 (their card 8E8D6618 closes when these land).

The three missing verbs, as reported and to be validated against the real routes before design:

- (a) **add-agent with status** — `aimaestro-agent.sh create` requires a working directory and
  exposes no `--status`.
- (b) **generic agent-status-set** — hibernate/wake/restart are ACTIONS, not label writes;
  there is no `update-status` verb.
- (c) **password-less status-PATCH for approval sync** — approve/reject are password-gated
  formal endpoints (a DIFFERENT operation, correctly so per R28/R41); the sync write has no
  AID-authorized verb.

## Why blocked

(c), and possibly (b), write agent state through routes governed by the strict-route/sudo model —
exactly the open policy question of TRDD-K2WJH7RF (agent authorization policy for the ten
remaining strict routes, `column: dev`). Shipping an AID-authorized write verb before that policy
lands would pre-decide it from the tool side. (a) is likely policy-free but ships with the set so
the COS repoints once, not three times.

## Acceptance

- [x] K2WJH7RF's policy names which of (a)/(b)/(c) an agent may perform under AID auth, and this
      card's verb design cites it per operation. (a) permitted+built elsewhere `82839c34`;
      (b) REFUSED per the #76 status-must-reflect-reality ruling — no verb, use the actions;
      (c) permitted per the RIFM4UXN Option A precedent K2WJH7RF affirmed — built `b2afaa15`,
      cited at every gate in the code comments.
- [x] The verbs land in the `aimaestro-*` script layer (never a raw API bypass), with `--help`
      exercised through the bare command name on PATH. `aimaestro-governance.sh help` via PATH
      shows the AID-path contract; deployed copy `cmp`-identical to the repo (2026-08-25).
- [ ] COS confirms their three DECOUPLE-BLOCKED sites repoint cleanly and 8E8D6618 closes.
