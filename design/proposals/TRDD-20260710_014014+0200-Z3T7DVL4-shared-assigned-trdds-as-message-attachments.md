---
trdd-id: Z3T7DVL4
title: Assigned TRDDs are shared objects attached to the message, not copies
column: proposal
approval-tier: 2
created: 2026-07-10T01:40:14+0200
updated: 2026-07-10T01:40:14+0200
current-owner: ai-maestro-session
assignee: null
priority: 1
severity: HIGH
effort: XL
task-type: feature
release-via: deploy
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [three-pillars, trdd, kanban, amp, governance, user-directive]
test-requirements: [unit, integration]
review-requirements: [human-review]
runtime-targets: [macos, linux]
impacts: [public-api, config-schema, migration]
attempts: 0
implementation-commits: []
external-refs: []
---

# TRDD-Z3T7DVL4 — an assigned TRDD is a shared object, not a copy

**Tier 2.** This changes AMP message semantics, TRDD ownership, kanban projection,
and introduces an approval gate on a receiver's edits. That is architecture plus
governance, so it is proposed, never self-approved.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

Authored from a USER directive given 2026-07-10T01:38 (verbatim in §1). **The
directive's last sentence is TRUNCATED** — it ends `"...the kanban metadata about
itself) and"`. Ask the USER to complete it before designing past §5. Do not guess
the tail.

Nothing is built. This is capture + first analysis. The load-bearing finding is
§4: **a filesystem symlink cannot be the sharing primitive**, because AI Maestro
agents may live on different hosts. Sharing must be by *reference resolved through
the server*, not by a link in a filesystem.

## 1. The directive, verbatim

> one thing that facilitate the work when inside the ai-maestro harness is that
> what the MANAGER or the CHIEF-OF-STAFF or the ORCHESTRATOR send to the agents is
> not only the message, but directly the TRDD file with all the details of what to
> do. The TRDD can be attached to the messages and become shared between the sender
> and the receiver. They must be shared because the same file can be updated by
> both and be instantly available to both for review. any change to a TRDD by a
> receiver must be approved by the sender. if the sender is the same agent (like
> for local TRDDs) this is of course not necessary. But for assigned TRDD, they are
> automatically shared (via symlink? i leave that to you, but must be
> crossplatform), and automatically added to the kanban with the assignee. This is
> the power of the 3-pillars task system: the TRDD is the atomic element of the
> design that is at the same time the kanban itself (since each TRDD carry in its
> own frontmatter the kanban metadata about itself) and

*(message ends here — truncated.)*

## 2. What this asks for, itemized

1. A message from MANAGER / CHIEF-OF-STAFF / ORCHESTRATOR **carries the TRDD**, not
   merely a reference to it.
2. The attached TRDD becomes **shared** between sender and receiver — one object,
   two viewers.
3. **Either party may edit**, and the change is **instantly visible** to the other.
4. **A receiver's edit requires the sender's approval.** A sender editing their own
   TRDD needs no approval. Self-assigned / local TRDDs need no approval.
5. Assignment **auto-shares** the TRDD (mechanism deliberately left open) and
   **auto-adds it to the kanban with the assignee set**.
6. The unifying claim: the TRDD is simultaneously the atomic unit of design **and**
   the kanban card, because its frontmatter carries its own kanban metadata.

## 3. How much of this already exists (verified, not assumed)

Point 6 is **already true by construction**, and it is worth stating plainly so we
do not rebuild it:

- `column:` in TRDD frontmatter *is* the kanban state. The DEP overlay
  `rules/aimaestro/aimaestro-kanban-multiagent.md` makes the TRDD corpus the
  **single source of truth**; the dashboard board and any GitHub Project are
  **one-way mirrors** of it. `assignee:` already exists in the v2 frontmatter.
- The 17-column vocabulary is ratified and 1:1 between the TRDD `column:` field and
  the server's `TaskStatus` (TRDD-YUGDER9D).
- **R15.4 already says an AMP message carries only the TRDD-id and a one-line
  request, because "the TRDD itself is the canonical record."** So the intent of
  point 1 is present; what is missing is *resolution* — the receiver has an id but
  no guaranteed way to open, watch, or write the file.
- The approval machinery exists in shape: every TRDD carries an `## Approval log`,
  and `trdd-approval-tiers` defines a proposal → approve/refuse flow with a
  `git mv` between folders. A receiver-edit gate is the same pattern, at a finer
  grain.
- `aimaestro-trdd.sh` already exposes `search`, `read`, `edit`, `approve`,
  `refuse`, `promote`, `archive`.

So the genuinely new work is: **shared mutable access with an approval gate on the
receiver's side, across agents that may not share a filesystem.**

## 4. Why a symlink cannot be the answer (the load-bearing constraint)

