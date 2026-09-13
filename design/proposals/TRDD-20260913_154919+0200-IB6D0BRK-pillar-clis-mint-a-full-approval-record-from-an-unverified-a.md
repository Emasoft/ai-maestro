---
trdd-id: IB6D0BRK
title: Pillar CLIs mint a full approval record from an unverified --approver string
column: proposal
created: 2026-09-13T15:49:19+0200
updated: 2026-09-13T15:49:19+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: security
min-approval-requirement: user
scope: project
project-id: ai-maestro
approved: false
---

# Pillar CLIs mint a full approval record from an unverified --approver string

## Problem

`trddgrep move <id> <column> --approver X` does NOT verify X. It accepts whatever string the caller supplies and writes a COMPLETE approval record from it.

MEASURED 2026-09-13 against commit 9e90a4ec. A single invocation with `--approver user` added all of:

    +approved: true
    +approval-judge: user
    +- <ISO> — APPROVED by user (min-approval-requirement: user). <caller-supplied reason>

Every one is a `+` line in that commit's diff. None existed beforehand.

## Why this matters

NOT a privilege boundary when run standalone, and an earlier draft of this card overstated it as "the CLI-side twin" of the route defect fixed in 25e5fc97. That framing does not transfer: the route case is remote-input-shaped, where a caller supplies the approver field over the network and the server prefers it over its own derived identity. The CLI runs AS the user, on the user machine, writing a file that same user can edit directly. What IS true, and is why this card stands: (1) the approval fields are unauthenticated BY CONSTRUCTION while the D4 watchdog is specified to read approval-judge when checking the mandate invariant, so a governance system cannot verify its own audit trail; (2) IN-HARNESS the boundary is real, since a registered agent holding the harness AID credential crosses one. Whether any code actually performs the D4 comparison is UNVERIFIED - read from the overlay rule prose, not from the implementation.

The pillar CLIs derive no actor at all — a symbol search for group or identity handling in the tool implementation returns nothing, the launcher execs node with no identity plumbing, and the env verb self-reports mode=standalone.

So the approval fields, which the entire approval-tier system rests on, are caller-assertable by anyone who can run the binary.

## Scope note

Discovered by using the defect on the very card filed against it. The approval recorded on G6EBLBIQ by 9e90a4ec is mitigated by an Approval log line quoting the USER verbatim — auditable prose beside an unauditable field — but the field itself was minted from an unverified string.

## Acceptance

- [ ] Decide whether the pillar CLIs should derive an actor outside the harness, or refuse approval-writing verbs when they cannot.
- [ ] If they derive: identity comes the same way the API gets it after 25e5fc97, so authority is never checked against a caller-supplied name.
- [ ] A test that a bogus --approver is REFUSED, with the expected failing test name written down before the neuter runs.

## Approval log
