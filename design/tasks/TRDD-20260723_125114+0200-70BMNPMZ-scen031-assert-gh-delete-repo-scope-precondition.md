---
trdd-id: 70BMNPMZ
title: SCEN-031 S002 preconditions should assert the gh token carries delete_repo scope
column: planned
created: 2026-07-23T12:51:14+0200
updated: 2026-08-16T16:43:00+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T12:51:14+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/scenarios-runner/SCEN-031_20260722T203644Z.report.md (ISSUE-002)
  - "memory:github-repo-deletion-and-scenario-repo-cleanup"
---

# TRDD-70BMNPMZ — SCEN-031 S002 should assert `gh` `delete_repo` scope upfront

## Problem

SCEN-031 creates a real GitHub repo (`Emasoft/zipsearcher`) during the run and its cleanup phase
(S022) deletes it with `gh repo delete`. Run `SCEN-031_20260722T203644Z` (ISSUE-002, INFO) found
that the host's `gh` token scopes were `gist, read:org, repo, workflow` — **missing `delete_repo`**
— so S022 was blocked and the repo had to be left as residue for the user to delete manually. The
scenario's S002 preconditions phase checks `gh auth status`, that the target repo 404s, and that the
template repo is reachable — but it does **not** check that the token can actually delete a repo it
is about to create, so the gap is only discovered at cleanup time, after the repo (and possibly PRs)
already exist.

This has since been worked around on this machine (the user ran `gh auth refresh -s delete_repo` on
2026-07-23 — see the local memory note `github-repo-deletion-and-scenario-repo-cleanup`), but the
scenario file itself still has no assertion, so a fresh host or a rotated token will hit the same
blocked-cleanup surprise again.

## Proposed fix

In `tests/scenarios/SCEN-031_*.scen.md`, extend the S002 GitHub-preconditions step to also assert
`delete_repo` is present in the token's scopes (e.g. via `gh auth status` output or
`gh api -H "Accept: application/vnd.github+json" /` response headers `X-OAuth-Scopes`), and FAIL
setup with a clear remediation message
(`gh auth refresh -h github.com -s delete_repo`) if it is absent — rather than discovering the gap
during cleanup after real GitHub state has already been created.

## Verification

- Simulate a token without `delete_repo` (or read the scopes check logic against the current token)
  and confirm S002 now fails fast with the remediation message, before any repo is created.
- Confirm the check does not false-fail when `delete_repo` is present (current host state, post
  2026-07-23 grant).

## Estimated risk

LOW. Test-infrastructure-only change (a scenario `.scen.md` precondition step); no production code
touched, no dependencies on other open TRDDs.

## Acceptance

- [ ] `tests/scenarios/SCEN-031_*.scen.md` S002 asserts the `gh` token's scopes include `delete_repo` (via `gh auth status` or the `X-OAuth-Scopes` response header) before any repo is created.
- [ ] The step FAILS setup with a remediation message naming `gh auth refresh -h github.com -s delete_repo` when the scope is absent.
- [ ] Simulated absence of `delete_repo` (or a scopes-check dry-run) shows the check fails fast, before S003/repo-creation runs.
- [ ] The check does not false-fail against the current host's token (which carries `delete_repo` as of 2026-07-23).

## Approval log

- 2026-07-23T12:51:14+0200 — MANDATE by USER (report→TRDD conversion, "you have my trust").
