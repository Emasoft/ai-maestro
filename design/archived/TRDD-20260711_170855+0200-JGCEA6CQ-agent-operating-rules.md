---
trdd-id: JGCEA6CQ
title: Ship a tiny operating-rules file to every agent workdir
column: complete
created: 2026-07-11T17:08:55+0200
updated: 2026-08-01T22:50:24+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 1
severity: MEDIUM
effort: S
labels: [dep-rules, agent-behavior, migration-readiness, token-economy]
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
parent-trdd: null
npt: []
eht: [TRDD-VYQ8N4KR]
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, typecheck, lint]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T17:20:00+0200
implementation-commits: [8e61eedf, 95451222]
external-refs: ["design/tasks/TRDD-20260707_232304+0200-DE9757LJ-split-governance-rules-ind-dep.md", "design/tasks/TRDD-20260711_162304+0200-IXUV1XHD-createagent-mints-unwakeable-agents.md"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Done.** Every agent workdir now receives `rules/aimaestro/aimaestro-agent-rules.md`
— 1,841 bytes, ~14 one-line rules — via the DEP-rule seeder, plus a new **boot sweep**
so the rules reach agents that are never woken. 14/14 unit tests pass.

## The problem

The rules an agent needs to behave correctly *inside the harness* existed nowhere it
could read them. They were spread across the server's own CLAUDE.md, this repo's
TRDDs, and the head of whoever was debugging that day. An agent in `~/agents/<name>/`
loads its `.claude/rules/` and its role-plugin, and neither told it: retry a transient
failure, don't call the API directly, don't claim success on a degraded outcome. So
every agent had to rediscover — or not rediscover — each of these the hard way.

The retry rule is the worked example. TRDD-IXUV1XHD shipped a one-shot network install
that a single DNS blip could turn into a permanently broken agent, and I diagnosed it
by *explaining* rather than *reproducing*. Two rules would have prevented both halves.
That is what this file is: the lessons, as instructions, in the agent's own context.

## Why a file, and why a TINY one

Everything in `.claude/rules/` is injected into the agent's context on **every turn**.
The cost of a rule file is therefore `size × turns × agents` — the one dimension that
matters is size, and the one failure mode is growth. A rule file nobody bounds accretes
prose until it is the largest thing in the context it was meant to keep small.

So the file is governed by three constraints, all enforced by
`tests/unit/agent-operating-rules.test.ts`:

1. **A hard 2,200-byte budget.** Tight enough that adding a paragraph trips the test
   and forces the author to ask whether it is worth paying for on every turn of every
   agent, forever. Currently 1,841 bytes (~460 tokens).
2. **One line per rule, ≤220 chars.** A bullet that wraps into continuation lines is a
   paragraph wearing a bullet.
3. **WHAT, never HOW.** "Retry a transient failure with exponential backoff and jitter"
   — the agent picks the base, the ceiling, the jitter. Prescribing the implementation
   is both longer and worse: the agent knows its own failure surface.

## What it says (4 sections, 14 rules)

- **Boundaries** — write only in your workdir and `/tmp`; reach the server only through
  the installed CLI, never its HTTP API; message only what the comm graph permits, route
  through your COS; never weaken a security check or a quality gate.
- **Failure** — retry transient, fail fast on deterministic; reproduce before you
  explain; never report success on a degraded outcome; after two failed fixes, stop and
  re-read.
- **Truth** — one writer per fact; verify before you assert.
- **Work** — a TRDD for a non-trivial change; the WHY in the message and at the change
  site; stage by name, never delete uncommitted, never push unless told; reports to
  `reports/<component>/`, return the path not the content.

It binds subagents too, and says so — an agent must restate it in every subagent prompt.
Subagents are exactly where the harness rules get lost today.

## Tamper-resistance — ai-maestro OWNS the `aimaestro-*.md` name

A rule an agent can edit is not a rule. Three properties, all enforced:

1. **Read-only (0444) on disk.** Written with the mode and re-asserted on every pass,
   so a `chmod +w` with no edit yet — a tamper in progress — is corrected before the
   write lands.
2. **Content restored when it differs.** A rewritten rule is overwritten with the
   shipped bytes. A legitimate app update and tampering are indistinguishable on disk
   and the correct response to both is identical, so no attempt is made to tell them
   apart.
3. **Re-created when deleted.**

This **changed the seeder's ownership contract, deliberately.** The original contract
PRESERVED a same-named file that lacked the `ai-maestro:installed-dep-rule` marker,
treating it as user-owned. That was a bypass with a two-step recipe: strip the marker,
rewrite the rule, and the seeder politely leaves your edit in place forever — letting
the GOVERNED party silently rewrite the rules that govern it. The marker is now
provenance, not a permission gate. A user who wants their own rule uses any other
filename; the `aimaestro-*` namespace is the server's.[^3]

**Honest limit.** Agents share the server's UID, so a determined agent can chmod the
file back and rewrite it. This is **tamper-evident and self-healing, not tamper-proof**:
the read-only bit stops accidents; the restore loop bounds a tamper's lifetime. Real
prevention needs per-agent UID isolation (TRDD-a1019073). This module is not a sandbox
and must not be described as one.

## The delivery — existing rails plus the missing sweep

`lib/agent-rules-seed.ts::ensureAgentRules` already copies every `*.md` from
`rules/aimaestro/` into `<workdir>/.claude/rules/`, marker-gated (`ai-maestro:installed-dep-rule`)
so it refreshes its own files and never touches a user's same-named file. It was already
wired at CreateAgent G05b, at `importAgent`, and at `ensureCorePluginInstalled` (the wake
path). So the file itself needed no new plumbing.

**But all three hooks only fire when an agent is TOUCHED.** An agent that is created and
then never woken never receives a rule the app ships later, and the fleet silently splits
into agents that know a rule and agents that do not — the failure mode is invisible,
because a missing rule looks exactly like an agent that chose to ignore it. So this adds
the periodic check the wiring lacked: `ensureAgentRulesForWorkdirs(workdirs)`, called once
from `server.mjs` startup over every registered non-deleted agent. A rule added to
`rules/aimaestro/` now reaches the whole fleet on the next server start, hibernated agents
included.

The sweep collects failures per workdir rather than throwing: one deleted or unwritable
agent directory must not deprive every other agent of its rules, and nothing about seeding
a data file justifies blocking server startup.[^1]

**The periodic loop this TRDD introduced was immediately superseded — by its own EHT.**
Adding a rules-only watchdog created the Nth-loop problem (one timer per invariant is how
you end up with N timers, N schedules, and N places to look when something did not get
repaired). TRDD-VYQ8N4KR folds it into the single agent-invariants watchdog, where
`dep-rules` is one row alongside every other workdir guarantee. `startAgentRulesWatchdog`
no longer exists; `ensureAgentRules` / `ensureAgentRulesForWorkdirs` remain as the
mechanism it calls.

## The naming decision (the non-obvious part)

The USER's wording was `.claude/rules/ai-maestro-rules.md`. The file shipped is
`aimaestro-agent-rules.md`, because `MANAGED_GITIGNORE_ENTRIES`
(`lib/workdir-gitignore-seed.ts`) ignores exactly `.claude/rules/aimaestro-*.md`. A
hyphen after "ai" would not match that glob, and every adopted project repo — a MAINTAINER
on `~/Code/<project>`, which is the entire point of the migration — would show an untracked
file in `git status` forever. The convention is also what the other four DEP rules and this
repo's own symlinks already use. A test asserts the name matches the glob so the next author
cannot quietly undo it.[^2]

## Verification

- `tests/unit/agent-operating-rules.test.ts` — 9 tests: marker present; size budget; the
  name matches the ignore glob; rules are single lines; the sweep seeds/refreshes/dedupes
  shared workdirs and **isolates a broken workdir** while the healthy one still gets its
  rules.
- `tests/unit/agent-rules-seed.test.ts` — 5 pre-existing tests still green.

## Acceptance
- [x] `rules/aimaestro/aimaestro-agent-rules.md` exists on disk (1841 bytes, under the card's own 2200-byte budget), re-verified live.
- [x] `tests/unit/agent-operating-rules.test.ts` and `tests/unit/agent-rules-seed.test.ts` both exist on disk.
- [x] Its `eht: [TRDD-VYQ8N4KR]` flock is now terminal — VYQ8N4KR is closed to `complete` and archived (closed earlier in this same session), satisfying the completion gate this card was correctly withholding on.
- [x] Commits `8e61eedf` and `95451222` both resolve.

## Approval log
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. This card's completion-gate was
  correctly withholding `complete` while its EHT (TRDD-VYQ8N4KR) was still open —
  that flock is now terminal (closed in this same closure pass), so the gate now
  passes. Re-verified this session: both cited commits resolve;
  `rules/aimaestro/aimaestro-agent-rules.md` exists on disk; both cited test files
  exist.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] A per-entity hook that only runs "when the entity is
  touched" is not a guarantee, it is a coincidence — it silently excludes every entity that
  is never touched. Whenever a fact must hold for ALL members of a set, there has to be a
  path that visits the whole set (a boot sweep, a cron, a migration). Seeding-on-wake looked
  complete because every agent you *test* is an agent you just woke.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] A filename can be load-bearing. `.claude/rules/aimaestro-*.md`
  is a glob in the managed git-exclude block, so the name of a seeded rule is what keeps it
  out of `git status` in someone's real repository. Following the USER's exact spelling would
  have been the *less* faithful choice — it would have dirtied every adopted project. When a
  name has to differ from what was asked, encode the reason in a test, not a comment: the
  comment is advice, the test is a wall.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] A "user-owned file" escape hatch in an enforcement
  mechanism is an authorization hole wearing a courtesy. The seeder skipped any same-named
  file lacking its provenance marker — so the two-step "strip the marker, rewrite the rule"
  made an agent's own governance permanently editable BY that agent. The general shape:
  when the enforcer and the enforced are the same uid, any field the enforced party can
  write is not a permission bit, it is a suggestion. Ownership must be decided by the NAME
  (which the server controls) and not by the CONTENT (which the tamperer controls).
