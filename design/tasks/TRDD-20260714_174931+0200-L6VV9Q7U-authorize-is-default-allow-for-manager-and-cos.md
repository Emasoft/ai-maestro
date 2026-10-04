---
trdd-id: L6VV9Q7U
status: tasked
title: authorize() is default-ALLOW for MANAGER and COS — every new AuthAction is a silent grant
column: human_review
created: 2026-07-14T17:49:31+0200
updated: 2026-10-05T01:57:03+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: security
min-approval-requirement: user
approved: true
priority: 0
severity: critical
effort: medium
release-via: none
relevant-rules: [6, 9, 10, 11, 26, 28, 30, 32, 42]
labels: [security, authorization, governance, root-cause, structural]
approval-judge:  user 
approval-datetime: 2026-09-05T10:20:46+0200
assignee: ai-maestro-hub-session
implementation-commits: [876673caa, 07f8745b0, fb4052467]
eht: []
relevant: [TRDD-A50RC5G8]
---

# authorize() is default-ALLOW for MANAGER and COS — every new AuthAction is a silent grant

## Problem

`lib/authorization.ts::authorize()` ends like this:

```ts
// MANAGER → always allowed (for actions on OTHER agents)
if (title === 'manager') {
  return { allowed: true }
}

// CHIEF-OF-STAFF → own team agents only
if (title === 'chief-of-staff') {
  … if (cosTeamId === targetTeamId) return { allowed: true }
}

// All other titles → denied
return { allowed: false, … }
```

For MANAGER and CHIEF-OF-STAFF the function is **default-ALLOW**. It is default-deny only for
everyone else. So a constraint on those two titles exists **if and only if** somebody remembered
to insert a gate ABOVE those lines.

**This is not a style observation — it is the shape of every authorization hole this project has
found.** R42 works only because its `DRIVE_ACTIONS` gate was inserted at `:499`, above the
blanket. `change-title` (`:278`), `delete-agent` (`:309`), `manage-team` (`:321`),
`register-agent` (`:333`), `export-agent` (`:362`) and `manage-trdd` (`:378`) are constrained for
the same reason: an explicit branch, hand-placed, above the grant.

**That is 8 gates for 17 `AuthAction`s.** The other 9 are granted to MANAGER on any agent, and to
COS across its whole team, **because nobody wrote a line preventing it**:

| AuthAction (ungated) | What the blanket grants | Rule behind it |
|---|---|---|
| `create-session` | **registry write + tmux spawn** for another agent | **none — and see the contradiction below.** |
| `link-session` | bind a tmux session name to another agent's registry record | **none.** |
| `delete-session` | hard-**KILL** another agent's session (`POST /api/sessions/[id]/kill`, `DELETE /api/sessions/[id]`) — no `/exit`, no safe-state gate, in-flight work destroyed | **none.** R10.3 grants COS *wake* and *hibernate*. Hibernate is the graceful one; a kill is a different act, and no rule mentions it. |
| `manage-group` | create/update/delete groups; subscribe/notify other agents | **none.** |
| `modify-agent`, `manage-skills` | change another agent's configuration | **R42.6 — RULED** (the USER, 2026-07-14: "MANAGER and COS retain a separate, non-injection authority: changing an agent's configuration … and its TEAM/TITLE"). Not a hole. |
| `wake-agent`, `hibernate-agent` | lifecycle | **R10.1/R10.2/R10.3 — RULED.** |
| `view-agent` | read | harmless. |

The four ruled rows are the point: R42.6 and R10.3 are what a *decided* policy looks like. The
four above them are what an *undecided* one looks like — **and the code cannot tell the
difference.**

### The contradiction that proves the mechanism is broken, not merely incomplete

`register-agent` is denied to **every** title including MANAGER (`:333`), and the comment says
exactly why:

> *"registerAgent writes `~/.aimaestro/agents/<id>.json` **and creates tmux sessions under
> arbitrary names**. Only system-owner is permitted — not even MANAGER, because registerAgent is
> the bootstrap primitive that mints agent records."*

`create-session`'s own declaration (`:54`) describes **the same primitive**:

> *"SVC2-MAJ-01: createSession is a **registry-write + tmux-spawn** primitive"*

One is locked to the system owner after a security review reasoned about it. The other is handed
to MANAGER and to every COS over its team — **not because anyone weighed it and decided
differently, but because no one wrote a branch.** Two identical dangers, two opposite policies,
and the difference between them is not a judgment: it is an omission. `link-session` (a registry
write) sits in the same family and got the same non-decision.

That is the whole argument for this TRDD in one pair of comments.

## Root cause

**A default-allow branch converts forgetting into permission.** Add a new `AuthAction` tomorrow —
`rotate-agent-key`, `read-agent-memory`, `impersonate-agent` — and it is granted to MANAGER and
to every COS over its team the moment it is defined, with no diff to review, no test to fail, and
no 403 to notice. The grant is invisible precisely because it is the *absence* of code.

