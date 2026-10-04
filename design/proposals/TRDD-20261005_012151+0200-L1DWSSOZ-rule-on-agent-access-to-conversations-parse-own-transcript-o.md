---
trdd-id: L1DWSSOZ
title: Rule on agent access to conversations parse — own transcript or operator only
column: proposal
status: proposed
created: 2026-10-05T01:21:51+0200
updated: 2026-10-05T01:21:51+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Rule on agent access to conversations parse — own transcript or operator only

## Problem

`POST /api/conversations/parse` returns a parsed Claude transcript. TRDD-RC33OAFQ closed the hole
where any authenticated agent could read any other agent's transcript. What shipped (46cb7eb1c):
an AGENT may read only its OWN transcript; the system owner may read any.

RC33OAFQ's own caller enumeration (2026-08-26, NOT re-checked at HEAD) found every caller is the
operator UI and no agent-side caller exists, and recommended OPERATOR-ONLY. The shipped guard is
broader than that recommendation, and nobody with authority chose it: the implementing worker
built it and the card was closed with a label ("operator-only") the code does not implement.
See TRDD-QSB64KKQ for the errata.

## The decision

1. **Keep** agent own-transcript access (what is live now), or
2. **Tighten** to operator-only: `enforceSystemOwner` on the route, agents get 403.

Facts established 2026-10-05 by reading `lib/agent-auth.ts`: a request with no credentials is
401; `X-Agent-Id` without `Authorization` is 401; only a valid browser session cookie resolves to
the system owner. So neither option has a fail-open path through authentication.

NOT established: whether any agent client needs this route for its own transcript, and whether an
agent can read the same file from disk anyway (same OS user, storage location per client, modes).

## Proposed fix

Option 2 unless a legitimate agent-side caller is found at HEAD: it matches the recommendation,
removes a surface nobody is known to use, and is one line plus the positive-control test flipping
to a refusal.

## Verification

Re-run the caller enumeration at HEAD first. Then, for option 2: agent credential gets 403 on its
own transcript too; owner session still parses; neuter recorded.

## Acceptance

- [ ] Caller enumeration re-run at HEAD (three needle forms, counted before reading)
- [ ] Ruling recorded: option 1 or option 2, by MANAGER or USER
- [ ] If option 2: guard, refusal test, neuter, ledger checked

## Approval log

## Approval log
