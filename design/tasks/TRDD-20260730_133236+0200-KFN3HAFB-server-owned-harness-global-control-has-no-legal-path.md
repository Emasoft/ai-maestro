---
trdd-id: KFN3HAFB
title: Server-owned GLOBAL control ops for harness agents have no legal implementation as specified
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: planned
created: 2026-07-30T13:32:36+0200
updated: 2026-08-21T22:00:37+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro
assignee: ai-maestro-hub-session
task-type: spike
min-approval-requirement: manager
mandate: false
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:00:37+0200
derived: false
parent-trdd: KCRMSNL7
relevant-rules: [42, 17]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-30

This was **capability #2 of TRDD-QZL828OD**. It is split out, not shrunk: while
implementing capability #1 I found that capability #2 **as specified has no legal
implementation** — both available routes are closed, by two different rules, each
with a real incident behind it. Building it would have required quietly breaking
one of them, so it needs a design decision (and a cross-project negotiation)
rather than code.

**The ask was:** the server provides the *global* versions of the janitor's control
ops — disarm/arm · pause/resume · reload — for **harness** agents, in-process, no
scripts, "machine-wide-for-the-harness switches the server invokes in certain
circumstances (e.g. before a fleet restart)".

**Route 1 — write the janitor's control-plane flags. CLOSED by the one-writer
contract.** `lib/janitor-control.ts` is a deliberate READ-ONLY reader of
`~/.claude/janitor-control/`, and its header states the rule and the reason:

> **NEVER WRITE.** The path is FIXED and foreign, so an accidental write here
> ratchets the whole fleet into a mode nothing lifts. This module has no writer
> and exports none. Reads only.

That is not our caution, it is the **janitor's own stated hazard** (ai-maestro#79
§7.1), and the failure it names has already happened once: agents re-enabled
maintenance at GLOBAL scope, where no project re-arm could clear it, so the fleet
ratcheted into machine-wide maintenance that nothing lifted — chores idle, plugin
self-updates stopped, and no session able to see the cause (recorded in the
janitor's own `/janitor-arm` skill). A second writer on that dir is exactly the
"two daemons fighting" corruption the one-daemon-per-host rule exists to prevent.

**Route 2 — inject `/janitor-disarm` into each agent's pane. CLOSED by R42.1.**
A janitor control command is a *slash command* — CONTENT. R42.1 forbids injecting
a command, keystroke, prompt, or queued input into another agent's session, and
this is absolute. **R42.7 (ratified today) does NOT help**, deliberately: it grants
only the *restart*, whose whole safety argument is that it carries no content
(R42.7(b)) and is uniform (R42.7(a)). A control command is expressive and
per-agent; stretching R42.7 to cover it would dissolve the one property that made
it approvable. R42.5's existing janitor exception is likewise the *janitor's* own
global switches, not the server's, and R42.5 says outright these are "machine-wide
switches, **not** commands targeted at an agent."

**So the honest position is: refuse the implementation, not the need.** The need is
real — before a fleet restart the server should be able to put the harness into a
known quiet state. But every mechanism that exists today is either a foreign write
or an injection.

**NEXT ACTION: decide which of the three designs below, then negotiate the one
that needs the janitor's agreement.** No code until then.

## Proposed fix — three candidate designs, in ascending cost

1. **The janitor exposes a WRITE API and remains the sole writer.** We ask (issue on
   `Emasoft/ai-maestro-janitor`) for a documented, locked entry point — a CLI verb or
   a small daemon endpoint — that the server calls to *request* a global mode change.
   The janitor stays the only process that writes its dir, so the one-writer contract
   holds intact, and the ratchet hazard stays the janitor's to manage. **Cheapest and
   safest; costs a round trip and their schedule.**
2. **A SECOND writer under an advisory lock.** `lib/janitor-control.ts` gains a
   writer that `flock(2)`-contends on the shared lock (the Flock-D5 shape). This is
   what the earlier plan sketched, and it is explicitly gated on "*once the janitor
   moves them to the control dir*" — i.e. it already depends on their cooperation, so
   it is design 1 with more of our code and more of our risk. It also needs an
   answer to "who clears a flag the other side set", which is precisely the ratchet.
3. **A SEPARATE ai-maestro-owned control plane under `~/.aimaestro/`.** No foreign
   write at all, fully within the R52 write boundary, and the server owns clearing
   its own flags. The cost is a SECOND set of switches with the same names as the
   janitor's — two control planes for one fleet, which is a new way for the two to
   disagree, and a human would have to know which one they just set. **Preferred only
   if 1 is refused**, and if so the flags must be named so they cannot be mistaken for
   the janitor's.

Whichever is chosen, the scope must state explicitly whether "reload" is included:
a plugin reload is arguably already served by R42.7's restart (a restarted agent
loads the new code), which would leave only pause/disarm genuinely unserved.

## Verification

- The chosen design is recorded here before any code lands.
- If design 1 or 2: the janitor issue is filed, linked, and answered.
- No commit in this card may write `~/.claude/janitor-control/` until the contract
  it depends on exists in writing. `lib/janitor-control.ts`'s no-writer property
  gets a test asserting the ABSENCE of an exported writer, so a future change has
  to delete a test that says why.

## Estimated risk

MED. The code is small in every design; the risk is entirely in the contract. Getting
it wrong reproduces a known incident (a fleet-wide mode nothing can lift) whose
symptom is silence — chores simply stop, and nothing on screen says why.

## Approval log

- 2026-07-30T13:32:36+0200 — FILED, split out of TRDD-QZL828OD's capability #2 while
  building capability #1. NOT a mandate: it needs a design decision plus (in two of
  three candidates) another project's agreement, and the USER's 2026-07-30 delegation
  ("i don't care of those details. you solve them") authorizes rulings, not a
  unilateral write into a foreign control plane that a prior incident already showed
  ratchets the whole fleet. `min-approval-requirement: manager` because the outcome
  crosses a project boundary.
- 2026-08-21T22:00:37+0200 — **APPROVED (min-approval-requirement: manager)** by
  ai-maestro-hub-session. Re-measured: `lib/janitor-control.ts` is still a documented,
  tested no-writer module ("This module has no writer and exports none. Reads only.");
  `gh issue list --repo Emasoft/ai-maestro-janitor --search "control plane"` returns none —
  no issue filed yet, no design decision recorded. Route 2 (R42.1) is unchanged: no R42
  amendment has landed that would cover injecting a control command. Premise stands
  unresolved, no legal implementation exists yet, and the card asks for a design decision
  plus a cross-project negotiation rather than for code — a legitimate spike. Approved as
  written; the actual design pick (candidate 1/2/3) and the janitor-issue filing are left
  to whoever picks this up next, per the card's own NEXT ACTION.
