---
trdd-id: KCRMSNL7
title: Absorb the janitor daemon continuity family (Family A) into the ai-maestro server
column: blocked
pre-block-column: design
blocked-by: [TRDD-H24DF6ZC, TRDD-DXJZM3BW, TRDD-1GGQ4HWY, TRDD-9ZIF82HI, TRDD-CHN16JXZ, TRDD-99LV0U4I]
created: 2026-07-16T15:16:13+0200
updated: 2026-08-20T22:01:57+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T15:16:13+0200
relevant-rules: [16, 23, 42]
labels: [janitor-absorption, continuity, oauth, resurrection, family-a, server, guardian]
external-refs: [Emasoft/ai-maestro-janitor#100, Emasoft/ai-maestro#68, Emasoft/ai-maestro#70, Emasoft/AgentlensPro#3]
npt: [H24DF6ZC, Y916N7WL, DXJZM3BW, 1GGQ4HWY, 9ZIF82HI, CHN16JXZ, JAU1ES1C, P7RPOR5O, 7DRSIKVZ, SX593MDG, YLCTM8EU, S5RUHJRP, A77JBHC9, CPETQBAW, 2X4AYX9T, NIU5RQ1S, JBFM8XR0, B8B6D56P, 5II83KK4, 4QOWVSLU, 99LV0U4I, 9FW92242, Z310XDAF]
release-via: none
---

# Absorb the janitor daemon continuity family (Family A) into the ai-maestro server

## ⏱ `janitor#100` READ IN FULL 2026-08-02 — what it concluded, and what it means for the 8 cards

It closed as **SUPERSEDED, not abandoned** — by the janitor's shipped two-backend split
(their `TRDD-PZLVT2RN`), which implements the coordination this thread asked for. Their SSOT is
`scripts/lib/harness_backend.py`:

- **`SERVER_ABSORBED_TASKS`** = `marketplace-refresh`, `user-plugins-update`, `version-update`,
  `oauth-rotator-supervisor`, `oauth-rotator-tick`.
- **`server_is_alive()`** probes `~/.aimaestro/server-liveness.json`; **30 s beat, 90 s staleness**
  (`LIVENESS_STALE_AFTER_S = 90`). Absent / stale / malformed ⇒ no live capability claim.
- The daemon honours it via `_SERVER_ABSORBED_TASK_NAMES` + `_task_yielded_to_server()`.

**THE LOAD-BEARING FACT — coordination is BINARY ON LIVENESS, NOT on capabilities**
(their `TRDD-LU0C5KAR`). Their code quotes the owner verbatim: *"if the ai-maestro server is
running, those chores are its responsibility… the janitor daemon must switch off those chores. any
other event is a bug"* — **no per-class capability checks**. So the `capabilities` array this server
publishes (`['family-a','singleton-chores']`) is **advertised and never consulted**: a live server
takes ALL FIVE, an absent one gives back ALL FIVE.

**Verified by effect, not from the changelog.** `~/.aimaestro/server-liveness.json` is fresh (16 s
at the time of writing, well inside the 90 s window), written by `lib/server-liveness.ts` and wired
at `server.mjs:1973`. **So the janitor is yielding all five chores to this server right now.**

**The structural hazard the 8 cards inherit, stated plainly:** because the yield is binary on
liveness, any absorbed chore this server advertises-by-being-alive but does not actually RUN is run
by **nobody**. That is not hypothetical — it is exactly what `ai-maestro#95` and `#102` were filed
about.

**Both of those issues are now STALE, and both are still OPEN:**

| issue | what it reported | measured 2026-08-02 |
|---|---|---|
| `ai-maestro#95` | *"Server absorbs oauth-rotator-tick but does not run it"* | the tick is **ARMED and BEATING** — the opt-in flag file `~/.aimaestro/oauth-rotator-tick.enabled` is present and `oauth-rotator-tick-status.json` was **27 s** old. Its live verdict is `nextAction: reauth-needed`, `reason: refresh-dead` — a real state that needs the human, not a stalled chore |
| `ai-maestro#102` | *"the absorbed version-update chore is not running"* | **root cause fixed** — the reader stat'd `version-update-request` (no `ed`, no `.flag`) against a janitor that writes `version-update-requested.flag`. Corrected in `lib/janitor-control.ts:48` (TRDD-4F40QCCH), verified against the WRITER at janitor `lib/global_state.py:596` |

**A correction to my own first pass, worth keeping.** Grepping our tree for the literal chore name
`oauth-rotator-supervisor` returned **zero** files, which reads as "not implemented". It is
implemented — `lib/oauth-rotator/server-supervisor.ts`, wired at `server.mjs:1965` — under our own
symbol names. **Grep for the THING, not for the peer's name for it**; all five chores do have an
implementation here.

**Do NOT reopen `#100`.** Their closing comment is explicit: a change to the SHAPE of the contract
(rather than its existence) belongs in a **fresh issue against their `design/ARCHITECTURE.md` §3`**;
reopening would re-litigate a landed design.

## ⏱ EXTERNAL REFS CHECKED 2026-08-02 — `janitor#100`, the coordination thread this card is built on, is CLOSED

Surfaced by the external-ref sweep on [[5YRLA53W]]. Two of this card's three refs are closed:

- **`ai-maestro-janitor#100`** — *"[COORDINATION] ai-maestro absorbs the daemon's functions + a
  special local-scoped janitor for ai-maestro agents"* — **CLOSED 2026-08-01**. This is the thread
  the "three-Claude consensus" section below is built on, and it is the **single most-referenced
  external item on the whole board: 8 cards** point at it (`1GGQ4HWY` `9ZIF82HI` `CHN16JXZ`
  `DXJZM3BW` `H24DF6ZC` `JAU1ES1C` `KCRMSNL7` `P7RPOR5O`), spanning `todo`/`blocked`/`testing`/
  `design`. It closed **yesterday**, so nothing here is stale yet — but a closed coordination thread
  is exactly the input that goes unnoticed, and eight cards inherit whatever it concluded. **Read it
  deliberately before advancing any of the eight**; do not infer its outcome from this card.
- **`AgentlensPro#3`** — the reciprocal of `ai-maestro#70` — **CLOSED 2026-07-30**: the consumed
  field paths are LOCKED in their `cliContract.aimaestro.test.ts`, so a reshape fails their CI. The
  dependency side of that work is done and re-verified today (see [[WF0UE9BC]], now `human_review`:
  npm latest 2.20.0, this machine 2.21.0, the `>=2.8.0` floor resolves).

`ai-maestro#68` was re-checked in the same sweep and is still **OPEN**.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

- **COUNT CORRECTION (2026-08-20, janitor TRDD-E39YT9G6 / their e3b0ec83):** GLOBAL_CHORES is
  **12**, not 13 — the `user-plugins-update` sweep is RETIRED on the janitor side too (Task,
  registry row, detector shim, stamp all gone; the harness self-updates user-scope plugins).
  Wherever this card's body says "all 13" read 12. Scoreboard after tonight's three lanes:
  7 unconditional + 3 conditional-when-armed (memory-guard, rules-cleanup, fleet-stop) of 12;
  remainder = session-liveness's second half (claim rides the recovery arming) ONLY —
  cold-cache-clear LANDED same-night (TRDD-Z310XDAF, ab0f2b9c) on the launcher the janitor
  shipped mid-session (9ZPU69UC/1d5a3b16, v3.3.19), version-gated + dynamic-claim, so the
  family is FULLY BUILT: 7 unconditional + 4 conditional-when-armed of 12.
**▶ 2026-07-24 — Flock D absorption landed the two biggest token-death levers (D1 + D2 COMPLETE):**
- **D1 (7DRSIKVZ) COMPLETE** — oauth `supervisor.ts` + `cookie-vault.ts` + the supervisor beat wired
  into the server tick (eb1439d5, b3846e9b, f0c66776); 48 parity tests; live-validated at boot. The
  rotator ORCHESTRATION was already `tick.ts`; this finished the governance + custody halves.
- **D2 (SX593MDG) COMPLETE** — the missing **dead-class boot-debounce** (`fleet-dead-debounce.ts`,
  c247b071) — the fail-safe guard the dark Phase-C hard rung must consult so it never kills a booting
  agent. Actuator decision path (gentle ladder + STOP/HID/cooldown) already tested. Live-validated
  fire-OFF; the new debounce wording EMITTED live; a `ps` snapshot confirms the janitor daemon stays
  exited (server-owns-host).
- **D5 (A77JBHC9) COMPLETE** — capability honesty + `$JANITOR_CONTROL_DIR` isolation already correct +
  tested; grounded the daemon's FRESHNESS-only exit (capabilities are advisory); the flock half was
  mis-scoped (janitor-control.ts is read-only) → relocated to D4.
- **D7 (2X4AYX9T)** — posted the D1+D2+D5 "now server-native" coordination on **janitor#100**
  (comment-5071270871; the plan's #79 was a stale closed issue). Stays open for D4/D6.
- **D6 (CPETQBAW) COMPLETE** — design decision stands (PER-CHORE unref'd timers, not a single ported
  loop, which would re-introduce the starvation the daemon's bulk-lane guards against). Box 1 is now
  **7/7** once D4 registered the last two chores; box 2 re-validated live on the D4 build.
- **D4 (S5RUHJRP) COMPLETE** (`6aac9397`) — **unblocked by reading the janitor SOURCE instead of
  waiting on Emasoft/ai-maestro-janitor#100** (the "port line-by-line" directive is the instruction to do exactly that). It
  corrected TWO errors in this flock's own plan:
  1. **wrong directory** — the lock is `global_state_dir()/marketplace-op.lock`
     (`global_state.py:433`), NOT the control dir. Building as planned = two files, ZERO mutual
     exclusion, silent. This was the precise rework the "wait for the reply" hold existed to avoid.
  2. **wrong premise** — Node cannot join the janitor's kernel `fcntl.flock(2)` at all (O_EXCL
     cannot interoperate). The USER already ruled this identical trade-off on 2026-07-17 for the
     rotation tick: SERVER-INTERNAL lock, DISTINCT filename. Hence `marketplace-op-server.lock`.
  The mechanism was EXTRACTED to `lib/server-lockfile.ts` and shared with the rotation tick, whose
  29 tests pass untouched.
- **D3 (YLCTM8EU) COMPLETE** (`25dca1bc`, archived 2026-07-30) — the box-2 gap is closed. The dep
  seam it needed is **`collectUpdateCandidates(s, marketplacesTouched, readers)`**: `runTick()` fused
  DECIDE with MUTATE, so Step 2 was extracted with the 3 corpus readers injected (defaulting to the
  real ones), behaviour verbatim. 7 tests, fakes only ⇒ **0-IMPACT by construction** (no filesystem
  path at all, so nothing to contain). 3 neuter runs; the third exposed a **vacuous assertion in the
  test itself** — it was passing through the `localMarketplaces` branch rather than the
  `agentLocalScopePlugins` one it names.
  **It also corrected this flock's own understatement:** D3 recorded the master toggle as "the
  remaining lever". It is not the only one — the janitor is USER-scope and `userScopePlugins` ships
  OFF, so its currency rests on the single default-on `aiMaestroMarketplace` toggle. That coupling is
  ai-maestro#102 / [[TRDD-5X3P79Q6]]'s subject; the test documents it as evidence and does not fix
  it here.

**Net — the 7-chore absorption is FUNCTIONALLY COMPLETE and live.** All 7 daemon chores now run on
server timers (oauth-tick, oauth-supervisor, session-liveness+fleet-stop, version-update,
server-liveness, marketplace-refresh, user-plugins-update); a `ps` snapshot shows zero `daemon.py`,
so the dark window that caused the token death is closed. What is NOT claimed: cross-process
exclusion against a live `#N` Python daemon (impossible in pure Node — see D4). *(D3's test was the
other item here; it landed 2026-07-30 — `25dca1bc`.)*
Parent stays `design` — several NPTs (H24DF6ZC, 9ZIF82HI, DXJZM3BW, …) are still open, and the
completion gate correctly holds it open until every one is terminal.

**▶ 2026-07-22 — NPT flock progress (8 NPTs; parent stays `design` until an NPT reaches `complete`):**
`testing` ×3 — Y916N7WL, JAU1ES1C, P7RPOR5O. `design` ×1 — H24DF6ZC (R16 oauth-design, owner-gated).
`dev` ×2 — **CHN16JXZ**: gentle fleet-recovery loop **A(detect)+B(actuate)+D(wire) COMPLETE + dark-shipped**
behind default-OFF `AIM_FLEET_RECOVERY_FIRE` (detection live at boot; gentle ladder
esc_nudge→rearm→reload→update via the authenticated server-queue #60 path); Phase C (hard rungs) SPECIFIED
+ deferred (needs a `dead`-class = `persisted && !exists`, debounced past boot — must NOT fire on live
frozen agents). 1GGQ4HWY oauth-manager ~95%, gated OFF (R16). `blocked` ×2 — DXJZM3BW (continuity-CLI),
9ZIF82HI (account-switcher, user-approval). **Flock is ACTIVE, not stale.** Launch-readiness verdict holds:
SAFE to launch — the janitor keeps its Family-A stopgaps (#79) until each server half lands; CHN16JXZ's
gentle recovery is the first server half built + tested (arm the flag to validate live).

**▶ CO-RATIFICATION COMPLETE — `design/ARCHITECTURE.md` rev 3 is FINAL (2026-07-17).** Both sides
posted **`RATIFIED rev 3`** (my comment `5005141732`; janitor's alongside `ca22004`). The janitor
drove the two-harness redesign (**v0.50.0**, one-plugin-two-backends:
`harness_backend.is_harness_session()` discriminator; `#J` thin-mode inside a harness agent, `#N`
standalone outside; Family-B unchanged) through 3 rounds on janitor#100; my round-1 §6 fill + §2
conflict-review are folded. **The required janitor-side change LANDED** (`616ab18`, janitor
TRDD-N9YAH5E7): per-class capability gating replaced the `server_owns_singleton_chores()` →
`server_owns_family_a()` delegation (OAuth pair → `family-a`; marketplace/version trio →
`singleton-chores`, which the server NEVER emits → janitor keeps them); `server_capabilities()` reads
my probe at rung 2; the legacy `list --json` rung was removed (liveness ≠ capability). rev 3 corrected
§6.4 (`ca22004`) to record the deployed `session command` verb (my retracted round-1 claim, fixed).
**The ratified baseline governs:** the two-backend split, the per-class chore matrix, the per-project
isolation invariant (X92VBFNF), the findings-ledger feed contract (FENWWB4E), and the §6 server-side
contracts. Verified §6.4 against the committed doc before ratifying.

**All 5 `--command-key` entries landed** (`ee9624f7` + `d9439b94`, `lib/agent-commands.ts`):
`compact → /compact`, `reload-plugins-force → /reload-plugins --force`, `reload-skills → /reload-skills`
(built-in), `janitor-resume → /janitor-resume`, `janitor-write-handoff → /janitor-write-handoff` —
strings CONFIRMED by the janitor against its shipped senders (never guessed). The server maps each key
to its fixed literal, so the janitor's #J soft-send never supplies command text.

**2 joint verify-together items remain (operational — no doc/code change):**
1. **`aimaestro-continuity.sh` redeploy** to `~/.local/bin` (installer `scripts/*.sh` glob) — repo-only
   on this machine (`ls` fails), so the janitor's Phase-D `ensure-resume` delegation is a
   feature-detected **no-op** until installed. Machine-provisioning step.
2. **First-run probe verification** — `~/.aimaestro/server-liveness.json` appears only once a server
   carrying the probe build is restarted live; confirm the file + the janitor's rung-2 read end-to-end
   then. Until then consumers correctly see "no file → safe default (janitor keeps every chore)".

**CORRECTION (2026-07-17, #100 comment 5004880793) — kept as the audit record:** my round-1 §6.4
claimed `aimaestro-agent.sh session command` was missing — **WRONG.** It EXISTS + is DEPLOYED
(`~/.local/bin/agent-session.sh:210` `cmd_session_command`, commit `77883371`, → `POST
/api/sessions/<name>/command`). I had grepped `aimaestro-session.sh` (a separate standalone CLI)
instead of the `agent-session.sh` module `aimaestro-agent.sh` sources. Throwaway TRDD-FUYUP38L
CANCELLED + archived; lesson `[^7]` in memory `agent-control-monitor-api`. **Grep the MODULE, not the
standalone CLI, before claiming a `session` sub-verb absent.**

Nothing is urgent: the probe ships advertising `capabilities: []`, so the safe default (janitor keeps
every chore) holds until each class is proven live. Everything landed is SAFE (OAuth port INERT via
the R16 flag; probe inert-on-disk until a server restart). **NEXT (architecture now RATIFIED, so
these are unblocked): the Family-A flock (#49) advances to the ratified baseline. restart-self
([[TRDD-4P1M8I18]], #59) is now ✅ COMPLETE (`2af0aabf`, `1981abf8`, `1fdc3603`, `6714a2ea`) — the
self-only-by-construction `POST /api/sessions/me/restart` (both serving modes) + the frozen
`aimaestro-continuity.sh restart-self` verb; a same-pass CC-GOV-001 gate also closed the adjacent
headless `/stop` shell-injection, with the deeper `/stop` parity split out as [[TRDD-OPNDCKVA]]. The
remaining flock infra is [[9ZIF82HI]] (account switcher) and Phase F (REAUTH browser tier). The 2 joint
verify-together items (continuity redeploy, first-run probe check) run when a server carrying the probe
build is live. R16 flag flip stays the USER's alone.**

**🔒 PER-PROJECT CHANNELING — binding invariant (USER via janitor#100 / janitor TRDD-X92VBFNF,
2026-07-17).** Every AUTOMATIC surface (heartbeat/drift line, detector finding, injected nudge,
proposal/task, notification, session-start report) may carry information about EXACTLY the
agent/project it fires in — NEVER another project's findings, names, or even aggregate counts.
Four reasons, each sufficient: wrong skills; forbidden cross-actuation on other workdirs/gits/repos;
token-budget contamination; **DATA EXFILTRATION** into projects with weaker (possibly zero) data
protections. Only an EXPLICIT HUMAN surface (the dashboard, a human command) may present a
machine-wide view. **Server audit 2026-07-17:** existing automatic per-agent surfaces are
point-to-point (`tmux send-keys -t <one agent>`; AMP push per recipient) and [[P7RPOR5O]] carries
chore CLASSES not per-agent findings — COMPLIANT, nothing to fix. The report-surfacing feature
(reqs #4-6 of the redesign) is built per-project-isolated FROM THE START: a finding routes only to
the affected agent's own session OR (if it is not running) the HUMAN — never through another agent;
the dashboard daemon section is the ONE sanctioned human-aggregate view; session-start reports are
own-project-only AND concise; storage is per-project-partitioned so cross-project leakage is
impossible by construction, not by filtering.

**Born approved — USER mandate (2026-07-16), verbatim intent:** *"coordinate with the
janitor plugin to incorporate [a] version of the janitor that is tailored for ai-maestro
and that will be installed as local-scoped in each ai-maestro agent instead of being
user-scoped. this special version of the janitor plugin will not rely on its own daemon
process to handle the agents, but will use the ai-maestro server (via scripts) to replace
the daemon. the ai-maestro server must then implement all the functionalities of the
janitor daemon, and expose them via api/scripts … including the oauth key rotations, the
automatic management of the account in case of api-errors, rate limits, network
interruptions, etc. to ensure the continuity of the agents work and automatic resume no
matter what … it even resurrects the whole sessions after a reboot."*

**This TRDD is the ai-maestro-SIDE half of that mandate.** The janitor authors its own side
(`#J` thin local build + `#N` scope-flip + shared-codebase/two-backends split) under
ai-maestro-janitor#100. Division of TRDDs was settled three-way on #100 — nothing of mine
moves under the janitor's TRDD and nothing of theirs moves under this one.

**Process gate (USER, 2026-07-16):** coordinate via issues → write TRDDs → **only then**
plan-mode the design. Coordination is DONE (all three Claudes aligned on #100 / AgentlensPro#3).
This file is the TRDD. **DECOMPOSED (2026-07-16) into 6 implementation NPTs** — all authored as
`planned`, depth-1 derived, siblings ordered via `blocked-by:`. A **7th NPT (P7RPOR5O)** was added
2026-07-17 when the daemon-coordination refinement (janitor#100) surfaced the need for the
auth-free liveness+capability probe file both janitor backends read:

| id | NPT | blocked-by | tier |
|---|---|---|---|
| [[Y916N7WL]] | AgentlensPro status-metadata consumption | — | none (self) |
| [[DXJZM3BW]] | Continuity CLI surface (`status` + `ensure-resume`) | Y916N7WL | none (self) |
| [[1GGQ4HWY]] | Server OAuth manager (ROTATE/REFRESH/REAUTH, keychain, one-writer lock) | DXJZM3BW | **user (mandate)** |
| [[9ZIF82HI]] | Account switcher (passive rotation on 429/dead-refresh/net-drop) | 1GGQ4HWY | **user (mandate)** |
| [[CHN16JXZ]] | Fleet recovery (liveness + `ensure-resume` actuation) | DXJZM3BW, 1GGQ4HWY | none (self) |
| [[JAU1ES1C]] | Session-resurrection hardening (boot-restore → immortality) | — (parallel) | none (self) |
| [[P7RPOR5O]] | Liveness+capability probe file (janitor#100 coordination seam) | — (parallel) | none (self) |

Topological order: Y916N7WL → DXJZM3BW → 1GGQ4HWY → {9ZIF82HI, CHN16JXZ}; JAU1ES1C, P7RPOR5O parallel.
The two token-touching NPTs (1GGQ4HWY, 9ZIF82HI) carry the USER mandate and are built to the
signed [[TRDD-H24DF6ZC]] design (D1-D4). **NEXT ACTION = start [[Y916N7WL]] (root of the order,
unblocked).** This TRDD cannot reach `complete` until every NPT is terminal (the completion gate);
it stays in `design` as the umbrella while the flock executes.

**Hard gate before any OAuth-rotation code:** the token-handling design
(**[[TRDD-H24DF6ZC]]**, this TRDD's NPT) must be **explicitly signed off by the USER** first
(R16). Family A can be built up to — but NOT including — anything that reads, writes, moves,
or persists live OAuth token material until that sign-off lands.

## ⏱ JANITOR ROSTER DELIVERED 2026-08-19 (USER full-absorption mandate) — the current normative input

The USER's 2026-08-19 orchestration directive WIDENS this card's frame: when the server runs
it must COMPLETELY replace the janitor's global daemon (not only Family A), with agent-work
continuity across stops/errors as the design driver. The janitor session delivered the live
roster the same hour (rev-8 §9 remains its normative table; env knob
`CLAUDE_PLUGIN_OPTION_DAEMON_<CHORE>_INTERVAL`, defaults in seconds):

| Chore | Default | Class (janitor's own classification) |
|---|---|---|
| oauth-rotator-tick | 60 | claim-eligible (absorbed five) |
| oauth-rotator-supervisor | 600 | claim-eligible |
| marketplace-refresh | 3600 | claim-eligible |
| version-update | 21600 | claim-eligible |
| github-config-audit | 21600 | claim-eligible |
| memory-guard | 120 | janitor-internal — NEVER yield |
| cache-prune | 21600 | janitor-internal — never yield |
| rules-cleanup | 3600 | janitor-internal — never yield |
| session-liveness | 120 | population-split — needs explicit redesign under full absorption |
| fleet-stop | 60 | population-split — redesign |
| cold-cache-clear | 300 | population-split — redesign |
| fleet-plugins-update | 21600 | population-split — redesign |
| user-plugins-update | 3600 | de-absorbed per PE54D95Q AC6 — under FULL absorption consider RETIRING (harness self-updates plugins) |

Claim/heartbeat contract the janitor expects: per-chore-exact tokens in
`server-liveness.json` capabilities (coarse family-a honored) · 90 s staleness window ·
completion stamps at `~/.claude/janitor-control/<chore>.last-run.ts` · stale bound
`max(3×cadence, cadence+600)` · `claim-bounds.json` widen-only, fail-open.

**DESIGN RESOLVED 2026-08-19 15:00 (first-hand from the janitor's own 3.3.16 source —
supersedes the "never-yield" framing above):** the roster message's NEVER-YIELD class does
not exist in the code. `daemon.py::_task_yielded_to_server` yields ANY chore in
`harness_backend.claimed_chores()`; the OWNER RULING recorded in that code (2026-08-05,
janitor#134) says *"the target state is that ALL chores are passed to ai-maestro
equivalents"*; and the full-exit ALREADY EXISTS janitor-side —
`server_owns_every_chore` (harness_backend:214, `claimed ⊇ GLOBAL_CHORES`) fires the
ONE-DAEMON-PER-HOST exit in main(). So the directive's end state needs ZERO janitor-side
changes: **the server absorbing + claiming all 13 GLOBAL_CHORES ⇒ daemon exits; server
down/stale ⇒ the sessions' `ensure_daemon_running` respawns it and it resumes everything.**
Continuity by claim-heartbeat, never by flag — already the shipped mechanism.

**Live measurement:** server claims 5/13 (`~/.aimaestro/server-liveness.json`:
marketplace-refresh, version-update, oauth-rotator-supervisor, oauth-rotator-tick,
github-config-audit). Remaining 8, characterized from each `task_*` docstring + body:

| chore (cadence) | what it does | server disposition |
|---|---|---|
| user-plugins-update (3600) | legacy user-scope update loop | RETIRE janitor-side (their own roster calls it retire-candidate; our loop+claim already removed, PE54D95Q AC6). Cross-repo ask on the coordination issue — not an NPT here. |
| fleet-plugins-update (21600) | per-agent local-scope plugin updates across the fleet | ABSORB — server owns the registry + workdirs; an absorbed lane like marketplace-refresh. All 3 measured requirements apply (atomic staging+rename, quarantine outside scanned trees, explicit cache-parent root). |
| cache-prune (21600) | prune stale plugin-cache version dirs; cardinal safety = cutoff behind the OLDEST live claude session's start | ABSORB — pure reimplementation (process-table snapshot + cache walk); carries the same cardinal-safety cutoff verbatim. |
| rules-cleanup (3600) | remove the janitor's own provenance-marked orphan rules ONLY after the janitor is CONFIRMED fully uninstalled | ABSORB — small marker-gated sweep, and the server STRICTLY improves it: the daemon survives uninstall ≤7 days (orphaned cache), the server indefinitely. |
| memory-guard (120) | Tier-1 OOM guard: free-mem probe → kill the single largest janitor-owned RUNAWAY per the USER-signed truth table (TRDD-7100178d; Tier 2 deliberately unimplemented) | ABSORB with the truth table REIMPLEMENTED server-side (signature allowlist + protected pids + claude-session rejection + age gate + one-kill-per-beat). Destructive ⇒ default-OFF flag + the USER-signed constraints carried verbatim; NEVER shell out to the janitor's cache (versions roll — the 4OFMHOZ7 blackout is what a mid-roll cache dependency does). |
| session-liveness (120) | recover frozen/dead janitor-armed sessions | CORE DONE ([[CHN16JXZ]] gentle+hard, dark). POPULATION GAP is the real remainder: the janitor scans EVERY claude session on the machine; the server scans the REGISTRY. Claiming it while dev-sessions exist un-covers them. NPT: extend the fleet scan to janitor-armed non-agent sessions (read the same janitor-control state + tmux), THEN claim — and claiming also requires arming AIM_FLEET_RECOVERY_FIRE (USER). |
| fleet-stop (60) | on kill-switch/pause, type STOP into every janitor session (default-OFF, 3 gates, dedupe per (pid,flag)) | ABSORB with the same population extension as session-liveness: registered agents via the authenticated queue; non-agent janitor sessions via the tmux channel. Shares the scan NPT. |
| cold-cache-clear (300) | shrink cold-prompt-cache sessions BEFORE their next fire pays; delegates to the janitor's external_handoff_clear.py, one candidate/beat | DEFER to LAST — double dependency (whole-machine population + delegation to janitor-owned scripts). Absorbing it means reimplementing the handoff composer or a versioned shell-out contract; park until the other 7 are claimed, daemon keeps running it (correctly — it is unclaimed). |

**The three cross-cutting axes the NPTs must honor:** (1) each new claim ships WITH its
completion stamp (`janitor-chore-stamp`) and a cadence that respects the janitor's stale
bound `max(3×cadence, cadence+600)` — the github-config-audit 4h-vs-180m lesson: a
faster-than-roster cadence is a declaration, a slower one is a default-change to ASK the
janitor for; (2) per-chore claim tokens are ADDED one at a time to `ABSORBED_CHORES`
(lib/janitor-chore-stamp.ts) only when the lane is live — claiming ahead of the lane is the
#111 blackout shape; (3) destructive lanes (memory-guard kill, fleet-stop injection) ship
default-OFF behind their own flags, mirroring the janitor's own posture.

**JANITOR ANSWERED BOTH (2026-08-19 15:04, their hub session) — design now FULLY resolved:**
1. **user-plugins-update RETIRES from GLOBAL_CHORES in janitor 3.3.18** (3.3.17 is
   content-frozen) — full-exit set becomes 12. Their retirement sweep: drop the Task +
   roster row, retire the session-side stamp-watch detector, KEEP `_consume_plugin_update_requests`
   (the per-plugin fast path; its `not in yielded` gate degenerates to always-true, correct
   once nothing claims the name). They card it when their session un-pauses; commitment stands.
2. **cold-cache-clear = versioned SHELL-OUT contract (their option a), THEY ship it**: an
   auto-rolling launcher at a stable DATA-dir path (the dispatcher-stub pattern) that
   re-resolves the newest C2-clean cached version per invocation and execs
   `scripts/external_handoff_clear.py` there. The server execs the stable path; their repo
   owns all /clear logic + gates (43+ tests). Explicitly NOT a version-pinned cache path
   (today's 4OFMHOZ7 hook-bricking) and NOT a staged DATA copy (ZM5LZ24Y staleness). CLI
   surface (args + exit codes) versioned in a §9-style table. Our absorption NPT for
   cold-cache-clear waits on that launcher shipping — deferred-last stands.
They also confirmed the O-block reading of the yield code ("no dispute").

Named design requirements from measured incidents (must appear in the NPT decomposition):
1. **Atomic cache population** — staging dir + rename. The 2026-08-19 morning incident
   (partial 3.3.16 cache; every session's PreToolUse hooks Errno-2 for ~20 min, machine-wide
   tool blackout, no in-band recovery possible) is the ACCEPTANCE SCENARIO; janitor
   post-mortem card TRDD-4OFMHOZ7 (janitor 844683d9).
2. **Quarantine outside every scanned tree** — the janitor's first mv-aside parked the broken
   copy inside the marketplace cache and produced 7 load errors.
3. **Cache-parent root resolution stated explicitly in the design** — the janitor's
   version-update was silently dead for a MONTH from a wrong-root assumption
   (janitor TRDD-ZM5LZ24Y, fixed 83cfd3b6); the absorption must not inherit that shape.

## The aligned architecture (three-Claude consensus, ai-maestro-janitor#100)

The janitor daemon owns **two families of work**; only **Family A** moves into the server.

| Family | Functions | Owner after this change |
|---|---|---|
| **A — continuity / guardian** | OAuth token rotation; account management on 429 / network interruption; work-continuity + automatic resume; session-liveness recovery; **session resurrection after reboot** | **ai-maestro server** (this TRDD) — with **#N daemon as the no-server fallback** |
| **B — dev-hygiene** | plugin / marketplace / self-update; cache-prune; rules-cleanup; OOM guard; github-config audit | **STAYS with the janitor** (`#N` daemon, machine-scope singleton) |

**Why the split stops exactly here (janitor's #100 Q2 correction, ACCEPTED):** the #56
invariant "ai-maestro boots and runs with no janitor" has a mirror — a machine with **no
ai-maestro** must still get Family B. Family B mutates the plugin install and kills processes;
that is an owner-controlled machine-wide singleton, not a per-fleet server concern. The USER's
directive named only Family-A functions, so the split honors the directive rather than
narrowing it.

**The recursive catch (ACCEPTED as a first-class constraint):** the server **cannot resurrect
itself**. So `#N`'s daemon remains the Family-A fallback **when there is no live server** —
including bringing the ai-maestro server back up. Locked pattern:

> server owns Family A when up; `#N` daemon owns it when there is no server; the two
> **NEVER write the live credential concurrently**.

That last clause is the single highest-risk seam. The server's OAuth manager MUST acquire a
**shared machine-wide lock** on the live-credential write (see the coordination model below for
why it is a shared O_EXCL lockfile, not the daemon's `fcntl.flock`), so "server up" and "daemon
fallback" are mutually-exclusive credential writers **by construction, not by timing**.

## Daemon coordination model — once-per-machine vs per-population (USER, 2026-07-17)

The USER refined how the server's janitor daemon-function and the external `#N` daemon **coexist
on one machine without doubling work.** The discriminator is **not** Family A vs B — it is **how
many times a chore must run per machine:**

- **ONCE-PER-MACHINE (single-owner)** — OAuth rotation, `claude plugin marketplace update` (all
  marketplaces), `~/.claude` config monitoring, and any chore that must execute exactly once per
  host. Rule: **when the ai-maestro server is ACTIVE, the `#N` daemon DEACTIVATES these** and the
  server's daemon-function owns them; with **no server, `#N` owns them** (the no-server fallback).
  This EXTENDS the Family-A "server-when-up / `#N`-when-not" pattern to the once-only Family-B
  chores (marketplace / self-update / `~/.claude`) purely to **de-duplicate** — Family B's
  OWNERSHIP on a non-ai-maestro machine is unchanged, so the #56 mirror still holds.
- **PER-POPULATION (both-run)** — global reload-plugins, global disarm, global rearm, global
  pause, global reload-skills, global restart-claude. These run on **BOTH** daemons over
  **DISJOINT agent sets**, so there is nothing to de-dup: **agents INSIDE the ai-maestro harness →
  the server's janitor daemon-function; agents OUTSIDE → the `#N` daemon.**

**Reconciles the one-writer seam (supersedes the "same `daemon.flock`" wording).** Presence-based
deactivation is the COARSE coordination the USER directs, but it has a transition WINDOW (server
coming up while `#N` is mid-rotation, or `#N` starting before it observes the server) in which both
could write the live credential — the exact corruption janitor#100 warned of. So the OAuth
live-write ALSO takes a **shared machine-wide lock layered UNDER** the presence model: a **shared
O_EXCL lockfile** at the resolved rotator-lock path — cross-language because both Node and Python
`open(O_CREAT|O_EXCL)` the same file, needing **no `fcntl.flock` and thus no native Node addon**
(this dissolves the Node-22 ABI blocker that pushed [[1GGQ4HWY]] to a server-INTERNAL lock).
Layered guarantee: presence deactivation prevents steady-state doubling; the shared lockfile makes
a handoff-window concurrent write impossible **by construction**. Both, not either — and the
janitor's `#N` side must (a) deactivate its once-only chores when it observes a live server and
(b) honor the same shared O_EXCL lockfile on its own live-credential write. Relayed to janitor#100.

## The `#J → server` contract (janitor #100 Q3, CONFIRMED) — the ONLY new script surface

Two net-new, **self-scoped** (AID, R42-clean) verbs on `aimaestro-continuity.sh`. `#J` never
drives another agent; everything cross-agent stays the server's internal job, so the `#J`
surface stays small and R42/R16-clean.

- **`aimaestro-continuity.sh status <self>`** → read-only, self-scoped, **NEVER token material**:
  ```
  { account_healthy, window_5h_pct, window_7d_pct, cache_ttl_minutes, next_action }
  ```
  Derived server-side from AgentlensPro (canonical paths, corrected on AgentlensPro#3):
  `window_5h_pct`/`window_7d_pct` ← `get_account_status.usageWindows.{fiveHourPct,sevenDayPct}`
  (fallback `get_burn_status.accountWindows`); `cache_ttl_minutes` ← `get_account_status.cacheTtl.minutes`.
  `account_healthy` / `next_action` are the server's own rollup. **The 5-field shape is a
  deliberate ceiling** — it is why no token can leak through this verb (R16 constraint 1).
- **`aimaestro-continuity.sh ensure-resume <self>`** → idempotent signal; the server owns the
  actuation (rotate / recover / resume).
- **Reuse, no new API for the rest:** self heartbeat-arm / compact / reload / resume via the
  EXISTING `aimaestro-session.sh slash|queue <self>` (queue beats ESC-injection — never
  mid-turn, survives hibernation; and R42 already makes `queue`/`send-command` self-only).

R23 boundary preserved: `#J` (and every plugin element) calls only the frozen
`aimaestro-*.sh` script layer, never `/api/...` directly. If a needed call is missing, it is
ADDED to ai-maestro (these two verbs), never reached past.

## What ai-maestro has TODAY — build the delta, do not duplicate

- **Session resurrection: PARTIAL.** `services/boot-restore-service.ts::restoreActiveAgentsOnBoot()`
  (invoked from `server.mjs`), backed by `lib/session-history.ts` + `lib/session-persistence.ts`.
  → HARDEN toward "immortality" (correct-attach, program-args + `--name` persona re-injection,
  the revivable-orphan dataset in `session-history.json`), do NOT rebuild from zero.
- **OAuth rotation / account-switching / rate-limit-recovery: NONE server-side yet.** Net-new
  (Family A) — and the part gated on the R16 sign-off.
- The 5-state safe-state model (`lib/session-safe-state.ts`) + stop/restart poll already exist and
  are the actuation substrate `ensure-resume` builds on.

## Scope decomposition (to become NPTs in plan mode — NOT authored yet, per the process gate)

1. **`aimaestro-continuity.sh` + the two verbs** — the `#J`→server contract surface (self-scoped,
   AID, the 5-field `status` + idempotent `ensure-resume`), server route(s) behind the frozen
   script layer.
2. **Server OAuth manager** — token rotation + the machine-wide one-writer lock shared with the
   `#N` daemon. **BLOCKED on [[TRDD-H24DF6ZC]] USER sign-off.**
3. **Account switcher** — rotate to a fresh account/token on 429 / dead-refresh / network
   interruption; the passive-switch pattern from TRDD-1222f06a §9 (the process never dies — only
   the turn does; a fresh call on a fresh token succeeds). **Token-touching parts BLOCKED on H24DF6ZC.**
4. **Fleet recovery** — server-internal liveness detection + `ensure-resume` actuation across the
   fleet (cross-agent = server's job, never a `#J` call). Reuses the queue/slash primitives.
5. **Session-resurrection hardening** — extend `boot-restore-service.ts` toward the "immortality"
   guarantee (survive reboot, mid-turn rate-limit, network drop; resume from durable state).
6. **AgentlensPro consumption** — the server derives `status` fields from the AgentlensPro CLI
   (dependency already landed, TRDD-WF0UE9BC); cache-health tools named on AgentlensPro#3 for the
   janitor's "prevent cache-miss/expiration" use — consume against the CI-locked contract only.

## Security guardrails (load-bearing, non-negotiable)

- **R16:** OAuth token material is **infrastructure-only** — never in any agent/model-readable
  API or CLI response, never a plaintext file, encrypted at rest in the OS secret store, ONE
  machine-wide-locked writer, and **REAUTH stays human** (the server DETECTS a dead refresh token
  and surfaces the `/login` nudge; it never automates re-auth with stored material). The full
  design + the four constraints are **[[TRDD-H24DF6ZC]]**, which gates the implementation of #2/#3.
- **R42:** the new verbs are self-scoped; no title (MANAGER included) gains a cross-agent drive
  through this surface. Cross-agent recovery is server-internal.
- **R23:** the script layer is the only API boundary; `#J` never calls `/api/...`.
- **AgentlensPro is observe-only** — it emits no token material and has no rotation capability
  (confirmed with code on AgentlensPro#3, `accountInfo.ts:10-13`). Rotation is THIS server's /
  the janitor's infrastructure, never AgentlensPro's.

## Verification (to be detailed per-NPT in plan mode)

- The one-writer lock is provable: a server-up + daemon-fallback concurrency test must show the
  two can never both hold the credential-write lock.
- `status` never emits token material (a schema test pinning the 5 fields, mirroring the
  janitor's/AgentlensPro's reshape-fails-CI discipline).
- Resurrection soak: reboot / mid-turn 429 / network drop → the fleet resumes from durable state
  with no manual step.
- `bash scripts/with-node.sh yarn test` + `yarn build` green at each NPT.

## Acceptance

- [ ] Each of the 6 scope-decomposition items is authored as its own NPT TRDD under this
      card's `npt:`, per the "to become NPTs in plan mode" process gate.
- [ ] The `#J → server` contract (`aimaestro-continuity.sh` + its two verbs, the 5-field
      `status` surface) is recorded as the sole new script surface, per R23.
- [ ] The daemon coordination model (once-per-machine vs per-population) decision is recorded
      and cross-referenced from the OAuth-manager and account-switcher NPTs.
- [ ] `TRDD-H24DF6ZC` (the R16 design gate) is cited as the blocker on NPT #2 (OAuth manager)
      and NPT #3 (account switcher), and its sign-off status is current here.
- [ ] The security guardrails section (R16/R42/R23 + the AgentlensPro observe-only boundary)
      is confirmed as binding on every NPT authored from this decomposition.

## Approval log

- 2026-07-16T15:16:13+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent. The
  token-handling half is carved out into the NPT [[TRDD-H24DF6ZC]], whose IMPLEMENTATION is a
  separate explicit USER sign-off (R16).
- 2026-08-20T22:01:57+0200 — `blocked-by:` pruned from 10 entries to 6. Column unchanged; the card
  is still genuinely `blocked`. Removed `TRDD-JBFM8XR0`, `TRDD-5II83KK4`, `TRDD-4QOWVSLU`,
  `TRDD-9FW92242` — each re-measured first-hand as `column: complete` in `design/archived/`, so
  none of them blocks anything. `blocked-by:` is a LIVE dependency list, not a history: a closed
  card left in it inflates how far this card looks from moving, and `blocked` is only licensed by
  blockers that are themselves still open. The six that remain were each resolved and are open
  (`H24DF6ZC` design · `1GGQ4HWY` backburner · `9ZIF82HI` planned · `DXJZM3BW`, `CHN16JXZ`,
  `99LV0U4I` human_review).
