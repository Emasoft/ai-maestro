---
trdd-id: 7DRSIKVZ
title: Port oauth-rotator-supervisor and rotator core into the server
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: port `oauth_rotator/{supervisor,rotator,cookie_vault}.py` from the janitor's daemon
(`…/ai-maestro-janitor/0.60.1/scripts/`) into `lib/oauth-rotator/{supervisor,rotator,
cookie-vault}.ts` — server-native, line-by-line port. NEXT ACTION: read the reference python
modules, then write the TS ports preserving the write-mutex + starvation guard. Not started.

## Spec

- Port `oauth_rotator/{supervisor,rotator,cookie_vault}.py` → `lib/oauth-rotator/{supervisor,
  rotator,cookie-vault}.ts`.
- The supervisor = 10-min governance/auto-heal loop; the rotator orchestrates ROTATE→RENEW→REAUTH
  over the already-ported `cascade.ts`/`rotate.ts`/`network.ts`/`slots.ts`/`safe-storage.ts`;
  `cookie-vault` = custody.
- Preserve the write-mutex + starvation guard.
- Do NOT port human-interactive capture (`reauth.py`, `slot_capture_browser.py`,
  `open-login.sh`) — the daemon can't rotate without pre-captured slots; that stays the human step.
- Stays R16 flag-gated (arming the live-credential write is the human's action; the port makes the
  mechanism native, it does not decide to rotate).

## Acceptance

- [ ] `tsc` 0
- [ ] Per-module unit tests (stub keychain/HTTP, 0-IMPACT) proving behavioral parity with
      `supervisor.py`
- [ ] The supervisor beat runs from the server tick when the flag is present

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
