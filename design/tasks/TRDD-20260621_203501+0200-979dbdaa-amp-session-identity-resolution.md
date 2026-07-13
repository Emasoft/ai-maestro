---
trdd-id: 979DBDAA
title: AMP sessions self-resolve identity from CWD — fix #46 (keystone, unblocks all amp-* coordination)
column: design
created: 2026-06-21T20:35:01+0200
updated: 2026-07-13T10:40:07+0000
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
task-type: infra
release-via: none
test-requirements: [unit, integration]
relevant-rules: [23]
parent-trdd: TRDD-903b7a20
labels: [amp, agent-identity, scripts, frozen-cli, fleet-readiness, keystone]
impacts: [install-script]
external-refs: ["github.com/Emasoft/ai-maestro/issues/46", "github.com/Emasoft/ai-maestro/issues/40", "github.com/Emasoft/ai-maestro-assistant-manager-agent/issues/21"]
---

# TRDD-979dbdaa — AMP session identity self-resolution (#46)

## ⏵ STATE — READ THIS FIRST ON RESUME — 2026-06-21T20:35:01+0200

**▶ DESIGN SYNTHESIS 2026-06-25 (authoritative — supersedes the CWD-only design below).**
A verified read-only research pass upgraded the design from CWD-only to an ENV-FIRST
LAYERED resolver: **P2.5** uses the already-server-injected `AIM_AGENT_ID`/`AIM_AGENT_NAME`
(more deterministic AND less spoofable than a directory) → **P3.5** CWD fallback (the
genuine env-scrubbed case), with **spoofing hardening** (when in-env identity is present,
the CWD-derived name MUST agree with it, else refuse — never relax security). It also
RESOLVED the "shared identity" confusion (it was the `.agent.address` display field, not
the distinct `.index.json` name key) and REFRAMED the gap (it only bites when `AMP_DIR` is
scrubbed — spawn already injects it). Read **"## Design synthesis (2026-06-25)"** at the
bottom + `reports/amp-identity-design/20260625_064631+0200-46-design-inputs.md`. Two items
now gate the build (beyond the USER-go gate): **(NPT)** reproduce the exact env of one
failing `amp-*` call; **(MANAGER)** scope-check delivery-vs-resolution. Still PLAN ONLY.

**PLAN ONLY — NOT yet built. `/go-on-yourself` authorizes autonomous DESIGN; the BUILD
waits for the USER's explicit go, and is gated behind the `governance-rules` MERGE
decision (the MANAGER flagged that merge to the USER).** This TRDD is the design the build
executes from.

**⚠ DESIGN CORRECTED 2026-06-21 (post-audit, before any build).** A delegated read-only
audit (`reports/audit-infra-46design/`) reproduced the v1 snippet under the helper's real
`set -euo pipefail` and found a **CRITICAL regression**: a bare `_agents_base="$(cd … &&
pwd -P)"` cmd-sub exits non-zero on a host WITHOUT `~/agents/`, and under `set -e` that
**kills the script before P4** — converting the existing single-agent success path into an
`exit 1` (an R23 frozen-CLI violation, the exact opposite of the "additive" claim). It also
used the wrong primary env key (`CLAUDE_PROJECT_DIR`, which AI Maestro NEVER sets — the real
injected var is `AGENT_WORK_DIR`), and an empty base would glob-match any path → phantom
"Users" agent. The pseudocode below is the corrected version (guards A/B + key C + unset D).
**Mandatory regression test for the build:** a fixture with `~/agents/` ABSENT + exactly one
indexed agent MUST still resolve via P4 (catches the `set -e` crash).

