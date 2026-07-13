---
trdd-id: GT0TAJFL
title: dev-browser as core-plugin dependency and hook AskUserQuestion capture in ai-maestro-plugin repo
column: completed
created: 2026-07-09T10:27:08+0200
updated: 2026-07-13T10:41:29+0000
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
effort: S
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: npt
npt: []
eht: []
relevant-rules: []
labels: [dev-browser, core-plugin, hook, askquestion, cross-repo]
test-requirements: [unit]
review-requirements: [human-review]
impacts: []
external-refs: ["https://github.com/Emasoft/ai-maestro-plugin/issues/19", "https://github.com/Emasoft/ai-maestro-plugin/issues/20", "https://github.com/Emasoft/ai-maestro-plugin/issues/21"]
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

## Outcome (2026-07-09) — three issues filed, spec corrected on two points

DONE for this repo. This TRDD's in-`ai-maestro` deliverable was to FILE and TRACK the
cross-repo work, never to edit the plugin tree. Filed on `Emasoft/ai-maestro-plugin`:

- **#19** — declare `dev-browser` as a core-plugin dependency.
- **#20** — capture AskUserQuestion via `PreToolUse`.
- **#21** — (NOT in the original spec) `Notification` matcher omits `elicitation_dialog`,
  making `ai-maestro-hook.cjs:372` unreachable dead code.

The plugin-side changes land on that repo's own cadence and test suite (per
`~/.claude/rules/plugin-tests-are-the-plugins-job.md`). #20 is what unblocks the
capture half of D2 (TRDD-TDFSELI1); until it lands, `PendingPrompt.question` in
`services/sessions-service.ts` stays `undefined` — which is exactly what that field's
comment already documents.

### Correction 1 — the marketplace precondition was already satisfied

The spec said to "confirm (expected: yes, verify before assuming)". Verified: the
`ai-maestro-plugins` marketplace already declares top-level
`"allowCrossMarketplaceDependenciesOn": ["dev-browser-marketplace"]`. **No
marketplace-side change is needed** — only the plugin-level `dependencies` entry.

Also surfaced, and recorded in #19 as a decision for the maintainer rather than an
implicit inheritance: `dev-browser-marketplace` resolves to the **third-party** repo
`sawyerhood/dev-browser` (`Emasoft/dev-browser-marketplace` 404s). Making it a *core*
dependency means every agent on every host transitively auto-installs a third-party
plugin.

### Correction 2 — the AskUserQuestion capture mechanism in the spec was wrong

The spec said "enhance `ai-maestro-hook.cjs` to detect the AskUserQuestion tool". That
understates the change, because the hook **never receives `PreToolUse` at all**:

- `ai-maestro-hook.cjs`'s `switch` has cases for `PermissionRequest`, `Notification`,
  `Stop`, `StopFailure`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`,
  `PreCompact`, `PostCompact` — **no `PreToolUse` case**.
- `hooks/hooks.json`'s only `PreToolUse` entry (`matcher: "Bash|Write|Edit|NotebookEdit"`)
  routes to a *different* script, `directory-guard.cjs`.

So the fix is TWO files: a new `hooks.json` `PreToolUse` entry (`matcher:
"^AskUserQuestion$"` → `ai-maestro-hook.cjs`) plus a new `case 'PreToolUse':`.
`Notification` cannot carry the payload — it has no `tool_input` — so `PreToolUse` is
the only event that can supply the question text and choices.

Two further points raised in #20 that the spec omitted:

- **A `PostToolUse` clear is required.** Only `Stop` currently clears state, and Claude
  keeps working *within the same turn* after a question is answered. Without a
  `PostToolUse` (`^AskUserQuestion$`) clear, `readPendingPrompt()` keeps returning the
  already-answered question, and a polling governance agent will answer it twice —
  injecting a stray keystroke into a live session.
- **The payload contract** was spelled out verbatim from
  `parsePendingPromptState`: pending iff `status === 'permission_request'` OR
  `options.length > 0` OR `question` is a string; options are `{key, label, action?,
  rule?}` where `key` is the menu digit and doubles as the keystroke to send.

### Bonus bug found while verifying (#21)

`hooks.json`'s `Notification` matcher is `"idle_prompt|permission_prompt"`, but the
hooks reference confirms that matcher filters on notification **type** and that
`elicitation_dialog` is a valid type. The handler at `ai-maestro-hook.cjs:372` therefore
cannot run: an agent blocked on an MCP elicitation dialog surfaces as **idle** in AI
Maestro's status ladder rather than blocked. `agent_needs_input` is excluded the same way.

## Approval log
- 2026-07-10T05:26:00+0200 — COMPLETED by a bulk archival sweep (no approver was recorded). The work reached its terminal column long before; only the folder move was missed. Completion evidence is in implementation-commits and git history.
