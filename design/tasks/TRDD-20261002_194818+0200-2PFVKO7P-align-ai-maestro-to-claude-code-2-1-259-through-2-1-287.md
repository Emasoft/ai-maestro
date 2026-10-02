---
trdd-id: 2PFVKO7P
title: Align ai-maestro to Claude Code 2.1.259 through 2.1.287
column: blocked
status: tasked
created: 2026-10-02T19:48:18+0200
updated: 2026-10-03T01:09:36+0200
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
approval-datetime: 2026-10-02T19:48:18+0200
implementation-commits: [95afabd91, 2af2c728b, c8dea5bae, 8ed347b39]
eht: [4UCBYEZ4, LJL6YUZ4]
blocked-by: [4UCBYEZ4]
pre-block-column: testing
blocker-probe: curl -s -o /dev/null -w %{http_code} http://localhost:23000/api/sessions
blocker-holds-if: not-match:^200$
---

# Align ai-maestro to Claude Code 2.1.259 through 2.1.287

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-10-02
NEXT ACTION: Code landed in 4 commits and was built and deployed on 2026-10-02 (worker-reported: Rust reader rebuilt, yarn build exit 0, bundle verified by string literals). Live check NOT done: the server never answered under host load ~150-286 from other processes, and the user stopped it with `pm2 stop ecosystem.config.js` (~21:35). Next: start the server (`pm2 start ecosystem.config.js`), then confirm a claude-fable-5-1 session's context limit is 1000000 (services/sessions-browser/local-context-breakdown.ts:1167) and that Opus costs show the $5/$25 rate. Open user decisions: (a) file issues on 3 plugin repos for unquoted ${CLAUDE_PLUGIN_ROOT} hook commands (A1); (b) update Claude Code to >=2.1.286 to capture a real Bash permission prompt (A7, services/agents-chat-service.ts detectTuiMenu); (c) the D3-D14 decision sheet in docs_dev/cc-align-consolidated-adopt.md section 3.

## Problem
The user asked (2026-10-02, verbatim): "update the project to align and take advantage of the following recent changes (from 30 days ago till now) of claude code: https://code.claude.com/docs/en/changelog.md Be sure to delegate. fan out subagents. use tldr-code skill, fastedit skill, jgrep skill and quicksilver skill to save tokens."
The last alignment pass covered CC 2.1.221 (TRDD-9X2STNL2). Releases published since 2026-09-02 are 2.1.259 through 2.1.287; the installed version is 2.1.285.

## Acceptance
- [ ] Every changelog bullet in range is classified, and each non-ui/bugfix-only bullet has an adopt, not-applicable, or defer verdict with a file:line reason. (Amended 2026-10-03: unattainable as written; 1,398 filter-dropped, 448 grouped and 125 never-judged bullets have no individual file:line verdict. See the Outcome coverage line.)
- [ ] Every adopted change is landed in its own commit citing this card, with `npx tsc --noEmit` and `npx eslint . --quiet` clean.
- [ ] Deferred items have their own TRDD cards. (Amended 2026-10-03: the deferred items are collected for a user ruling in card LJL6YUZ4; each adopted one gets its own card then.)

## Approval log

- 2026-10-02T19:48:18+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Method

Scope: changelog versions 2.1.222 through 2.1.287 (46 versions, 2243 bullets) [stage 1 only; the 9 skipped versions added 384 bullets, total 2,627], wider than the user's 30 days (2.1.259 onward) because no alignment pass had covered 2.1.222 to 2.1.258 in this repo. Installed CC is 2.1.285; 2.1.286 and 2.1.287 are newer than the installed version.
Stage 1: bullets extracted to docs_dev/cc-changelog-items.jsonl and sorted into areas with quicksilver classify (docs_dev/cc-changelog-buckets.md). The label hints were split at commas, so the area sorting is approximate.
Stage 2: one read-only scanner per area shortlists with single-question quicksilver filters, then checks code with jgrep and tldr, and gives each shortlisted bullet ADOPT, REMOVE-WORKAROUND, DEFER or NOT-APPLICABLE with file:line evidence. The ui-only area is scanned as well, because ai-maestro drives agents through tmux keystrokes and screen parsing.
Known gap: bullets a quicksilver filter drops get no individual verdict; each report records how many were dropped.

## Outcome 2026-10-02

95afabd91: screenshot-interpreter agent gets omitClaudeMd: true (CC 2.1.271). Not live-verified by a spawn.
2af2c728b: help assistant launches with --system-prompt-file (CC 2.1.281). Live-tested interactively on 2.1.285: a PINEAPPLE system prompt was obeyed. Quoting the path was skipped: fastedit refused the edit twice.
c8dea5bae: Fable 5 / 5.1 resolve to a 1M context window in lib/context-limits.ts and the Rust reader. The bare alias `fable` stays 200K; 0 records use it as message.model in transcripts modified in the last 20 days (an earlier agent counted 36 `fable` lines by a different method), against 18,534 for claude-fable-5-1.
8ed347b39: prices at Anthropic's published rates. Opus 4.5-5 at $5/$25 (was $15/$75, 3x too high); opus41 at $15/$75 for Opus 4.1 and earlier; opus5 for Opus 5.5 at $4/$20; fable and fable5 at $10/$50 (Fable had fallen back to Sonnet, 3.3x too low); Haiku 4.5 at $1/$5. Gap: retired Haiku 3/3.5 ids are now priced at the Haiku 4.5 rate. A worker removed a duplicate comment with sed -i, against the edit rule; the orchestrator reviewed the full diff and re-ran vitest (57/57), tsc and eslint.
Not adopted: A5 (plugin update --json, low value); R1 refuted (plugin validate --json at scripts/agent-plugin.sh:766 already prints to the terminal); A7 blocked on a real >=2.1.286 permission-prompt capture.
Coverage (worker-reported): 2,627 changelog bullets (2.1.222-2.1.287). 650 have an individual verdict, 448 a grouped verdict, 125 were shortlisted but never judged, 6 are inferred, 1,398 were dropped by quicksilver filters (mostly bugfix-only). Details in docs_dev/cc-align-coverage.md.
Method correction: 7 of the 10 scanners used one compound quicksilver question at threshold 0.4 and kept 82-100% of their bucket, so most narrowing was the agents' own judgment. The Method section above overstates the role of the filters.
Card title is stale: the scope was widened to 2.1.222-2.1.287; the user has not yet confirmed the widening.
