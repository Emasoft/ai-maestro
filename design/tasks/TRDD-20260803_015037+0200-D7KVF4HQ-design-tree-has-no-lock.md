---
trdd-id: D7KVF4HQ
title: The design tree has no lock, so a concurrent TRDD state change can desync column from folder
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-03T01:50:37+0200
updated: 2026-08-03T01:50:37+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-03T01:50:37+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [trdd-tooling, concurrency, project-scope-sharing]
external-refs: [Emasoft/ai-maestro#57]
---

# The design tree has no lock, so a concurrent TRDD state change can desync column from folder

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-03

Surfaced answering the MAINTAINER's Q3 on `#57` ("tell me the locking/ownership model for
`project-scope-sharing`, or confirm there is none"). Measured, not assumed: **there is none.**

`withLock` is used consistently across the server, and every key is a JSON store:

```
agents · amp-api-keys · amp-index · documents-<teamId> ·
governance-requests · governance-tokens · tasks-<teamId>
```

```bash
grep -rn 'withLock(' lib/ services/ | grep -ci design   # → 0
```

**Zero locks cover the `design/` tree.** Today this is latent because one agent works the board at a
time. It stops being latent the moment two agents share one project folder, which is exactly the
`project-scope-sharing` shape the fleet migration is heading for.

**NEXT ACTION:** review the MAINTAINER's lock proposal (requested on `#57`) against the server's
`withLock` semantics, so the two models do not diverge into two answers about what is locked. If no
proposal arrives, write one here.

## Why this is worse than a generic lost update

A TRDD state change is **two operations that must be atomic together**:

1. the `column:` frontmatter edit, and
2. the `git mv` between zone folders (`proposals/ tasks/ archived/ refused/`).

A lost update on a JSON store drops an edit — recoverable, and obvious. A lost update here can leave a
card whose **column and whose folder disagree**, which is precisely the corrupt state the zone layout
exists to make impossible, and which the doctor then reports as a ZONE-MISMATCH finding with no way to
tell which half was the intended one.

That asymmetry is the argument for locking the pair rather than the file.

## Constraints any proposal must satisfy

- **The unit of exclusion is ONE TRDD, not the tree.** A tree-wide lock serialises two agents working
  unrelated cards for no reason, and a lock people route around is worse than none.
- **The lock must span the edit AND the move.** Holding it for only one half reintroduces the exact
  mismatch, under a lock that reads as correct — the most expensive possible outcome.
- **It must compose with `withLock`'s semantics**, not invent a second locking vocabulary. Two locking
  models over one project is how you get two answers to "is this card being written".
- **Crash safety:** a process killed mid-move must leave a state the doctor can classify, not a card
  in neither zone.

## Verification

```bash
grep -rn 'withLock(' lib/ services/ | grep -c design    # must be non-zero when done
```

A test must pin the interleaving directly, not by racing: hold the lock, assert the contender **cannot
complete**, release, assert it then does. A test that fires N concurrent writers and asserts all
survive passes with the lock removed — whether the losing interleaving occurs is the scheduler's
choice, not the test's. And the release-then-completes half is a mandatory positive control, since
"did not complete" is equally satisfied by a contender that threw or was never called.

## Estimated risk

MEDIUM. Introducing a lock on a path many tools touch (the doctor, `trddgrep`, the fixer, any agent
editing a card by hand) risks serialising or deadlocking work that is fine today. A per-TRDD key and a
timeout are what keep that bounded — and a hand edit outside the tooling will not take the lock at
all, which is a limit to state rather than to hide.

## Acceptance

- [ ] a lock model exists covering the `column:` edit + the `git mv` as one unit
- [ ] key is per-TRDD, not tree-wide
- [ ] it uses the existing `withLock` primitive rather than a second mechanism
- [ ] crash mid-move leaves a doctor-classifiable state
- [ ] the interleaving is pinned deterministically (hold → contender blocked → release → completes)
- [ ] a neuter recorded showing which test the lock's removal reddens

## Approval log

- 2026-08-03T01:50:37+0200 — SELF-MANDATE (min-approval-requirement: none). Infra inside this repo's
  own design tooling; no baseline deviation, no frozen interface touched, reversible. Sourced from the
  `Emasoft/ai-maestro#57` verification pass; no approval request was sent.
