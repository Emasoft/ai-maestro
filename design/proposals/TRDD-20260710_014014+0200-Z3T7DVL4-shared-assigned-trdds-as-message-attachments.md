---
trdd-id: Z3T7DVL4
title: Assigned TRDDs are shared objects attached to the message, not copies
column: proposal
min-approval-requirement: user
created: 2026-07-10T01:40:14+0200
updated: 2026-08-15T01:02:27+0200
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

Authored from a USER directive of 2026-07-10, received COMPLETE on the third send
(verbatim in §1; the first two sends were truncated mid-clause).

Nothing is built. This is capture + analysis. Four load-bearing findings:

1. **§4 — a filesystem symlink cannot be the sharing primitive.** Agents live on
   different hosts; for the primary case there is no filesystem between them. The
   directive's closing constraint kills it a second time: a symlink cannot express
   "scoped by project and role."
2. **§3.5 — the third pillar's automation does not exist as code.** `approval-tier:`
   is hand-written in 13 TRDDs today. Nothing reads the PRRD and computes it.
   Verified 2026-07-10: no tier-floor evaluator, no watchdog anywhere in `scripts/`,
   `lib/`, or `services/`. The rules DESCRIBE it (D3/D4 of the DEP overlay
   `aimaestro-trdd-approval.md`); the code does not exist.
3. **§3.6 — the shared unit is the `design/` FOLDER, not one file.** Load-bearing,
   not a wording choice: deciding "does this change need golden/silver approval"
   requires the owning project's `design/requirements/PRRD.md`. A lone TRDD does not
   carry its own rules — only its `relevant-rules:` citations.
4. **§3.7 — sharing is a SCOPED VIEW, per project and per role.** The directive's
   final clause. Not a blanket share: R6 team isolation and the comm graph already
   say a MEMBER of team X may not reach team Y, and COS is the sole gateway into a
   closed team. A share that ignores that is a governance hole, not a convenience.

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
> own frontmatter the kanban metadata about itself) and the governance system (since
> the TRDD carry the approval requirements of itself, and the first pillar PRRD
> provides the means to automatically know if a change require a certain level of
> approval simply comparing it with the project rules of silver or gold level). make
> sure everything is ready to use this system in its fullness. and make sure the
> sharing of the design folder is made according to the project and the role,
> following the governance rules.

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
7. **And the governance system**, because the TRDD carries its own approval
   requirements, and the PRRD (pillar one) makes the required approval level
   *computable* — compare the change against the project's golden/silver rules.
8. **"Ready to use in its fullness"**, and **the `design/` folder is shared according
   to the project and the role, following the governance rules.**

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
receiver's side, across agents that may not share a filesystem, scoped by project
and role.**

## 3.5 The third pillar is described but NOT BUILT

The directive's claim — *"the first pillar PRRD provides the means to automatically
know if a change require a certain level of approval simply comparing it with the
project rules of silver or gold level"* — is exactly the **objective tier-floor** of
`rules/aimaestro/aimaestro-trdd-approval.md` §D3, and its lazy **classification
watchdog** §D4. The design is written. The code is not.

Verified 2026-07-10 across `scripts/`, `lib/`, `services/`:

| Piece | Status |
|---|---|
| `approval-tier:` frontmatter field | exists — hand-written in 13 TRDDs |
| `relevant-rules:` citation field | exists |
| PRRD golden/silver rule file + `get-prrd.py` / `prrd-edit.py` / `findprrd.py` | exist (per the IND rule) |
| **Anything that READS the PRRD and COMPUTES a TRDD's minimum tier** | **does not exist** |
| **The watchdog that compares declared tier to the floor and auto-corrects** | **does not exist** |

