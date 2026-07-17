---
trdd-id: KCRMSNL7
title: Absorb the janitor daemon continuity family (Family A) into the ai-maestro server
column: design
created: 2026-07-16T15:16:13+0200
updated: 2026-07-17T19:06:11+0200
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
npt: [H24DF6ZC, Y916N7WL, DXJZM3BW, 1GGQ4HWY, 9ZIF82HI, CHN16JXZ, JAU1ES1C, P7RPOR5O]
release-via: none
---

# Absorb the janitor daemon continuity family (Family A) into the ai-maestro server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-16

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

## Approval log

- 2026-07-16T15:16:13+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. No approval request was sent. The
  token-handling half is carved out into the NPT [[TRDD-H24DF6ZC]], whose IMPLEMENTATION is a
  separate explicit USER sign-off (R16).
