---
trdd-id: VT6SSI0T
title: WS1b — dummy live-import verification protocol (adopt a cloned repo end-to-end)
column: completed
created: 2026-07-08T14:21:32+0200
updated: 2026-07-08T17:28:00+0200
current-owner: main-session
assignee: main-session
priority: 0
severity: HIGH
effort: S
labels: [fleet-readiness, import-system, derived-eht]
task-type: audit
parent-trdd: TRDD-57EBNB72
approval-tier: 0
release-via: none
test-requirements: []
relevant-rules: []
implementation-commits: []
---

# WS1b — dummy live-import verification protocol

Derived EHT of TRDD-57EBNB72 (the import fix cannot be trusted for real fleet imports on unit
tests alone — the USER requires a live dummy/cloned-repo rehearsal first). Also closes campaign
blockers B3 (fleet-readiness evidence) and B5 (definitive idle-burn measurement) on TRDD-903b7a20.

## Protocol

1. `yarn build` + `pm2 restart ai-maestro` so the live server runs the WS1 code.
2. Rehearse the exact WS3 flow: `git clone <local core-plugin dev repo> ~/agents/dummy-fleet-pilot/`
   (local clone — no network, realistic plugin content, disposable).
3. Adopt via `POST /api/agents` `{workingDirectory, allowExternalFolder:true, createSession:false}`.
4. Assert: registry entry; `.claude/rules/aimaestro-*.md` seeded; `.claude/settings.local.json`
   written; managed `.gitignore` block present; **`git status --porcelain` EMPTY**.
5. Wake; leave IDLE 1-2h with janitor armed → re-assert clean tree AND idle token burn ~0
   (token_report window on the dummy's project slug).
6. Delete via API/UI with folder; re-clone; re-import — proves the tombstone fixes (folders route
   + G03-OVERLAP) hold.
7. Record verdicts here + on TRDD-57EBNB72 (→ complete on pass) + TRDD-903b7a20 (B1/B3/B5).

## Results — 2026-07-08 (steps 1-4 + 6 PASS; step 5 idle-burn pending)

- Server rebuilt on node22 (`/opt/homebrew/opt/node@22`, engines pin blocks the system node 26.4)
  and started under pm2 via a node22 wrapper (pm2 was EMPTY before — no prior process).
  A prebuild guard refuses `yarn build` while pm2 is online → stop→build→restart is the cycle.
- Adoption of the cloned core-plugin repo at `~/agents/dummy-fleet-pilot`: **201**, in-place
  workdir, 4 DEP rules seeded, role+core plugins local-scoped, exclude block written.
- **LIVE CATCH:** the first seeder wrote `.gitignore` → ` M .gitignore` (repos TRACK it).
  Fixed in commit a1724058: managed block moved to `.git/info/exclude` (dir/submodule/worktree
  shapes all resolved). Re-verified live: `git check-ignore` IGNORES
  `.claude/settings.local.json`, `.gitignore` untouched, **`git status --porcelain` = 0**.
- Step 6: soft delete (200, `hard:false` — note: `?deleteFolder=true` does NOT remove the
  folder on soft delete) then re-adopt of the SAME folder over the tombstone: **201** —
  tombstone fixes hold. Agent 3d4b21f3-1f67-4f10-8cdd-3f8e85553ee3 now owns the workdir.
- **Step 5 PASS (2026-07-08T17:20):** woken 14:35:43, left idle 2h44m with the janitor armed.
  Pane confirmed claude v2.1.204 ALIVE at the idle prompt (0% ctx, 0 turns). Idle burn =
  **literally 0** — the dummy never appeared in the token-attribution table over the exact
  14:35→17:20 window and never even created a `~/.claude/projects/` transcript dir.
  `git status --porcelain` = 0 entries after the whole window.
- **Final cleanup PASS:** soft delete (200) → cemetery purge of both export zips
  (`DELETE /api/agents/cemetery` takes a JSON body `{filename}`, one fresh one-shot sudo
  token per call) → `?hard=true&deleteFolder=true` on BOTH agent ids (3d4b21f3 current +
  549d1dc4 first-cycle tombstone). End state: registry mentions 0, per-agent dirs 0,
  workdir folder GONE (deleteFolder IS honored on hard delete — only soft delete skips it),
  cemetery 0, tmux sessions 0.
- Minor observations (non-blocking, for the backlog):
  1. `GET /api/agents?includeDeleted=true` did NOT return the soft-deleted tombstone
     (registry.json had it; the API filtered it) — param possibly unwired.
  2. A user/plugin-scope `SessionStart:startup` hook errors with a non-blocking traceback in
     any fresh agent workdir (the workdir itself has no SessionStart hooks) — cosmetic today,
     every fleet agent will show it.

**VERDICT: WS1b PASS end-to-end.** Closes B1 (import mechanics live-verified) and B5
(definitive idle-burn = 0) on TRDD-903b7a20; parent TRDD-57EBNB72 test-verified live.

## Approval log

- 2026-07-08T17:28:00+0200 — COMPLETED by main-session (tier 0). All 7 protocol steps PASS;
  system restored to pre-test state (zero dummy remnants).