So "make sure everything is ready to use this system in its fullness" has a concrete
first deliverable: **a tier-floor evaluator**. Given a TRDD (and its proposed diff)
plus the project's PRRD, return the minimum approval tier from the D3 signals, which
are deliberately mechanical — path globs, keyword greps, dependency names — so the
cheap script pre-filter runs on every change and the expensive LLM confirm runs only
on the handful of suspects (§D6's token discipline).

A receiver that can compute this locally can self-classify a change *before* asking
for approval, which is the whole point of the pillar: the TRDD carries its own
approval requirements.

## 3.6 The shared unit is the folder, because the rules live outside the TRDD

The directive says *"the sharing of the design folder"* — not "the TRDD file". That
is necessary, not incidental. A TRDD cites `relevant-rules: [3, 27, 64.134]`; it does
not contain them. To decide whether an edit crosses a golden rule, the receiver needs
`design/requirements/PRRD.md` of the **owning** project.

Minimum shared surface for an assigned TRDD, therefore:

- the TRDD file itself (read + gated write),
- `design/requirements/PRRD.md` (read-only — the rules it is judged against),
- enough of `design/{tasks,proposals}/` to resolve its `npt:` / `eht:` / `blocked-by:`
  graph, which is what tells the receiver whether it may start at all.

Not shared by default: the rest of the owning project's board.

## 3.7 "According to the project and the role" — the share is an ACL, not a link

The final clause is the tightest constraint in the directive, and it independently
rules out every filesystem-link scheme: **a symlink has no notion of who is reading
it.**

Scoping must fall out of governance rules we already have, not a new ACL language:

- **R6 comm graph** already decides who may send to whom. An attachment rides a
  message, so it inherits the graph. A MANAGER cannot hand a TRDD directly to an
  in-team non-COS agent, because MANAGER→ORCHESTRATOR/ARCHITECT/INTEGRATOR/MEMBER
  edges were deliberately removed in v3 — the COS is the sole gateway. **Assignment
  must not become a side channel that reintroduces those edges.**
- **Team isolation** already decides visibility: a MEMBER of team X has no business
  reading team Y's `design/`.
- **The governance title** decides the write mode: the TRDD's `current-owner` writes
  directly; the `assignee` writes as a pending edit; everyone else reads or is
  refused.

So the share is a **server-mediated, per-(project, agent, title) view** over the
owning project's `design/` tree. This is the same conclusion §4 reaches from the
cross-host argument, arrived at independently — which is the strongest evidence it is
right.

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

## 6. Hard questions — ALL SEVEN ANSWERED IN §8. Read §8, not this list.

1. **Sequencing.** "Ready to use this system in its fullness" spans four
   deliverables, and they are not independent: (a) the `manage-trdd` AuthAction
   (§6.6) — without it agents cannot write a TRDD at all; (b) the **tier-floor
   evaluator** (§3.5) — without it the third pillar is prose; (c) the scoped
   `design/` view (§3.7); (d) the attach + pending-edit + change-channel flow (§5).
   (a) and (b) are prerequisites, and (a) is itself an unmade policy decision. Does
   the USER want them landed in that order, or a walking skeleton across all four?
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

## 7. The edit taxonomy — the one artifact everything else is read off

The USER says *"any change to a TRDD by a receiver must be approved by the sender."*
Taken literally that would gate `test-failures: 3`, and no one wants a MANAGER
approving a counter. The metaphor resolves it: **a cell's position and its readings
change constantly — that *is* circulation. What requires a compatibility check is a
change to the cell's markers.**

So the split is not new policy. It is `rules/aimaestro/aimaestro-manager-approval-defaults.md`'s
EXEMPT / NON-EXEMPT lists, **applied one layer down** — to file edits instead of
column moves.

| Class | Fields / transitions | Write from `assignee` |
|---|---|---|
| **CIRCULATION** (the cell reports where it is and what it carries) | `implementation-commits`, `ci-runs`, `last-test-result`, `last-test-at`, `test-failures`, `attempts`, `feature-branch`, `audit-evidence`, appended review notes / post-mortems; mechanical column moves (`dev↔testing`, `testing→ai_review`, `ai_review→dev`) | **applies directly** |
| **IDENTITY** (the cell's markers) | `title`, body scope / acceptance criteria, `approval-tier`, `relevant-rules`, `release-via`, `test-`/`audit-`/`review-requirements`, `npt`, `eht`, `blocked-by`, `parent-trdd`, `assignee`, `priority`, `severity`, `effort`, `impacts`; governance-crossing moves (`complete→publish\|deploy`, `→failed`, `→superseded`, `ai_review→human_review`) | **pending edit → owner approves** |

And the third pillar closes the loop: for an IDENTITY edit the **tier-floor evaluator**
(§3.5) reads the proposed diff against the project's PRRD and decides whether the
*owner's* approval suffices, or whether it escalates to COS / MANAGER / USER. The
receiver's edit inherits the approval-tier machinery it already lives under. Nothing
new is invented — the TRDD carries its own antigens, and the PRRD is the immune
system that reads them.

## 8.5 The Derived TRDD is the platelet — USER, 2026-07-10

The USER extended the metaphor, and the extension is a requirement, not a
flourish:

> the Derived-TRDD or D-TRDD, are crucial for the 3-pillars system to work.
> Because no change can exist in isolation. Everything affects what is around it.
> If the TRDD are the red blood cells of the ai-maestro circulatory system, the
> Derived-TRDD are the platelets: they will cover the holes left by the changes
> introduced by the TRDD. Without them, each TRDD will cause more damages than
> good. The D-TRDD must be produced along with any TRDD, and if an agent, even
> the receiver, think that a TRDD is missing a Derived-TRDD, it must notify this
> immediately to the TRDD sender, even writing a D-TRDD proposal to get approved
> by the MANAGER or the CHIEF-OF-STAFF or the ORCHESTRATOR.

Read against the rest of this document, three things follow.

**1. A TRDD without its D-TRDDs is a wound, not a delivery.** The NPT/EHT fields
already exist in the v2 schema, and the IND base already gates a parent's
`complete` on its EHTs reaching a terminal column. What was missing is the
*obligation*: `eht: []` is an assertion that the change touches nothing around
it, and that assertion is almost always false. A change that alters an observable
behavior owes an EHT for each downstream surface that behavior reaches. Prose in
a STATE block is not a platelet — it cannot be assigned, it does not block
`complete`, and nothing bleeds when it is ignored.

**2. The duty runs in BOTH directions along the vessel.** The sender authors the
D-TRDDs; the **receiver** who spots a missing one must say so *immediately* — and
may author the D-TRDD itself, as a **proposal** for MANAGER / CHIEF-OF-STAFF /
ORCHESTRATOR approval. This is the first place in this design where the assignee
originates a cell rather than circulating one, and it slots cleanly into §7: a
receiver-authored D-TRDD is a NEW TRDD in `design/proposals/`, not an IDENTITY
edit of the assigned one, so it needs no pending-edit machinery. It needs only
the comm-graph edge back to the sender — which, per §8 Q7, it already has,
because the notification *is* a message.

Note the approver list the USER named — MANAGER **or** COS **or** ORCHESTRATOR —
maps exactly onto the Tier 1/2 ladder: a D-TRDD confined to one team is the COS's
(Tier 1); the ORCHESTRATOR may approve within its own dispatch scope; anything
crossing a team, a project, or the release surface is the MANAGER's (Tier 2). No
new authority is introduced.

**3. Verify each platelet before authoring it.** A D-TRDD invented to satisfy a
quota is worse than none: it dilutes the ones that matter and it lies about blast
radius. The test is mechanical — name the downstream surface, then go read it. In
`TRDD-WNZ72SFO` (the first EHT authored under this rule) two candidate effects
were identified and only one survived: the subconscious indicator genuinely now
renders "Inactive" for eight agents, while the skill-settings 404 turned out to
have **zero consumers anywhere in the tree**. The non-effect was recorded inside
the surviving EHT so nobody re-derives it. Platelets clot holes; they do not clot
healthy vessels.

**Consequence for the walking skeleton (§8 Q1).** The narrowest complete circuit
must carry a D-TRDD, or it does not exercise the system: assign a TRDD, apply a
CIRCULATION edit directly, queue an IDENTITY edit for the owner's approval, **and
have the receiver notice a missing EHT and file it as a proposal.** That last leg
is the one that proves the vessel runs both ways.

## 8.6 The mandate — why an assigned TRDD arrives already approved (USER, 2026-07-10)

> mandate TRDD are just TRDD sent directly by the MANAGER, the CHIEF-OF-STAFF or
> the ORCHESTRATOR. they are different from normal TRDD because they came
> 'pre-approved', since they are essentially commands from above. […] the ones
> that can create them are the same that the approval requirements and the PRRD
> rules will require to approve them. […] a TRDD that require no approval, like a
> local MEMBER TRDD, are automatically approved and considered mandate (even if
> the mandate is from the agent itself, since he is both the sender and the
> receiver).

This closes a hole in §5 and §8 that I had not seen. The design so far described
how a cell *circulates* and who may *edit* it, but left "approval" as an event
that happens to a TRDD somewhere off-stage. It is not an event. It is a
**property of the author's authority relative to the TRDD's tier**:

```
mandate  ⟺  authority(author) >= required-approver(tier)
proposal ⟺  authority(author) <  required-approver(tier)
```

The proposal folder is not a stage every TRDD passes through. It is the holding
pen for TRDDs whose author could not approve them. **A TRDD authored by someone
who could have approved it is born approved**, because the approval round-trip
would be that agent asking itself for permission.

Three consequences for THIS design, each of which changes something above.

**1. The assignment message and the approval are the same act.** §8 Q7 concluded
that assignment must BE a message through `validateMessageRoute`, not a file write
plus a notification. The mandate rule tells us what that message carries: a TRDD
sent *down* the ladder — MANAGER→COS, COS→member, ORCH→member — is pre-approved
**by the fact of who sent it**. The comm graph and the authority ladder are the
same edge seen twice. This is why a MANAGER cannot reach an in-team MEMBER
directly (R6 v3): a mandate that skipped the COS would also skip the COS's
approval scope.

**2. Tier 0 is not "approval-free", it is self-mandated.** Every derived NPT/EHT
an agent creates for its own slice is a mandate where sender and receiver are the
same agent. That is *why* §8.5's platelets never queue and never wait: not
because they are unimportant, but because the author already holds the authority
their tier requires. The walking skeleton's receiver-authored D-TRDD is a mandate
when the hole is inside the receiver's slice, and a proposal only when it reaches
past it.

**3. Every MANAGER-created TRDD is a mandate — except at Tier 3.** No *agent*
outranks the MANAGER, so at tiers 0-2 a MANAGER commands rather than proposes.
But the USER is not an agent and sits above the ladder, and the USER-reserved set
is real and already enforced in code: `prrd-edit.py` refuses a MANAGER golden-rule
edit with `403 — golden rules are user-only` (`caller_is_manager()` in
`prrd_lib.py`). So "the MANAGER has no one above him" is true of the fleet and
false of the USER. A MANAGER-authored Tier-3 TRDD is a proposal, and the one
kind of TRDD the MANAGER may never mandate.

**The teeth.** `mandate: true` is written by the author, so on its own it is
self-certified — and a self-certified mandate stacked on an under-classified tier
(§D2) is a total bypass of the approval system by an agent that never sent a
single request. The §D4 watchdog therefore gains a second check beside the
tier-floor one: recompute the floor, then verify
`authority(mandated-by) >= required-approver(floor)`. A mandate that fails is not
a mis-filing, it is a **forged approval** — revoked, moved back to
`design/proposals/`, dependent execution halted, issuer named in the
`## Approval log`.

**Frontmatter (open-schema expansion, DEP layer):**

```yaml
approval-tier: 2          # the REQUIRED authority — the objective floor (§D3)
mandate: true             # author authority >= required approver
mandated-by: manager      # the TITLE that pre-approves it; 'self' at tier 0
```

**4. A mandate travels as a flock, and the flock is judged per cell.** The USER:
*"mandate-TRDD often comes with a flock of mandate-derived-TRDD. But even so, if a
receiver agent think that is missing a derived-TRDD he can propose one for
approval."* The issuing authority sends the parent together with its NPTs and
EHTs, and those children are pre-approved by the same issuer — an authority that
commands a change commands the platelets too. But authority does **not** flow down
the `parent-trdd` link: each child is a mandate only if the issuer's rank clears
**that child's own** floor. A MANAGER's flock mandates every child at tier ≤ 2 and
ships any Tier-3 child as a proposal still awaiting the USER.

And the flock never forecloses the receiver. However complete the mandate looks,
the receiver may still propose a missing D-TRDD, and must still report the gap. A
command from above carries authority, not omniscience — the issuer decided *what*
must change; the receiver is standing where it will break. Note the routing: the
receiver's D-TRDD goes to the approver **its own hole's tier** requires — a
self-mandate inside its slice, upward only when the hole reaches past it. It does
not route back to the issuer merely because the issuer outranks the receiver.
This is the §8.5 leg of the walking skeleton, and it is the only leg that proves
the vessel runs *up*.

The pillars fold together here. The **PRRD** supplies the rule that sets the tier
floor; the **TRDD** carries the tier and the mandate in its own frontmatter; the
**kanban** shows it already in `planned`/`dispatch` rather than parked in
proposals. A mandate is a cell that entered the bloodstream carrying its own
clearance — the antigen and the passport on the same surface. A flock is what the
marrow actually releases: never one cell, and never cells without platelets.

## 9. Why this is Tier 2

It creates a governance object (an approval gate on a file edit), changes AMP
message semantics, and gives an agent write-influence over a file in another
project's git repository. Any one of those is a MANAGER call; together they are
architectural.

What is **no longer** blocking: `manage-trdd` is not an independent unmade decision —
§8 Q6 shows its matrix is read off §7. The residue genuinely reserved to the USER is
the approval of this proposal, and a nod to the walking-skeleton order in §8 Q1.

## Approval log

- 2026-08-15T01:02:27+0200 — §D4 watchdog auto-correction (TRDD-AYBAMFN2 sweep): floor
  raised to `user` and the deprecated `approval-tier: 2` migrated to the named-rung field
  on this touch. Unambiguous D3 signal: `impacts: [public-api, …]` with
  `release-via: deploy` is a breaking public-API change (§D3 → user). Still a PENDING
  proposal — nothing was authorized or un-authorized; only the required approver rose.
