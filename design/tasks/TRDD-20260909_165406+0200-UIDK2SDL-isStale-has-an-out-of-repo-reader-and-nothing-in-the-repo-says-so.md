---
trdd-id: UIDK2SDL
title: isStale has an out-of-repo reader in the janitor and nothing in this repo says so
column: todo
created: 2026-09-09T16:54:06+0200
updated: 2026-09-09T16:54:06+0200
current-owner: unassigned
created-by: governance-rules-session
assignee: unassigned
task-type: docs
min-approval-requirement: none
approved: true
approval-judge: governance-rules-session
approval-datetime: 2026-09-09T16:54:06+0200
labels: [oauth-rotator, cross-repo, comment-only]
external-refs: [TRDD-WLHP34KZ, TRDD-W11LAPSC]
---

# isStale has an out-of-repo reader in the janitor and nothing in this repo says so

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

QUEUED, not done. **Filed because the decision was living only in a chat reply with a compaction
imminent** — which is the third option `new-directive-never-drops-the-old-work` forbids: neither
queued nor delegated. The card is the QUEUE ENTRY for the comment. **It is not a substitute for
it:** someone editing `isStale` sees the file, not `design/`. Do not let this card's existence
feel like the hazard is closed.

REQUESTED BY the ai-maestro-janitor session (cross-session message, 2026-09-09), NOT by the
owner. A peer cannot authorise a source change in this repo, which is why nothing was written.

NEXT ACTION: owner says yes or no to a one-line comment. Nothing else in this card needs doing.

## Problem

`lib/server-lockfile.ts` `isStale()` treats an empty or corrupt lockfile as RECLAIMABLE
(`parseInt` → `NaN` → `return true`), and `createExclusive`'s `finally` deliberately leaves an
empty, therefore stale, lock if the write throws.

REPORTED by the janitor session, not verified here: their `server_tick_holder()` returns `None`
for an empty or corrupt lockfile, and that is safe ONLY because this side reclaims such a file.
They matched their observer to this predicate rather than being stricter than it, because
treating an empty lockfile as HELD would deadlock their importer permanently whenever a throwing
write left one behind and no server tick came to reclaim it.

**The failure mode, if `isStale` is ever hardened** — a defensible change on its own terms, e.g.
"an empty lockfile might mean a writer is mid-write, so wait":

- their importer would write straight through a lock this tick is respecting;
- **nothing on either side detects it.** Their tests stub the state dir and never read a real
  lockfile, so no test, lint or CI run on either side can fail on it;
- the boundary is currently held by nothing but a cross-session transcript, which no future
  editor of that file will ever see.

## Proposed fix

One comment above `isStale`, naming the out-of-repo reader — enough that the person editing the
predicate learns the dependency exists. No behaviour change, no test change. Something like:

    // OUT-OF-REPO READER: the ai-maestro-janitor's `server_tick_holder()` mirrors this
    // predicate — it returns None for an empty/corrupt lockfile *because* we reclaim one.
    // Hardening this to treat an empty file as HELD would let their importer write through a
    // lock we are respecting, and NO test on either side can catch it (theirs stub the state
    // dir). Message that project before changing this.

## Verification

None possible and none pretended: a comment changes no behaviour, so no test can pin it. The
honest check is that the string is present, which is what a reader needs and all a reader needs.
Deliberately NOT proposing a test — a test asserting a comment's presence would be decoration.

## Risk

NONE to this repo (comment-only, no behaviour, no bundle dependency). The risk is in NOT doing
it, and it is borne by the other project.

## Acceptance

- [ ] owner rules yes or no
- [ ] if yes: the comment added above `isStale` in `lib/server-lockfile.ts`
- [ ] if yes: janitor told, so their docstring can stop being the only record on either side
- [ ] if no: this card CLOSED as declined and the janitor told, so they stop relying on a
      boundary this repo has decided not to mark

## Approval log

- 2026-09-09T16:54:06+0200 — Authored directly in `design/tasks` as a Tier-0 self-mandate. D3
  floor is `none`: docs-only, reversible, local, no governance change, no credential, no
  `.github/`. The CONTENT was requested by a peer session; a peer cannot approve anything here,
  and the card exists precisely so the owner — not the peer, and not me acting on the peer's
  ask — decides whether this repo's source gets the comment.
