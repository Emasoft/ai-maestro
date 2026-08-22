---
trdd-id: N6V7WB69
title: The agent-subject half of the manage-trdd smoke needs a registered agent
column: todo
created: 2026-08-22T19:10:40+0200
updated: 2026-08-22T19:11:09+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T19:10:40+0200
assignee: ai-maestro-hub
priority: 2
labels: [auth, e2e, manage-trdd, owner-act]
external-refs: [TRDD-798OAHMX]
---

# The agent-subject half of the manage-trdd smoke needs a registered agent

# The AGENT-subject half of the `manage-trdd` smoke — needs a registered agent, not a console

Descoped out of **TRDD-798OAHMX**, whose USER-authority half is done (5 verbs, 4 controls, 2 bugs
found and filed) and whose remaining box is structurally unreachable from an owner console.

## Why the parent could not do it

`manage-trdd` authorizes two subject classes behind ONE token prefix — `aim_tk_` is minted for
both (`lib/aid-token.ts:375` agent, `:426` user) and the discriminator is `subject_type`. The
parent exercised the **user** subject exhaustively. The **agent** subject is the half the policy
is actually about, and reaching it requires a real `aim_tk_` obtained by **Ed25519
proof-of-possession against a REGISTERED agent's keypair**.

This session cannot hold one, and that is by design rather than by configuration:
`app/api/v1/auth/token/route.ts` requires a registered record plus a signed-ledger association
(`403 aid_no_ledger_history` otherwise), and only agents *created / imported / migrated* into the
server are registered. An owner console is the complement — `buildAuthContext`
(`lib/agent-auth.ts:373`) derives `isSystemOwner` from the ABSENCE of an `agentId`, which is also
why the sudo route refuses agents with `403 sudo_user_only`. `AID_AUTH` is unset here, and
minting a token for an existing agent would mean **borrowing its identity**.

## Who can run it — measured, not assumed

`GET /api/agents` (authenticated) returns **11** registered agents. Exactly two are `active` and
carry a governance title:

| agent | status | title |
|---|---|---|
| `frank` | active | autonomous |
| `testbot` | active | manager |

The other nine are `offline` with **no governance title** — the structural signature of the
owner's pre-fork agents (`~/Code/*` workdirs). **Never drive those**, and never identify them by
a hand-kept name list; the two facts above are what define them.

**This session deliberately did NOT dispatch `frank` or `testbot`.** Steering a live fleet agent
unattended to run a test is a fleet action, and neither agent's provenance was established — the
board has a standing lesson about acting on an agent identified by nothing but its row.

## What the run must cover

The same five verbs the user-authority pass drove — `create`, `promote`, `archive`, `refuse`,
`approve` — plus the tier boundary, which is the whole point:

- a verb the agent's **tier permits** succeeds;
- a verb **above** its tier is refused by the ROUTE, not merely by the wrapper (drive the raw
  route too — the parent found the wrapper and the route disagreeing on `--state failed`, and
  only the raw call proved the route also refuses);
- `verify` returns a positive/negative pair (`exit 0` / `exit 2`) on agent-minted approvals.

Note `approve` is the ONLY verb that mints an approval token, so a card closed on a review verdict
is permanently UNVERIFIABLE by design (`TRDD-06G43RK2`) — do not read that as a failure of this run.

## Do NOT

- Do not mint an `aim_tk_` for an agent this session is not. That is identity borrowing, and the
  `403 aid_no_ledger_history` gate exists to stop exactly it.
- Do not touch any of the nine offline, title-less agents.
- Do not weaken a gate to make a verb pass. The parent's two findings (`MWKCBLQN`, `P6MSMQ2I`)
  were RECORDED, not reconciled; do the same here.

## Acceptance

- [ ] The owner authorizes which registered agent runs it (or registers one for the purpose)
- [ ] That agent obtains a real `aim_tk_` by Ed25519 PoP — no borrowed identity, no console token
- [ ] All five verbs exercised, plus at least one ABOVE-tier refusal proved at the RAW route
- [ ] Divergences filed as their own cards rather than reconciled in place

## Approval log

- 2026-08-22T19:10:40+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
