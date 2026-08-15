---
trdd-id: DSQUWKVI
title: Server-triggered externalized compaction — run the janitor's zero-turn shrink for a named agent
column: completed
created: 2026-08-15T22:23:24+0200
updated: 2026-08-15T23:58:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 1
severity: high
effort: medium
release-via: none
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
labels: [continuity, compaction, janitor-parity, fleet]
npt: []
eht: []
blocked-by: []
implementation-commits: [ac180a83, 2be39063, fcbeb021]
external-refs: [Emasoft/ai-maestro-janitor#222]
---

# Server-triggered externalized compaction

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-15

- **Attended path: DONE** — `janitor-externalized-compaction` added to the curated command
  allowlist (`ac180a83`), auto-reachable from the dashboard listing + `POST
  /api/agents/[id]/session` + the by-key actuators. 4 tests, 1 neuter.
- **Unattended path: DONE** (`2be39063`, guarded by `fcbeb021`) — `lib/external-compaction.ts`,
  the per-agent subprocess runner. This is the seam the janitor asked for and the one that works
  on a WEDGED agent. Reachable at `POST /api/agents/[id]/continuity/compact`; pinned by
  `tests/unit/external-compaction.test.ts` and
  `tests/unit/externalized-compaction-not-automatic.test.ts`.
- **NEXT ACTION:** none — the card is `completed`. (This line read *"finish the runner + tests,
  wire the route action, then reply to the janitor"* until the closing edit; all four had landed
  by then, and a STATE block that contradicts its own acceptance boxes is the one thing a
  resuming session cannot safely trust.)

## Origin

USER directive, 2026-08-15 (verbatim): *"implement the externalized-compact (or make the
janitor able to trigger it from inside the ai-maestro server). ask the janitor for the
details."* The janitor's spec answered on the same evening; its load-bearing citations were
re-verified first-hand here before anything was built on them.

## What externalized compaction is (and why it is not `/compact`)

There is **no model turn anywhere in the path**. A script composes a link-only handoff to
`<project>/.janitor/state/agent-handoff.md` from on-disk facts (TRDD `## STATE` blocks, git
log, the findings ledger), optionally upgrading the prose through the `llm-ext` CLI at $0, then
types `/clear` plus a verified bootstrap chain into the target session's pane. `/compact` by
contrast pays a full-price sampling step over the entire pre-compaction context — the thing it
is trying to shrink.

## The two seams, and why BOTH exist

| | attended (`ac180a83`) | unattended (this card) |
|---|---|---|
| how | inject `/janitor-externalized-compaction` into the agent's pane | run `external_handoff_clear.py --project-root <agent workdir>` as a subprocess |
| who decides | the agent's own session | the janitor's script, against that agent's state |
| needs a responsive REPL | **yes** — the keystroke must be consumed at idle | **no** |
| good for | a human clicking a button in the dashboard | continuity: an agent that can no longer act for itself |

The second is the one that matters for continuity, because **a wedged agent is exactly when a
shrink is needed and exactly when an injected command cannot be consumed.**

**A correction worth recording, because it was committed before it was caught.** The first
version of this work argued the server *must not* run the script — that it self-targets and
could never aim at another pane. That is FALSE: `external_handoff_clear.py:402` calls
`fleet_restart.recorded_terminal(str(root))`, resolving the pane from the `--project-root`
passed in (via `<root>/.janitor/state/terminal-identity.json`). Verified first-hand in the
shipped 3.3.3 cache, not taken from the peer's report. The comment carrying the false rationale
was corrected in the same session.

## Invocation contract (from the janitor's spec, citations re-verified here)

```
<plugin_root>/scripts/external_handoff_clear.py --project-root <ABS path> [--on-resume] [--force] [--dry-run]
```

- `--project-root` is **required** — it cannot be inferred, because a detached caller's cwd is
  the daemon's, not the agent's.
- `CLAUDE_PROJECT_DIR` must be set **for the child only**. Unset, the chain writes the resume
  marker into the wrong tree and the cleared session waits forever for a marker that never
  arrives. Never mutate the server process's own env to achieve it.
- **Never launch it via `uv run` on macOS**: uv mints a fresh ephemeral interpreter per run, so
  the TCC Automation grant cannot attach to a stable client and every injection is denied. Use a
  stable interpreter path.
- Stdout's **first word** is the machine-readable outcome. `CLEAR_CHAIN_SPAWNED` fired;
  `VERDICT HOLD … why=active-waiting` is a resume/background agent in flight and is CORRECT (wait,
  never force); `NO_RECORDED_PANE` cannot bootstrap back so it declines; `HANDOFF_NOT_CONCISE`,
  `DISABLED` (opt-in `CLAUDE_PLUGIN_OPTION_EXTERNAL_IDLE_CLEAR_ENABLED`), `NO_JANITOR_STATE`,
  `DRY_RUN`.
- `--force` relaxes exactly two TRIGGER terms (`idle`, `no-headroom`); **every safety veto still
  holds**, so forcing past `active-waiting` is not possible and must not be attempted.
