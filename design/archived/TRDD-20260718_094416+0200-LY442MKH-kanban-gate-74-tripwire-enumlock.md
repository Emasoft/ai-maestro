---
trdd-id: LY442MKH
title: close ai-maestro#74 residuals — BYPASS-1 previousStatus tripwire test + surface the enum hard-lock decision
column: complete
created: 2026-07-18T09:44:16+0200
updated: 2026-07-23T14:37:20+0200
current-owner: ai-maestro
task-type: security
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-18T09:44:16+0200
relevant-rules: [23, 42]
labels: [security, kanban, field-authority, gate, issue-74, tripwire]
external-refs: [Emasoft/ai-maestro#74]
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [69b03617]
---

# close ai-maestro#74 residuals — BYPASS-1 previousStatus tripwire test + surface the enum hard-lock decision

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-18

**Context:** ai-maestro#74 flagged 2 bypasses + 1 enum gap in `lib/kanban-field-authority.ts`
(the R41 approval-ladder gate on kanban column moves). **BYPASS 2 is already FIXED** (`c61ccbcb`,
MANAGER-accepted). Two residuals remain, per the MANAGER ruling in the issue thread:

1. **BYPASS 1 — CI regression tripwire (MANAGER: REQUIRED).** `previousStatus` is client
   bookkeeping validated LATENT-safe: no server code promotes it to `status`. The tripwire asserts
   that stays true, so the day a refactor wires `previousStatus → status` the gate is bypassed and
   CI turns red BEFORE it ships. **← THIS TRDD does this now (Tier-0, self-mandate, pure test).**
2. **Enum hard-lock (MANAGER: REQUESTED, but tradeoff USER-RESERVED).** A team whose custom
   `kanbanConfig` renames/omits `ai_review`/`human_review`/`complete` structurally stops GATE 2
   firing (self-review ban) for that team. The MANAGER explicitly reserved the MECHANISM tradeoff
   (per-team custom columns vs gate integrity) to the USER: *"theirs to override if they disagree
   with my strict default."* **← NOT executed here; surfaced to the USER for the mechanism pick.**

**VERIFIED on-disk (HEAD b834bcec, gate last touched by c61ccbcb):**
- `previousStatus` has NO server-side `→ status` promotion. `updateTask` (`lib/task-registry.ts:275`)
  spreads `...updates` — a `{previousStatus}` write lands on `task.previousStatus`, `status` untouched.
  Derived only in `lib/github-project.ts` (mirror label), free-string at the route, passed to registry.
- Arbitrary status strings are ALREADY rejected: `validStatusesForTeam` (`task-registry.ts:49`) →
  `team.kanbanConfig.map(c=>c.id) ?? DEFAULT_STATUSES`; both create (L192) and update (L263) reject.
- `setKanbanConfig` (the custom-column override) is ALREADY gated (GOV-AUDIT 2026-06-21,
  `teams-service.ts:1533-1542`) to ORCHESTRATOR/COS/MANAGER — a plain MEMBER gets 403. So the GATE-2
  config-disable path requires elevated setup, not a rogue MEMBER.

**ITEM 1 DONE (`69b03617`).** 3 BYPASS-1 tripwire tests added to `tests/task-registry.test.ts`
(previousStatus-only write leaves status unchanged; a governed column parked in previousStatus never
leaks into status; an explicit status write always wins over previousStatus). Verified: file 61/61
green, tsc 0, `yarn build` exit 0. NOT pushed (app, not a plugin).

**ITEM 2 DONE — OPTION C IMPLEMENTED (2026-07-23).** The USER delegated the reserved mechanism pick
("decide yourself", 2026-07-23) and **C** was chosen: `setKanbanConfig` (`services/teams-service.ts`)
now REJECTS (400) any custom column set that drops a governance column id, naming every missing id.
The set is `GATE_CRITICAL_COLUMN_IDS`, newly exported from `lib/kanban-field-authority.ts` and
DERIVED from the gate's own sets (`GOVERNED_TARGET_COLUMNS ∪ GOVERNED_BACKWARD_TO_DEV ∪
REVIEW_COLUMNS ∪ {dev}`) so the config check can never drift from the predicates it protects.
Validation sits in the SERVICE (not the route), so the Next.js route and the headless router are
covered alike — same reason the GOV-AUDIT RBAC gate lives there. It applies to the system-owner path
too: a gate-breaking board is a STRUCTURAL defect, not an authority question. C was chosen over A
(breaks every legit custom board) and B (reverses the deliberate 2026-06-21 GOV-AUDIT authority
decision); C changes no authority and keeps the feature.

Tests: 5 service tests (incl. the exact `boss-check`/`done` rename attack from the issue, the
all-missing-ids-named case, RBAC-runs-first ordering, and the system-owner path) + 3 pure gate-set
tests. The pre-existing RBAC fixture `COLS` was widened to a gate-valid set — it tests RBAC, not the
vocabulary, and would otherwise have 400'd. Gates: tsc 0 · `yarn test` 227/227 files · `yarn build`
exit 0. NOT pushed (app, not a plugin).

**ai-maestro#74 is now fully closed:** BYPASS 2 (`c61ccbcb`) · BYPASS 1 latent-safe + tripwires
(`69b03617`) · enum hard-lock (this commit).

**SUPERSEDED — do NOT carry forward:** item 1's original "NEXT ACTION: add the tripwire tests" —
done. And item 2's "awaits the USER's mechanism pick / do NOT unilaterally restrict the
custom-columns feature" — the USER delegated the pick on 2026-07-23 and C is implemented.

## The enum hard-lock — mechanism options for the USER (the reserved decision)

The residual GATE-2 strictness gap: a custom `kanbanConfig` (settable by ORCH/COS/MANAGER) can rename
`human_review`→e.g. `boss-check` and `complete`→`done`; then a self-assigned agent moving its own
card `boss-check → done` trips neither GATE 1 (`done`∉GOVERNED_TARGET_COLUMNS) nor GATE 2
(`boss-check`∉REVIEW_COLUMNS) — self-review ban disabled for that team. Three ways to close it:

- **Option A — hard-lock the vocabulary at the route.** Reject any `status` write not in the ratified
  17-col set. CONFLICT: directly contradicts the wired custom-columns feature
  (`validStatusesForTeam` custom path, `setKanbanConfig`, GH-Project column sync) — breaks every
  legit custom board. Only correct if custom columns are declared NOT a real product need.
- **Option B — tighten the override to MANAGER-only.** Change `setKanbanConfig` from
  ORCH/COS/MANAGER → MANAGER-only, so only the authority GATE 2 protects can define a non-standard
  board. A governance-authority change (who may configure a team's board) — MANAGER-requested, but
  reverses a deliberate 2026-06-21 GOV-AUDIT decision.
- **Option C (RECOMMENDED) — require custom configs to PRESERVE the governance column ids.**
  Validate in `setKanbanConfig` that a custom column set still contains the gate-critical ids
  (`ai_review`, `human_review`, `complete`, the release/terminal columns) so the gates keep firing,
  while letting teams add/rename NON-governed columns. Keeps the feature, closes the gap by
  construction, no authority change. Cost: constrains what a custom board may omit — the exact
  per-team-configurability-vs-gate-integrity tradeoff the MANAGER reserved to the USER.

My recommendation: **C** (preserves the feature AND makes the gate config-unbreakable). Awaiting the
USER's pick; then implement as a follow-up (its own commit, tests, verify).

## Verification (item 1)

- `bash scripts/with-node.sh npx tsc --noEmit` — 0 errors.
- `bash scripts/with-node.sh yarn test` — green, incl. the new BYPASS-1 tripwire tests.
- `bash scripts/with-node.sh yarn build` — clean.
- Do NOT push (this is the app, not a plugin). Commit by name with TRDD-LY442MKH in the subject.

## Approval log

- 2026-07-23T14:37:20+0200 — COMPLETED. Item 2 (enum hard-lock) implemented as Option C after the
  USER delegated the reserved mechanism pick ("decide yourself"). ai-maestro#74 fully closed.
- 2026-07-18T09:44:16+0200 — MANDATE issued by ai-maestro (min-approval-requirement: none).
  Self-mandate: Tier-0 regression test on the server's own security gate, MANAGER-REQUIRED in
  ai-maestro#74, no product/governance change. The enum hard-lock's mechanism is USER-reserved and is
  NOT executed under this mandate — only surfaced. Pre-approved: issuer authority >= required approver.
