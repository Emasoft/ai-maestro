---
trdd-id: ZA8GMJJB
title: Adopt CLAUDE_CODE_PROJECT_DIR_NAME and converge the second documented project-slug implementation
column: complete
created: 2026-08-28T02:21:59+0200
updated: 2026-08-28T22:53:57+0200
current-owner: hub-claude
created-by: hub-claude
task-type: refactor
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T02:21:59+0200
---

# Adopt CLAUDE_CODE_PROJECT_DIR_NAME and converge the second documented project-slug implementation

## Problem
Claude Code 2.1.234 added `CLAUDE_CODE_PROJECT_DIR_NAME`: a host that gives each session its own config directory can choose a SHORT name for the per-project transcript directory. It overrides the `absolute-workdir, / -> -` derivation this repo depends on to find `~/.claude/projects/<slug>/`.

ai-maestro is exactly that kind of host — it gives every agent its own workdir — and the slugs it produces today are long (`-Users-<user>-agents-<name>`). Nothing sets the variable, so nothing is broken; the risk is that the day anything does, every reader silently reports 'no transcript' rather than erroring.

Commit 5fb974db converged three ad-hoc copies onto `lib/claude-conversation.ts::conversationSlug()`. TWO derivations remain:

- `lib/claude-conversation.ts:119` — the canonical one, the single place any adoption would change.
- `services/sessions-browser-service.ts:51` (`slugifyWorkingDirectory`) — ANSWERED 2026-08-28: the
  two describe **different rules, and deliberately so**, so they are NOT converged into one function.
  `conversationSlug` RESOLVES a known-good absolute POSIX dir (`path.resolve`); `slugifyWorkingDirectory`
  DEFENSIVELY NORMALIZES an arbitrary string, returning `null` for empty or a bare `/` and handling
  Windows separators (`C:\\Users\\e` → `C:-Users-e`, pinned by its own test). `path.resolve` would
  anchor that non-POSIX-absolute input to the process cwd and mangle it, so the canonical helper cannot
  replace it.
  What WAS a real gap: slugify collapsed neither interior `//` nor `.`/`..`, so `/a/b/../c` derived
  `-a-b---c`, matching no real directory — the agent then silently reports ZERO SESSIONS, the exact
  failure its own leading-dash note warns about, reached by another route. Fixed with
  `path.posix.normalize` (normalize, not resolve — it invents no base). Neuter recorded: removing it
  reddens exactly the two new tests and nothing else.

## Proposed work
1. Read both docstrings and establish whether they actually describe the same rule. If they do, converge; if they do not, the difference is a finding worth its own note.
2. Decide whether ai-maestro should SET `CLAUDE_CODE_PROJECT_DIR_NAME` per agent. Shorter, stable transcript dirs would be a real win; the cost is that every existing agent's transcripts live under the old slug, so adoption needs a migration or a dual-read.

## Acceptance
- [x] the two remaining derivations are either one function or documented as deliberately different, with the reason
- [x] a written decision on whether to set the env var — DECIDED 2026-08-28: **NO, ai-maestro does not set `CLAUDE_CODE_PROJECT_DIR_NAME`.** See `## Decision` below
- [x] a test pins that a workdir with a doubled slash resolves to the same slug as without

## Decision — do NOT set `CLAUDE_CODE_PROJECT_DIR_NAME` (2026-08-28)

The slug is not one reader's convention; it is the shared key of every consumer of
`~/.claude/projects/<slug>/`, and most of them are NOT this repo:

- in-repo: 7 files derive or consume it (`conversationSlug` / `slugifyWorkingDirectory` sites, the
  restart-continuity probe, the sessions browser, agents-chat) — `services/agents-chat-service.ts:59`
  already names the one-place adoption point, so the IN-REPO cost is small;
- out-of-repo, and the reason to refuse: the janitor plugin (a different project) derives the same slug
  on its own for the LOCAL memory scope (`~/.claude/projects/<slug>/memory/`), the LOCAL TRDD scope
  (`…/design/`), `token_report.py`, `fleet_status.py`; the harness's own auto-memory dir uses it too.
  Setting the var per agent would make Claude Code write transcripts under the SHORT name while every
  other reader keeps looking under the LONG slug — the silent "no transcript / no memory / no local
  cards" failure this card exists to avoid, delivered by us on purpose.

Benefit: cosmetic (shorter directory names). Cost: a migration or dual-read of every existing agent's
transcripts, plus cross-project coordination with the janitor. Nothing is broken today. So: not set.

Existing transcripts: untouched — no migration, no dual-read, because nothing changes.

Revisit trigger (named so the refusal is not forever): Claude Code makes the var the ONLY derivation,
or the janitor adopts it first. Either way the adoption is `conversationSlug()` + the janitor in the
same change, never one side alone.

## Approval log

- 2026-08-28T02:21:59+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T22:53:57+0200 — COMPLETED by hub-claude. 3/3 boxes; the decision is recorded in `## Decision`.
- 2026-08-28T22:53:57+0200 — COMPLETE by emanuelesabetta. archived → complete.
