---
trdd-id: KO4TQCJ0
title: A new agent at a reused workdir can resume the previous agent's conversation
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: backburner
created: 2026-07-30T12:54:45+0200
updated: 2026-07-30T12:54:45+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T12:54:45+0200
derived: true
derived-kind: eht
parent-trdd: 0GCIMQ9F
relevant-rules: [R51]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

The EHT of TRDD-0GCIMQ9F's Shape-A ruling: removing DeleteAgent's `~/.claude/projects/` purge
closed a recursive delete of the user's data and, in exchange, made an existing hole reachable on
one more path. This card owns that hole. **It is NOT a regression introduced by the removal** — it
was already true for every SOFT delete, which is the default and the only one that keeps a cemetery
archive.

NEXT ACTION: decide whether the fix belongs at the RESUME decision (cheap, ours) or at transcript
identity (correct, blocked on Claude Code's path-keyed storage). Read `lib/claude-conversation.ts`
first — `hasPriorConversation` is the whole surface.

## Problem

Claude Code keys transcripts by **working-directory path**, not by agent:
`~/.claude/projects/<abs-path-with-slashes-as-dashes>/*.jsonl`. Agent identity does not appear in
that path at all.

So when agent A at `~/agents/alpha` is deleted and a NEW agent B is created at the same
`~/agents/alpha`, B's workdir slug is A's workdir slug. `hasPriorConversation(workdir)` returns
true, and the restart routes (`app/api/sessions/[id]/restart`, `app/api/sessions/me/restart`) plus
`boot-restore-service` append the client's resume verb — so **B resumes A's conversation**.

Verified 2026-07-30 by reading the call graph, not by grep: `hasPriorConversation` has exactly two
route callers and reaches the boot path via `decideResume`. Nothing consults agent identity on the
way.

Two things this is NOT:

- **Not new.** A soft delete (the default, and the only kind that archives to the cemetery) never
  purged transcripts, so the reuse path has always inherited. Removing the hard-delete purge widened
  it from "usually" to "always".
- **Not fixed by deleting the transcript.** That is the thing TRDD-0GCIMQ9F just ruled out: it is
  the user's data, in another tool's directory, and Claude Code already owns its retention.

## Proposed fix — two shapes, and the cheap one is not obviously wrong

**Shape 1 — gate the RESUME decision on agent identity (ours, cheap).** Record on the agent, at
creation, whether it is entitled to a transcript that predates it: e.g. `transcriptEpoch` = the
agent's `createdAt`. `hasPriorConversation` then requires at least one `.jsonl` whose mtime is at or
after that epoch. A newly created agent at a reused path finds only older files and launches fresh;
a restarted agent finds its own and resumes. No user data is touched, and the whole change is inside
`lib/claude-conversation.ts` plus one registry field.

**Shape 2 — per-agent transcript identity (correct, blocked).** What CLAUDE.md already records as
TRDD-1ee4a3c1 Phase 4: chat history is not portable today *because* it is path-bound. A real fix
needs Claude Code to key transcripts by something we control, or needs each agent to own a distinct
path. Out of our hands.

Shape 1 is a filter over someone else's data, which is exactly the posture the parent ruling
endorses (read the owner's files, never write them). Its risk is the opposite of a delete: if the
epoch is wrong, an agent launches FRESH when it could have resumed — recoverable, and visible.

## Verification

- A unit test in which two agents share a workdir: the second, created after the first's transcripts
  were written, must NOT resume. Proven by a neuter run (drop the epoch comparison → that test reds).
- The existing `tests/unit/cross-client-resume.test.ts` stays green: a restart of the SAME agent must
  still resume, which is the behaviour TRDD-NIU5RQ1S shipped and this must not undo.
- No test may read or write the developer's real `~/.claude/projects/` — the fixture supplies the
  directory, as `tests/unit/startup-guards.test.ts` does for `$HOME`.

## Estimated risk

MED. The failure mode of getting it wrong is a lost conversation resume, not lost data — but
`decideResume` is on the boot path for every agent on the host, so a mistake is fleet-wide.

## Approval log

- 2026-07-30T12:54:45+0200 — MANDATE (self, min-approval-requirement: none). Derived EHT of
  TRDD-0GCIMQ9F; in-scope dev work, no governance surface, so it is born approved. Authored at the
  moment the parent's ruling made the consequence reachable, rather than absorbed silently into that
  change — a removed guard whose cost is written only in a code comment is a cost nobody tracks.
