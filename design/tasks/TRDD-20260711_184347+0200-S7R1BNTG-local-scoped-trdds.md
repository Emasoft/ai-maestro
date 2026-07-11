---
trdd-id: S7R1BNTG
title: LOCAL-scoped TRDDs — a machine-private task corpus at .claude/local-tasks/
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
implementation-commits: []
external-refs: ["https://github.com/Emasoft/ai-maestro-janitor/issues/73"]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

The SPEC below is the deliverable. The **IND rule it amends is owned by the
ai-maestro-janitor repo**, not this one, so per the cross-project rule ai-maestro does NOT
edit it — the spec is filed as a janitor GitHub issue. What ai-maestro DOES own and has
landed: the gitignore entry + the managed git-exclude entry so `.claude/local-tasks/` is
never committed in this repo or in any adopted agent workdir.

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

### 1. New frontmatter field

```yaml
scope: project | local     # default: project (an absent field means project — back-compat)
```

### 2. Root by scope — same lifecycle, different root

| scope | root | git |
|---|---|---|
| `project` | `<project>/design/` | **tracked + pushed** — every contributor sees it |
| `local` | `<project>/.claude/local-tasks/` | **gitignored, never pushed** |

The local root carries the **identical four lifecycle folders**, so every existing rule,
protocol and tool works by swapping ONE path and nothing else:

```
.claude/local-tasks/
├── proposals/   # a local task that still needs a decision (rare — see §4)
├── tasks/       # OPEN local work (incl. blocked and failed — failed is retryable)
├── archived/    # completed · cancelled · superseded
└── refused/     # proposals never approved
```

`local-tasks/tasks/` is mildly redundant as a name. That is a deliberate trade: a redundant
word costs a reader one second, whereas a divergent lifecycle costs every tool a special
case. Symmetry wins.

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
**`min-approval-requirement: user`** and lives in `local-tasks/proposals/` until the USER
approves. That is why the local root keeps `proposals/` and `refused/` rather than being a
flat folder.

### 5. Ids and citation — unchanged, but the collision check widens

- The id stays the 8-char UPPERCASE base36 `TRDD-<id8>`, and stays **unique across BOTH
  roots of a project**. The create-time collision check MUST scan `design/**` AND
  `.claude/local-tasks/**`, or a citation stops being unambiguous — which is the one
  property the whole citation grammar rests on.
- **A LOCAL TRDD may cite a PROJECT TRDD** (`parent-trdd`, `blocked-by`, `npt`, `eht`).
- **A PROJECT TRDD MUST NOT cite a LOCAL one.** It would be a dangling reference for every
  other contributor — they can never resolve it, because the file does not exist in their
  clone. This is the one hard invariant the scope split introduces, and a linter can check
  it with a grep.

### 6. Kanban

One board, `scope` as a filter/badge — not a second board. A local card renders like any
other; the columns and transitions are identical. `findtrdd`/`kanban` take the root(s) to
scan; default = both.

### 7. Gitignore is part of the spec, not an afterthought

`.claude/local-tasks/` MUST be ignored in every repo that has one. Whoever CREATES the
folder is responsible for ensuring it is ignored:

- **ai-maestro** (landed here): `.gitignore` entry, plus `.claude/local-tasks/` added to
  `MANAGED_GITIGNORE_ENTRIES` (`lib/workdir-gitignore-seed.ts`) so every adopted agent
  workdir gets it in `.git/info/exclude` automatically.
- **the janitor**, when it first writes a local TRDD into an arbitrary repo, must add the
  ignore itself — it runs in projects ai-maestro does not manage.

Note `.git/info/exclude` (not `.gitignore`) for a repo ai-maestro merely ADOPTS: repos
track their `.gitignore`, so writing there dirties the tree we are trying to keep clean.

## Why in-repo (`.claude/local-tasks/`) and not `~/.claude/projects/<slug>/tasks/`

The LOCAL memory scope lives OUTSIDE the repo, so mirroring it was the obvious alternative
and was rejected on two grounds:

1. **Tooling.** Every tool (`findtrdd`, the kanban renderer, a plain `grep`) would have to
   compute the project slug to find the local corpus. In-repo, it is one relative glob
   beside `design/`.
2. **Precedent.** The janitor's own per-project state ALREADY lives in-repo and gitignored
   at `<project>/.janitor/state/`. "Machine-local, project-adjacent, gitignored" is an
   established shape here, not a new one.

The leak risk that pushed MEMORY out of the repo is handled by §7 plus the standing
never-`git add -A` rule.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] The janitor's Claude concluded "TRDDs cannot express
  local chores" from the fact that the only defined ROOT was git-tracked. The pillar was
  fine; one missing directory was doing all the damage. When a system "cannot represent X",
  check whether the model actually forbids X or whether a single unstated default is
  masquerading as the model.
