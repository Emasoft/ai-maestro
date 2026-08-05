---
trdd-id: AODXPI5E
title: Seeded agent rule forbids the terminal-unblock capability the server ships
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-05T22:17:05+0200
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
blocked-by: []
release-via: none
relevant-rules: [42]
labels: [manager-filed, testbot-session, owner-mixed]
external-refs: [Emasoft/ai-maestro#125]
---
# Seeded agent rule forbids the terminal-unblock capability the server ships

## ⏵ UNBLOCKED — THE USER RULED DIRECTLY, R42.8 IS RATIFIED (2026-08-05T21:05)

The USER granted the exception in the first person, to me, having been reminded R42 was absolute:

> i know that i said that that rule is absolute, you don't need to remind me. But I just realized
> that there is a case where it is absolutely necessary to override that rule, and that is the case
> of a question or permission query blocking an agent from doing its work. In this case only the
> MANAGER and the CHIEF-OF-STAFF are allowed to read and inject commands directly in the agent
> terminal in realtime. is it clear? change this golden rule. you have my permission.

**LANDED (rule layer):**
- `design/specs/governance-spec.md` — **GOV-R42.8** authored FIRST per the v4.8.0 authority
  inversion, spec-version **2.3.0 → 2.4.0**; `R42.0/.1/.2` re-scoped from "influence" to "assign,
  redirect, or perform another agent's WORK", which is what they always meant to protect.
- `docs/GOVERNANCE-RULES.md` **5.2.0 → 5.3.0** — the R42.8 row + changelog entry, and a new
  rationale paragraph explaining why an unblock does NOT undo R42's "why this is absolute"
  argument (the agent already chose its action and is waiting on an input it asked for; the prompt
  is its own question).
- `rules/aimaestro/aimaestro-agent-rules.md` — the seeded rule every agent reads each turn.

Eight constraints carry it (blocked-only · unblock-never-drive · title-scoped · never-an-ASSISTANT ·
identity-prompts-escalate · read-before-answer · server-enforced · audited). The COS-own-team and
ASSISTANT-exclusion detail was folded in from the USER's earlier ruling relayed in #125, and is
flagged to the USER as folded-in rather than assumed silently.

## ⏵ ENFORCED — the capability works (2026-08-05T21:30, commits 2237ca4d · 0f104dba · d536560b)

**R42.8 is `ENFORCED` in the map.** Three layers, all pinned:

| layer | what it does |
|---|---|
| `lib/sudo-guard.ts` | `POST …/prompt/answer` declares **`unblock-prompt`** (was `send-command`) |
| `lib/authorization.ts` | the `unblock-prompt` gate: MANAGER any · COS own-team · never an ASSISTANT · fails closed |
| `services/agents-core-service.ts` | **Gate 0b** — the target must ACTUALLY be blocked on a pending prompt |

`unblock-prompt` is a NEW action, deliberately **not** a loosening of `send-command`; R42's
cross-agent revocation of `send-command`/`restart-session` stays green, asserted by a complement
block that reddens if a future change reaches the unblock by widening the general verb.

**Six neuters, each 1:1 with a distinct test** (via `scripts/dev/neuter`, restores blob-verified):
ASSISTANT exclusion → 2 red · COS own-team → 1 · undefined target → 1 · other titles → 1 ·
`DRIVE_ACTIONS` emptied → **10 red** (3 new + 7 pre-existing R42) · Gate 0b → **0 red, then 1**.

**That 0 was the finding.** Gate 0b survived its own deletion across 108 tests — pinned by nothing.
Four cases now pin it (`0f104dba`), including the positive control without which "no pending prompt
⇒ 409" passes equally against a gate that refuses *everything*.

### Three defects the BUILD found that re-reading the text never would

1. **The rule named verbs the server refuses.** The clause listed `inject`/`queue` and advised
   "prefer `queue` over interrupting". Both deliver an arbitrary command, so they express the
   CALLER's decision — R42.1 — and stay SELF-ONLY. **An agent following the rule would be 403'd on
   the rule's own advice.** The exception is `read-prompt` + `answer`, nothing else.
2. **The guard made the whole thing inert.** `sudo-guard` runs BEFORE the handler, so with
   `send-command` still declared there, both lower layers permitted an unblock the door refused.
   R42.8 would have read ENFORCED and *not worked* — the original incident, one layer up.
3. **The identity carve-out lacked its reason** (USER, this session): no agent can answer an
   identity prompt because **no agent is the authority on identity — the SERVER is the sole
   notary.** It created/imported every agent, registered it and its AID in the signed ledger, alone
   holds the key that signs and rotates that AID, and alone signs and verifies AMP messages.
   Identity is ESTABLISHED by the server's verification, never ASSERTED by a party to the exchange
   — which is also what makes the title scoping meaningful: `authorize()` reads back the server's
   notarized record, not a caller's claim.

### One wrong turn, recorded

I added an `authorize()` call to the queue POST believing it ungated, having read the whole handler
and found none. **It is gated** — `lib/sudo-guard.ts:422` via `STRICT_AGENT_RULES`, whose own
comment says that guard is the ONLY check for `panel` and `queue`. Reverted. Concluding "ungated"
from one file was the error; the gate was in another layer.

### (h) LEDGER AUDIT — DONE (2026-08-05T22:20, commit `6299ae72`)

New `LedgerOp` **`unblock_prompt`**, declared rather than left to the open taxonomy for
precisely the reason `fleet_restart` was declared for R42.7 — that precedent states it
outright: *when a rule makes the audit trail part of the grant, the op must be groupable by an
external tool, not merely verifiable.* The taxonomy is additive and `verify()` does not
enum-check `op`, so no existing chain is affected.

Emitted from the **SERVICE**, not the route (headless calls services directly — same altitude
and same SF4 reasoning as Gate 0b). Scoped to a **CROSS-agent unblock by an agent caller**: a
self-unblock is self-drive and predates R42.8, and logging it would bury the one entry that
matters under the many that do not; the system owner is not audited either, since R42.8 governs
agents.

The diff is **empty on purpose** — an unblock mutates no registry field. Its audit value is
entirely WHO did it TO WHOM and WHEN, carried by the `authAction`/`authAgentId`/`authActor`
triple, the same shape `send_message` uses.

**Complementary neuter pair, each reddening exactly ONE distinct test:** disabling the emit →
`AUDITS a cross-agent unblock`; widening the scope so a self-unblock also audits → `does NOT
audit a SELF-unblock`. The negative is the load-bearing one, and modelling `registryLedger` as
a real spy rather than a no-op is what makes the positive assertable at all — *"it did not
crash"* is a different claim from *"it was recorded"*.

### Not done here
- **`ama-session` skill** (scope item 4) — still scoped to self, so the cross-agent procedure stays
  undiscoverable. It lives in `Emasoft/ai-maestro-plugin`, so it is an issue or a fork+PR there,
  not an edit here.
- **The behavioural check** (last acceptance box) needs a live fleet, not a unit test.
- **Pre-existing, NOT mine:** `tests/governance/` has a load-dependent flake — measured at HEAD with
  every change of mine stashed, 5 failures in one run and 1 in the next across `r1-teams-service`
  and `r10-restart`/`r10-wake`. Passes in isolation, which is the signature of a shared-state
  concurrency defect, not evidence of its absence. Own TRDD.

## ⏵ SUPERSEDED — the block that preceded the ruling (kept for the reasoning)

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

- [x] The seeded rule permits unblocking and still forbids driving, with
      the boundary stated in terms an agent can apply without a judgment
      call. — `rules/aimaestro/aimaestro-agent-rules.md`. The boundary is
      now stated as VERBS, not as a judgment: `read-prompt`/`answer` cross,
      `inject`/`slash`/`queue` do not. An agent no longer has to decide what
      counts as "driving" — and the server 403s the wrong choice anyway.
- [x] The identity-vouching carve-out is explicit — and now carries its
      REASON (the server is the sole notary of identity), which is what makes
      it followable rather than a rule to memorise.
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