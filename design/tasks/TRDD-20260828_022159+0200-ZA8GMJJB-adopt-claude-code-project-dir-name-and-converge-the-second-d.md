---
trdd-id: ZA8GMJJB
title: Adopt CLAUDE_CODE_PROJECT_DIR_NAME and converge the second documented project-slug implementation
column: todo
created: 2026-08-28T02:21:59+0200
updated: 2026-08-28T02:29:14+0200
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
- [ ] a written decision on whether to set the env var, including what happens to existing transcripts if we do
- [x] a test pins that a workdir with a doubled slash resolves to the same slug as without

## Approval log

- 2026-08-28T02:21:59+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
