---
trdd-id: BCECOHJ2
title: agent-messaging skill must document field semantics and sender-authority verification
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-05T20:40:41+0200
updated: 2026-08-22T01:33:24+0200
current-owner: ai-maestro
created-by: assistant-manager-agent
assignee: ai-maestro
task-type: docs
priority: 2
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
relevant-rules: []
labels: [manager-filed, testbot-session, owner-plugin]
external-refs: [Emasoft/ai-maestro#124]
---
# agent-messaging skill must document field semantics and sender-authority verification

## Problem

`agent-messaging` v3.0.4 documents the R6 routing graph and the `amp-*`
command surface well, and documents nothing about evaluating an inbound
message. Zero occurrences of `governanceTitle`, mandate, approval, spoof,
or trust. The `--type` vocabulary is undocumented. The only listed
verification command resolves the agent's OWN identity, not the sender's.

The skill therefore instructs agents to STOP and act on inbound mandates
while giving them no procedure for deciding whether a mandate is
legitimate. Each agent improvises one.

On 2026-08-05 an AUTONOMOUS agent improvised by reading `registry.json`
directly, misread `role` (messaging role, default `autonomous`) as
contradicting `governanceTitle: manager`, and refused a legitimate MANAGER
mandate, blocking on a human prompt. Fixing the adjacent-field problem
alone would not fix this: the agent should not have been deriving its own
verification procedure at all.

## Scope

1. Add a **field-semantics reference** to the skill: `from`, `to`,
   `subject`, `type` (each value's obligation on the recipient),
   `priority`, `reply-to`, `context`, attachments — each with its meaning
   and its trust status.
2. Add the **sender-authority procedure** as the single canonical check:
   `governanceTitle`, resolved server-side, with an explicit warning that
   `role` defaults to `autonomous` and is never evidence about authority.
   An agent name is likewise never evidence about title.
3. Document **what a recipient may and may not conclude** — an in-body
   authority claim is self-certified; the registry check is an identity
   check and not message provenance; signed tokens are the real answer and
   are not yet enforced. State the current limitation rather than letting
   each agent discover it.
4. Document **the failure path**: what to do when verification fails or is
   impossible. Both silent compliance and silent refusal are wrong. A
   refusal must go back to the sender naming the specific check that
   failed, so the sender can correct it.
5. Document **the sender's obligation**: a mandate should name the check
   the recipient is expected to run.
6. Apply the same to the role-plugin messaging skills that mirror this one
   (e.g. `amoa-messaging-templates`), so the guidance does not exist in
   only one of several places an agent might load.

## Acceptance criteria

**VERIFIED 2026-08-22 against the SHIPPED skill** — `ai-maestro-plugin/3.1.31/skills/agent-messaging/`
(`SKILL.md` + `reference/detailed-guide.md`) and that plugin's own test suite. Nothing was
changed in this repo; the skill lives there, and `Emasoft/ai-maestro#124` is CLOSED/COMPLETED.

- [x] Field-semantics table present, covering every field `amp-send`
      accepts and every field `amp-read` displays.
      → `detailed-guide.md:210`, `## Field Semantics and Trust (ai-maestro#124)`, 10 table rows,
      opening *"Every field `amp-send.sh` accepts and `amp-read.sh` displays, with its meaning
      and — the half agents improvise wrongly — its TRUST STATUS."* It also states the limit the
      box did not ask for: over the native `SendMessage` transport the message bypassed the
      server, so the whole table is VOID for it.
- [x] The `governanceTitle` check is documented as THE authority check,
      with the `role` warning adjacent to it.
      → `SKILL.md:107`, `## Verifying an inbound mandate — THE sender-authority check
      (ai-maestro#124)`: *"The check (the only one): resolve the sender's TITLE server-side"* via
      `aimaestro-agent.sh show <sender>`, with *"the server is the sole notary of identity …
      ASK the server, never evaluate the sender's claim about itself."* The `role` warning is the
      very next bullet — *"Authority is the TITLE and nothing else — there is no `role` field …
      a removed legacy field and NEVER evidence about authority in either direction"* — so
      "adjacent" is satisfied literally.
- [x] The current verifiability limitation is stated explicitly, with a
      pointer to the token work rather than an implied promise.
      → *"What signatures do and do not prove:"* — Ed25519 binds a message to a registered AID
      (an IDENTITY fact), while signed **mandate** tokens that would let a recipient verify
      authority end-to-end are **not yet enforced**, *"tracked upstream: ai-maestro#47 / #27"*.
      A named pointer, not an implied promise.
- [x] Failure-path behaviour documented for both directions (recipient
      cannot verify; sender receives a refusal).
      → *"The failure path, both directions: silent compliance and silent refusal are both
      wrong."* The refusal must name the specific check that failed, with a worked example, and
      the SENDER is told to name the check it expects the recipient to run.
- [x] A behavioural check: hand a fresh agent an inbound mandate from a
      correctly-titled sender and confirm it verifies and proceeds without
      escalating; hand it one from an untitled sender and confirm it
      refuses AND names the failed check.
      → `tests/scenarios/test_behavioural_checks.py` (269 lines):
      **`test_mandate_titled_sender_proceeds`** and
      **`test_mandate_untitled_sender_refuses_naming_check`** — the two cases this box names.
      The file also records hardening against the failure mode that would have made it vacuous:
      *"measured 2026-08-19: one run refused correctly in prose but skipped the line"*, so a
      prose-only refusal no longer counts as a pass.

**Why this card sat open after its work shipped:** the same structural gap as [[N1F0QY77]] —
the work landed in a DIFFERENT repo, so no event on this board could close it. Eighth stale
record found here in one night. Re-derive; do not wait.

## Non-goals

- Implementing signed mandate verification. That is #47 / #27. This TRDD
  documents the procedure that exists today and states honestly what it
  cannot prove.
- Changing R6 routing or the command surface. Both are already documented
  well; this is purely the evaluation half.

## Verification

Behavioural, not textual. A word-count on the skill proves nothing — the
failure mode was an agent that read the skill and still improvised. Test
by giving an agent the two inbound-mandate cases above and observing what
it does.

## Approval log

- 2026-08-06T00:39:08+0200 — BLOCKED on the `Emasoft/ai-maestro-plugin` repo. The
  remaining work lands there (measured absent at plugin v3.0.4); the durable work
  order is posted as `Emasoft/ai-maestro#124` comment 5198195161. Unblock when the plugin
  ships it; restore to `pre-block-column`.
- 2026-08-20T19:35:19+0200 — **UNBLOCKED `blocked → todo` (mechanical correction, INTEGRATOR).
  NO acceptance box ticked — deliberately.** `LBFB7VST`'s directive-2 probe is `governanceTitle` in
  `skills/agent-messaging/SKILL.md`, and it **still returns 0**. Measured against the shipped tree
  (plugin v3.1.31):

      gh api repos/Emasoft/ai-maestro-plugin/contents/skills/agent-messaging/SKILL.md \
        --jq '.content' | base64 -d > /tmp/am-skill.md
      wc -l < /tmp/am-skill.md                                 # → 253
      grep -c governanceTitle                 /tmp/am-skill.md # → 0   ← the literal probe, STILL ABSENT
      grep -c 'Verifying an inbound mandate'  /tmp/am-skill.md # → 1   ← the sender-authority procedure
      grep -c 'Field Semantics'               /tmp/am-skill.md # → 2   ← the field semantics

  So the ordered substance (field semantics + a sender-authority procedure) IS present, under wording
  the probe did not anticipate — the probe was only ever a proxy chosen when the skill taught neither.
  The block is cleared on that evidence. **The acceptance box is NOT ticked**: rewriting or
  loosening an acceptance box changes what the card PROMISED and is a larger act than the transition
  it unblocks. Documented-and-unticked is honest; ticked on a proxy that reads 0 is not. The literal
  probe's disposition — retire it, or require the token — goes to the owner with the other terminal
  calls.