This is the same asymmetry recorded in `[[an-unenforced-rule-produces-a-success-not-an-error]]`:
**a missing guard produces a SUCCESS, not an error.** Here the missing guard is structural rather
than accidental — the architecture *manufactures* missing guards.

It also explains why the audit keeps finding "INVENTED" policies. They were not invented by an
implementer choosing a policy; they were invented by the blanket, choosing one for them.

## Proposed fix

Invert the default. Replace the two blanket branches with an explicit, exhaustive
**action → titles** matrix, and DENY anything absent from it:

```ts
const ACTION_POLICY: Record<AuthAction, Policy> = {
  'send-command':      { self: true,  manager: false, cosOwnTeam: false },  // R42
  'restart-session':   { self: true,  manager: false, cosOwnTeam: false },  // R42
  'modify-agent':      { self: false, manager: true,  cosOwnTeam: true  },  // R42.6
  'manage-skills':     { self: false, manager: true,  cosOwnTeam: true  },  // R42.6
  'wake-agent':        { self: false, manager: true,  cosOwnTeam: true  },  // R10.3
  'hibernate-agent':   { self: true,  manager: true,  cosOwnTeam: true  },  // R10.3
  'delete-session':    { … },   // ← REQUIRES A USER RULING (see below)
  'create-session':    { … },   // ← REQUIRES A USER RULING
  'link-session':      { … },   // ← REQUIRES A USER RULING
  'manage-group':      { … },   // ← REQUIRES A USER RULING
  …
}
// exhaustiveness is compiler-checked: Record<AuthAction, Policy> fails to typecheck
// the moment a new AuthAction is added without a policy.
return ACTION_POLICY[action] ? evaluate(...) : { allowed: false, reason: 'no policy for this action' }
```

Two properties this buys, neither of which exists today:

1. **A new AuthAction cannot ship ungoverned.** `Record<AuthAction, Policy>` fails to compile
   until someone writes its row. The decision becomes a diff a human reviews, instead of a
   silence nobody sees.
2. **Every row cites the rule that authorises it.** A row with no rule citation is, by
   construction, an invention — visible in review rather than discovered in an audit a year later.

## The rulings this needs (the rules are SILENT — an engineer must not choose)

1. **`delete-session` (kill).** May a MANAGER hard-kill any agent's session, and a COS any of its
   team's? Note the tension with R42: the USER ruled that no agent may make another agent *act* —
   but a kill does not make it act, it *ends* it, destroying in-flight work with no safe-state
   check. Hibernate (graceful, `/exit`, R10.3) is the ruled act; a kill is a different one.
2. **`create-session` / `link-session`.** These are the same registry-write + tmux-spawn primitive
   that `register-agent` is locked to the system owner for. Should they follow `register-agent`
   (system-owner only), or `wake-agent` (MANAGER + own-team COS)? The two are defensible; the
   status quo — *neither, by accident* — is not.
3. **`manage-group`.** Who may create groups and subscribe other agents to broadcasts? R1 defines
   groups; it never says who administers them.

An engineer can pick a plausible answer for each of these in thirty seconds. That is exactly why
one must not: a plausible answer, once shipped, becomes law by deployment and is indistinguishable
from a decision anyone made.

## Verification

- The matrix is `Record<AuthAction, Policy>` — adding an AuthAction without a row is a **type
  error**. That is the regression test.
- Adversarial tests (a happy-path test proves nothing here — see the aspect page): for each
  action × each title × {self, own-team, other-team}, assert the decision. The table above is the
  expected-value fixture.
- Non-regression: R42 (drive denied for all), R42.6 (config allowed for MANAGER/COS), R10.3
  (wake/hibernate allowed), delete-agent/register-agent/export-agent unchanged, system-owner
  unaffected.

## Acceptance
- [x] Matrix landed with no behaviour change for MANAGER, CHIEF-OF-STAFF, MEMBER and the system owner (876673caa; baseline of 19 actions x 8 cases reproduced; governance + unit + security + authorization suites 456 files / 5649 tests green on the committed tree, 2026-10-05). The other six titles are not in the fixture; the tail treats every non-manager, non-COS title identically
- [ ] USER: is a process-level session kill a hard-kill reserved to the user? (then set the delete-session row)
- [ ] USER ruling 2: create-session / link-session — system-owner only like register-agent, or MANAGER + own-team COS
- [ ] USER ruling 3: who administers groups (manage-group)
- [x] Split the CHIEF-OF-STAFF denial reason: a grant row with cosOwnTeam false must not answer "only in their own team" to a COS acting on its own team (unreachable today, wrong for the first such row)
- [x] ACTION_POLICY is an exported MUTABLE object: freeze it and give the synthetic-row tests a test-only seam, so no module can flip a grant at runtime
- [ ] The four UNRULED rows carry no UNRULED marker after the rulings above are applied

## Estimated risk

**Landing it: LOW-MEDIUM.** It is a refactor of one function with a complete test suite already
pinning today's behaviour; any row I get wrong turns a 200 into a 403, which fails loudly rather
than silently. **Not landing it: CRITICAL** — every future AuthAction is a silent privilege grant
to the two most powerful titles in the system, and the next hole is already scheduled.

