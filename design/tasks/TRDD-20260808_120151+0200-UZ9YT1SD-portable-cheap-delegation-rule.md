---
trdd-id: UZ9YT1SD
title: One portable cheap-delegation rule in the server-installed layer instead of per-plugin guidance
column: planned
created: 2026-08-08T12:01:51+0200
updated: 2026-08-15T01:30:26+0200
current-owner: ai-maestro-hub-session
task-type: feature
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T01:30:26+0200
project-id: ai-maestro
labels: [fleet-readiness, token-economy, rules-layer]
external-refs: []
---

# One portable cheap-delegation rule in the installed layer

## Why (measured 2026-08-08 ~12:00 at all 10 remote tips)

Cheap-model offload guidance (LLM-Externalizer etc.) ships in 5 role plugins and is ABSENT in
architect, integrator, autonomous, and assistant-role. `lean-worker` specifically is a
user-scope agent on one machine — no plugin can reference it portably. Tiering guidance is a
fleet-wide economy lever (the token-economy cost model: cost ≈ turns × per-turn-context), so it
belongs in the ONE layer every agent already receives — the server-installed workdir rules —
not in 10 drifting per-plugin copies.

## Design constraint — the 2200-byte budget

`rules/aimaestro/aimaestro-agent-rules.md` is charged on every turn of every agent and its
size is pinned by `tests/unit/agent-operating-rules.test.ts` at ≤2200 bytes (currently 2192 —
8 bytes free). The rule line costs ~110 bytes. Decide in implementation, in this order:
1. Trim ≥110 bytes of filler elsewhere in the file (preferred — budget unchanged);
2. else raise the budget with the WHY recorded in the test file: the line teaches delegation
   that saves orders of magnitude more tokens than its own carriage cost.
Never a new rules FILE for one line (a file has frontmatter+header overhead and is also
charged per-turn).

## The line (draft, tighten at implementation)

`- Delegate bounded simple work to the cheapest capable agent/model; keep your own context for judgment.`

## Verification

- Byte budget test green; the seeded file at or under budget.
- The line reaches a NEW agent workdir on next install/heal (verify in a real workdir, not
  the repo copy — the installed layer is what agents read).

## Acceptance

- [ ] Line landed in aimaestro-agent-rules.md within budget (trim-first)
- [ ] Budget test green; full seeded-rules conformance green
- [ ] Verified present in an actual agent workdir's installed copy after the server heals it

## Approval log

- 2026-08-15T01:30:26+0200 — §D4 sweep D3-FLOOR-SUSPECT ruled by ASSISTANT-MANAGER: floor
  RAISED to `manager` (this card edits the server-installed rules layer) and APPROVED at
  that floor in the same ruling. The prior self-mandate is VOID and replaced by this
  approval record — content judged sound and consistent with the standing token-economy
  rules.
