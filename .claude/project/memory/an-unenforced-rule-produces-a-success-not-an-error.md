---
name: an-unenforced-rule-produces-a-success-not-an-error
description: "the scenario passed / the tests are green / the feature works — but is the governance rule actually ENFORCED? how do I test authorization? why didn't the test suite catch that anyone can create an agent?"
ocd: 2026-07-14
lmd: 2026-07-14
metadata:
  node_type: memory
  type: project
  tier: aspect
---

**A missing authorization check does not produce an error. It produces a SUCCESS that should
never have happened.** This single asymmetry is why ai-maestro's governance could be
comprehensively unenforced while every test, every scenario, and every day of real use looked
fine.

Therefore: **"the feature works" is evidence of NOTHING about authorization.** A green
happy-path test is exactly what a missing guard looks like from the outside. Verify a rule by
**reading the guard that refuses the violation** — never by observing the permitted case
succeed.

## The evidence (all confirmed 2026-07-14, `1ac64125`)

| Rule (IRON, USER-set) | What the code does |
|---|---|
| **R30.1** — "the COS requires the MANAGER's approval/**mandate** to create agents" | **No enforcement anywhere.** `POST /api/agents` calls `authenticateFromRequest()` and *nothing else* — no `authorize()`, no title check. There is no `create-agent` AuthAction in the RBAC enum, and the route is absent from `security-registry.json`. **Any authenticated agent of any title can create agents.** |
| **R30.1's mandate mechanism** (the R28 portfolio token) | Built, wired into `CreateAgent`, six passing test suites — and **inert**: `OPERATIONS_REQUIRING_TOKEN = {}`, so `matchPortfolioToken` returns `ok:true` unconditionally. |
| **R29.1** — a team auto-creates the COS **+ the 5 basic members** | `createNewTeam` creates the auto-COS **only**. Every team is born incomplete. |
| **R31** — an incomplete team is **FROZEN** | **Zero enforcement.** (The only `frozen` hits are R9.8's no-MANAGER-on-host cascade — a different rule.) |

**R29.1 and R31 conceal each other**, which is the whole lesson in miniature: teams are born
without their mandated members, and the rule that would have caught that was never wired. Two
holes, mutually masking, both invisible from the happy path.

## The corollary that kills the obvious fix

A UI scenario *"the USER asks the MANAGER to create a team, then destroy it"* — the natural test
to reach for — **PASSES today.** MANAGER may create a team ✓. The auto-COS is created through
the ungated path ✓ (*because* it is ungated). MANAGER may delete the team ✓. Green, end to end,
while violating R29.1, R30.1 and R31.

**A happy-path suite is constitutionally blind to a missing guard, however many you write.**
Only an **adversarial** test finds one — attempt the forbidden act and assert the *refusal*:

- a MEMBER calls `POST /api/agents` → **must be 403** (today: **201**)
- a COS creates an agent with no MANAGER mandate → **must be 403** (today: **201**)
- a freshly-created team → **must contain the 5 base members** (today: **1**)
- a team missing a base member → **must be FROZEN** (today: fully operational)

Same shape as `[[TRDD-SB5I53K1]]`'s sibling lesson from the approval verifier: *a verifier that
never fails is not a verifier.*

## The third category — worse than an unenforced rule

Where the rules are **SILENT**, the code invents a policy, and the invention is then read
downstream as law. `lib/authorization.ts`:

```ts
// Only system-owner and MANAGER can delete agents.  ← asserted as policy…
// No agent can delete itself via API. COS cannot delete.
if (action === 'delete-agent') { … return { allowed: false, reason: 'Only MANAGER can delete agents' } }
```

R30 governs COS agent *creation* and says **nothing** about deletion. That flat denial is an
**invention**, and it contradicts the COS's own role definition (*"per-team agent management"*)
— a role that may create its team's agents and may not remove them. The USER has since ruled
otherwise (`[[TRDD-8K68E16G]]`).

**An unenforced rule looks missing. An invented one looks DECIDED.** That is why this category
is the most dangerous, and it is the same shape as the `agent_policy_undefined` incident in
`[[strict-route-agent-policy]]` — hit twice in one week.

## How to apply

1. **Auditing a rule?** Open the guard. Cite `file:line` for the refusal. A grep miss is not
   proof of absence (see `[[claim-verification]]` discipline) — open the plausible file.
2. **Writing a governance test?** Write the **negative** case first. The positive case will
   pass whether or not the guard exists, so it distinguishes nothing.
3. **Reading a hard denial in code?** Check the rule actually *says* it. If the rule is silent,
   you are looking at an invention, not a policy — and something downstream is already treating
   it as law.
4. **Found a mechanism that's built but switched off?** That is the sixth instance this week —
   see `[[agent-claims-the-api-was-never-delivered]]`. Check the switch beside the call site.

## Notes and lessons learned

[^1]: [ocd:2026-07-14 lmd:2026-07-14] All four holes above surfaced from **stopping and
  restarting the server** — nobody was using ai-maestro, no feature was under test. Touching
  the power switch was enough. The lesson is not "we found bugs"; it is that the defects sat in
  the authorization layer, where nothing exercises them, and the system's own success was the
  camouflage. When a subsystem's correctness is only ever observed through its happy path,
  assume it is unverified rather than working.

[^2]: [ocd:2026-07-14 lmd:2026-07-14] I filed `TRDD-F1SL03CK` saying its blocking question —
  *"does a COS ever create an agent in normal team operation?"* — was one I could not answer and
  that the MANAGER could settle "in one query". **R30.2 already answered it: yes.** The answer
  was written by the USER, in the repo, in the rules file the TRDD itself cites. I reasoned about
  what I *would need to be told* instead of reading what was *already there*.
  Lesson: **before declaring a question unanswerable, grep the governance rules for the answer.**
  This is the same error as `[[agent-claims-the-api-was-never-delivered]]`, committed while
  writing a TRDD about that very error.
