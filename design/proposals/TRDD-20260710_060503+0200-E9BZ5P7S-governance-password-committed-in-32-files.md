---
trdd-id: E9BZ5P7S
title: The governance password is committed verbatim in 32 tracked files on a public branch
column: proposal
created: 2026-07-10T06:05:03+0200
updated: 2026-07-10T06:05:03+0200
current-owner: ai-maestro-session
created-by: ai-maestro-session
assignee: null
priority: 0
severity: CRITICAL
effort: M
task-type: security
labels: [security, credentials, public-repo, scenarios]
parent-trdd: null
npt: []
eht: []
min-approval-requirement: user
mandate: false
approved: false
relevant-rules: []
release-via: none
audit-requirements: [security-scan]
review-requirements: [human-review]
impacts: [ci-pipeline]
external-refs: []
---

# TRDD-E9BZ5P7S — the governance password is in the repository

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**Blocked on the USER. Credential rotation is never an agent's action, and this cannot
be fixed by an edit.** Nothing here has been changed. Read the whole page before touching
any of the 32 files — a partial redaction is worse than none.

## What is exposed

The live AI Maestro **governance password** — the secret that gates sudo-mode, agent and
team deletion, title changes, and `POST /api/governance/password` — appears **verbatim in
32 git-tracked files**, all present on the tip of `governance-rules`, which is pushed to
the **public** `Emasoft/ai-maestro`.

| Where | Count | Shape |
|---|---|---|
| `tests/scenarios/SCEN-0*.scen.md` | 28 | `governance_password: "<value>"` in frontmatter |
| `tests/scenarios/SCENARIOS_TESTS_RULES.md` | 1 | the rule that **mandates** the above |
| `tests/scenarios/agents/scenario-batch-runner.md` | 1 | a "Constraints" table handed to the runner agent |
| `tests/e2e/helpers.ts` | 1 | `export const GOVERNANCE_PASSWORD = '<value>'` — a bare constant, no env indirection |
| `design/tasks/…-TBGGUA2V-…md` | 1 | quoted in a TRDD body |

Not on `fork/main` today. But `governance-rules` is the branch heading for a PR, so a
merge publishes it there too.

## This is a convention, not an accident

`tests/scenarios/SCENARIOS_TESTS_RULES.md` requires it:

> line 544 — `governance_password: "<password>"   # The actual password value, in quotes.`
> line 574 — `| governance_password | string | yes | Actual password in quotes. Referenced verbatim in steps. |`

So every new scenario file is *required* to commit the secret. Fixing the 32 files
without fixing the rule guarantees the 33rd.

## Why a redaction alone is the wrong move

1. **It does not undo the exposure.** The value is in the history of every branch that
   carries these files. Removing it from the tip changes nothing for anyone who has
   already cloned, forked, or scraped the repo.
2. **It breaks the suite.** The scenarios and `tests/e2e/helpers.ts` need a real value at
   run time. Redaction without an injection path (env var, keychain, gitignored local
   config) just makes the tests fail.
3. **Redacting 1 of 32 is theatre.** It reads, to a future maintainer, as "handled".

Therefore the ONLY first step that means anything is **rotation**. Everything else is
cleanup that follows it.

## Mitigating facts (this is why it is not an emergency, only urgent)

- The server binds to localhost and the Tailscale CGNAT range only; `isAllowedSource()`
  in `server.mjs` drops LAN and public IPs at the TCP layer. Reaching the endpoint at all
  requires being on the owner's machine or inside the owner's tailnet.
- No API token, OAuth credential, or signing key is exposed — only this password.

Neither fact makes it safe: it is defence-in-depth's last layer, published.

## Proposed sequence (each step is the USER's to authorize)

1. **Rotate.** Set a new governance password in the running instance. Nothing else can
   happen first, and nothing else matters if this does not.
2. **Introduce an injection path.** One source: an env var (`AIM_GOVERNANCE_PASSWORD`)
   read by `tests/e2e/helpers.ts` and by the scenario runner, failing loudly when unset —
   never a fallback literal, which is how `helpers.ts` got here.
3. **Amend the rule** (`SCENARIOS_TESTS_RULES.md`): scenario frontmatter carries
   `governance_password: env:AIM_GOVERNANCE_PASSWORD`, never a value. This is the step
   that stops the leak recurring; it is a change to a project rules doc, so it is a
   governance edit in its own right.
4. **Sweep the 32 files** to the new form.
5. **Decide on history.** Same question as TRDD-UPOR2IQY, same three options
   (accept / delete-stale-branches-then-rewrite / add a GitHub Support purge). Once
   rotated, the old value is worthless and option A becomes defensible — which is the
   strongest argument for doing step 1 immediately and deciding step 5 calmly.

## What must NOT happen without the USER's exact approved command

- Rotating the password (an agent must never rotate a credential).
- Any `git push --force`, `filter-repo`, or remote branch deletion.
- Editing `SCENARIOS_TESTS_RULES.md` (a rules doc — a governance edit).

## Approval log

- 2026-07-10T06:05:03+0200 — FILED by ai-maestro-session (min-approval-requirement: user).
  Found while de-pathing the harness for TRDD-91LLU879. Nothing was changed: the one file
  I was already editing (`scenario-batch-runner.md`) had its hardcoded path fixed and its
  password left exactly as it was, deliberately, because a lone redaction would misreport
  the problem as handled. Standing by.

## Notes and lessons learned
