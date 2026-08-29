---
trdd-id: 70BMNPMZ
title: SCEN-031 S002 preconditions should assert the gh token carries delete_repo scope
column: complete
created: 2026-07-23T12:51:14+0200
updated: 2026-08-29T17:22:53+0200
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
implementation-commits: [8450bbf6]
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

- [x] `tests/scenarios/SCEN-031_*.scen.md` S002 asserts the `gh` token's scopes include `delete_repo` (via `gh auth status` or the `X-OAuth-Scopes` response header) before any repo is created.
- [x] The step FAILS setup with a remediation message naming `gh auth refresh -h github.com -s delete_repo` when the scope is absent.
- [x] Simulated absence of `delete_repo` (or a scopes-check dry-run) shows the check fails fast, before S003/repo-creation runs.
- [x] The check does not false-fail against the current host's token (which carries `delete_repo` as of 2026-07-23).

## Approval log

- 2026-07-23T12:51:14+0200 — MANDATE by USER (report→TRDD conversion, "you have my trust").
- 2026-08-29T17:22:53+0200 — COMPLETED. S002 now asserts `gh auth status`'s `Token scopes:` line
  contains `'delete_repo'` and ABORTS setup with the `gh auth refresh -h github.com -s delete_repo`
  remediation when it does not. No new tooling: S002 ALREADY ran `gh auth status`, and that command
  already prints the scopes, so the whole fix is one added assertion on output the step was
  discarding.

  **Two corrections to this card's own text, both measured rather than assumed.**
  (1) The card's third acceptance box says the abort must land "before S003/repo-creation" — S003
  is the dashboard login; the repo is created at **S011** (MAINTAINER, `gh repo create --template`),
  and the blocked cleanup is **S022** (`gh repo delete`). The scenario text cites S011 and S022, the
  step numbers that are actually true; the box's "S003" is left as written because a terminal card's
  body is frozen and the box's INTENT (fail before any real GitHub state exists) is satisfied either
  way. My first draft of the edit wrote "before S008" from memory — S008 creates the AGENTS, not the
  repo — and only grepping the step list caught it.
  (2) The card proposed `X-OAuth-Scopes` response headers as an alternative mechanism. Not needed,
  and the simpler one is strictly better here: the header route would add an API round-trip to a
  step that already holds the answer in a command's stdout.

  **Verified by a control PAIR, not by reading the predicate** — a scope check that never fails is
  the whole failure mode this card exists to prevent, and one direction cannot show it:
  `'delete_repo'` present → exit 0 · absent → exit 1 · the live host's real `gh auth status` → exit 0
  (so the gate does not false-fail today). The negative arm is the load-bearing one; without it, an
  identity check passes both arms and the gate is decorative.

- 2026-08-29T17:31:00+0200 — Post-close verification of the ABORT clause's LOCATOR (append-only log;
  the frozen body is untouched). An adversarial review caught that I had verified S011 is *a*
  repo-creation step but never that it is the FIRST step creating outward GitHub state — and that is
  the property the clause actually asserts, for a gate whose entire purpose is to fire before real
  state exists. Now measured: every step S003–S010 was read for an outward-state action, and the
  only GitHub mentions there are PROSE (the brief's text, the template named in S002, and one
  "pushes a card into a column" metaphor) — no step before S011 touches GitHub. The locator holds.

  Recorded because the settling grep UNDER-MATCHES and its silence is therefore not evidence: the
  pattern `gh repo create|gh repo fork|git push|gh release create|gh pr create` hits exactly ONE
  line in the whole file (276, S011), yet S012 forks, S013 opens PRs and S016 cuts a release — the
  scenario phrases those in prose ("fork + clone", "opens PRs", "cut a v1.0.0 release"), so an
  instrument that finds nothing before S011 would also find nothing at three steps that definitely
  create state. Reading the step bodies is what settled it, not the grep's zero.
