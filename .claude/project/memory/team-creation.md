---
name: team-creation
description: "how is a team created / who creates the 5 base members — the MANAGER or the COS / what are the 5 required roles / why is my team stuck with only a chief-of-staff / can a COS create agents / how do I add a specialist (e.g. a webdesigner) to a team / is an incomplete team supposed to be frozen"
ocd: 2026-07-14
lmd: 2026-07-14
metadata:
  node_type: memory
  type: project
  tier: hub
  topic: teams-and-governance
globs:
  - services/teams-service.ts
  - lib/team-registry.ts
  - app/api/teams/**
  - lib/authorization.ts
  - lib/portfolio-check.ts
---

# Team creation — who creates whom, and in what order

**The USER ratified this on 2026-07-14.** It is reconstructed from FOUR rules that partly
contradict each other, so read the reconciliation before trusting any single rule —
`docs/GOVERNANCE-RULES.md` **R29.1 is WRONG** and will mislead you (see below).

## The 5-role base — R12.1 is AUTHORITATIVE

> **R12.1** (`docs/GOVERNANCE-RULES.md:529`, CRITICAL) — Every team **MUST** contain a minimum
> of **5 agents** with these titles: **1 CHIEF-OF-STAFF · 1 ARCHITECT · 1 ORCHESTRATOR ·
> 1 INTEGRATOR · 1 MEMBER** (programmer role-plugin).

**The COS is ONE OF THE 5**, not an extra on top. So the base is *the COS + 4 others*.

> **USER, verbatim (2026-07-14):** *"a team cannot work if it is missing any of the 5 basic
> roles: CHIEF-OF-STAFF, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER"*

## The creation sequence — the MANAGER makes the COS; the COS makes the rest

| Step | Actor | Creates | Rule |
|---|---|---|---|
| 1 | **USER** | asks the MANAGER for a team | — |
| 2 | **MANAGER** | the **team** + its **CHIEF-OF-STAFF** (auto-COS) — and *nothing else* | R29 (`:1272`) |
| 3 | **CHIEF-OF-STAFF** | **the other 4**: ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER | **R12.2** (`:529`), **R31.1** (`:1292`) |
| 4 | **CHIEF-OF-STAFF** | any **specialists** the project needs — see below | R30.2, R30.3 (`:1282`) |

> **R12.2** — a team lacking any of the 5 is a **NON-FUNCTIONAL TEAM** — *"the CHIEF-OF-STAFF
> must immediately add the missing agents"*.
> **R31.1** — an incomplete team is FROZEN *"until **the COS** finishes creating + configuring
> all basic members"*.

**So `createNewTeam` creating ONLY the auto-COS is CORRECT.** It is not a bug. (It was reported
as one on 2026-07-14 — see the lesson `[^1]`.)

## Specialists beyond the base — always MEMBER + a role-plugin

> **R30.3** (`:1282`) — customization is limited to **extra MEMBER agents**, created from
> existing role-plugins. *"Neither MANAGER nor COS may create a team lacking the 5 basic
> agents, nor create non-MEMBER agents … under a team-creation mandate."*

> **USER's example (2026-07-14):** a team tasked with building a website gets **an extra MEMBER
> agent with a webdesign role-plugin assigned to it.**

That is the **TITLE / ROLE** split doing its job (see `[[feedback_agent_three_layer_model]]`):
the **TITLE** stays `MEMBER` (what it may *do* — the governance class), while the **ROLE**
(role-plugin) is what it *knows how to do*. **Never invent a new TITLE for a specialist.**

## The COS needs a MANDATE to create agents

> **R30.1** (`:1282`, IRON) — the CHIEF-OF-STAFF requires the MANAGER's **approval/mandate** to
> create agents, **unless** the MANAGER granted a **team-creation mandate**.
> **R30.2** — a team-creation mandate authorizes, by default, the 5-basic-member structure PLUS
> the specialized MEMBERs.

**The "mandate" is a portfolio token (R28), not a message.** Scope `agent:create`, host-signed
and ledger-anchored, minted by the MANAGER into the COS's enclave. An AMP message must never
serve as the approval: it is unsigned, unbounded prose that anything able to write to an inbox
can forge. See `[[approval-vs-mandate-protocol]]`.

## An incomplete team is FROZEN — but the COS stays AWAKE

> **R31.1** (`:1292`, IRON) — an incomplete team is FROZEN: **only the CHIEF-OF-STAFF may be
> active**; all other team agents are hibernated until the COS finishes creating them.

**This is the load-bearing detail and the easiest to get wrong.** The COS is the *only* agent
that can lift the freeze, so freezing it deadlocks the team permanently. There are **two
different freezes** in this system, sharing a vocabulary and inverting the COS rule:

| | trigger | the COS is… | why |
|---|---|---|---|
| **R9.8 block** (`:433`) | no MANAGER on the host | **hibernated** | nothing in-band can fix it — only the USER can assign a MANAGER |
| **R31 freeze** (`:1292`) | team missing ≥1 of the 5 | **ACTIVE** | the COS is the repair mechanism (R12.2) |

`blockAllTeams()` (`lib/team-registry.ts:427`) implements the **R9.8** one and hibernates
`team.chiefOfStaffId` along with everyone else — correct there, **fatal** if reused for R31.
See `[[TRDD-0KMDJVON]]`, which carries the regression test that catches the collapse:
*freeze a team, then assert the COS's tmux session is still alive.*

## ⚠ R29.1 is a DEFECT in the governance document — do not follow it

> **R29.1** (`:1272`) claims a team *"auto-creates the CHIEF-OF-STAFF **+ the 5 basic team
> members**"*.

Wrong **twice**:
- **count** — that reads as *6* agents (COS + 5). R12.1 says **5, including the COS**.
- **actor** — *"auto-creates"* says the **system** builds them all. R12.2 and R31.1 both put the
  creation of the other four on the **COS**.

It contradicts R12.1, R12.2, R30.2 and R31.1 simultaneously. **R12.1 wins** (it is the rule that
*defines* the term R29.1 merely *uses*). R29.1's text is **IRON / USER-set**, so only the USER
may correct it — a fix is pending.

## What the CODE actually does today (2026-07-14 — expected to change; verify before relying)

The rules above are the **design**. The enforcement is largely absent — audited 2026-07-14
(`reports/governance-audit/`, gitignored; commits `1ac64125`, `65bd6ec9`):

| Rule | Enforcement |
|---|---|
| R12.1 (5-role base) | **none** — no `isTeamComplete()` predicate exists anywhere |
| R30.1 (COS needs a mandate) | **none** — `OPERATIONS_REQUIRING_TOKEN = {}`, so `matchPortfolioToken` returns `ok:true` unconditionally |
| *(any title) may create agents* | **ungated** — `POST /api/agents` runs `authenticateFromRequest()` and **no `authorize()`**; there is no `create-agent` AuthAction at all |
| R31 (freeze) | **none** — zero freeze logic in `lib/ services/ app/ components/` |
| COS may delete an own-team agent | **denied** — `lib/authorization.ts` hard-codes *"Only MANAGER can delete agents"*, an **invention** filling R30's silence. USER has since ruled otherwise → `[[TRDD-8K68E16G]]` |

**Consequence:** every team is born at **1-of-5** and stays there, reporting healthy — a
NON-FUNCTIONAL TEAM by R12.2's own definition, with nothing to detect it.

Open work: `[[TRDD-F1SL03CK]]` (the creation gate) · `[[TRDD-0KMDJVON]]` (the R31 freeze) ·
`[[TRDD-8K68E16G]]` (COS delete).

## Governed by

- `[[an-unenforced-rule-produces-a-success-not-an-error]]` — **why the gaps above were
  invisible**: a missing guard produces a SUCCESS, not an error, so *"the team was created"*
  proves nothing. Test the **refusal**, never the happy path.

## See also

- `[[feedback_agent_three_layer_model]]` — TITLE vs ROLE vs PERSONA (why a webdesigner is a
  MEMBER with a webdesign role-plugin, not a new title)
- `[[role-boundaries-cos-orchestrator]]` — the COS owns the team **roster**; the ORCHESTRATOR
  owns the **kanban**
- `[[approval-vs-mandate-protocol]]` — what a mandate is, and why it must be a signed token

## Notes and lessons learned

[^1]: [ocd:2026-07-14 lmd:2026-07-14] On 2026-07-14 I reported *"`createNewTeam` never builds
  the 5 base members"* as a hole. **It is not a hole** — the COS is supposed to build them
  (R12.2, R31.1), so creating only the auto-COS is correct. I had read **R29.1**, transcribed
  it, and audited the code against it — never noticing R29.1 disagrees with R12.1, R12.2, R30.2
  and R31.1. The same error had already been laundered into the memory corpus, where it read
  *"auto-COS + 5 base MEMBER agents"* (miscounted, **and** calling all five MEMBERs when four
  carry different TITLEs).
  **WHY:** I treated the governance corpus as a **list of rules** and read one. It is a
  **system of claims**, and an error in one rule is invisible until it is made to disagree with
  another. **How to apply: when a rule USES a term ("the 5 basic members"), go read the rule
  that DEFINES it before acting.** If two rules disagree, the more specific/CRITICAL definition
  wins and the other is a **defect in the document** to raise with the USER — never a nuance to
  smooth over in prose. This is why the rule-by-rule conformance audit found in one pass what
  months of reading rules one at a time did not.
