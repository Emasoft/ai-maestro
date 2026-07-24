---
trdd-id: 2X4AYX9T
title: GitHub coordination on the daemon absorption issues 79 and 100
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:32:56+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: coordinate the daemon-chore absorption with the janitor via GitHub comments, posting
per-chore "now running" as D1-D6 land. **CORRECTION:** the plan's `#79` is STALE (that number is
now a CLOSED, unrelated "PreToolUse nudges" issue). The live coordination thread is **janitor#100**
("[COORDINATION] ai-maestro absorbs the daemon's functions", OPEN, 27+ comments).

**PROGRESS 2026-07-24:** posted the D1+D2+D5 "now server-native" comment on **janitor#100**
(comment-5071270871): oauth tick+supervisor+cookie-vault + freeze-recovery/dead-debounce are
server-native (ported from the v0.60.1 cache per the owner's "port line-by-line" directive), the
daemon-exits-on-freshness grounding (daemon.py:2032), the read-only control-plane contention, the
R16-INERT caveat, and the ONE ASK that unblocks D4 (confirm the `marketplace-op.lock` filename/path).
**COMPLETE 2026-07-24** — the closing comment for D4 + D6 is posted
(janitor#100 `issuecomment-5073681789`). It reports all 7 chores server-native with the live
evidence (restart, timers, zero `daemon.py`), tells the janitor it can retire the stopgaps for
chores 6-7, and carries the FINDING the build surfaced:

`marketplace-op.lock` lives at `global_state_dir()/marketplace-op.lock` (`global_state.py:433`),
NOT in the control dir — while the janitor's OWN comment above `control_dir()` says the
`global_state_dir()` ladder "is exactly what such a reader cannot reproduce" and that the failure
is SILENT. That is why the six mode flags and `oauth-rotator-tick.lock` were moved there;
`marketplace-op.lock` was not. The ASK is to move it (or alias it).

The comment is also honest about a limit the janitor cannot see from its side: even after the
move, Node cannot join a `fcntl.flock(2)` without a native addon (ABI-constrained), so byte-level
lock sharing stays impossible — and it offers a mechanism both runtimes COULD honor (atomic
directory-create / rename) if true cross-process exclusion is wanted.

No further posts are owed by this TRDD; a future chore's coordination is a new one.

## Spec

- Ack reading/contending on `~/.claude/janitor-control/`; confirm routing (a); post a per-chore
  "now running: yes" as each of D1-D6 lands so the janitor retires that stopgap; state we are
  porting from the v0.60.1 source rather than waiting for a curated snapshot.

## Acceptance

- [x] Comments posted as chores land — D1+D2+D5 in `comment-5071270871`; D4+D6 (and the
      lock-path finding + ask) in `issuecomment-5073681789`. All 7 chores reported.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T17:00:00+0200 — ai-maestro posted the D1+D2+D5 coordination comment on janitor#100 (corrected from the stale #79). Stays open (dev) for D4/D6.
- 2026-07-24T21:32:56+0200 — COMPLETED by ai-maestro (self-mandate). Posted the D4+D6 closing comment with the live evidence, the stopgap-retirement notice, and the `marketplace-op.lock` control-dir ask. dev → complete.
