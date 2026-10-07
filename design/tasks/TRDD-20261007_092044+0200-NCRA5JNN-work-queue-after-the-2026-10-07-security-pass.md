---
trdd-id: NCRA5JNN
title: Work queue after the 2026-10-07 security pass
column: backburner
status: tasked
created: 2026-10-07T09:20:44+0200
updated: 2026-10-07T09:20:44+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: infra
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-07T09:20:44+0200
---

# Work queue after the 2026-10-07 security pass

Ordered queue left by the main session on 2026-10-07 (fork/governance-rules at 496c3db9f, full suite green: 615 files, 8153 tests). Owner rulings are quoted on the cards named. 1) TRDD-EC9DB4GM (clear session secrets on every session-ending path): a worktree worker was running; inspect its diff, re-test, commit. 2) TRDD-ADM0CHTJ follow-up: clampConfig skips a config SECTION that is present but not an object (sessionAuth set to a string or null); delete such sections before clamping, test both. 3) TRDD-HUSKG52P: move the strict-route registry cross-check from module load to the first request (owner ruling on the card). 4) TRDD-SHGIKNLN: routes reachable with an AMP key alone. 5) TRDD-ADYYHLIC: mint a mandate token in create, then remove the interim stop-and-confirm wording in rules/aimaestro/aimaestro-trdd-approval.md (rule files go LIVE to agents on wake: edit only when the code is ready). 6) Apply the 33 triage defaults in reports/workers/20261007-board-triage.md ONE AT A TIME under the owner delegation, skipping factual questions (e.g. TRDD-1HUKAYI6) and anything editing rules/aimaestro/. 7) Worktree cleanup: 20+ leftover .claude/worktrees/agent-*; before removing any, run git status --ignored --porcelain in each and move reports/docs out; keep branches (git guard) and the stash. 8) Headless forwarder builds its forwarded request on http://localhost so headless-issued session cookies lack Secure: card it. 9) Server restart ONLY when everything is fixed (owner ruling): yarn build then pm2 restart. Standing rules learned today: push only after a green full suite; never publish a security gap before its fix; zsh does not word-split, pass file lists with xargs.

## Approval log

- 2026-10-07T09:20:44+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