**Why (MANAGER direction, ai-maestro#35, 2026-06-21):** after accepting (a) the Extended
Task Model, the MANAGER confirmed ordering **(b) #46 -> (c) #37**. #46 is the keystone — it
gates the #40 kanban round-trip, ALL `amp-*` inter-agent coordination, and the #11 pillar
skills. Confirmed blocked from 3 sessions (orchestrator AMOA#24, MANAGER, this one).

**Root cause (VERIFIED by reading `scripts/amp-helper.sh:95-205`):** the AMP identity
resolver tries, in order — (1) `AMP_DIR` env (set only by AI-Maestro wake/create routes),
(2) `CLAUDE_AGENT_ID` (`--id`), (3) `CLAUDE_AGENT_NAME` **or the tmux session name** ->
`_index_lookup` -> uuid, (4) single-agent auto-select, **else `Error: Multiple AMP agents
found. Use --id <uuid>` (line 173) + exit 1.** An agent session that runs an `amp-*` CLI
*outside* an agent-named tmux session and without `CLAUDE_AGENT_NAME`/`--id` falls through
to (4) and dies — even though it is sitting in its own workdir.

**The unused deterministic key (VERIFIED):**
- AMP `~/.agent-messaging/agents/.index.json` = **39 entries, all DISTINCT names**
  (alexandre, genny-bot, ecos-chief-of-staff-one, jack-bot, ...).
- **34 `~/agents/<name>/` workdirs** whose basenames **MATCH** those index names.
- So a session's **CWD (`~/agents/<name>/`) -> basename `<name>` -> `_index_lookup(<name>)`
  -> uuid** resolves deterministically, with NO env var and NO `--id`. The resolver simply
  never consults CWD.
- Separately: **210 dirs** under `~/.agent-messaging/agents/` (stale bare-uuid accumulation,
  vs 39 indexed) — a secondary prune, NOT the blocker.

## Design — additive resolver priority (frozen-CLI-safe, R23)

Add a **new resolution step between current Priority 3 and Priority 4** in
`scripts/amp-helper.sh` (~line 160, before the multiple-agents error). Pseudocode:

```sh
# Priority 3.5: derive identity from the session's working directory.
# An AI-Maestro agent runs in ~/agents/<name>/ — a deterministic self-identity key
# (never the shared host identity, never guessed). TRDD-979dbdaa / #46.
# CORRECTED per audit (A/B/C/D): AGENT_WORK_DIR is the var AI Maestro actually injects
# (CLAUDE_PROJECT_DIR is NEVER set) -> fall back to $PWD. The `[ -d "$HOME/agents" ]`
# precondition + `|| _agents_base=""` keep this a TRUE no-op under `set -euo pipefail`
# on hosts WITHOUT ~/agents/ (a bare `_x="$(cd … && pwd)"` cmd-sub exits non-zero, so
# `set -e` would kill the script and break the existing P4 single-agent success path).
# The non-empty `_agents_base` guard stops an empty base from glob-matching any path.
if [ "$_amp_resolved" = false ] && [ -d "$HOME/agents" ]; then
    _amp_cwd="${AGENT_WORK_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
    _agents_base="$(cd "$HOME/agents" && pwd -P)" || _agents_base=""
    _cwd_real="$(cd "$_amp_cwd" 2>/dev/null && pwd -P || echo "$_amp_cwd")"
    if [ -n "$_agents_base" ]; then
        case "$_cwd_real/" in
          "$_agents_base"/*/)
            _amp_name="${_cwd_real#"$_agents_base"/}"; _amp_name="${_amp_name%%/*}"
            _amp_uuid="$(_index_lookup "$_amp_name" 2>/dev/null || true)"
            if [ -n "$_amp_uuid" ]; then AMP_DIR="${AMP_AGENTS_BASE}/$_amp_uuid"; _amp_resolved=true; fi
            ;;
        esac
    fi
    unset _amp_cwd _agents_base _cwd_real _amp_name _amp_uuid
fi
```

- **Additive / R23-safe (only AFTER the A/B guards above):** with the `[ -d "$HOME/agents" ]`
  precondition + `|| _agents_base=""` + non-empty-base guard, this resolves ONLY a case that
  currently exits 1 and is a true no-op everywhere else; no existing arg/output/success path
  changes. (The v1 snippet was NOT additive — it crashed P4 under `set -e` on no-`~/agents`
  hosts; see the post-audit correction note above.) Same shape as the existing tmux fallback.
- **No-match -> unchanged:** a CWD not under `~/agents/<name>/`, or a `<name>` not in the
  index, falls through to the existing Priority-4 error (no regression; the owner/core-app
  session — e.g. CWD `~/ai-maestro` — correctly does NOT resolve to an agent).
- **Symlink-safe:** `pwd -P` resolves both sides before the prefix test.

## How it meets the MANAGER's 4 acceptance criteria (manager#21 / ai-maestro#35)
1. **Deterministic self-resolution at startup** — CWD->name->uuid; never guessed, never the
   shared `ai-maestro@emasoft` host identity.
2. **Addressable delivery** — once a session resolves its own uuid, `amp-inbox`/`amp-read`
   read THAT agent's mailbox; senders already address by name/uuid via `_index_lookup`.
   (Push-vs-poll delivery is a separate concern — see open Q3.)
3. **Composes with #45 `presence` + Task `assignee`** — a task `assignee: architect`
   resolves to the architect's workdir-named session.
4. **Shared GitHub/OAuth identity preserved** — touches ONLY the AMP runtime identity layer
   (`~/.agent-messaging`); the shared `gh` identity (#33) is untouched.

## Phased plan (TDD; build gated on USER go + the merge)
1. **Phase 1 — resolver fix (keystone):** add Priority 3.5 to `scripts/amp-helper.sh`; add a
   unit test (fake `HOME` with `agents/<name>/` + an `.index.json` -> assert the helper
   resolves `AMP_DIR` to the right uuid with no `--id`/env). Deploy via
   `install-messaging.sh` (the `amp-*.sh` glob forward-deploys).
2. **Phase 2 — prune stale registrations (EHT):** reconcile the 210
   `~/.agent-messaging/agents/` dirs against the 39 indexed; safe-delete orphans (per
   use-safe-delete, never `rm -rf`). Verify no two `~/agents/<name>/` basenames collide in
   `.index.json`.
3. **Phase 3 — live round-trip verify (closes #40 / unblocks #11):** a real role-plugin agent
   (AMOA has a ready validation path, AMOA#24) drives `amp-kanban-*` end-to-end over the
   AID-authed API from its own session.

## Open questions (resolve during build)
- **Q1:** prefer `$CLAUDE_PROJECT_DIR` over `$PWD`? CPD is the session's pinned project dir
  (more stable than a transient `cd`); fall back to `$PWD`. Lean: CPD-first (shown above).
- **Q2:** `<name>` in `~/agents/` but NOT in `.index.json` (never AMP-registered) — auto
  `amp-init` or fall through? Lean: fall through (explicit init).
- **Q3:** addressable DELIVERY (criterion 2) — today an idle agent doesn't poll; a posted
  directive != delivered. The resolver fix makes a session KNOW its inbox; the push/poll
  delivery loop may be a follow-up TRDD. Scope-check with MANAGER before closing #46.

## Scope / non-goals
- Resolver change is ADDITIVE only (R23 frozen-CLI): no existing flag/output/success path
  changes. A genuine interface change needs MANAGER coordination first.
- Does NOT touch the shared `gh`/OAuth identity (#33) or the AID crypto layer.
- Prune (Phase 2) uses safe-delete (`.trashcan/`), never `rm -rf` on agent stores.

## Design synthesis (2026-06-25) — env-first layered resolver + spoofing hardening

A read-only research pass (`reports/amp-identity-design/20260625_064631+0200-46-design-inputs.md`,
every claim verified against code + live data) confirmed the CWD approach is viable and
surfaced three improvements the CWD-only design above does not capture. This section is the
authoritative design for the build; the P3.5 pseudocode above is retained as the
CWD-fallback *component* of it.

### Finding A — the "shared identity" was a display-layer artifact, not the index key
The ~26 entries reported as "all named `ai-maestro@emasoft.aimaestro.local`" are the
`.agent.address` field that the P4 error LISTS (`amp-helper.sh:182`), NOT the `.index.json`
KEY. The index is keyed by DISTINCT agent NAMES (live: 40 distinct name keys, 0 addresses;
`amp-init.sh:441-459`). So CWD→basename→`_index_lookup(name)`→uuid is deterministic and the
shared-address collision does NOT block it — the single biggest surface-reading confusion
in #46, now resolved.

### Finding B — the gap only manifests when the env is SCRUBBED (reframes the fix)
Both spawn paths ALREADY inject `AMP_DIR` (+ `AIM_AGENT_ID`, `AIM_AGENT_NAME`,
`AGENT_WORK_DIR`, `AID_AUTH`) into the tmux session env (`services/sessions-service.ts:766-823`,
`services/agents-core-service.ts:1980-2019`). So for a normally-spawned session **P1 already
resolves and #46 never triggers.** The P4 failure the 3 sessions hit occurs only when
`AMP_DIR` is ABSENT — an env-scrubbing subprocess (`env -i`, `sudo`, some hook subshells), a
manually-launched terminal, or a re-sourced shell that lost the var. **NPT (prerequisite,
blocks the build):** reproduce the EXACT env of one failing `amp-*` call (report Q2) and
record whether `AIM_AGENT_ID`/`AIM_AGENT_NAME` SURVIVE when `AMP_DIR` is lost — this
determines which layer below is the actual #46 fix.

### Decision — a LAYERED resolver, env-first then CWD (integrate both, don't pick one)
The resolver ignores TWO deterministic keys, not one. Add BOTH, ordered by trustworthiness,
before the P4 error:
- **Priority 2.5 — server-injected identity env (preferred when present):** if `AIM_AGENT_ID`
  set → `AMP_DIR="${AMP_AGENTS_BASE}/$AIM_AGENT_ID"`; elif `AIM_AGENT_NAME` set →
  `_index_lookup("$AIM_AGENT_NAME")` → uuid. The server injects these at spawn and a peer
  cannot forge them into ITS OWN session, so they are strictly MORE deterministic and LESS
  spoofable than CWD.
- **Priority 3.5 — CWD fallback (the genuine env-scrubbed #46 case):** the corrected P3.5
  pseudocode above, with precedence **`AGENT_WORK_DIR` → `$PWD`**. Drop `CLAUDE_PROJECT_DIR`
  entirely — AI Maestro NEVER sets it (grep of `services/`+`lib/` = 0 hits), so the TRDD's
  Q1 "CPD-first" lean is dead weight; correct Q1 to "AGENT_WORK_DIR-first, $PWD fallback."
  This is the ONLY layer that fires when the full env (incl. `AIM_AGENT_*`) was scrubbed.

If the Finding-B NPT shows `AIM_AGENT_*` is scrubbed together with `AMP_DIR`, P2.5 helps only
PARTIAL-scrub cases and P3.5 (CWD) is the #46 fix — but P2.5 is still worth adding (cheaper +
safer for partial-scrub + future callers). Both layers are additive ⇒ R23 frozen-CLI-safe.

### Security hardening — bind the spoofable CWD handle to the trusted env (never relax)
The `amp-*` filesystem layer has NO crypto auth (no secret/signature in `amp-helper.sh:108-213`);
the shell guard confines `cd` inside a guarded session but FAILS OPEN without `AGENT_WORK_DIR`
and is explicitly not a sandbox (`lib/agent-shell-guard.ts:8-20,55-57`). CWD-resolution lowers
the impersonation bar from "know a uuid" to "type a workdir name." Built into the design:
- In **P3.5**, when `AIM_AGENT_ID`/`AIM_AGENT_NAME` ARE present, the CWD-derived name MUST
  AGREE with them — a mismatch REFUSES (never silently trusts CWD). Binds the spoofable
  handle to the server-injected one whenever both exist.
- When ONLY CWD is present (the genuine scrubbed case), accept it under the EXISTING user-UID
  trust boundary (the same boundary `--id` already accepts per #46) but emit a one-line
  stderr note that identity was CWD-derived, so the path is auditable.
- Adds NO interface change (additive, R23-safe) and relaxes NO existing check — it only
  refuses a newly-detectable mismatch.

### Still needs an external decision before #46 closes
- **Delivery vs resolution (report Q8 / TRDD Q3):** the resolver makes a session KNOW its
  inbox; it does NOT make idle agents POLL (no poll loop in the `amp-*` scripts). MANAGER
  acceptance criterion 2 says "addressable delivery" — MANAGER scope-check whether closing
  #46 needs only self-resolution or also a push/poll loop (likely a follow-up TRDD). A scope
  decision, not a code question.

### Build prerequisites (gating Phase-1 build, in addition to the existing USER-go gate)
1. **NPT** — reproduce one failing `amp-*` env (Finding B) → confirm the live failing layer.
2. **MANAGER** — scope-check delivery (above) → confirm #46's closing criteria.
3. **Then build** P2.5 + P3.5 + the cross-validation, with tests: the mandated regression
   (`~/agents/` ABSENT + 1 indexed agent → still resolves via P4) PLUS a P2.5 test
   (`AIM_AGENT_ID` set, no `AMP_DIR` → resolves) PLUS a cross-validation test (CWD name ≠
   `AIM_AGENT_NAME` → refuses).
