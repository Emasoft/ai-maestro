---
trdd-id: JY6IDFFC
title: Spec and ruling on the aimaestro-agent.sh deployment contract — manual cp-based install and no build-vs-runnable distinction
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-21T21:58:50+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:58:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: medium
effort: M
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#116, Emasoft/ai-maestro#64, Emasoft/ai-maestro#69, Emasoft/ai-maestro#80, Emasoft/ai-maestro#97, Emasoft/ai-maestro#88, TRDD-T3FXA0Y0]
---

## Problem

`scripts/aimaestro-agent.sh` reports the same hardcoded version (`v1.0.1`) whether or not an
installed copy has the verbs the current source ships — `install-agent-cli.sh` (invoked by
`install.sh` when `INSTALL_AGENT_CLI=true`) is the only propagation path, it `cp`s rather than
symlinks, and nothing re-runs it automatically on a source change. A consumer (core plugin)
cannot tell "built into source" from "runnable on this host" without reading the dispatch table
directly — which is exactly the coupling the Plugin Abstraction Principle exists to avoid. This
already produced two independent wrong conclusions in both directions (core nearly filed a false
defect on a verb that existed but wasn't deployed; core separately cited a stale published line
from another repo).

Note: this is distinct from `TRDD-T3FXA0Y0` (the exit-status contract, §6.4 of
`docs/SCRIPT-MANIFEST.md`, tracking #121) — that covers exit-code semantics; this covers
*deployment propagation and version/capability truthfulness*.

## Root cause

`install-agent-cli.sh` was built as a one-shot manual copy step with no trigger tied to source
changes, and the CLI's version string is a literal that nobody bumps on dispatch-table edits.

## Proposed fix

Per the issue's own framing, this needs a **ruling**, then implementation:

1. **State the deployment contract explicitly**: is manual re-run of `install-agent-cli.sh`
   the permanent expected operator step, or should there be an automatic trigger (e.g. wired into
   `bump-version.sh`, a post-commit hook, or a server-side self-update check)? Document whichever
   is chosen as a spec other skills can cite.
2. **Make the version move with the verb set** — one of: (a) `bump-version.sh` bumps the CLI
   version on any change to its dispatch table, (b) a `--verbs`/`--capabilities` listing verb,
   (c) a `scripts/script-manifest.json` installed alongside the binary so manifest and binary
   travel together. Any one suffices; pick and document.
3. **Rule on the adoption gate** for #69's "core holds a verb until deployed" question — once (2)
   exists, core can self-serve "is verb X live on this host" instead of holding indefinitely or
   guessing.
4. Resolve the two smaller specs bundled in the issue: whether `.janitor/daemon_responses/
   hibernation.json` is intentionally server-local-only, and the literal lockdir expression for
   `ai-maestro-plugin#54`'s atomicity fix (both need a one-line factual answer from this repo's
   side, not new design).

## Verification

- `aimaestro-agent.sh --version` (or equivalent) differs between an installed copy missing a verb
  and current source that has it.
- Core can determine "is verb X live on this host" without reading `scripts/aimaestro-agent.sh`
  source.
- The install/adoption ruling is documented somewhere core's skills can cite (SCRIPT-MANIFEST.md
  or equivalent).

## Acceptance

- [ ] Deployment-propagation contract stated (manual-with-doc, or automated trigger)
- [ ] Version/capability signal that moves with the actual verb set, deployed
- [ ] Ruling given on core's #69 adoption-gate question (hold-until-deployed vs teach-with-prerequisite)
- [ ] `hibernation.json` scope question answered (server-local by design, or repo not a registered agent workdir)
- [ ] Lockdir expression for `ai-maestro-plugin#54` given literally
- [ ] Comment posted on Emasoft/ai-maestro#116 confirming the card and status

## Approval log
