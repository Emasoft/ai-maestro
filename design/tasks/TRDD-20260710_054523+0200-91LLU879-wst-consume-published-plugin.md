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

**NEXT ACTION:** part 3 — the consume-vs-keep decision. Parts 1 and 2 are **DONE**.

### ⏵ UPDATE 2026-07-10 — part 2 (`scenarios.config.json`) done

Authored at `tests/scenarios/scenarios.config.json`, conforming to the **plugin's own**
spec (`references/scenarios.config.README.md` + `scenarios.config.template.json` at
v0.1.3) rather than to an invented schema. Key set is identical to the template's; every
value is grounded in a fact in this repo, not guessed:

| Key | Value | Where it came from |
|---|---|---|
| `browserInstance` | `ai-maestro-scenarios` | the `--browser` name Rule 8 mandates |
| `healthEndpoint` | `…/api/v1/health` | what `setup-overnight-batch.sh:97` already probes; whitelisted in `middleware.ts:42` so it answers without a credential, and served in headless mode too |
| `helpersScript` | `…/dev-browser-helpers/aim-helpers.sh` | exists on disk |
| `cleanupTmuxPattern` | `^(scen[0-9]*-\|cos-scen-)` | the `scenNNN-` prefixes `setup-overnight-batch.sh` kills, plus Rule 7's `scen-` / `cos-scen-` |
| `buildCommand` / `testCommand` | `yarn build` / `yarn test` | present in `package.json` |
| `targetBranch` | `governance-rules` | the live branch — **update this when the branch changes** |

Two things worth stating plainly:

- **`governancePasswordRef: env:AIM_GOVERNANCE_PASSWORD`.** The plugin's spec is explicit
  that this key is "a REFERENCE to the test password — never the literal secret". The
  published extraction of this harness already handles secrets correctly; the harness it
  was extracted from still commits the literal in 32 files (TRDD-E9BZ5P7S). This config
  adds no 33rd copy. The env var does not exist yet — that is E9BZ5P7S's step 2, and the
  `helpersScript` is what resolves the reference.
- **The pattern was tested in both directions.** `scen001-foo`, `scen-test-agent-01` and
  `cos-scen-alpha` match; `_aim-placeholder`, `alexandre` and `luckas-bot` do not. A
  cleanup pattern that over-matched would kill the owner's real agents' sessions.

Nothing in this repo reads the file yet — it is inert until part 3 decides whether the
harness is driven by the plugin. `writeGuardAllowlist` is `[]` because scenario fixtures
under `~/agents/` are created through the UI or by setup scripts running as child
processes, neither of which the subagent write-guard sees.

### ⏵ UPDATE 2026-07-10 — part 1 (de-path) done; it was five files, not four

Fixed and verified. Three things the original scoping got wrong:

- **A fifth file, outside `tests/scenarios/`.** `.claude/scripts/test-subagent-write-guard.sh`
  had the same defect, and worse: its `ALLOW` case asserted a write to
  `<absolute-root>/README.md`, a path that is *outside* any other clone — so the guard
  would have correctly blocked it and the test would have failed for a reason unrelated
  to the guard. Folded in rather than left behind a folder boundary. Suite: 24 pass, 0 fail.
- **The correct answer was already in the repo, and was being destroyed.**
  `setup-overnight-batch.sh` resolves `PROJECT_ROOT` from `${BASH_SOURCE[0]}` at line 35,
  then sources `fixture-helpers.sh` four lines later, which reassigned it to the literal.
  The helper now computes the identical value from its own location, so the reassignment
  is idempotent instead of destructive.
- **A second machine-specific assumption on the very line being de-pathed.** The overnight
  batch's disk-space guard used `df -BG`, a GNU-coreutils flag. It works on the author's
  machine only because homebrew's `df` shadows `/bin/df` on PATH. Stock BSD `df` exits 64;
  `2>/dev/null` swallowed it, `FREE_GB` came back empty, and `[ -n "$FREE_GB" ]` skipped
  the check in silence — so on any other Mac the unattended overnight run had no disk
  guard at all. Now `df -P -k` (POSIX, verified to return the same number through both
  `df` binaries), and an unreadable `df` is fatal rather than ignored.

Verified: `bash -n` and `shellcheck -S warning` clean on all three scripts; a copy of
`fixture-helpers.sh` placed under `/tmp/…/fakeclone` resolves `PROJECT_ROOT` to the copy,
while the real repo still resolves to itself. That check was falsified first — given the
old hardcoded line, it resolves to the author's machine and fails, so it can detect the
bug it guards against.

**Found while doing this, NOT fixed here:** the governance password is committed verbatim
in **32 tracked files** on this public branch, and `SCENARIOS_TESTS_RULES.md` mandates it
("the actual password value, in quotes"). That needs a rotation and a convention change,
not a redaction — redacting 1 of 32 would be theatre and would break the suite. Filed
separately; do not "fix" it piecemeal from here.

### The three pieces, in the order they should be done

1. **De-path.** ✅ **DONE.** Five *git-tracked* files baked the author's absolute working
   directory into the repo, so the harness was unrunnable in any other clone and the path
   was published to every reader:

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

2. **`scenarios.config.json`.** ✅ **DONE** — see the update above.

3. **Consume the plugin, or keep the copy — decide before moving anything.** ⚠ This may
   not be a Tier-0 call: making this repo's own test suite depend on a marketplace
   install is architectural and touches CI. If that reading holds, it is a MANAGER
   (Tier-2) decision and belongs in `design/proposals/`, not here. Settle the tier
   before settling the question. The
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
