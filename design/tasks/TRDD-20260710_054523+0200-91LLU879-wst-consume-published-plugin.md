---
trdd-id: 91LLU879
title: Repoint the scenario harness onto the published web-scenario-tester plugin
column: planned
created: 2026-07-10T05:45:23+0200
updated: 2026-07-10T05:45:23+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
created-by: ai-maestro-session
priority: 3
severity: MEDIUM
effort: M
task-type: refactor
labels: [scenario-testing, plugin, deduplication, de-path]
parent-trdd: TRDD-f181a4ae
derived: true
derived-kind: eht
npt: []
eht: []
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-session
approval-datetime: 2026-07-10T05:45:23+0200
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
test-requirements: [lint]
audit-requirements: []
review-requirements: []
runtime-targets: [macos, linux]
impacts: []
external-refs: []
---

# TRDD-91LLU879 — repoint `tests/scenarios/` onto the published plugin

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**Why this exists.** Its parent TRDD-f181a4ae packaged the scenario harness as the
`web-scenario-tester` role-plugin and published it (v0.1.3, 2026-07-08). Publishing
opened a hole it named but did not close: this repo still carries its own copy of the
harness, so the plugin and `tests/scenarios/` are now two divergent sources for one
thing. That is the hole; this is the platelet. Until it closes, f181a4ae is `blocked`
on this TRDD, not `published` — a parent that ships a change and leaves its hole open
has not finished.

**NEXT ACTION:** start with the de-path (independent of the plugin decision, and the
only part with a security edge). Then decide consume-vs-keep before moving any file.

### The three pieces, in the order they should be done

1. **De-path.** Four *git-tracked* files bake the author's absolute working directory
   `/Users/emanuelesabetta/ai-maestro` into the repo, so the harness is unrunnable in
   any other clone and the path is published to every reader:

   | File | What it does with the path |
   |---|---|
   | `tests/scenarios/scripts/fixture-helpers.sh` | `PROJECT_ROOT="…"` at the top; every other var derives from it |
   | `tests/scenarios/scripts/setup-overnight-batch.sh` | same shape |
   | `tests/scenarios/scripts/README.md` | documents the absolute path |
   | `tests/scenarios/agents/scenario-batch-runner.md` | agent prompt hardcodes it |

   Replace with a resolution that works from any caller — the repo already has the
   idiom (`git rev-parse --show-toplevel`, or `git worktree list | head -n1` when the
   main root is wanted from inside a worktree; see `~/.claude/rules/agent-reports-location.md`).
   The 59 further hits under `tests/scenarios/state-backups/` are *gitignored* runtime
   artifacts of past scenario runs — leave them; they are captures of a machine's real
   state, not source.

2. **`scenarios.config.json`.** Does not exist. The plugin's runner reads its project
   config from it (paths, type-check + build commands). Authoring it is what lets any
   project — not just this one — drive the plugin.

3. **Consume the plugin, or keep the copy — decide before moving anything.** The
   plugin ships 6 agents, 14 skills and 11 scripts at v0.1.3 (verified on the tag's
   tree). `tests/scenarios/` still ships its own runner agents and scripts. Deleting
   this repo's copy in favour of the installed plugin is the intent recorded in
   f181a4ae, but it makes the repo's own test suite depend on a marketplace install,
   which is a real cost. Whichever way it goes, write the reason down here.

**Verification.** `bash -n` on every touched script; `shellcheck` clean; a `grep -rl`
for the absolute path over `git ls-files tests/scenarios/` returns nothing; and the
harness runs from a *fresh clone at a different path* — that last one is the only
check that actually proves the de-path, since running it in place passes either way.

**Do not** treat this as a chance to refactor the harness. It closes one hole.

## Approval log

- 2026-07-10T05:45:23+0200 — MANDATE issued by ai-maestro-session (min-approval-requirement: none).
  Pre-approved: a Tier-0 derived EHT inside the author's own slice, so sender and receiver
  are the same. No approval request was sent.

## Notes and lessons learned