- Machine-wide the `llm-ext` calls are capped at 3 by a TTL'd flock lease — a fleet woken
  together would otherwise 429 a free-tier endpoint. Any fan-out here must pace.

## Acceptance

- [x] Attended trigger: curated allowlist key, auto-exposed to UI + API, destructive-flagged
      (`ac180a83`; neuter recorded)
- [x] `lib/external-compaction.ts`: per-agent runner — absolute `--project-root`, child-only
      `CLAUDE_PROJECT_DIR`, no `uv run`, typed outcome parsed from the FIRST WORD of stdout,
      a decline is never an exception (`2be39063`)
- [x] Tests drive every documented token, including the two that must NOT read as failure
      (`active-waiting` is the design working; `DISABLED` is an unset opt-in, not a fault) —
      21 tests. **Verified LIVE against the real script** (`--dry-run`, mutates nothing):
      resolved cache **3.3.4** (it had auto-rolled past the 3.3.3 I read the spec from, which
      is the version sort working on real data), `/opt/homebrew/opt/python@3.14/bin/python3.14`,
      and parsed a genuine `VERDICT HOLD trigger=- why=idle 11s < 3600s`. A mocked runner could
      not have shown any of that.
- [x] Reachable from the server: `POST /api/agents/[id]/continuity/compact` — `strict` in
      `security-registry.json` and mapped in `STRICT_AGENT_RULES` to `send-command`, whose
      matrix is already SELF-ONLY and whose own comment names *"an agent enqueuing `/compact`
      on itself"* as the primary use case. The governance ratchet
      (`sudo-guard-strict-agent-coverage`) caught the route as undeclared before the mapping
      existed — working exactly as designed.
- [x] Janitor told which seam shipped (their spec asked for the subprocess form; both exist).
      **They ruled: KEEP the command key** — their objection had been to a raw `/clear` verb,
      which is not what was built, and they agreed the fail-differently split is right
      (injection = human/UI, subprocess = continuity).
- [x] Their ONE scoping hazard encoded and ENFORCED. Injecting the key costs the target a full
      MODEL TURN (it is a SKILL, not a script alias — verified against its shipped `SKILL.md`,
      which instructs the model), so on a COLD cache with a large context that single turn IS
      the ~600k cache-creation write the feature exists to avoid. Attended use only; never as
      an automatic response to "cold and fat". A comment cannot enforce that — the failure mode
      is a future continuity leg resolving the key on a context-pressure signal, which reads
      like the right thing to do — so `tests/unit/externalized-compaction-not-automatic.test.ts`
      pins it, with a positive control (`model-opus` IS fired automatically, proving the scan
      reaches real code) and a neuter: adding the key to `model-fallback-sweep.ts` reds exactly
      the one test, blob-verified back to HEAD.

## Not building: the cold-resume path

The janitor's `3.3.5` (their `904ddef4`) handles cold-resume autonomously via their SessionStart
hook on every project — probe abstains → elapsed-time fallback → the blocking hook shrinks
BEFORE the first turn. The server does not need to drive that. The subprocess seam is for the
cases their hook cannot see: a wedged agent, or a project whose session never starts.

If the resume gate is ever mirrored here, take BOTH halves of their fix together — the
probe-abstains→elapsed-time fallback is useless while the CLI still cannot be found, and the
PATH-resolution fix alone leaves the gate refusing. Either alone reproduces one of their two
measured dead ends.

## What the live probe also surfaced (2026-08-15 22:2x)

The armed fallback lane IS running and is currently **inert for an honest reason**: it logs
`model-fallback could not read 10 pane(s)` every pass, and there are only 3 tmux sessions on the
host, none of them an agent. The fleet is hibernated, so there is no live Fable agent to switch.
The live rotator state at that moment read **Fable 100% with 5h=61% / 7d=81%** — a textbook
scoped-only wall, i.e. exactly the case the new policy and the armed lane were built for. So
**DPPYVLVH's human-watched first switch is still PENDING a live Fable agent**, and must not be
recorded as verified until the `confirmed=true` line and the pane flip are actually seen.

## Approval log

- 2026-08-15T22:23:24+0200 — MANDATE issued by USER (floor `none`): a direct directive to give
  the server its own trigger for the janitor's zero-turn shrink. Pre-approved; no request sent.
- 2026-08-15T23:58:00+0200 — COMPLETED by ai-maestro. All six acceptance boxes checked, no
  NPT/EHT, work landed as `ac180a83` (attended), `2be39063` (unattended runner + route) and
  `fcbeb021` (the attended-only guard) — all three now in `implementation-commits:`. Each
  artifact was verified to exist on disk and in git before closing, not inferred from the
  checkboxes; the STATE block's stale *"IN PROGRESS / NEXT ACTION"* lines were corrected in the
  same closing edit. The DPPYVLVH note above is about a DIFFERENT card and does not gate this one.
