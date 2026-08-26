---
trdd-id: NFHFN8AJ
title: The keychain ACL for the encryption key would bind to an adhoc-signed node that every agent can run
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
min-approval-requirement: user
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, encryption-at-rest, code-signing]
external-refs: [TRDD-EVO7T245]
---

## Problem

The owner's design encrypts all tokens and keys at rest and holds the decryption key in the
macOS keychain, accessible only to the ai-maestro server binary once that binary is
registered with Apple. A keychain ACL binds to a CODE-SIGNED EXECUTABLE. The current
executable is a generic interpreter that every agent can run.

## Evidence (measured 2026-08-26)

```
server executable : /opt/homebrew/Cellar/node@22/22.23.1/bin/node
Signature         : adhoc
TeamIdentifier    : not set
agent can run it  : YES  (ran an arbitrary script under that exact binary)
```

An adhoc signature carries no Team ID and no Apple registration, and it changes on every
reinstall. Any script an agent runs under that same `node` presents the same identity to the
keychain, so the ACL protects nothing while the server ships as `tsx server.mjs`.

The owner's phrasing already anticipates this — *"once the binary is registered with apple"*
— so this card records the precondition and its cost rather than disputing the design.

## Task

1. INVESTIGATE — confirm the ACL-binds-to-signed-executable mechanism against Apple's
   current keychain behaviour (the measured half above stands regardless; the mechanism is
   recalled, not measured).
2. ASSESS — what shipping a signed standalone binary costs here, given node-pty is pinned to
   NODE_MODULE_VERSION 127 and better-sqlite3 caps below Node 26.
3. SAFEGUARD — ship a signed binary with a real Team ID, or choose a different key custody
   mechanism that does not rest on binary identity.

## Acceptance

- [ ] The ACL mechanism confirmed or corrected against a first-hand measurement.
- [ ] A decision recorded: signed binary, or alternative custody.
- [ ] If signed binary: the native-module pinning survives the packaging, demonstrated.
- [ ] A probe proving a non-server process CANNOT retrieve the key.
