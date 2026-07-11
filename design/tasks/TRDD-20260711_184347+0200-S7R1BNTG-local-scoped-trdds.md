---
trdd-id: S7R1BNTG
title: LOCAL-scoped TRDDs — a machine-private task corpus beside LOCAL memory
column: dev
created: 2026-07-11T18:43:47+0200
updated: 2026-07-11T18:43:47+0200
current-owner: claude-ai-maestro
assignee: claude-ai-maestro
priority: 1
severity: MEDIUM
effort: S
labels: [trdd, governance, scope, janitor, cross-repo]
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
parent-trdd: null
npt: []
eht: []
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [typecheck, unit]
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 1
test-failures: 0
last-test-result: not-run
last-test-at: null
implementation-commits: [00c9c25a]
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/84", "https://github.com/Emasoft/ai-maestro-janitor/issues/73"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

The SPEC below is the deliverable. The **IND rule it amends is owned by the
ai-maestro-janitor repo**, not this one, so per the cross-project rule ai-maestro does NOT
edit it — the spec is filed as janitor issue #84.

**REVISED TWICE, and the janitor's Claude was right BOTH times.**

1. The first version put the local root IN the repo (`.claude/local-tasks/`, gitignored). The
   janitor proposed `~/.claude/projects/<slug>/` — outside the repo, beside LOCAL memory —
   and that is what shipped. See "The root: outside the repo" below.[^2]
2. The second version kept a `scope:` FRONTMATTER FIELD. The janitor pointed out (#58) that
   **scope IS the path**, so the field is a second source of truth with nothing to buy. Also
   correct; §1 is rewritten and the field is gone.[^3]

§8 now carries the rulings on the five questions their implementation surfaced.

ai-maestro's in-repo half (a `.gitignore` entry + a `MANAGED_GITIGNORE_ENTRIES` entry) was
therefore REVERTED — there is nothing in-repo left to ignore.

## The problem (raised by the janitor's Claude)

TRDDs are project-scoped: `<project>/design/`, git-tracked, pushed, shared with every
contributor. So there was **nowhere to plan a LOCAL chore** — maintenance of files, caches,
or memories belonging to THIS instance of the machine. Those tasks are real and recurring
(re-index the memgrep DB, purge the trashcan, repair a drifted rule install, rotate a
credential), and they were being done ad-hoc because the one planning artifact the system
has could not represent them.

The USER's ruling: **a TRDD may be LOCAL-scoped.** The pillar was never the problem; the
missing piece was a non-git-tracked root to put them in.

## THE SPEC

### 1. Scope IS the path — there is NO `scope:` frontmatter field

A TRDD's scope is determined **solely by which root it lives under**, exactly as a memory
note's scope is. There is no `scope:` field to set, to read, or to get wrong.[^3]

```
<repo>/design/…                       ⇒ PROJECT
~/.claude/projects/<slug>/design/…    ⇒ LOCAL
```

A field that merely restates the path would be a second source of truth, free to disagree
with the filesystem — and the two would eventually disagree, because a promotion (§5) moves
the file and nothing forces the field to follow. It would also buy nothing: a query already
knows which root it searched.

### 2. Root by scope — same lifecycle, different root

| scope | root | git |
|---|---|---|
| `project` | `<project>/design/` | **tracked + pushed** — every contributor sees it |
| `local` | `~/.claude/projects/<slug>/design/` | **outside the repo — cannot be committed** |

`<slug>` is the project's absolute path with `/` → `-` (e.g.
`-Users-me-ai-maestro`) — the SAME slug the LOCAL memory scope already uses, so the two local
corpora sit side by side under one local-scope root:

```
~/.claude/projects/<slug>/
├── memory/          <- LOCAL memory  (already exists)
└── design/          <- LOCAL design  (new — mirrors <repo>/design/ exactly)
    ├── proposals/
    ├── tasks/       <- OPEN local work (incl. blocked and failed — failed is retryable)
    ├── archived/    <- completed · cancelled · superseded
    └── refused/     <- proposals never approved
```

Naming it `design/` rather than `tasks/` is what avoids a `tasks/tasks/` path once the four
lifecycle folders go inside, and it makes the local root a byte-for-byte mirror of the
project root's — so every existing rule, protocol and tool works by swapping ONE path and
nothing else.

