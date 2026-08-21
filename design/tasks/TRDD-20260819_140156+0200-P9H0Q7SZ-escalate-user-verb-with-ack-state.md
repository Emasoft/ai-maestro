---
trdd-id: P9H0Q7SZ
title: USER-escalation script verb with acknowledgment state
column: design
created: 2026-08-19T14:01:56+0200
updated: 2026-08-21T18:12:19+0200
implementation-commits: []
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 2
project-id: ai-maestro
labels: [scripts-spec-needs, decoupling-layer, autonomous, escalation]
external-refs: [TRDD-1R72424K, AUTONOMOUS reply 2026-08-19 (BRRJK57P ledger)]
---

# USER-escalation script verb with acknowledgment state

## Problem (spec-first — requested by ai-maestro-autonomous-agent, 2026-08-19)

The AUTONOMOUS Tier-3 workflow (solo project, no MANAGER) must reach the USER for
golden-rule changes, irreversible ops, credential issues — and the loop must KNOW whether
the USER saw it. Today the spec offers only `aimaestro-hook.sh notify` (dashboard activity
line, no ack) and `aimaestro-groups.sh notify` (agent-to-agent). TRDD-1R72424K records the
inverse gap ("a non-maestro user has no channel to me at all").

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21T18:12

**Three of the problem statement's premises are wrong, and correcting them shrinks the build
from "a new escalation subsystem" to "an ack record on top of two shipped ones."** Measured:

1. **A human↔agent round trip ALREADY SHIPS.** `scripts/aimaestro-panel.sh`
   (verbs `open close refresh set status feedback`) pushes live HTML into the human's
   dashboard side panel, and `GET /api/agents/[id]/panel/feedback` drains the click events
   the human generated inside it, FIFO, read-and-clear. Card **TRDD-229CJGYH** —
   `column: completed`, in `design/archived/`. So "server side: dashboard surfacing" is not
   to be built; it exists and is the substrate.
2. **The board ALREADY HAS a USER-escalation state.** `lib/kanban-field-authority.ts:33`
   registers `human_review` as *"escalation to USER (Z)"*, with `human_review → dev` as the
   un-escalation. For anything that IS a TRDD, the durable escalation record is the column.
3. **`external-refs: TRDD-1R72424K` is DANGLING** — `find -iname '*1R72424K*'` across all
   three scope roots (PROJECT, LOCAL, USER) returns nothing. The "inverse gap" it is cited
   for is at least partly closed by 229CJGYH above. Do not treat that ref as evidence.

### The real delta is ONE thing: nothing anywhere records that the human SAW it

Panel feedback fires only if the human clicks something inside the panel; `human_review`
records that a card is with the user but never that they looked. So an autonomous loop still
cannot distinguish *unseen* from *seen and not yet decided* — which is the whole reason this
card exists. Everything else on the wish-list is already on disk.

Measured against a live instance of the gap, twice today: TRDD-A9335BZ6 waits on the owner
minting one token, and TRDD-N4SDG0ML waits on the owner choosing a cross-repo route. Both sit
in `human_review` with no way to tell whether the owner has seen either.

### Proposed shape (corrected — build the ack, reuse the rest)

```
aimaestro-agent.sh escalate-user  --message M --priority P [--trdd <id8>] [--panel <file>]
aimaestro-agent.sh escalation-status <id>     → pending | seen | acked  (+ timestamps)
```

- **Record**: one append-only store, `{id, agentId, message, priority, trdd?, createdAt,
  seenAt, ackedAt}`. It is the ONLY new persistence.
- **Surfacing**: reuse `aimaestro-panel.sh` when `--panel` is given; otherwise the dashboard
  activity line. Do NOT add a second push channel.
- **`seen`** is written by the dashboard when the escalation is rendered; **`acked`** by an
  explicit user action. They are different facts and must not be collapsed — "it was on
  screen" is not "they decided".
- **`--trdd`** links the escalation to a card so `human_review` and the ack agree instead of
  drifting; that link is what stops this becoming a second board.

### The spec-first gate has a trap — do not write the header before the code

The card's first box says "usage block in the script header", and specs are GENERATED from
those headers (`scripts/gen-specs.mjs` → `design/specs/aimaestro-scripts-spec.md`). Writing
the header first therefore publishes a spec for a verb that does not exist, and every reader
of that spec — including other plugins' agents — takes it as shipped. **Land the header in the
SAME commit as the implementation, and draft the spec text here in the card meanwhile.** The
gate's intent (design the interface before coding it) is satisfied by the block above.

## Acceptance

- [ ] spec section drafted first (usage block in the script header) and reviewed against
      the autonomous plugin's escalation workflow
- [ ] server records escalation + ack; poll verb returns pending/acked with timestamps
- [ ] autonomous session confirms the verb serves the Tier-3 loop (their reply ledgered)

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive
  ("many plugins needs some specific functionalities... ask them, implement them, create
  the scripts and update the specs"). Queued at todo; spec-first at design.