**Dependency:** the three rulings above. The refactor can land with today's behaviour preserved
row-for-row (a pure, no-op restructure that makes the exposure *visible*), and the rulings can
change individual rows afterwards. That sequencing is recommended: it removes the structural
defect immediately without pretending an engineer may settle a governance question.

## Approval log
- 2026-09-05T10:20:46+0200 — APPROVED by  user  (min-approval-requirement: user). APPROVED:  `authorize()` still hard-codes MANAGER/COS default-allow (lib/authorization.ts:305-343) . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
- 2026-10-05 — USER RULING 1 (delete-session / kill), verbatim: "1 - yes, MANAGER and CHIEF-OF-STAFF (this one only in its own team) can kill/delete an agent. but only soft-kill. the agent corpse in the cemetery can always be resurrected by the user maestro." Consequences: the `delete-session` row is a RULED grant (MANAGER any agent; CHIEF-OF-STAFF own team only). An AGENT caller, whatever its title, may only SOFT-delete: the cemetery archive must survive, and hard delete / cemetery purge / resurrection stay with the user (MAESTRO). Rulings 2 (create-session, link-session) and 3 (manage-group) remain OPEN.
- 2026-10-05 — USER RULING (general rule on hard-kill), verbatim: "in general hard-kill is strictly reserved to the user maestro. it also needs a sudo confirmation from the user." Consequences: no agent, under any title, may hard-kill or hard-delete; the hard path is system-owner only AND requires a sudo token. This settles the reading that agents are soft-only.
- 2026-10-05 — CORRECTION by main-agent@ai-maestro to the two entries above. Only the QUOTED sentences are the user's. Everything after "Consequences:" is my INTERPRETATION and is UNCONFIRMED. Specifically NOT ruled: (1) whether a process-level session kill (`delete-session`: POST /api/sessions/[id]/kill and the two session DELETEs) counts as "hard-kill" — if it does, it is user-only and the phrase "RULED grant" above is wrong; that row stays at status quo, flagged, until the user answers. (2) Whether cemetery RESTORE is user-only — the user said the user "can always" resurrect, not that others cannot. (3) "system owner" was used for "the user maestro" without checking how the two relate when the user-authority model is on. ENTAILED by the quotes and safe to build: CHIEF-OF-STAFF may delete an agent of its own team (a privilege widening); agents may only soft-delete; hard delete is the user's and needs sudo; cemetery purge is the user's. The question is with the user.
- 2026-10-05 — LANDED by main-agent@ai-maestro as 876673caa: the matrix, with no behaviour change (a table recorded from the previous source is reproduced cell for cell; 136/136; six neuters). The structural defect is closed. NOT closed: the four UNRULED rows still carry their old grant. This card cannot reach complete until rulings 2 and 3 are made, the session-kill question is answered, and TRDD-A50RC5G8 (its EHT) is terminal.
- 2026-10-05T01:37:48+0200 — column → human_review by main-agent@ai-maestro. Code landed 876673caa as a proven no-op; remaining work is three USER rulings on the UNRULED rows.
- 2026-10-05 — NOTE by main-agent@ai-maestro on the column: this card went planned → human_review in one move. No separate AI reviewer signed it off; the implementing session verified it and had it challenged by review forks it briefed. human_review here means ONLY "waiting on the user for the three rulings in Acceptance", not that an independent review passed.

## RE-VERIFIED 2026-08-22T15:0x — the claim HOLDS against live code

Read `lib/authorization.ts:624-640` first-hand. After the per-action gates fall through:

```ts
// MANAGER → always allowed (for actions on OTHER agents)
if (title === 'manager') { return { allowed: true } }

// CHIEF-OF-STAFF → own team agents only (target required for agent-scoped actions)
if (title === 'chief-of-staff') { … if (cosTeamId === targetTeamId) return { allowed: true } … }

// All other titles → denied (no agent can modify other agents)
```

MANAGER is an **unconditional allow** on the fall-through path; COS is a team-scoped allow on the
same path; every other title is denied. So an `AuthAction` that has no dedicated branch above is
granted to MANAGER and COS **by default**, and adding a new action grants it silently — which is
this card's claim, unchanged.

**Scope note — what was and was NOT re-derived.** A verification pass reported *"9 of 18
AuthActions have no dedicated gate."* That tally is **not** re-derived here; only the STRUCTURE is
verified. Treat the count as needing its own measurement before it is quoted as a number — the
default-allow shape is the part that is measured.

**The fix direction this implies (not decided here):** the safe default for a new enum value is
DENY, so the fall-through should refuse an action it does not recognise rather than admit it. That
is a behaviour change with real blast radius — every MANAGER/COS action that currently relies on
the fall-through would need an explicit branch first, or it breaks. Sequence it that way round:
enumerate and gate the actions that legitimately pass today, THEN invert the default.
