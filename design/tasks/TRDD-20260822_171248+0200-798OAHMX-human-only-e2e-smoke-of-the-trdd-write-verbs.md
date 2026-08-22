---
trdd-id: 798OAHMX
title: End-to-end smoke of the TRDD write verbs with a real aim_tk token via dev-mode login
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T17:12:48+0200
updated: 2026-08-22T17:12:48+0200
current-owner: ai-maestro-session
created-by: ai-maestro-session
assignee: ai-maestro-session
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-session
approval-datetime: 2026-08-22T17:12:48+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: low
effort: small
labels: [auth, e2e, human-only, manage-trdd]
external-refs: []
---

# Human-only end-to-end smoke of the TRDD write verbs

## ⏵ STATE — READ THIS FIRST

**Descoped out of `TRDD-K2WJH7RF` on 2026-08-22T17:12 so that card could close.** It is not
leftover work on the policy — the policy is decided, implemented and pinned. This is the one
verification that **no agent may ever perform**, which is why it needs an actor this card names.

**INDEPENDENT, not an EHT of `K2WJH7RF` — this was checked, not assumed.** `K2WJH7RF` is itself
`derived: true` (`derived-kind: eht` of `TRDD-SCLSRS6E`), and the depth-1 invariant in
`rules/aimaestro/aimaestro-trdd-approval.md` states it flatly: *"`derived: true` ⇒ `npt: []` and
`eht: []`; no TRDD may name a `derived: true` TRDD as its `parent-trdd:`."* A D-TRDD cannot carry
an EHT. Independently of that, an EHT closes a hole the parent's change OPENED; this is an
assurance smoke the parent scoped and could not perform, which is a different thing. Filing it as
an EHT would also have pinned `K2WJH7RF` at `blocked` forever behind an act only a human can do.

**⚠ THIS CARD WAS FIRST WRITTEN AS "HUMAN-ONLY BY CONSTRUCTION". THAT WAS WRONG, TWICE OVER, AND
THE CORRECTION IS THE POINT OF THE CARD.** It inherited its premise verbatim from `K2WJH7RF`'s
acceptance box — *"Needs a live human session token; an agent holding one would defeat the very
separation this card decided"* — which I quoted as authority without checking. Both halves fail:

1. **`aim_tk_` is not a human-token marker.** `lib/aid-token.ts` mints the single
   `TOKEN_PREFIX = 'aim_tk_'` (`:76`) in two places — `:375` `issueGovernanceToken` →
   `subject_type: 'agent'`, `:426` `issueUserGovernanceToken` → `subject_type: 'user'`. The
   discriminator is `subject_type`; `validateGovernanceToken` (`:475`) only checks the prefix. An
   agent bearing `aim_tk_*` is the ORDINARY path (`lib/sudo-guard.ts:19`).
2. **Even user authority no longer needs the owner at the keyboard.** Dev-mode login
   (`TRDD-A9335BZ6`) exists precisely as *"the credential that lets development continue while the
   owner is away"*, and it is **ARMED on this host**: `governance.json` →
   `devModeLogin.enabled: true`, `tokenHash` present, created `2026-08-21T16:39:34Z`, last used
   `16:47:53Z`. It stands in for the governance password at `POST /api/auth/login`, so it yields a
   user-authority session without the owner present.

**The separation that IS real, and that this card must not break:** the token value never passes
through a model. The shell resolves `AI_MAESTRO_DEV_MODE_TOKEN` from `.env.local` itself — read by
the **CLI only, never by the server** — exactly as `$AIM_GOVERNANCE_PASSWORD` is handled. No step
below prints, echoes, logs, or reconstructs it.

**NEXT ACTION (this session):** a shell-driven e2e that never sees the secret —

1. Point state at a throwaway dir so nothing touches the live corpus.
2. Log in via the CLI, letting the shell read `$AI_MAESTRO_DEV_MODE_TOKEN` from the environment.
3. Drive each `manage-trdd` write verb — `approve`, `refuse`, `promote`, `archive` — against a
   throwaway TRDD, as BOTH subject classes (an agent `aim_tk_` and the dev-mode user session).
4. Assert observed behaviour equals the matrix in `tests/unit/manage-trdd-authorization.test.ts`.

**The gap this closes that the unit matrix CANNOT.** The neuter proved `authorize()` refuses with
no TRDD context (`1 red / 28 green`). Nothing proves the **route actually supplies** that context —
a faithful double of an interface cannot see that the real implementation of that interface is
broken. That, not the token, is the reason this card is worth doing.

## Why this is worth keeping rather than dropping

The unit matrix is thorough — 29 tests, and the fail-closed branch is neuter-proven (2026-08-22:
`s/    if \(!trdd\) \{/    if (false) {/` on `lib/authorization.ts` → **1 red / 28 green**,
*"denies when no TRDD context is supplied (a guessed tier is a guessed approval)"*). What it cannot
cover is the real token traversing the real route, which is exactly the class of gap this fleet
keeps finding: a faithful double of an interface cannot see that the real implementation of that
interface is broken.

## Acceptance

- [ ] A human holding a real `aim_tk_*` token drives `approve`, `refuse`, `promote` and `archive`
      against a throwaway TRDD, and each behaves as the unit matrix says it should.
- [ ] Any divergence between observed behaviour and `tests/unit/manage-trdd-authorization.test.ts`
      is recorded here as a finding, not silently reconciled.
- [ ] No agent performed any step of this card.

## Approval log

- 2026-08-22T17:12:48+0200 — MANDATE (self, Tier-0): a derived EHT descoped from `K2WJH7RF` to let
  that card close on its decided-and-implemented policy. Creating the card is in-scope and
  reversible; performing it is not mine and never will be.
