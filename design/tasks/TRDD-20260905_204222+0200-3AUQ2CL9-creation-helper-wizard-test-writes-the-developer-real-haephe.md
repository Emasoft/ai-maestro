---
trdd-id: 3AUQ2CL9
title: creation-helper wizard test writes the developer real haephestos workdir
column: todo
created: 2026-09-05T20:42:22+0200
updated: 2026-09-13T04:18:27+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T20:42:22+0200
labels: [tests, containment]
implementation-commits: [b14d7f2ea]
---

# creation-helper wizard test writes the developer real haephestos workdir

## Approval log

- 2026-09-05T20:42:22+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T20:43:48+0200 — self-mandate (min-approval-requirement: none) by ai-maestro-hub-session; found while verifying TRDD-E5AAE555.
- 2026-09-05T20:50:13+0200 — identity stamps corrected before the first commit (fc5c8b8e): the create route stamped created-by/mandated-by/approval-judge as user because the call was owner-authenticated with no AID (app/api/trdd/create/route.ts lines 36-44); this is a hub-session self-mandate, so created-by and approval-judge now read ai-maestro-hub-session and mandated-by reads self (Tier-0 spelling). Whether a hub session without an AID should mint as the user is a design question surfaced to the owner.

## Problem

Wizard tests that exercise the creation-helper API routes are not sandboxed: they hit the same filesystem paths the routes compute for the real Haephestos agent.
A plain `yarn test` on a developer machine rewrites the live Haephestos helper's settings and drops files into its uploads directory under `~/agents/haephestos/` — the developer's REAL agent workdir, not a fixture.
Measured 2026-09-05 20:00-20:35: `~/agents/haephestos/` was rewritten at 20:02:02 — `.claude/settings.local.json` (the permissions allowlist, 648 B) overwritten, `uploads/e4e8e23f-raw.txt` (1 byte) created, and an empty `toml/` created.
Writers: `app/api/agents/creation-helper/ensure-persona/route.ts`:70-84 ("Always overwrite settings.local.json", plus mkdir uploads) and `app/api/agents/creation-helper/file-picker/route.ts`:12 (`const UPLOAD_DIR = join(homedir(), 'agents', 'haephestos', 'uploads')` — evaluated at MODULE LOAD, so per-test env stubbing cannot redirect it).
The test that produced the 1-byte upload: `tests/unit/creation-helper-wizard-system-owner.test.ts`:188 `fd.append('file', new File(['x'], 'raw.txt', …))` — that file contains no HOME redirect and no `os.homedir` mock (grep it to confirm).

## Root cause

`app/api/agents/creation-helper/file-picker/route.ts`:12 fixes `UPLOAD_DIR = join(homedir(), 'agents', 'haephestos', 'uploads')` at MODULE LOAD time, so any HOME redirect a test applies with `vi.stubEnv('HOME', …)` inside a test body cannot reach it — the constant was already computed against the real $HOME when the module was first imported.
`ensure-persona/route.ts`:70-84 unconditionally overwrites `settings.local.json` for whichever workdir it is handed; nothing in the test suite substitutes a temp workdir path, so the handler operates on the real `~/agents/haephestos/` on disk.

## Proposed fix

Prefer (a): make both routes resolve the agent workdir PER CALL, mirroring `app/api/agents/creation-helper/cleanup/route.ts`:35 which already reads `process.env.HOME` inside the handler instead of at module load. Alternative (b): have the test redirect `process.env.HOME` to a tmpdir BEFORE the route module is first imported (top-level, ahead of the import statement) — fragile because import order/caching can defeat it.
INFERRED (not measured): the same unredirected routes are also imported by `tests/integration/haephestos-pipeline.test.ts` and `tests/services/creation-helper-service.test.ts` — list them as suspects to re-check once the fix lands, not as confirmed writers.

## Verification

Prove containment by snapshotting `~/agents/haephestos/` (recursive listing + mtimes) before and after the affected test file(s) run; the snapshot and mtimes must be byte-identical. Contrast: `tests/haephestos-cleanup.test.ts` and `tests/haephestos-launch.test.ts` (added in commit 3f41f718) are contained by construction and can serve as the pattern to copy.

## Acceptance

- [ ] routes resolve the agent workdir per call (or the test redirects HOME before the module is first imported)
- [ ] a containment assertion exists in the test (real-dir snapshot unchanged before/after)
- [ ] full `yarn test` leaves `~/agents/haephestos` untouched (measured, not assumed)