### 3. Scope routing — decide BEFORE authoring (mirrors the memory-scope rule)

Ask: **"would this task be TRUE and USEFUL for a contributor who clones this repo on a
DIFFERENT machine?"**

- **No → LOCAL.** Red flags, each of which forces local: an absolute `$HOME` path, a
  hostname, a username, a credential or token, "on THIS machine", a specific install/cache
  state, anything about a plugin's own runtime data dir.
- **Yes → PROJECT.**
- **UNSURE → LOCAL.** Local is the safe scope; promoting local→project later is a
  deliberate act, whereas a leaked machine-private TRDD is already pushed.

A task may SPLIT: the machine-agnostic work as a PROJECT TRDD, the per-machine state as a
LOCAL one, cross-linked.

### 4. Approval

A local TRDD is **`min-approval-requirement: none`** by default — it is a chore on the
user's own machine and there is no MANAGER for that. The exception is the same one that
always applies: if the task is **destructive or irreversible on the user's machine**
(rotating a credential, deleting a store, purging history), it is
**`min-approval-requirement: user`** and lives in the local root's `proposals/` until the
USER approves. That is why the local root keeps `proposals/` and `refused/` rather than
being a flat folder.

### 5. Ids and citation — unchanged, but the collision check widens

- The id stays the 8-char UPPERCASE base36 `TRDD-<id8>`, and stays **unique across BOTH
  roots of a project**. The create-time collision check MUST scan `<repo>/design/**` AND
  `~/.claude/projects/<slug>/design/**`, or a citation stops being unambiguous — which is
  the one property the whole citation grammar rests on.
- **A LOCAL TRDD may cite a PROJECT TRDD** (`parent-trdd`, `blocked-by`, `npt`, `eht`).
- **A PROJECT TRDD MUST NOT cite a LOCAL one.** It would be a dangling reference for every
  other contributor — they can never resolve it, because the file does not exist in their
  clone. This is the one hard invariant the scope split introduces, and a linter can check
  it with a grep.

### 6. Kanban

One board, `scope` as a filter/badge — not a second board. A local card renders like any
other; the columns and transitions are identical. `findtrdd`/`kanban` take the root(s) to
scan; default = both.

### 7. No gitignore needed — and that is the point

Nothing is written inside the repo, so there is no ignore entry to maintain, in this repo or
in any other. A repo the janitor merely visits is **not mutated at all**.

### 8. Rulings on the five questions the janitor's implementation surfaced (#58)

**Q1 — `TRDD_PATH` override.** PROJECT honors it (existing behaviour; the design root is the
parent of the configured tasks dir, and the other three lifecycle folders travel with it).
**LOCAL never honors it.** The janitor's instinct is right and the reason is stronger than
"a typo could take the board down": LOCAL is the scope that must still resolve when the
project's own configuration is absent, broken, or untrusted. A root derived from the project
slug is computable from the path alone; a root read from project config inherits every way
that config can be wrong. Derivation, not configuration.

**Q2 — Containment.** Confirmed: the escape check (reject absolute / `../`) exists to stop a
**user-supplied string** from escaping the repo. It is not a general law that TRDDs live
inside the repo, so it does not apply to LOCAL — being outside the repo IS the scope.
LOCAL's containment is a different and stricter one: the root must be **exactly**
`~/.claude/projects/<slug>/design/` with `<slug>` from `project_slug()` — no env var, no
config, no override. Nothing to escape from, because nothing is supplied.

**Q3 — Promotion LOCAL → PROJECT.** Plain `mv` (LOCAL is not in git, so `git mv` has nothing
to remove), and the id is **kept** — ids are globally unique, so nothing collides and every
existing citation keeps resolving. One thing the mechanical move misses, and it is the whole
non-trivial part: **check the citations before promoting.** A PROJECT TRDD must never cite a
LOCAL one (§5), so any `parent-trdd` / `blocked-by` / `npt` / `eht` on the promoted file that
still points into LOCAL becomes a dangling reference for every other contributor the instant
it lands in the repo. Promotion is therefore `mv` **plus** resolving those edges — promote
them too, or drop them. Demotion (PROJECT → LOCAL) is legal but only when nothing in PROJECT
cites the file, for the same reason in reverse.

