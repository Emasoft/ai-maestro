---
trdd-id: 0QC40GBG
title: Role-plugins must instruct the frozen CLI in their skills (R23 iron rule), fleet sweep still active
column: proposal
status: proposed
created: 2026-10-06T21:12:14+0200
updated: 2026-10-06T21:12:14+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: manager
scope: project
project-id: ai-maestro
approved: false
---

# Role-plugins must instruct the frozen CLI in their skills (R23 iron rule), fleet sweep still active

## Problem
Issue 107 restates the USER iron rule: direct server API calls are forbidden for agents; plugins must instruct in their SKILLS to use the ai-maestro scripts, never the API. The persona stating it is not enough because skills load on demand in isolation and the decision-time checklist is what gets consulted.
## Current open ask
The thread is active and the plugins are working it themselves: AUTONOMOUS shipped Q13 and the rule in all three SKILL.md files; MAINTAINER found clause 2 failing in three places (a command with no prohibition, the weakest wording in the trdd skill, hooks that instructed nothing) and fixed it in v1.10.0 with a two-detector test; the MANAGER moved from a 3-of-10 to a 1-of-10 skills count and pinned a byte-exact canonical block. Open requests to the hub: (1) publish R23 as a versioned file in the hub repo (path plus blob sha, per 3P-VER-05) so mirrors can poll it instead of pinning an issue comment; (2) canonical wording in the core plugin that plugins inherit rather than re-phrase; (3) whether the janitor report that triggered the directive names specific plugins, which would make the sweep targeted. The hub said no hub action is owed unless a specific gap needs a decision.
## Evidence
Audit docs_dev/issue-coverage-audit-20261006.md row 107: MENTION-ONLY (one passing mention in BRRJK57P), plugins report clause 2 fixed, thread active.
## Acceptance
- [ ] R23 canonical text published as a versioned file
- [ ] Inheritable canonical wording available from the core plugin
- [ ] The janitor report naming plugins located or its absence recorded
external-refs: Emasoft/ai-maestro issue #107 (https://github.com/Emasoft/ai-maestro/issues/107)

## Approval log
