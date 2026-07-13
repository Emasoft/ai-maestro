---
trdd-id: CNF1X3J7
title: reliability — refuse to launch an agent client that cannot authenticate or whose role-plugin is not installed
column: ai_review
created: 2026-07-12T12:27:10+0200
updated: 2026-07-13T05:47:00+0200
current-owner: ai-maestro-dev-session
assignee: ai-maestro-dev-session
priority: 0
severity: CRITICAL
effort: M
labels: [reliability, keychain, auth, agent-launch, fleet-outage]
task-type: bugfix
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-12T12:27:10+0200
created-by: ai-maestro-dev-session
derived: false
parent-trdd: null
npt: []
eht: [78J4I4QS]
blocked-by: []
relevant-rules: []
release-via: none
delivery: direct-commit
target-branch: governance-rules
test-requirements: [unit, typecheck]
audit-requirements: []
review-requirements: []
impacts: [agent-lifecycle]
attempts: 0
implementation-commits: [e8593bf4, fb8c03ea]
external-refs: ["memory:running-claude-code-clients", "memory:tmux-pane-cannot-read-login-keychain", "memory:agent-launch-must-preflight-keychain-and-plugin", "memory:fleet-auth-outage-2026-07-12-tmux-server-keychain-blind"]
---

# TRDD-CNF1X3J7 — Agent-launch preflight: never start a client that cannot function

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-12

**▶ UPDATE 2026-07-13 05:47 (DEPLOYED):** full suite 168 files green, built, pm2
restarted. The fleet watchdog (EHT 78J4I4QS, also live) runs the SAME
`preflightPaneKeychain` through the real runtime every sweep and returns `ok` —
live evidence the probe does not false-refuse on a healthy server. Residual manual
item (deliberately blind server ⇒ REFUSE end-to-end) deferred: fabricating
blindness on the live fleet server would disrupt real agents; the unit tests pin
the refuse path. Columns → ai_review; USER is the reviewer.

**▶ UPDATE 2026-07-13 (Gate-1 WIRED + Gate-2 LANDED — full suite/build pending):**

- **Gate-1 wiring DONE at both launch sites.** `ensureKeychainProbeInstalled()` +
  `preflightPaneKeychain(runtime, session)` inserted after the shell-ready check and
  before ANY key injection at `services/agents-core-service.ts` (wake, real-program
  branch) and `services/sessions-service.ts` (createSession). On `refuse`: loud
  console.error naming the remedy, `killSession` (no zombie pane),
  `unpersistSession` (boot-restore must not resurrect the doomed launch),
  `unlinkSession` where the link already happened (sessions-service), return 503 —
  the client command, guard-source, and trust-auto-accept are all skipped and the
  agent stays NOT-online.
- **Gate-2 LANDED.** `role-plugin` row in `lib/agent-invariants.ts`, `triggers:
  ['wake']` pinned by test. Ground truth = NEW `lib/claude-plugin-list.ts`
  (`claude plugin list --json`, cwd = workdir) — NEVER settings.local.json. Expected
  role resolution: scan quad-match → fallback `programArgs` `--agent
  <plugin>-main-agent` (the quad-match returns null in the very outage state, files
  absent) → marketplace from settings key suffix / predefined-vs-local default.
  Repair = `InstallElement` scope local. 4 new tests; invariants+preflight suites
  18/18 green; `tsc --noEmit` clean.
- **Residual (accepted):** the RESTART route relaunches into an EXISTING pane with
  no keychain gate — a server that turns blind AFTER first launch is caught
  fleet-level by EHT TRDD-78J4I4QS (the watchdog), not per-restart.
- **NEXT:** full `yarn test` + `yarn build`, commit, then EHT TRDD-78J4I4QS.

