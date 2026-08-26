---
trdd-id: W4MTW35A
title: The identity mapping table that kernel peer credentials rely on is writable by every agent
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:32:08+0200
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
priority: 0
severity: critical
labels: [security, impersonation, agent-auth, guarantor-integrity]
external-refs: [TRDD-EVO7T245, TRDD-K4BEKT3L]
---

## Problem

(A) — the kernel-peer-credential design — reads the connecting PID truthfully from the kernel,
then consults a FILE to turn that PID into an agent identity. That file is writable by every
agent.

## Evidence (measured 2026-08-26)

```
-rw-r--r-- 1 emanuelesabetta staff 19615  ~/.aimaestro/agents/registry.json
registry writable by this uid: True
```

## Why it matters

Rewrite the mapping, keep the kernel honest, obtain any identity you like. The kernel
attestation is unforgeable and the LOOKUP is not, so the weakest link is the file — and
no amount of hardening the syscall path compensates.

This is the same class as TRDD-K4BEKT3L (writable server tree): the mechanism is sound and
its inputs are attacker-controlled.

## Task

1. INVESTIGATE — enumerate every file the identity resolution reads (`registry.json`,
   `teams.json`, `groups.json`, session/pane maps, anything under `~/.aimaestro`).
2. ASSESS — which of them can change an identity decision if mutated.
3. SAFEGUARD — make the identity-bearing state unwritable by the agent uid (root-owned,
   or server-owned under a separate service account), or authenticate it (signed records
   the server verifies on read).

## Acceptance

- [x] Every file consulted during identity resolution enumerated, with owner and mode.
- [x] For each, a statement of what mutating it does to an identity decision.
- [ ] Safeguard applied so the agent uid cannot mutate them.
- [ ] A probe run AS AN AGENT proving the write is no longer possible.
- [ ] A regression check that fails if any identity-bearing file becomes agent-writable.

## Investigation — 2026-08-26 (read-only, evidence only; no safeguard applied)

**Files the identity path consults**, ranked by how many code sites read them:

```
12 sites  ~/.aimaestro/sessions.json          -rw-r--r--
 8 sites  ~/.aimaestro/agents/registry.json   -rw-r--r--
 3 sites  ~/.aimaestro/teams/teams.json       -rw-r--r--
 2 sites  ~/.aimaestro/amp-api-keys.json      -rw-------
```

**Full identity-bearing set and its mode split** (chat-state, backups and ledger archives
excluded):

| mode | files |
|---|---|
| `644` — world-readable, owner-writable | `agents/registry.json`, `agent-directory.json`, `teams/teams.json`, `teams/groups.json`, `sessions.json`, `governance.json`, `governance-requests.json`, `manager-trust.json`, `hosts.json`, `system-settings.json` |
| `600` — owner-only | `amp-api-keys.json`, `governance-tokens/active-tokens.json`, `webauthn-credentials.json`, `aid-recovery-cache.json`, the `*.ledger.json` files |

**What mutating them does to an identity decision:**

- `registry.json` / `agent-directory.json` — the name/uuid/workdir map. Rewriting it re-points
  an identity. This is the file a kernel-attested PID is resolved THROUGH, so it is the
  weakest link in the peer-credential design.
- `sessions.json` — the most-read file on the path (12 sites). A session→agent remap is an
  identity remap.
- `teams/teams.json`, `groups.json`, `manager-trust.json`, `governance.json` — decide title,
  team and authority, i.e. what an identity is ALLOWED to do once resolved.

**The 600/644 split buys nothing under this threat model, and that is the point.** Someone
deliberately locked the sensitive stores to owner-only — but every agent IS the owner, so 600
and 644 are the same permission here. Identical to the `private.pem` 0644→0600 fix recorded in
`agent-isolation-is-not-enforced` (ATOM-UBMF-AWTG): a protection against other Unix users, on a
system that has none.

**Reachability from an agent** — established by uid identity, as in TRDD-K4BEKT3L. Re-derive it,
do NOT quote a process count: the population drifts (31 / 22 / 21 / 20 within one session) and it
includes any non-agent `claude` session on the box, such as the hub's own. The load-bearing fact
is the CARDINALITY of the uid set:

```bash
ps -eo user,pid,command > /tmp/p.txt
awk '$4 ~ /claude$/ {print $1}' /tmp/p.txt | sort -u   # 2026-08-26 -> one row: emanuelesabetta
``` Not tested by driving a live agent
(blacklist), and the uid identity is the stronger proof.

**Not yet done:** the safeguard. Note it cannot be "chmod 600" — that is the fix already proven
inert. It must be a different OWNER (root or a server service account), or authenticated records
the server verifies on read.
