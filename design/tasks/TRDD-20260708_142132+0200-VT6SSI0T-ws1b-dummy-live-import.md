---
trdd-id: VT6SSI0T
title: WS1b — dummy live-import verification protocol (adopt a cloned repo end-to-end)
column: dev
created: 2026-07-08T14:21:32+0200
updated: 2026-07-08T14:21:32+0200
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

## Approval log