- **State (2026-07-12, superseded above):** Gate-1 DECISION done, TDD, all 4 tests green:
  - `lib/agent-keychain-probe.ts` — the probe script installer (mirrors
    agent-shell-guard-install.ts; sentinels `AIM_KC_READY`/`AIM_KC_BLIND`; the
    `-s` arg + sentinels live IN the file so the pane only types `sh "<path>"`).
  - `lib/agent-runtime.ts` — `preflightPaneKeychain(runtime, sessionName, opts)`
    → `{status:'ok'|'refuse'|'skip', reason?}`. macOS-only (skip off-darwin);
    fail-fast (BLIND / timeout / un-typable-probe all REFUSE).
  - `tests/unit/agent-launch-preflight.test.ts` — 4 cases (ok / refuse-blind /
    refuse-timeout / skip-non-mac), green.
  NOT yet wired into the launch path — the function is currently dead code.
- **NEXT ACTION (wiring — the risky part, two big files):** at BOTH launch sites,
  right after `prepareShellForLaunch` and BEFORE the client `sendKeys`, insert:
  `await ensureKeychainProbeInstalled(); const kc = await preflightPaneKeychain(runtime, sessionName, {probePath: KEYCHAIN_PROBE_INSTALL_PATH});`
  and on `kc.status === 'refuse'`: log loudly (name the remedy), kill the tmux
  session (no zombie pane), mark the agent failed (NOT green/online), and SKIP the
  client injection AND the trust-auto-accept. Sites:
  - `services/agents-core-service.ts` ~line 2216 (inside the `else` real-program
    branch; skip guard-source + `unset CLAUDECODE; ${fullCommand}` + the
    `handleTrustAutoAccept` at ~2263).
  - `services/sessions-service.ts` ~line 1099.
  Then the `role-plugin` invariant row (Gate 2) + its test, then run
  `bash scripts/with-node.sh yarn test && yarn build`, then EHT TRDD-78J4I4QS.
- **Load-bearing facts (do not re-derive — they cost a day):**
  - Keychain access is **inherited from the spawner**. Every agent pane is forked by
    ONE long-lived tmux server, so a blind server ⇒ the WHOLE fleet is blind at once,
    while the developer's own shell works fine. Restarting a client CANNOT fix it.
  - The free, zero-token probe is
    `security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; echo $?`
    → `rc=0` means the pane can authenticate; non-zero means it cannot.
  - **Run it from a SCRIPT FILE.** Through nested shell quoting the `-s` arg gets
    mangled and returns `errSecParam` ("parameters not valid"), which reads exactly
    like a real keychain denial. That false signal cost hours.
  - A role-plugin can be **enabled but never installed**; Claude then ignores it, so
    `claude --agent <name>-main-agent` exits printing the available-agents list and the
    pane falls back to `zsh`. Verify with `claude plugin list` (free, local, no API
    call) — **never** by reading `settings.local.json`.
- **SUPERSEDED — do NOT carry forward:** the 2026-07-12 outage was *not* caused by a
  securityd recycle, a corrupt keychain search list, pm2/launchd, SSH, or Claude's Bash
  sandbox. All five were tested and refuted. The origin of the blind server is
  **undetermined** and this TRDD deliberately does **not** depend on knowing it.
- **Read before acting:** the four memory pages in `external-refs`.

## Problem

On 2026-07-12 the **entire agent fleet was unauthenticated for hours while the
dashboard showed every agent ONLINE.** Two independent preconditions can be false at
launch, and ai-maestro launches the client anyway:

1. **The pane cannot read the OAuth credential** from the login keychain. The client
   prints `Not logged in` / `API Usage Billing` and every prompt fails.
2. **The role-plugin is enabled but not installed.** `claude --agent …` exits and the
   pane falls back to a shell prompt.

Both produce an agent that **looks alive and can do nothing**. That is the whole bug:
*a dead agent that looks alive is worse than one that never started*, because nobody
investigates until work silently fails to happen. The dashboard actively lied for hours.

## Root cause

**Gate-1 class.** Keychain access is a property of the process's inherited security
context. All panes are forked by one tmux server, so they share its fate; a blind
server forks only blind children, forever. The asymmetry (fleet blind, own shell fine)
is what disguised it as a billing/account problem and sent the investigation into the
wrong layer for hours.

**Gate-2 class.** `ChangeTitle` (and any pipeline that writes `enabledPlugins`) writes
the enable flag **without ensuring `claude plugin install` ran**. This is also why a
title-cycle appeared to "fix" an agent that then regressed on the next hibernate/wake —
that path happened to install the plugin; the flag alone never did.

