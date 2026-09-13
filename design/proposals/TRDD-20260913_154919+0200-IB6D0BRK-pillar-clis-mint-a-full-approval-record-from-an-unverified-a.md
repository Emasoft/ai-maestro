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

This is the CLI-side twin of the defect TRDD-G6EBLBIQ was filed about: the approve and refuse ROUTES preferred a caller-supplied approver field over the derived auth identity, while the signed proof beside it was correctly derived. That was treated as a security defect and fixed in 25e5fc97.

The pillar CLIs derive no actor at all — a symbol search for group or identity handling in the tool implementation returns nothing, the launcher execs node with no identity plumbing, and the env verb self-reports mode=standalone.

So the approval fields, which the entire approval-tier system rests on, are caller-assertable by anyone who can run the binary.

## Scope note

Discovered by using the defect on the very card filed against it. The approval recorded on G6EBLBIQ by 9e90a4ec is mitigated by an Approval log line quoting the USER verbatim — auditable prose beside an unauditable field — but the field itself was minted from an unverified string.

## Acceptance

- [ ] Decide whether the pillar CLIs should derive an actor outside the harness, or refuse approval-writing verbs when they cannot.
- [ ] If they derive: identity comes the same way the API gets it after 25e5fc97, so authority is never checked against a caller-supplied name.
- [ ] A test that a bogus --approver is REFUSED, with the expected failing test name written down before the neuter runs.

## Approval log
