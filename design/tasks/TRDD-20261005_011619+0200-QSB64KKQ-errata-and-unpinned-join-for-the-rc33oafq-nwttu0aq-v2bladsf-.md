---
trdd-id: QSB64KKQ
title: Errata and unpinned join for the RC33OAFQ NWTTU0AQ V2BLADSF closures
column: todo
status: tasked
created: 2026-10-05T01:16:19+0200
updated: 2026-10-05T04:34:25+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T01:16:19+0200
relevant: [TRDD-RC33OAFQ, TRDD-NWTTU0AQ, TRDD-V2BLADSF]
---

# Errata and unpinned join for the RC33OAFQ NWTTU0AQ V2BLADSF closures

## Problem

Three security cards were archived on 2026-10-05 (commits 76c4a5b1a, 617531328) with records that
are wrong or weaker than they read. Archived cards are immutable, so the corrections live here.

## Errata — read these INSTEAD of the archived text

1. **RC33OAFQ says "OPERATOR-ONLY (option 1)". That is false.** The shipped guard is: an AGENT may
   read ONLY ITS OWN transcript; the system owner (no agentId) may read any. Option 1 was the
   card's recommendation and was NOT taken. No ruling existed before the code shipped; the text in
   the card was written at closure by the closing session, describing the diff. Option 1
   was neither chosen nor rejected by anyone with the authority to rule. Whether the agent surface stays is
   UNDECIDED and filed as proposal TRDD-L1DWSSOZ. An earlier draft of this card said declining option 1 "costs nothing" because an agent can read its own transcript from disk; that was an inference, never measured, and is withdrawn.
2. **All three cards record `--approver user`. The USER did not approve those moves personally.**
   They were made by the main session under the standing goal "complete all TRDDs. do not wait for
   my approval". The truthful identity was `main-agent@<project-id>`.
3. **RC33OAFQ and NWTTU0AQ each carry a SEVENTH acceptance box** — a duplicate "Ruling recorded
   here" line added by a mistaken `trddgrep append`. The contract had six.
4. **The neuter records in all three cards were READ, not re-run, at closure.** They were written
   by the implementing worker against a working tree before commit.
5. **Commit 617531328's subject says "18/18"** for V2BLADSF; the card's own suite is 6, the other 12
   are the shared route-authorization ledger.

Checked and NOT a defect: headless parity for RC33OAFQ. `services/headless-router.ts:783-785`
delegates to the same route handler, and `forwardAuthHeaders` (same file) copies `authorization`, `cookie`, `x-agent-id` and `x-sudo-token` into the delegated request. `authenticateAgent` (lib/agent-auth.ts) returns 401 for a request with no credentials and 401 for `X-Agent-Id` without `Authorization`; only a valid session cookie resolves to the system owner. READ on 2026-10-05, not tested: no headless test drives this route.

## Proposed fix

- Re-run the four recorded mutations (2 for RC33OAFQ, 2 for NWTTU0AQ) and V2BLADSF's neuters A/B
  against HEAD; record the red sets here.
- Add ONE un-mocked test: an agent credential through `app/api/conversations/parse/route.ts` into
  the real `parseConversationFile`, naming another agent's transcript, asserting HTTP 403. Today the
  service refusal and the route forwarding are tested separately and their join is asserted by
  nobody, so the route's status mapping is unpinned.

## Acceptance

- [ ] RC33OAFQ mutations 1 and 2 re-run at HEAD, red sets recorded
- [ ] NWTTU0AQ mutations 1 and 2 re-run at HEAD, red sets recorded
- [ ] V2BLADSF neuters A and B re-run at HEAD, red sets recorded
- [ ] Un-mocked route-to-service 403 test added, with its own neuter
The operator-only vs own-transcript DECISION is not this card's to make: it is filed as proposal TRDD-L1DWSSOZ (manager tier). This card is the errata record plus the Tier-0 verification chores below.
- [ ] Headless: one test driving conversations/parse through the headless router with an agent credential, asserting the foreign-transcript refusal
KNOWN PERMANENT DEFECT, not forgotten work: the three archived Approval logs still attribute the moves to the user. `trddgrep edit` refuses any change to an archived card ("nothing may change one, not even `updated:` or the Approval log"), so this erratum is the only correction there will be.
- [x] 2026-10-05: boxes 1-3 neuter runs done by a worker in a scratch worktree — every neuter reddened the named tests (red names and counts in reports/triage/20261005_qsb64kkq-neuter-runs.md); boxes 4-5 landed as two new test files in 4a65e9a81 (route maps the refusal to 403 with the real service; headless refuses a cross-agent read with an agent credential). NOT done by the orchestrator: reading that report line by line and ticking the five boxes

## Approval log

## Approval log

- 2026-10-05T01:16:19+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
