---
trdd-id: KO4TQCJ0
title: A new agent at a reused workdir can resume the previous agent's conversation
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: complete
created: 2026-07-30T12:54:45+0200
updated: 2026-07-31T07:23:46+0200
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
implementation-commits: [3607d208]
---

## ⏵ CLOSED 2026-07-31 — Shape 1 shipped (authoritative; supersedes everything below)

**DONE.** The hole is closed by a FILTER over the owner's data, never a write to it. Every resume
decision now counts only a transcript last written at or after the agent's own `createdAt`, so a
persona created at a recycled workdir finds nothing it is entitled to and starts fresh, while a
restarted agent still resumes. Landed as `3607d208`.

**THE DESIGN DECISION THAT MATTERED WAS NOT THE COMPARISON — IT WAS WHERE THE EPOCH LIVES.** Five
call sites consult the probe (`services/headless-router.ts` ×2, `app/api/sessions/me/restart`,
`lib/session-relaunch.ts`, and the boot/wake path in `services/agents-core-service.ts`). The obvious
implementation — add an optional `sinceEpochMs` to `hasPriorConversation` and edit each site — is the
shape that fails silently: a forgotten site keeps the bug and NOTHING REDDENS, which is precisely
what `4520ef9a` cost a week earlier ("N-1 of N is indistinguishable from N"). So the epoch travels
inside two helpers that take the AGENT:

| helper | shape | a client with no verified probe |
|---|---|---|
| `agentMayResumeConversation` | the `--continue`-flag builders (4 sites) | **false** — we cannot see its transcripts, so we cannot claim one exists |
| `resolveAgentResumeProbe` | the `decideResume` thunk (boot path) | **null** — "resume anyway", because the CALLER knows if this is a first launch (USER 2026-07-25) |

Two shapes, not one, because that USER ruling makes the two genuinely disagree about an unverified
client. A test then forbids any production import of `hasPriorConversation` outside the module, so
the hand-replicated variant cannot come back by hand.

**DEGRADES OPEN, DELIBERATELY.** No parseable `createdAt` ⇒ no epoch ⇒ exactly the pre-card answer.
Blocking a resume on a missing field would trade a rare wrong resume for a routine lost one, and the
lost turn in flight is the costlier failure — it is the entire reason TRDD-NIU5RQ1S exists.

**Four neuters, each reddening a DISJOINT named set, all restored byte-identical (`diff -q`):**

| neuter | mutation | reds |
|---|---|---|
| A | `st.mtimeMs >= sinceEpochMs` → always true | **2** — the flag shape AND the boot shape |
| B | one call site back to the bare-workdir probe | **1** — the structural guard |
| C | missing `createdAt` returns `Date.now()` | **1** — degrade-open |
| D | `Number.isFinite(t) ? t : undefined` → `t` | **1** — degrade-open on NaN |

No positive control ever red. **Attempt 1 of neuter A was VACUOUS and the grep caught it**: `sed -i ''`
is BSD syntax and this shell has GNU sed, so nothing was mutated and the run read 47/47 green — the
"mutation landed" count is the only reason that did not get recorded as a passing neuter.

**A stale comment fell out of the structural guard on its FIRST run**, in `element-management-service.ts`:
it still named `hasPriorConversation` as "what the restart routes and boot-restore consult" and still
described this card's fix as Shape 2. Corrected in place — a guard that finds documentation drift on
day one is doing the job the citation-rot lessons ask for.

**SUPERSEDED — do NOT carry forward:** the old STATE block's NEXT ACTION ("decide Shape 1 vs
Shape 2"). Shape 2 (per-agent transcript identity) remains out of our hands — it needs Claude Code to
stop keying transcripts by path, tracked as TRDD-1ee4a3c1 Phase 4.

**Verified:** tsc 0 · full suite **309 files / 4425 passed / 2 skipped**, exit 0.

### Acceptance

- [x] Two agents share a workdir; the second, created after the first's transcripts were written,
      does NOT resume — proven by neuter A, which reds that named test (and its boot-path twin).
- [x] `tests/unit/cross-client-resume.test.ts` stays green — a same-agent restart still resumes
      (TRDD-NIU5RQ1S), and `tests/unit/restart-preserves-conversation.test.ts` with it.
- [x] No test reads or writes the real `~/.claude/projects/` — every case supplies its own
      `homedir` under `os.tmpdir()` and removes it in `afterEach`.
- [x] The epoch cannot be dropped by a future hand-edit: no production file outside
      `lib/claude-conversation.ts` may name `hasPriorConversation` (neuter B pins it).

## ⏵ STATE — the design record (2026-07-30; superseded above)

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
- 2026-07-31T07:23:46+0200 — COMPLETED by ai-maestro. Shape 1 shipped as `3607d208`; four neuters
  with disjoint red sets; suite 309/4425 green. Archived per the folder lifecycle.