The directive says "via symlink? i leave that to you, but must be crossplatform."
Three independent reasons it cannot be the primitive:

1. **Cross-host.** AI Maestro addresses agents as `agentId@hostId` over a Tailscale
   mesh. A MANAGER on host A can assign a TRDD to a MEMBER on host B. **There is no
   filesystem between them.** A symlink is undefined for the primary use case.
2. **Windows.** Symlink creation needs Developer Mode or
   `SeCreateSymbolicLinkPrivilege`; git-for-Windows checks symlinks out as plain
   text files by default. "Cross-platform symlink" is not a thing we can rely on.
3. **Editors break links.** Most editors (and every atomic-write path we already
   use) write a temp file and rename over the target, which **replaces** a hardlink
   and can replace a symlink. The link would silently decay into a copy — the exact
   divergence the directive is trying to prevent.

A same-host, same-user, POSIX-only symlink is a *possible optimization*, never the
contract.

## 5. Proposed shape — share by reference, resolved by the server

The TRDD file has exactly **one canonical location**: the `design/` tree of the
**sender's** project, git-tracked as today. Nothing is copied on assignment.

- **Attach = a resolvable handle.** The AMP message carries
  `<project-id>:TRDD-<id8>` (the project-scoped citation form the approval-tier rule
  already defines). This keeps R15.4 intact.
- **Open / watch / write via the script layer.** The receiver reads with
  `aimaestro-trdd.sh read`, and the server resolves the handle to the canonical
  file — locally, or over the mesh to the owning host. The receiver's local copy, if
  materialized at all, is a **read-through cache**, never an authority.
- **"Instantly available" = a change channel, not a shared inode.** We already run a
  WebSocket broadcast layer and AMP push. A TRDD write emits a change event to every
  agent holding a handle. This is the only mechanism that works cross-host, and it
  makes the same-host case correct too.
- **The approval gate is a write mode, not a new subsystem.** A write from the
  `assignee` lands as a **pending edit** (proposed diff) rather than a mutation. It
  is delivered to the sender, who applies or refuses it; the outcome appends to
  `## Approval log`. A write from the TRDD's owner (`current-owner`), or where
  sender == receiver, applies directly. This reuses the proposal → approve/refuse
  vocabulary rather than inventing a second one.
- **Kanban is a projection, so "auto-added with the assignee" is free** — the moment
  `assignee:` is set and the TRDD is in `design/tasks/`, it is on the board. The new
  part is that the **assignee's** project board must also show a TRDD it does not
  own. That means a board query over handles, not over the local filesystem only.

## 6. Hard questions this proposal does NOT settle

1. **The truncated sentence.** Ask the USER.
2. **Which board owns an assigned TRDD?** It belongs to the sender's project but
   appears on the assignee's board. Does it appear on both? Does moving its column
   from the assignee's board write back to the sender's project's git tree?
3. **Concurrent edits.** Two writers on one file. Do we take a lock, or accept the
   pending-edit queue as serialization? (The pending-edit model gives serialization
   for free on the receiver's side, but the owner can still write underneath it.)
4. **Offline / hibernated receiver.** The command queue solved this for commands. A
   TRDD handed to a hibernated agent must resolve on wake, not fail at send.
5. **Cross-host git.** If the canonical file is git-tracked in the sender's repo,
   the receiver's write-back must eventually become a commit **in the sender's
   repo**, authored by an agent that cannot push there. Commit-on-approval, by the
   owner, is the obvious answer. Confirm it.
6. **Blocked on `manage-trdd`.** `aimaestro-trdd.sh`'s write verbs (`edit`,
   `approve`, `refuse`, `promote`, `archive`) **403 for agents today** — they sit in
   `AGENT_POLICY_PENDING` (`lib/sudo-guard.ts`) awaiting a `manage-trdd` AuthAction
   whose matrix mirrors the approval tiers. **This proposal cannot ship before that
   action exists**, and the matrix it needs is precisely the sender/receiver
   asymmetry described here. That is not a coincidence — it is the same decision.
7. **Who may be a sender?** The directive names MANAGER, CHIEF-OF-STAFF,
   ORCHESTRATOR. Under R6 v3 the COS is the sole gateway into a closed team, and
   MANAGER may not reach in-team non-COS agents directly. An attachment is a
   message, so it inherits the comm graph. Confirm that assignment cannot route
   around R6.

## 7. Why this is Tier 2

It creates a governance object (an approval gate on a file edit), changes AMP
message semantics, and gives an agent write-influence over a file in another
project's git repository. Any one of those is a MANAGER call; together they are
architectural. The `manage-trdd` AuthAction it depends on (§6.6) is itself an
unmade policy decision.

## Approval log
