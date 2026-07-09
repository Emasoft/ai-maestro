---
trdd-id: GT0TAJFL
title: dev-browser as core-plugin dependency and hook AskUserQuestion capture in ai-maestro-plugin repo
column: dev
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T10:27:08+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
effort: S
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
relevant-rules: []
labels: [dev-browser, core-plugin, hook, askquestion, cross-repo]
test-requirements: [unit]
review-requirements: [human-review]
impacts: []
external-refs: ["Emasoft/ai-maestro-plugin (cross-project — issue/PR, NOT edited in this repo)"]
---

# TRDD-GT0TAJFL — dev-browser core dependency + hook AskUserQuestion capture

Per `~/.claude/rules/how-to-fix-issues-of-other-projects.md`, this work happens in
the **`ai-maestro-plugin`** repo (`~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/`), not
in this repo. This TRDD's in-`ai-maestro` deliverable is limited to filing the
GitHub issue(s)/PR against that repo and tracking their status here. It unblocks the
hook-capture half of D2 (TRDD-TDFSELI1).

## What exists today

- The core plugin manifest
  (`~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/.claude-plugin/plugin.json`, v2.8.0)
  has **no `dependencies` field** — dev-browser is not declared as an auto-installed
  dependency of the core plugin.
- The cross-marketplace dependency shape already has a working precedent,
  confirmed from the webdesign/WST plugin's `plugin.json`:
  ```json
  "dependencies": [{"name": "dev-browser", "marketplace": "dev-browser-marketplace"}]
  ```
  plus the hosting marketplace's top-level `allowCrossMarketplaceDependenciesOn`
  field, which already lists `dev-browser-marketplace` from the prior WST work — so
  the marketplace-level allowance is already in place; only the plugin-level
  `dependencies` entry is missing.
- The hook `ai-maestro-hook.cjs` captures tool-PERMISSION prompts (see D2 / TRDD-
  TDFSELI1 for the exact capture shape) but does **not** capture AskUserQuestion
  events — no question text, no option/choice labels are recorded for that tool.

## What to build (in the ai-maestro-plugin repo, via GitHub issue/PR)

1. Add
   `"dependencies": [{"name": "dev-browser", "marketplace": "dev-browser-marketplace"}]`
   to the core plugin's `.claude-plugin/plugin.json`, so Claude Code auto-installs
   dev-browser alongside the core `ai-maestro-plugin`. Confirm the
   `ai-maestro-plugins` marketplace's `allowCrossMarketplaceDependenciesOn` already
   permits `dev-browser-marketplace` (expected: yes, from prior WST work — verify
   before assuming).
2. Enhance `scripts/ai-maestro-hook.cjs` to detect the AskUserQuestion tool
   specifically and capture its question text plus option labels into the same
   `~/.aimaestro/chat-state/<hash>.json` chat-state file that permission prompts
   already use — this is the exact field TRDD-TDFSELI1 (D2) reads from once this
   lands.
3. Ship both changes with the plugin's own test suite and publish via that repo's
   `publish.py` pipeline (per
   `~/.claude/rules/plugin-tests-are-the-plugins-job.md` — the plugin owns its own
   tests; this TRDD does not add tests to this repo for that work).

## Files to touch

- (in the `ai-maestro-plugin` repo, NOT this repo)
  `.claude-plugin/plugin.json` — add the `dependencies` entry.
- (in the `ai-maestro-plugin` repo, NOT this repo)
  `scripts/ai-maestro-hook.cjs` — add AskUserQuestion capture.
- (in the `ai-maestro-plugin` repo, NOT this repo) that repo's own test files for
  the hook capture change.
- In THIS repo: none — this TRDD's deliverable here is limited to filing and
  tracking the cross-repo issue(s)/PR, per `external-refs:` above.

## Tests

- (in the `ai-maestro-plugin` repo) A hook-input fixture containing an
  AskUserQuestion tool-invocation event, run through the enhanced
  `ai-maestro-hook.cjs`, results in the question text and option labels being
  written into the chat-state JSON file.
- (in the `ai-maestro-plugin` repo) `plugin.json` with the new `dependencies` entry
  validates against the plugin schema (via that repo's own `validate_plugin.py` /
  CPV gate).
- In THIS repo: none required — verification is that the GitHub issue/PR was
  actually filed and its URL recorded in `external-refs:`/this TRDD's body once
  created.

## Approval log