**Q4 — Approval tiers in LOCAL.** Neither of the two offered answers — it is a third.
A LOCAL TRDD is `min-approval-requirement: none` **by default** (a chore on the user's own
machine; there is no MANAGER for that, and a self-mandate is the honest description). The
exception is real and is why the folder exists: a task that is **destructive or irreversible
on the user's machine** — rotate a credential, purge a store, rewrite history — is
`min-approval-requirement: user` and waits in the LOCAL `proposals/` until the USER approves,
landing in `refused/` if they decline. So LOCAL *does* use `proposals/`; it just uses it
rarely, and the approver is always the human.

**Q5 — Detector visibility.** Surface them, as first-class work items — that is what "local
tasks are essential" means, and drift lines never leave the local session so there is nothing
to leak. Two conditions: (a) **label the scope in the output**, because a LOCAL and a PROJECT
card are otherwise indistinguishable while their remediation differs (one is committed, one
cannot be); (b) the session-start / pre-compact handoffs that enumerate in-progress TRDDs
should enumerate **both** roots, or a compaction will quietly drop half the board.

**Q6 (not asked, but load-bearing) — the collision check must scan BOTH roots.** The id is
what makes a citation unambiguous, and it is unique per PROJECT, not per root. A create-time
check that scans only one root can mint a duplicate. The janitor's `trdd_files()` already
returns files across both scopes, which is the primitive this needs.

## The root: outside the repo (and why my first answer was wrong)

I first specified `<project>/.claude/local-tasks/` — in the repo, gitignored. The janitor's
Claude counter-proposed `~/.claude/projects/<slug>/`, beside LOCAL memory. It is right, on
three grounds I had underweighted:

1. **`git clean -fdx` destroys a gitignored in-repo folder.** It is a routine command. A
   local TRDD is planning work — it is NOT regenerable, and losing it is losing the plan.
2. **An in-repo root forces us to mutate repos we do not own.** The janitor runs in arbitrary
   projects; my design required writing an ignore entry into each one just to hold our own
   scratch. Outside the repo: zero mutation, zero bootstrap, zero failure mode.
3. **Symmetry.** LOCAL memory already lives at `~/.claude/projects/<slug>/memory/`. A second
   local corpus belongs in the same local-scope root, not a different one.

My argument FOR in-repo was that tooling would otherwise have to compute the slug. That is
three lines of shell the memory recall protocol already runs — a weak reason, and it did not
survive contact with the three above.[^2]

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] The janitor's Claude concluded "TRDDs cannot express
  local chores" from the fact that the only defined ROOT was git-tracked. The pillar was
  fine; one missing directory was doing all the damage. When a system "cannot represent X",
  check whether the model actually forbids X or whether a single unstated default is
  masquerading as the model.

[^3]: [ocd:2026-07-11 lmd:2026-07-11] This spec originally defined a `scope: project | local`
  FRONTMATTER FIELD. That was wrong, and the janitor's Claude caught it (ai-maestro#58):
  **scope IS the path**, so a field restating it is a second source of truth that the
  filesystem is free to contradict — and would, at the first promotion, since `mv` moves the
  file and nothing makes the field follow. What stings is that I had *written the rule that
  forbids this* days earlier, in the DEP overlay: *"A field that restates another is a second
  source of truth waiting to disagree with the first."* I applied it correctly to `status:`
  and `archived:` (declining both), then added `scope:` without running the same test. The
  test that decides it is one question — **does this field enable a query the derived value
  cannot?** `approved:` and `derived:` earn their denormalization (a one-pass grep across a
  corpus). `scope:` earns nothing: a query always knows which root it searched. Lesson: a rule
  you authored is not a rule you have internalized. Run your own checklist against your own
  new work, especially when the new work feels obvious.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] I picked the WRONG PRECEDENT and the whole design
  followed it off a cliff. I reasoned "the janitor's per-project state lives in-repo and
  gitignored at `.janitor/state/`, so a local task corpus should too" — but `.janitor/state/`
  is REGENERABLE runtime state, and a TRDD is irreplaceable planning work. The right
  precedent was LOCAL *memory*, which was deliberately placed OUTSIDE the repo for exactly
  this reason. Lesson: when you justify a location by precedent, check that the precedent
  shares the property that MATTERS (here: recoverability), not merely the property that is
  salient (here: "machine-local and gitignored"). A gitignored in-repo directory is not a
  safe place for anything you cannot rebuild — `git clean -fdx` is one keystroke away.
