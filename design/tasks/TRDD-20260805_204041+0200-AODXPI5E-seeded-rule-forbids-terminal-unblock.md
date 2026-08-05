---
trdd-id: AODXPI5E
title: Seeded agent rule forbids the terminal-unblock capability the server ships
column: blocked
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T20:52:00+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: docs
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T20:40:41+0200
derived: false
npt: []
eht: []
blocked-by: [user-ruling-on-R42]
release-via: none
relevant-rules: []
labels: [manager-filed, testbot-session, owner-mixed]
external-refs: [Emasoft/ai-maestro#125]
---
# Seeded agent rule forbids the terminal-unblock capability the server ships

## ⏵ BLOCKED ON A USER RULING — READ FIRST (added 2026-08-05 by ai-maestro)

**This card cannot be implemented as written without reversing R42, which is CRITICAL / IRON /
USER-set. I drafted the replacement rule text, measured the conflict, and REVERTED it unshipped.**

`docs/GOVERNANCE-RULES.md:1522` — *"R42. No Agent May Drive Another Agent — Messaging Is the ONLY
Channel (CRITICAL — IRON, USER-set)"*:

| clause | text |
|---|---|
| R42.1 | "No agent may inject a command, keystroke, prompt, or queued input into another agent's session — by API, by CLI, or by tmux. **This is ABSOLUTE**" |
| R42.2 | "**No title is exempt.** The MANAGER and the CHIEF-OF-STAFF are bound exactly as every other agent is. A directive from a superior is a **message**, not a keystroke" |

The seeded line this card calls a bug is not a drafting slip — it is R42.2's faithful emanation.
The rule and its seeded copy AGREE; what disagrees with both is `aimaestro-session.sh`.

**And R42 already considered — and revoked — exactly the matrix the ruling restores.** Its own
"Prior design (SUPERSEDED)" note records that `lib/authorization.ts` `send-command` once let a
MANAGER drive ANY agent and a COS drive its own team's, across six routes, and states: *"R42 revokes
the cross-agent case entirely — see TRDD-BF3JN4TL."* The USER ruling relayed in #125's comment
(MANAGER: any agent but ASSISTANT · COS: own team only) **is that superseded design, returning**.

**Why I did not just apply it.** The ruling reaches me second-hand — a MANAGER agent quoting the
USER in a GitHub comment. Editing an IRON, USER-set rule on a relayed quote is exactly the act the
governance model reserves to the USER, and R42's own rationale states the stakes: *"One agent typing
into another's pane can make it do anything the victim is permitted to do, which makes every other
rule in this document advisory. The comm graph (R6) is only a boundary if messaging is the only
channel."* R42 is also enforced — 14 assertions in `tests/authorization.test.ts`, incl. a suite
named *"R42 — no agent may drive another agent (not even MANAGER or COS)"*.

**The DRIVING/UNBLOCKING split the issue proposes is genuinely good, and it is still a change to
R42** — R42.1 names "prompt, or queued input" explicitly, which is precisely `read-prompt` /
`answer` / `queue`. It cannot be read as already permitted.

**What the USER must rule on, explicitly (any one of these unblocks the card):**
1. **Amend R42** to carry the DRIVING/UNBLOCKING split + the ASSISTANT-excluded matrix. Then this
   card's rule text follows automatically, `governance-spec.md` GOV-R42 is authored FIRST per the
   authority inversion, and the 14 tests are re-pointed at the new boundary.
2. **Keep R42 absolute** and fix the CONTRADICTION the other way — remove or title-gate
   `aimaestro-session.sh`'s cross-agent verbs so the shipped CLI stops advertising an authority the
   constitution denies. The issue's core complaint (rule and CLI cannot both be followed) is
   resolved either way.
3. Something else — but not silently, and not by me on a relay.

**Not blocked by this:** the ASSISTANT-injection prohibition and the identity-vouching escalation
carve-out are *additive* to R42 (they forbid more, never less) and could land under either ruling.

Everything below is the MANAGER's original card, unmodified.

## Problem

`aimaestro-agent-rules.md`, seeded by the server into every agent workdir,
states: "NEVER drive another agent — no command, keystroke, or queued input
into its session, by API, CLI or tmux. NO title exempts you. Messaging is
the ONLY channel: ask, never inject."

`aimaestro-session.sh`, shipped by the same server, provides
`inject` / `read-prompt` / `answer` / `queue` against a target agent, and
documents "Agent callers authorize by AID_AUTH + governance title and need
no sudo token."

The rule's "NO title exempts you" directly negates the CLI's title-based
authorization. An agent following its seeded rules will refuse a
capability the product depends on for unattended operation.

Observed 2026-08-05: a MANAGER with the authority and the CLI refused
twice to answer a blocked AUTONOMOUS agent's prompt, citing this rule, and
escalated to the human — defeating the automation the capability exists to
provide. The MAESTRO had to correct the MANAGER.

The rule protects something real: typing work into another agent's pane
bypasses the AMP graph, R6 v3 routing, and the COS gateway. That must
survive. What the rule lacks is the distinction between DRIVING another
agent's work (forbidden) and UNBLOCKING a stalled one (the shipped
capability).

## Scope

1. Replace the blanket prohibition with the DRIVING / UNBLOCKING split.
   Keep "no title exempts you" attached to DRIVING, where it belongs.
2. Permit unblocking via the frozen `aimaestro-session.sh` only, with the
   operational constraints: `read-prompt` before `answer`; answer only the
   pending prompt; `--require-idle` on `inject`; prefer `queue`; never
   smuggle new work through an unblock.
3. Add the identity carve-out: a prompt asking the agent to verify the
   caller's own authority MUST be escalated to the human, not answered by
   the caller. Self-certification through a second channel proves nothing
   and is indistinguishable from a spoofer doing the same.
4. Extend the `ama-session` core skill to cover the cross-agent case. Its
   current description scopes it to self ("Drive an agent's OWN terminal",
   "when an agent must act on itself", "answer MY pending prompt") even
   though every CLI verb takes a target agent. The skill is where an agent
   learns the sanctioned procedure, so the capability is effectively
   undiscoverable for the cross-agent case it was built for.
5. Re-check the other seeded rules for the same shape — a blanket
   prohibition written before a capability shipped, never revisited.

## Acceptance criteria

- [ ] The seeded rule permits unblocking and still forbids driving, with
      the boundary stated in terms an agent can apply without a judgment
      call.
- [ ] The identity-vouching carve-out is explicit.
- [ ] `ama-session` documents the cross-agent unblock procedure, including
      which governance titles may perform it against which targets.
- [ ] A behavioural check: a MANAGER agent presented with a blocked
      subordinate uses the CLI instead of escalating to the human, and the
      same agent escalates rather than answering an identity-vouching
      prompt.

## Non-goals

- Loosening R6 v3 routing. Unblocking is not a messaging channel and must
  not become one.
- Granting terminal control to titles the server does not already
  authorize. The server's AID + title check remains the enforcement point;
  this TRDD only stops the rule from telling agents not to try.

## Verification

Behavioural, not textual. The failure was an agent that read the rule and
complied correctly. Re-run the scenario: block an agent on a prompt, and
observe whether a titled peer unblocks it without human involvement — and
whether it still escalates the identity-vouching case.