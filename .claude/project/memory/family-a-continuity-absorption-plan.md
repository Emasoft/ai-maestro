---
name: family-a-continuity-absorption-plan
description: "the implementation decomposition (NPT map) for absorbing the janitor's continuity daemon into the ai-maestro server — how is Family-A (oauth rotation / account-switch / auto-resume / session-resurrection) broken into tasks, in what order, which are unblocked, which are already done; the ai-maestro-side plan for TRDD-KCRMSNL7 / janitor#100. ALSO: is the server OAuth rotator LIVE or still gated/inert, is it safe to edit lib/oauth-rotator, when was the R16 go-ahead given, why does a Family-A card's column disagree with its own commits"
ocd: 2026-07-16
lmd: 2026-08-04
metadata:
  node_type: memory
  type: project
  tier: component
  topic: reliability-patterns
---

The ai-maestro server absorbs the janitor daemon's **Family A** (continuity/guardian) work;
**Family B** (dev-hygiene: plugin/self-update, cache-prune, OOM guard, github audit) STAYS with
the janitor. The server owns Family A when up; the janitor's `#N` daemon is the fallback when
there is NO server (the server can't resurrect itself). See [[server-oauth-token-continuity-design]]
for the R16 token rules (D1–D4, USER-signed-off) that gate NPT2/NPT3.

**Authoritative TRDDs:** parent `TRDD-KCRMSNL7` (ai-maestro side, has the full scope + the
aligned architecture), NPT `TRDD-H24DF6ZC` (the signed token design). Coordination: `janitor#100`
(the 3-way Family-A/B division), `AgentlensPro#3` (observe-only dep). The `#J` (thin local
janitor) + `#N` (scope-flip) side is the JANITOR's TRDDs under #100 — NOT mine.

**The `#J`→server contract (the ONLY new script surface, R23/R42-clean):** two self-scoped verbs
on `aimaestro-continuity.sh` — `status <self>` (5 fields: account_healthy, window_5h_pct,
window_7d_pct, cache_ttl_minutes, next_action — a deliberate ceiling, no token can leak) and
`ensure-resume <self>` (idempotent; server owns the actuation). Everything else reuses existing
`aimaestro-session.sh slash|queue`.

## The 6 NPTs — status MEASURED off the board 2026-08-04 (depth-1 derived under KCRMSNL7)

**🔴 THE ROTATOR IS LIVE.** The USER gave the R16 go-ahead on **2026-07-29** by creating the flag
file `oauth-rotator-tick.enabled` in the state dir. `lib/oauth-rotator/` is therefore a **LIVE
writer against the real credentials**, not the gated infra the cards were written against — an
edit there can rotate a real token on the next beat. Any "INERT / NOT ACTIVATED / NOT RUN LIVE"
wording in [[1GGQ4HWY]] pre-dates that date and is marked superseded on the card.[^2]

| id | NPT | one-line scope | status (2026-08-04) |
|---|---|---|---|
| **Y916N7WL** | 6. AgentlensPro consumption | derive the `status` fields from the AgentlensPro CLI (canonical paths on AgentlensPro#3; CI-locked contract; observe-only) | ✅ **complete**, archived |
| **JAU1ES1C** | 5. Session-resurrection hardening | HARDEN `services/boot-restore-service.ts` for the REBOOT case — the other two cases were scope-corrected onto 9ZIF82HI / CHN16JXZ | ✅ **complete**, archived (last box, the `restoring` state, landed `14046e53`+`79a18bad`) |
| **DXJZM3BW** | 1. Continuity CLI surface | `aimaestro-continuity.sh` + the 2 verbs + server route behind the frozen layer | **testing** — ONE box open: the live end-to-end route test, which needs an AUTHENTICATED caller, so it is parked on a scenario or the USER, not on code |
| **1GGQ4HWY** | 2. Server OAuth manager | the janitor daemon PORTED Python→TS (23 modules), ROTATE/RENEW/REAUTH cascade, keychain custody, server-internal tick lock | **backburner** — phases A,B,C,D,E,G done + LIVE since Jul 29; only Phase F (REAUTH browser tier) remains, deferred behind 9ZIF82HI. Column corrected from a false `todo` on 2026-08-04 |
| **9ZIF82HI** | 3. Account switcher | rotate to a fresh account/token on 429 / dead-refresh / network interruption (passive-switch, TRDD-1222f06a §9 — the process never dies, only the turn does) | **blocked** on 1GGQ4HWY, and stale since 2026-07-17 — see the lesson below, the blocker is satisfied in substance |
| **CHN16JXZ** | 4. Fleet recovery | server-internal liveness detection + `ensure-resume` actuation across the fleet (cross-agent = server's job, never a `#J` call; reuses queue/slash) | **todo** — the remaining unbuilt piece besides 9ZIF82HI |

**NEXT: [[9ZIF82HI]] (the account switcher), then [[CHN16JXZ]].** Both are net-new infra that
build on the now-landed rotator machinery. The old "start with Y916N7WL" instruction is spent.[^3]

**Open issues each NPT must honor:** `janitor#82` (oauth_rotator keychain reads RE-PROMPT every
access — NPT2 must fix, likely an EHT) · `ai-maestro#60` (authenticated daemon→agent injection for
freeze-recovery — NPT4) · `ai-maestro#51` (active idle-agent wake — NPT4/NPT5).

**What exists TODAY (build the delta, don't duplicate):** session-resurrection is PARTIAL
(`boot-restore-service.ts::restoreActiveAgentsOnBoot` + `session-history.ts` + `session-persistence.ts`)
→ harden. OAuth rotation / account-switch / rate-limit recovery = NONE server-side yet (net-new).
The 5-state safe-state model (`lib/session-safe-state.ts`) + stop/restart poll are the actuation
substrate `ensure-resume` builds on.

**See also [[janitor-chore-absorbability]]** — this page owns the **Family-A** (oauth / continuity)
absorption specifically. That one owns the SEPARATE question of the janitor's GLOBAL chore set
(`session-liveness`, `fleet-stop`, `memory-guard`, `cache-prune`, `rules-cleanup`,
`github-config-audit`): which of them the server can absorb at all, and the test that decides it.
Read it before assuming any chore is absorbable — it also records that `SERVER_ABSORBED_TASKS` is
inert while a server is up, because the daemon exits wholesale rather than yielding chore by chore.

## Notes and lessons learned
[^1]: [id:ATOM-FAMA-NPT, status:valid, keywords:"family_a_npt_map decompose_KCRMSNL7 which_npt_unblocked oauth_manager_blocked_on_design", ocd:2026-07-16, lmd:2026-07-16]
  DO NOT author the 6 NPT ids into KCRMSNL7's `npt:` list before the NPT TRDD FILES exist,
  BECAUSE a parent naming an npt id with no file (or a file that doesn't declare `derived: true`)
  is an orphan-platelet invariant violation the D4 watchdog flags. DO author each NPT file first,
  then wire the id into KCRMSNL7's `npt:` in the same edit.

[^2]: [id:ATOM-FAMA-LIVE, status:valid, keywords:"is_the_rotator_live safe_to_edit_lib_oauth_rotator gated_infra_or_live_writer r16_go_ahead_given card_says_inert, when_did_activation_happen", ocd:2026-08-04, lmd:2026-08-04]
  SUPERSEDED BODY (true until 2026-07-29, wrong after): *"the Python→TS port is a WORKING but
  INERT server mechanism; no code path is wired to a tick/route, so nothing runs against the real
  credentials yet."*
  DO NOT infer a subsystem's RUN state from the card that built it, BECAUSE a card records what
  its author BUILT and is frozen in the moment they wrote it, while activation is a separate act
  by someone else — here the USER creating a flag file six days later, which no card observes. DO
  check the runtime gate itself (the flag file, plus the tick's own stamp to prove it is beating)
  before treating credential-touching code as safe to edit.

[^3]: [id:ATOM-FAMA-COLUMN, status:valid, keywords:"card_column_disagrees_with_commits todo_over_landed_code duplicate_work_risk npt_status_stale, which_family_a_npt_is_next", ocd:2026-08-04, lmd:2026-08-04]
  SUPERSEDED BODY (true 2026-07-16, spent since): *"all 6 NPT files EXIST as `column: planned`
  TRDDs … NEXT: implement in topological order, starting Y916N7WL (root, unblocked)."*
  DO NOT trust a status table in a memory page over the cards themselves, BECAUSE the table is a
  snapshot that ages silently while the board moves — this one still said "start with Y916N7WL"
  nineteen days after Y916N7WL completed, and 1GGQ4HWY sat at `column: todo` over NINE
  implementation-commits, an invitation to REBUILD live-credential machinery that already existed.
  DO re-measure the columns off the files (`grep -H "^column:" design/**/*.md`) and cross-check
  sibling cards against each other — the contradiction that exposed this one was DXJZM3BW's
  acceptance box calling 1GGQ4HWY "landed and wired" while 1GGQ4HWY called itself unstarted.