## Proposed fix

### Gate 1 — pane keychain preflight (`lib/agent-runtime.ts`)

After `waitForShellReady()` and **before** the client command is injected:

- Run the probe **in the pane, from a script file** (never inline nested quoting).
- **`rc == 0`** → proceed with the launch.
- **`rc != 0`, or the probe times out** → **REFUSE**: do not inject the client command,
  tear the session down, mark the agent `failed` with reason `keychain_unreadable`, and
  surface the remediation (*"this tmux server cannot read the login keychain — recreate
  it from a shell verified with the same probe"*) in the dashboard and the logs.
- **Fail-fast, no bypass.** A timeout is a REFUSAL, not an "allow on uncertainty". If we
  cannot *prove* the pane can authenticate, we do not launch. (Per the project's
  fail-fast rule: no fallbacks, no workarounds — it works or it exits with an error.)
- **Cost: zero.** No API call, no tokens; ~1 s once per launch.
- **macOS-only.** On other platforms the gate is `skipped` (never `failed`) so it can
  never produce a false refusal.

### Gate 2 — role-plugin INSTALLED, not merely enabled (`lib/agent-invariants.ts`)

- Add a registry **row** (per the architecture rule: *to add a guarantee, add a row —
  never a call site*): `id: 'role-plugin'`, `triggers: ['wake']`.
- **`triggers` MUST be `['wake']` only**, exactly like `core-plugin`: its repair is
  `claude plugin install` — network I/O plus a package manager — and a background loop
  that silently reinstalls plugins fleet-wide is a categorically bigger promise than
  "rewrite a file". A test **pins** `triggers === ['wake']` so a future edit cannot
  quietly turn the periodic watchdog into a background plugin installer.
- **Guarantee:** the agent's role-plugin is installed at local scope in its workdir,
  verified with `claude plugin list`. **Repair:** `claude plugin install <plugin>@<marketplace> --scope local`.

## Verification (TDD — tests first, they must fail before the fix)

1. `tests/unit/agent-launch-preflight.test.ts` — probe returns non-zero ⇒ the client
   command is **never injected**, the session is torn down, the agent is `failed` with
   `keychain_unreadable`.
2. same — probe returns 0 ⇒ the client **is** injected (no regression on the happy path).
3. same — probe **times out** ⇒ REFUSE (pins the fail-fast contract; a future "allow on
   uncertainty" bypass must break this test).
4. same — non-macOS ⇒ gate `skipped`, launch proceeds (no false refusal).
5. `tests/unit/agent-invariants.test.ts` — the `role-plugin` row exists; `triggers`
   deep-equals `['wake']`; it detects enabled-but-not-installed and repairs it.
6. `bash scripts/with-node.sh yarn test` + `yarn build` green (Node 22 — the repo's ABI
   cap; see CLAUDE.md).
7. Manual: point an agent at a deliberately keychain-blind tmux server → it must REFUSE
   with a clear message, **not** start a zombie that looks alive.

## Estimated risk

**MED.** The preflight sits in the hot path of every agent launch, so a false negative
would refuse legitimate launches. Mitigations: the probe is exactly the signal that
empirically discriminated a working pane (`rc=0`) from a blind one (`rc=44`) during the
outage; it is `skipped` (never `failed`) off macOS; and it runs from a script file so
the quoting artefact that once faked a denial cannot recur. The residual risk —
refusing a launch that would have worked — is deliberately accepted: **a refused launch
is strictly better than a silent fleet outage**, which is the failure this TRDD exists
to eliminate.

Dependencies: none. `SHELL_READY_TIMEOUT_MS` / `waitForShellReady()` already exist in
`lib/agent-runtime.ts` (landed by SCEN-015), so the insertion point is present.

## Approval log

- 2026-07-12T12:27:10+0200 — **MANDATE** issued by USER ("create the TRDD").
  `min-approval-requirement: none` (Tier 0 — in-scope dev, reversible, local, no
  baseline deviation). Pre-approved: issuer authority ≥ required approver. No approval
  request was sent.
