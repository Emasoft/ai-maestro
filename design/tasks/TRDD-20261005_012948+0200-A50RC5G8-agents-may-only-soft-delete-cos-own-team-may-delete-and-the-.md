---
trdd-id: A50RC5G8
title: Agents may only soft-delete — COS own team may delete and the cemetery stays user-only
column: todo
status: tasked
created: 2026-10-05T01:29:48+0200
updated: 2026-10-05T01:37:47+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: user
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: user
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T01:29:48+0200
parent-trdd: L6VV9Q7U
derived: true
derived-kind: eht
---

# Agents may only soft-delete — COS own team may delete and the cemetery stays user-only

## Problem

USER RULING, 2026-10-05, verbatim: "1 - yes, MANAGER and CHIEF-OF-STAFF (this one only in its own
team) can kill/delete an agent. but only soft-kill. the agent corpse in the cemetery can always be
resurrected by the user maestro."

Three parts, measured against the code on 2026-10-05:

| The ruling says | The code today | Evidence |
|---|---|---|
| CHIEF-OF-STAFF may delete an agent of its OWN team | DENIED — only MANAGER | `lib/authorization.ts`, the `delete-agent` branch: any title but manager returns "Only MANAGER can delete agents" |
| An agent caller may only SOFT-delete | NOT ESTABLISHED. `DELETE /api/agents/[id]?hard=true` forwards `hard` straight into `DeleteAgent`; a grep of the pipeline for a hard-plus-owner refusal found none, which is one needle and proves nothing | `app/api/agents/[id]/route.ts:176-186` |
| The cemetery corpse is always resurrectable by the user | AT RISK. `POST /api/agents/cemetery` and `DELETE /api/agents/cemetery` are mapped to the `delete-agent` action, which a MANAGER agent holds — so an agent may be able to PURGE a corpse | `lib/sudo-guard.ts:499-500` |

Killing a session (`delete-session`) by MANAGER / own-team COS is the same ruling and is handled
in TRDD-L6VV9Q7U's matrix row.

## Proposed fix

1. `delete-agent`: allow a CHIEF-OF-STAFF over its own team (same team test the unblock branch uses).
2. In the SERVICE (`DeleteAgent`), so both server modes are covered: an AGENT caller with
   `hard: true` or `deleteFolder: true` is refused; only the system owner may hard-delete.
3. Cemetery purge (`DELETE /api/agents/cemetery`) is system-owner only. Read the POST handler
   first to learn what it does before deciding its gate; if it is restore, it is system-owner only
   too ("resurrected by the user maestro").

## Verification

Per title x {own team, other team} x {soft, hard}: assert the decision, and assert on the refusal
path that the cemetery archive still exists. Neuter each guard separately. Run the headless twin.

## Acceptance

- [ ] READ FIRST: does `DeleteAgent` already refuse an agent's `hard: true`? Record the file and line either way
- [ ] READ FIRST: what `POST /api/agents/cemetery` does, and who may call both cemetery verbs today
- [ ] COS own-team soft delete allowed; COS other-team denied; MEMBER denied; self-delete still denied
- [ ] Agent hard delete and agent folder delete refused in the service, cemetery archive intact
- [ ] Cemetery PURGE is user-only (entailed: a purged corpse cannot be resurrected). Cemetery RESTORE: gate NOT ruled — ask before restricting it
- [ ] Each guard neutered, red set recorded; headless path exercised
- [ ] Hard delete requires BOTH the MAESTRO user (the system owner when the user-authority model is off; test both flag states) AND a sudo token a human obtained by re-entering the password. Verify the token check on three surfaces, not just the Next route that already has it: the headless path, cemetery purge, and whichever verb the user confirms as "hard-kill"
- [ ] USER ANSWER recorded: is a process-level session kill a "hard-kill" reserved to the user, or may MANAGER / own-team CHIEF-OF-STAFF do it?

## Approval log

- 2026-10-05 — MANDATE issued by USER (min-approval-requirement: user), relayed and filed by main-agent@ai-maestro. The ruling quoted under Problem is the mandate; no approval request was sent.
- 2026-10-05 — USER RULING (general rule on hard-kill), verbatim: "in general hard-kill is strictly reserved to the user maestro. it also needs a sudo confirmation from the user." Consequences: no agent, under any title, may hard-kill or hard-delete; the hard path is system-owner only AND requires a sudo token. This settles the reading that agents are soft-only.
- 2026-10-05 — CORRECTION by main-agent@ai-maestro to the two entries above. Only the QUOTED sentences are the user's. Everything after "Consequences:" is my INTERPRETATION and is UNCONFIRMED. Specifically NOT ruled: (1) whether a process-level session kill (`delete-session`: POST /api/sessions/[id]/kill and the two session DELETEs) counts as "hard-kill" — if it does, it is user-only and the phrase "RULED grant" above is wrong; that row stays at status quo, flagged, until the user answers. (2) Whether cemetery RESTORE is user-only — the user said the user "can always" resurrect, not that others cannot. (3) "system owner" was used for "the user maestro" without checking how the two relate when the user-authority model is on. ENTAILED by the quotes and safe to build: CHIEF-OF-STAFF may delete an agent of its own team (a privilege widening); agents may only soft-delete; hard delete is the user's and needs sudo; cemetery purge is the user's. The question is with the user.

## Approval log

- 2026-10-05T01:29:48+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
