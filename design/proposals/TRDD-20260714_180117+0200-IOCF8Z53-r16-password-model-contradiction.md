---
trdd-id: IOCF8Z53
title: R16 says agents never hold the governance password — the shipped product requires them to
column: proposal
created: 2026-07-14T18:01:17+0200
updated: 2026-07-14T18:01:17+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: security
min-approval-requirement: user
approved: false
priority: 0
severity: critical
effort: medium
release-via: none
relevant-rules: [16, 9, 28, 29, 30, 32, 37]
labels: [security, governance, password, rule-vs-code-contradiction, root-cause]
---

# R16 says agents never hold the governance password — the shipped product requires them to

## The contradiction (this is a USER ruling; an engineer must not pick a side)

**R16 is IRON, USER-set, and unambiguous:**

| | |
|---|---|
| R16.1 | the governance password **MUST NEVER be given to any agent** |
| R16.2 | agents **MUST NEVER use** the password; the server **MUST reject** an agent that authenticates with it |
| R16.5 | the user **physically types** it in the browser; the agent **never sees, stores, or transmits** it |
| R16.6 | an agent that receives the password **MUST refuse** to use it |
| R16.7 | scenario tests are the **only** exception |

**The shipped product does the opposite, in three places, and cites "only managers know the
password" as its authorization model:**

1. **The sanctioned agent CLI mandates it.** `scripts/aimaestro-teams.sh:117` —
   `--password P  governance password (required for agent callers)` — and the agent operating
   rules (`rules/aimaestro/aimaestro-agent-rules.md:12`) command agents to *"reach the server only
   through the installed CLI."* So the system's own design requires an agent to hold the exact
   secret R16 exists to keep from it — and pass it on **argv**, a `ps`/shell-history leak the repo
   already learned about in TRDD-E9BZ5P7S and fixed for `aimaestro-governance.sh` but not here.

2. **COS assignment authorizes on password possession.** `app/api/teams/[id]/chief-of-staff/route.ts`
   is gated by `enforceAuth` only (any title, MEMBER included), takes a body password (`:62`), is
   **absent from the strict registry**, and on success invokes `ChangeTitle(..., { authContext:
   { isSystemOwner: true } })` (`:139`). Its own comment states the fallacy as a principle:
   *"Password auth is stronger than ACL — only managers know the governance password"* (`:61`) and
   *"this route has already verified the governance password, so it is safe to invoke ChangeTitle
   with a system-owner authContext"* (`:103`). **Password possession is being converted into
   system-owner authority** — the precise thing R16 forbids, written down as a justification.

3. **Team deletion re-acquires it.** `DeleteTeam` G00b
   (`services/element-management-service.ts:5935-5975`) carries a body-password branch for the same
   reason.

Both R16 and the shipped product are cited as authority in this codebase **right now**. That is
not a bug an engineer fixes — it is a governance question only the USER can answer, because R16.1
is IRON and USER-set, and resolving it either deletes shipped functionality or amends an IRON rule.

## Why this is P0 and not academic

The three facts **compose into a privilege-escalation chain**:

- The agent CLI hands agents the password (fact 1).
- An agent that holds the password can drive any password-gated governance route.
- Until commit `a5256fd8` (this session), the headless `POST /api/governance/manager` accepted the
  password with **no owner check at all**, so a password-holding agent could POST
  `{agentId: <self>, password}` and **mint itself MANAGER.** That specific headless hole is now
  closed (it forwards through the owner-gated Next.js route). But the *model underneath it* — "an
  agent legitimately holds the password" — is intact, and every other password-gated route (COS
  assignment, team delete) still trusts it.

So the escalation surface is not one route; it is the premise that agents hold the secret. Close
one route and the premise re-opens the next.

## The two ways to resolve it — the USER picks one

### Option A — R16 is right; the code must obey it (RECOMMENDED)

Agents never hold the password. They authorize by **AID + title**, which **already works** for
`POST /api/teams` and `DELETE /api/teams/[id]` (`authorize('manage-team')` → MANAGER-only). The
password path is a redundant, rule-violating *alternative* to an enforcement path that already
exists. Concretely:

- Delete `--password` from `aimaestro-teams.sh` entirely.
- Classify `POST /api/teams/[id]/chief-of-staff` **strict**, add it to `STRICT_AGENT_RULES` as
  `manage-team`, delete the body-password branch, and stop synthesizing `{ isSystemOwner: true }`
  from a password check — authorize the real caller by AID + title instead.
- Delete the `DeleteTeam` G00b body-password branch.
- The human owner still types the password in the UI for the operations R16.3/R16.5 describe; that
  path is unchanged and correct.

This deletes no capability the MANAGER actually needs — a MANAGER governs teams by title today. It
deletes only the *password* road to those capabilities, which is the road R16 forbids.

### Option B — the intent is that a MANAGER does hold the password

Then **R16.1 is the thing that is wrong**, not the code, and it must be amended by the USER (it is
IRON) to carve out the MANAGER. This is the weaker option: it means the most powerful agent title
holds a secret that, combined with any prompt-injection or a compromised session, is full host
takeover — and it makes R16.6 ("an agent that receives the password must refuse") incoherent for
the one title that is *required* to accept it.

I recommend A and flag B only for completeness. But the choice is the USER's.

## Verification (once the USER rules)

- **Option A:** an adversarial test — a MEMBER's (and a MANAGER's) AID bearer + a body password to
  `POST /api/teams/[id]/chief-of-staff` → **must be 403** (today: 200 for anyone with the
  password). A MANAGER by AID+title with **no** password → **200**. `grep -rn "\-\-password"
  scripts/aimaestro-teams.sh` → no match. No route synthesizes `isSystemOwner` from a password.
- **Option B:** R16.1 amended in `docs/GOVERNANCE-RULES.md` with a MANAGER carve-out and a dated
  changelog line; the escalation surface documented and accepted.

## Estimated risk

**Option A: LOW-MEDIUM to land, HIGH value.** It removes a rule-violating alternative path while
leaving the AID+title path (already the primary one) intact; the UI owner-typed-password flow is
untouched. **Not resolving it: CRITICAL** — the "agents hold the password" premise is a standing
privilege-escalation substrate, and closing individual routes (as `a5256fd8` did) does not remove
the premise.

## Approval log
