---
trdd-id: TDFSELI1
title: Read and answer AskQuestion and permission prompts via API
column: completed
created: 2026-07-09T10:27:08+0200
updated: 2026-07-10T05:26:00+0200
implementation-commits: [f401728d]
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: npt
npt: []
eht: []
relevant-rules: []
labels: [askquestion, permission, terminal-control, api, hook]
test-requirements: [unit, integration]
review-requirements: [human-review]
impacts: []
external-refs: []
---

# TRDD-TDFSELI1 — AskQuestion/permission read+answer API

> **Graph correction 2026-07-10 (corpus sweep).** This TRDD claimed two children
> it does not have: `eht: [TRDD-280DF70U]` and `npt: [TRDD-GT0TAJFL]`. Both are
> siblings — the epic TRDD-SCLSRS6E is the sole parent of each, and still claims
> them. An `npt:`/`eht:` edge declares parenthood; a *dependency* on a sibling
> belongs in `blocked-by:`. Both edges expressed real ordering (this API needs the
> script wrappers, and its capture half needs the hook change in GT0TAJFL) and both
> are moot now that GT0TAJFL and 280DF70U are complete — `blocked-by:` carries only
> OPEN blockers. This TRDD is itself an NPT of the epic; a derived TRDD carries no
> children of its own (depth is exactly 1).

Expose the hook's already-captured permission-prompt data (tool name, description,
selectable options) through the API, and add a way to answer a pending prompt by
option key or free text — not just the hardcoded `y` the UI currently sends.

## What exists today

- The hook `ai-maestro-hook.cjs` (lives in the **ai-maestro-plugin** repo, cached at
  `~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-plugin/2.8.0/scripts/`)
  already CAPTURES, on a tool-permission prompt (`PermissionRequest` event, lines
  253-320): `toolName`, `toolInput`, `description`, and an `options[]` array shaped
  `{key, label, action}`. This is written to
  `~/.aimaestro/chat-state/<hash>.json` under `status: waiting_for_input`.
- BUT: `getHookState()` (`services/sessions-service.ts:174`) only surfaces
  `{status, notificationType, subagentCount}` — it drops `toolName`, `toolInput`,
  `description`, and `options[]` entirely. No API route exposes the rich fields.
- There is **no AskUserQuestion-specific extraction**: that tool fires
  `idle_prompt`, not `permission_prompt`, so the hook does not currently capture its
  question text or choice labels at all (this half is the cross-repo dependency —
  see D7 / TRDD-GT0TAJFL).
- Answering today: only a hardcoded `y` keystroke, sent via
  `components/AgentProfile.tsx` `handleApprove` → `POST /api/sessions/[id]/command`
  `{command: 'y'}`. There is no option-index or free-text answer path.

## What to build

1. Extend `getHookState()` (or add a new `readPendingPrompt(workingDir)` helper in
   `services/sessions-service.ts` or a new `lib/` module) to parse the FULL captured
   prompt: `toolName`, `description`, `options[]`, plus — once TRDD-GT0TAJFL (D7)
   lands — the AskUserQuestion question text + choices.
2. NEW `GET /api/agents/[id]/prompt` — returns the currently pending
   question/permission prompt with its options, or `null` if none is pending.
3. NEW `POST /api/agents/[id]/prompt/answer` — accepts `{optionKey}` OR `{text}`.
   Resolves an `optionKey` to the digit/keystroke the terminal expects and sends it
   via the existing `sendAgentSessionCommand`; a `{text}` payload is sent as free-text
   input. Strict-classify this route (it injects into a live agent terminal).
4. UI: an AgentProfile answer picker that goes beyond the single `y` Approve button
   (OPTIONAL for this TRDD — may be split into a follow-up TRDD if scope runs long).

Cross-repo dependency: the hook must ALSO capture AskUserQuestion (its question text
and the option labels) for the full parse in step 1 to have that data available —
tracked separately in TRDD-GT0TAJFL (filed against the `ai-maestro-plugin` repo).

## Files to touch

- edit `services/sessions-service.ts` — add `readPendingPrompt` (or extend
  `getHookState`) to surface the full captured prompt shape.
- NEW `app/api/agents/[id]/prompt/route.ts` — `GET` (read pending prompt).
- NEW `app/api/agents/[id]/prompt/answer/route.ts` — `POST` (answer by optionKey or
  text).
- optionally `components/AgentProfile.tsx` — richer answer picker beyond `y`.

## Tests

- Parsing a permission chat-state fixture (`toolName`, `description`, `options[]`
  present) surfaces all fields through `readPendingPrompt`/`getHookState`.
- `GET /api/agents/[id]/prompt` returns `null` when no prompt is pending.
- `POST .../prompt/answer` with `{optionKey}` resolves to the correct keystroke and
  calls `sendAgentSessionCommand` with that value.
- `POST .../prompt/answer` with `{text}` sends the free-text payload as-is.
- An AskUserQuestion fixture (once the D7 hook capture lands) parses correctly into
  question text + choice labels.

## Outcome (2026-07-09) — complete in THIS repo; the AskUserQuestion half awaits the plugin

`column: complete` refers to this repo's deliverable, which shipped in `f401728d`:
`GET /api/agents/[id]/prompt` + `POST /api/agents/[id]/prompt/answer`, the pure
`parsePendingPromptState` parser, and the `aimaestro-session.sh read-prompt|answer`
wrappers (TRDD-280DF70U). Live-verified in Phase E, including the `409` refusal when
answering a prompt that is not pending.

**Read this before assuming `read-prompt` works for every menu.** It returns the full
prompt for **tool-permission** menus today. It returns **no `question` and no
`options` for AskUserQuestion menus**, because `ai-maestro-hook.cjs` does not capture
that tool — `PendingPrompt.question` is a forward-compat slot that stays `undefined`
until the hook lands the capture. That work is cross-repo and cannot be done from here:
filed as **Emasoft/ai-maestro-plugin#20** (its NPT, TRDD-GT0TAJFL, is `complete` because
its in-repo deliverable was to file and track that issue).

Consequence for a governance agent: an agent stuck on an AskUserQuestion menu shows as
blocked, but its choices are unreadable. `answer --text` still works; `answer --option`
has nothing to select. Verifying #20 landed is the trigger to revisit this TRDD.

Also surfaced while filing #20 and recorded there: the capture point is `PreToolUse`
(`matcher: "^AskUserQuestion$"`), not the hook's `Notification` path — a `Notification`
carries no `tool_input` and so cannot supply the question text — and it must be paired
with a `PostToolUse` clear, or an answered question stays "pending" until the end of the
turn and a polling agent answers it twice.

## Approval log
- 2026-07-10T05:26:00+0200 — COMPLETED by a bulk archival sweep (no approver was recorded). The work reached its terminal column long before; only the folder move was missed. Completion evidence is in implementation-commits and git history.
