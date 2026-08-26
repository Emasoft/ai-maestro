---
trdd-id: 0GX8FOCJ
title: A sandbox profile built by string interpolation can be altered by an attacker-chosen agent name
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:18:32+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, sandbox, injection]
external-refs: [TRDD-EVO7T245]
---

## Problem

The per-agent sandbox profile is an S-expression containing the agent's own identifiers:

```lisp
(allow file-read* file-write* (subpath "<agents-root>/<agent-name>"))
```

Agent names are supplied through the creation wizard. If the profile is produced by string
interpolation, a name containing `")` followed by an `(allow ...)` form breaks out of the
intended rule and appends attacker-chosen policy — including `(allow default)` or an allow
for another agent's directory.

The agent would then be sandboxed by a profile it wrote part of.

## Why it is easy to get wrong

The profile is generated at spawn, in the same code that generates tmux arguments, where
array-args already prevent shell injection. That existing correctness invites the assumption
that the profile is equally safe — it is not; it is a different language with different
escaping.

## Task

1. INVESTIGATE — determine what characters the wizard permits in an agent name, and what
   the AID/uuid format guarantees.
2. ASSESS — construct a name that alters the emitted profile, or prove the charset makes it
   impossible.
3. SAFEGUARD — emit the profile through a serializer that escapes or rejects, never a
   template. Prefer substituting only the UUID (a fixed charset) and never the display name.

## Acceptance

- [ ] Permitted agent-name charset recorded, with the wizard's validation cited.
- [ ] A demonstration that a hostile name does or does not alter the profile.
- [ ] Profile emission uses a serializer or a fixed-charset identifier only.
- [ ] A test feeding a hostile name and asserting the emitted profile is unchanged in shape.
