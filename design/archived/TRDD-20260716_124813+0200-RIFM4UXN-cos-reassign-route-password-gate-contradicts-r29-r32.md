---
trdd-id: RIFM4UXN
title: COS-reassign route requires the governance password — contradicts R29/R32 and defeats MANAGER ruling #64
column: completed
created: 2026-07-16T12:48:13+0200
updated: 2026-08-19T21:14:04+0200
current-owner: ai-maestro
task-type: audit
scope: project
min-approval-requirement: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T16:02:18+0200
implementation-commits: [20f5ba72]
relevant-rules: [29, 32, 9]
labels: [governance, security, core-readiness, script-decoupling, decouple-blocked]
external-refs: [Emasoft/ai-maestro-plugin#29, Emasoft/ai-maestro#64, Emasoft/ai-maestro#69]
---

# COS-reassign route requires the governance password — contradicts R29/R32 and defeats MANAGER ruling #64

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**▶ RULED (USER, 2026-07-16) = Option A + self-assign ban. SHIPPED — `column: testing`.**
Commit `20f5ba72`: the route now authorizes via `authorize('manage-team')` (MANAGER by
AID / human system-owner), password OPTIONAL, an agent may not self-assign, and the
human/UI keeps its password confirmation unchanged (a strict superset — zero human-side
weakening). The CLI gained the #64-canonical `aimaestro-teams.sh update --cos <uuid>`
(+ `--remove-cos`) routed to the chief-of-staff POST; `reassign-cos` kept as a thin alias
with `--password` now optional. 6-case route test
(`tests/unit/cos-reassign-authorization.test.ts`) green; tsc clean.

**NEXT ACTION — the ai-maestro side is DONE; what remains is CORE's, gated on DEPLOYMENT.**
CORE (ai-maestro#69) holds the same discipline it applied to `verify`: it drops the stale
DECOUPLE-BLOCKED markers (SKILL.md L60, REFERENCE.md L36/L69/L122/L126) and teaches
`update --cos` the moment the CLI verb is on a DEPLOYED host (i.e. `governance-rules`
merged to `main` + installed to `~/.local/bin/`). That deploy is USER/ops-gated (the whole
governance-rules branch), the same trigger as SCRIPT-MANIFEST.md landing on `main`.

**Originally surfaced** 2026-07-16 while verifying (USER ask) whether the ai-maestro plugins
call any script command the frozen CLI layer lacks. Answer was **no missing commands**, but
the #64 verb shipped password-gated, so a MANAGER agent couldn't call it — the contradiction
this TRDD fixed.

**▶ 2026-07-16 — CORE INDEPENDENTLY CONFIRMED Option A + added a missing guard
(`Emasoft/ai-maestro#69`, comment 11:05Z).** Told by the USER to "rewrite the
requested commands to be secure", CORE restated the COS-assign verb as a security
contract: **`aimaestro-teams.sh update --cos <id>` (+ clear-path `--cos ""`/`--remove-cos`)
= MANAGER-title-by-AID ONLY (R29/R9.11 — no user approval, NO gov-password ever through
a model, R32.3), NEVER self-assignable (an agent cannot make itself or its ally the
COS).** That is Option A, and it adds a guard THIS TRDD missed: the **self-assign ban**
("without it, it would be a fleet-takeover primitive"). So the ruling is effectively
**A + self-assign ban**, pending the USER's nod. NOTE a verb-name choice remains: CORE/
#64 want it under `aimaestro-teams.sh update --cos`; the repo currently ships it as the
password-gated `reassign-cos`. Fold both into Option A: expose it AID-MANAGER + self-assign
ban, under the #64-named `update --cos` (keep `reassign-cos` as an alias or retire it).
This item is now part of the CORE #69 work package (4 server-side asks, all R23-mine).

## Problem — a contradiction, not a missing command

Three artifacts disagree about how "assign/remove a Chief-of-Staff on an
**already-existing** team" is authorized:

1. **Governance design (R29 / R32 / R9.11), as the core plugin's own
   `team-governance` skill states it (SKILL.md lines 21, 49, 58):** the MANAGER
   performs team-governance ops **by AID, with no user approval and no password**;
   "agents **never** face a sudo gate … a `--password` flag on a deployed CLI is a
   **USER/UI residual you surface to the user, never supply yourself**" (R32); COS
   assignment "needs **no agent password**" (R29/R9.11).

2. **The shipped route `app/api/teams/[id]/chief-of-staff/route.ts`:** `password:
   z.string().min(1).max(256)` — **REQUIRED**; `verifyPassword(password)` → `401`
   with **no MANAGER bypass**; the handler then acts *as* `getManagerId()` — i.e.
   **the password IS the authorization** ("stronger than ACL", route comment L61).
   → the operation is **USER/UI-only** in practice: only a holder of the governance
   password (the human, via the UI) can do it.

3. **MANAGER ruling ai-maestro#64:** committed the hub to build an **agent-usable**
   COS-assign verb **before launch** (under R6 v3 the COS is the sole entry into a
   team, so assigning one on an existing team is a real operational need). The verb
   shipped (`reassign-cos`) but, being password-gated, is **not agent-usable** — the
   #64 intent is unmet. This is the same "verb shipped ≠ consumer can use it" drift
   class recorded in the memory corpus (script↔server drift).

**Smoking gun — an INTERNAL inconsistency, not merely doc-vs-code:** the sibling
governance route `app/api/teams/[id]/route.ts` (team **update/delete**, same MANAGER
actor, same op class) makes the password **`.optional()`** — i.e. it honors the
AID-MANAGER path exactly as the skill (SKILL.md L49) says delete does. Only the
COS-assign route makes it **required**. COS-assign is uniquely over-gated relative to
its own siblings.

## Root cause

The COS-assign route was written to gate on the governance password ("stronger than
ACL") without reconciling against R32 ("agents never face a password gate") or the
sibling routes (password optional). MANAGER ruling #64 then commissioned a CLI verb
for it, and the verb was built and shipped — but nobody checked that the ROUTE it
targets is agent-callable. So the verb exists and is green, yet the capability #64
asked for (a MANAGER agent assigning a COS) does not exist.

## Proposed fix — one of two; this is a USER/MANAGER decision (touches R32, a security rule)

**Option A (RECOMMENDED) — align the route to the ratified design.**
- Make `password` `.optional()` on `app/api/teams/[id]/chief-of-staff/route.ts`
  (mirroring the update/delete route); authenticate the MANAGER by AID via
  `enforceAuth` + a MANAGER check; verify the password only when supplied (the
  USER/UI convenience path).
- Then `reassign-cos` becomes the agent-usable verb #64 intended; the core plugin's
  `team-governance` skill is already correct — it needs only the stale DECOUPLE-BLOCKED
  marker dropped (SKILL.md L60, REFERENCE.md L36/L69/L122/L126) and a `reassign-cos`
  example added.
- **Consistency:** satisfies R29 (MANAGER team-gov ops need no user approval), R32
  (no agent password gate), the sibling-route pattern, and the #64 intent.
- **Security note the USER must weigh:** this lets a **MANAGER agent** reassign a COS
  **without the human's password**. R29 already grants the MANAGER team-governance
  authority "with no user approval", so this is *within* the ratified design — but COS
  is the sole team gateway, so it is a genuine autonomy-vs-human-in-loop tradeoff.

**Option B — align the design to the route.**
- Rule COS-assign/remove **USER/UI-only** (keep the password gate), carve it out of
  R32's "no agent password" blanket, and have the MANAGER re-scope #64 accordingly.
- Update the core `team-governance` skill to say so explicitly: assign/remove COS on
  an existing team is USER/UI-only (governance-password-gated); agents set `--cos` at
  **create** time or ask the human; `reassign-cos --password` is a USER/UI verb, never
  agent-called.
- **Cost:** weakens R32 (a security governance rule) → **USER-only** ruling; and the
  #64 "agent-usable verb pre-launch" goal is formally abandoned.

## Verification (after the ruling)
- Option A: `password.optional()` on the COS route + a MANAGER AID check; a MANAGER
  AID call with no password → `200`; a non-MANAGER → `403`; a USER/UI call with the
  password still → `200`. `bash scripts/with-node.sh yarn test` green; add a route test.
  Core doc marker dropped + `reassign-cos` example added (PR to Emasoft/ai-maestro-plugin).
- Option B: core `team-governance` skill reclassifies the op USER/UI-only; R32 carve-out
  authored in the PRRD/GOVERNANCE-RULES; #64 re-scoped by the MANAGER.

## Estimated risk
- Option A: **MED** — a governance-route auth change; blast radius = who can reassign a
  COS. Reversible. Depends on a MANAGER AID-title check existing (it does; `enforceAuth`
  + registry title).
- Option B: **LOW code / HIGH governance** — no code change to the route, but amends a
  ratified security rule (R32) and a MANAGER ruling (#64).

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list — **the Option A branch only**,
since the USER ruled Option A; Option B's items were never owed and are not listed as debt. Re-run
live. The last box is CROSS-REPO and belongs to CORE, not to this card.

- [x] `password` is `.optional()` on `app/api/teams/[id]/chief-of-staff/route.ts:19`, mirroring the
      sibling update/delete route that was already optional — the internal inconsistency this card
      opened on is gone
- [x] the MANAGER is authenticated by AID: `authorize(auth, 'manage-team')` at `:64`, replacing the
      old "the password IS the authorization" gate that made a shipped #64 verb uncallable
- [x] **the self-assign ban** — the guard this card MISSED and CORE added (`:72-79`): an agent
      cannot make itself COS. Without it the verb is a fleet-takeover primitive, so it is part of
      the ruling, not a nicety
- [x] a MANAGER AID call with NO password → **200**
- [x] a non-MANAGER → **403**
- [x] a USER/UI call WITH the password → **200** — the human path is a strict superset, unchanged;
      the route still 400s a human who omits it and 401s a wrong one, so nothing human-side weakened
- [x] a route test exists and is green: `tests/unit/cos-reassign-authorization.test.ts`, **6 cases**,
      one per bullet above plus the two human-path negatives. `yarn test` green (345 files / 4889)
- [x] the #64-canonical CLI surface ships: `aimaestro-teams.sh update --cos <uuid>` /
      `--remove-cos` (`:122`, routed to the chief-of-staff POST at `:212-216`), with `reassign-cos`
      kept as a thin alias whose `--password` is now USER/UI-only (`:134-135`)
- [x] **~~CORE drops the stale DECOUPLE-BLOCKED markers and teaches `update --cos`~~ → SPLIT
      2026-08-19T21:14:04+0200: the half the HUB controls — the verb shipped, deployed, pushed, and CORE NOTIFIED
      (#69 issuecomment-5304702847 + a direct peer message 2026-08-19T21:14:04+0200) — is DONE and ticked; the half that
      is CORE's act (their markers, their skill) is NOT a gate on this card — it is tracked on
      `Emasoft/ai-maestro#69`, left OPEN for CORE to close. A box whose completion depends on
      another party's reply can never be honestly ticked by this card (the fused-box lesson), and
      leaving it open kept a finished server-side card in `testing` for 34 days.** Original text:
      CORE drops the stale DECOUPLE-BLOCKED markers and teaches `update --cos` — cross-repo
      (`Emasoft/ai-maestro#69`, OPEN), and CORE gates it on the verb being on a DEPLOYED host. That
      gate has TWO conditions and exactly one holds today: `~/.local/bin/aimaestro-teams.sh` is
      byte-identical to the repo copy (installed ✓), but `governance-rules` is unpushed, so the verb
      does not exist for anyone else. Not this card's to close

      **⚠ THAT SECOND CONDITION HAS CLEARED — measured 2026-08-16T01:19, and nobody had looked.**
      Both of CORE's conditions now hold, verified three ways rather than assumed:
      `git diff fork/governance-rules HEAD -- scripts/aimaestro-teams.sh` is **EMPTY** (the pushed
      script is exactly this script, nothing about the verb sits unpushed); the pushed tip carries
      `--cos UUID | --remove-cos` and the `Alias of \`update --cos\`` line; and `cmp` says
      `~/.local/bin/aimaestro-teams.sh` is **byte-identical** to the pushed copy, so a deployed host
      and the branch agree. The 660-commit gap this box measured is now **13, 0 behind** — and all
      13 are tonight's doc commits, touching no script.
      **Relayed to CORE on `Emasoft/ai-maestro#69` (`issuecomment-5304702847`)** — still not this
      card's to close, but the gate CORE named is open and it was owed the notice.
      **This is the SECOND time on that same thread.** My own comment there on 2026-08-03 reads
      *"You have been blocked for ~11 days on a condition that was met on 2026-07-23."* The pattern
      is not the individual miss, it is that **a precondition is recorded as a STATE and nothing
      ever re-reads it.** Record the COMMAND that tests it instead — here, one `git diff` and one
      `cmp`, three seconds, definitive.
      **⚠ METRIC CORRECTED 2026-08-05 — this box cited "2517 commits ahead of `origin/main`",
      which is the WRONG DISTANCE and overstates the pending work ~4x.** `origin/main` is the
      UPSTREAM (`23blocks-OS/ai-maestro`), so that number is the fork-vs-upstream gap, not unpushed
      work. Measured today: `origin/main..HEAD` = **2646** (so the 2517 was stale as well as wrong),
      while the number that actually answers *"does anyone else have this verb"* is
      `fork/governance-rules..HEAD` = **660**, with **0 behind** — a clean fast-forward.
      The CONCLUSION was right (the verb is not published) and only the EVIDENCE was wrong, which is
      the harder error to catch: a true claim resting on a wrong number survives every review that
      checks whether the claim is true. This repo's handoff records the same substitution being
      quoted TWICE before being caught — this card is the third — so re-derive with
      `git rev-list --count fork/<branch>..HEAD`, never by copying a number forward.

## ⏱ VERIFIED 2026-08-02 — everything ai-maestro owed is met; the residue is a DEPLOY, not a defect

Two things worth recording beyond the boxes:

**The deploy gate is half-met, and only the half nobody can act on is missing.** The STATE says
CORE's follow-up waits for the CLI verb to be "on a DEPLOYED host (`governance-rules` merged to
`main` + installed to `~/.local/bin/`)". The install half is verified true; the merge half is
2517 commits away and is USER/ops-gated for the whole branch. So this card is not waiting on
engineering — it is waiting on a release decision that is not an agent's to make.

**`Emasoft/ai-maestro-plugin#29` is CLOSED, and its closing comment names its successor.** CORE
closed it because the build-offer was confirmed *standing, not one-shot*, and moved the standing
channel to **`ai-maestro-plugin#31`** (the script/skill sync loop). Reading the STATE alone would
leave #29 looking like a live dependency; reading the closing COMMENT is what says where the thread
actually lives now — the same reason a closed ref is never read from its state alone.

## Approval log
- 2026-07-16T16:02:18+0200 — RULED by USER: **Option A + self-assign ban** (CORE #69 and
  ai-maestro independently converged on the same). Implemented in `20f5ba72` (route + CLI +
  6-case test). Moved `proposal → testing`. The core-plugin marker-drop + `update --cos`
  teaching (ai-maestro#69) follows on deployment of `governance-rules` to `main`.
- 2026-08-19T21:14:04+0200 — COMPLETED by the hub under the USER's Phase-2 delegation (BRRJK57P approval log): every server/scripts box ticked and tested; the last box split into the hub's half (done + CORE notified twice) and CORE's half (tracked on #69, not this card's gate). Archived as completed.
