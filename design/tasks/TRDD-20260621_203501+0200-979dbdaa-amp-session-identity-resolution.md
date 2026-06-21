---
trdd-id: 979dbdaa-d73c-4041-8dd7-406c0d546b4b
title: AMP sessions self-resolve identity from CWD — fix #46 (keystone, unblocks all amp-* coordination)
column: design
created: 2026-06-21T20:35:01+0200
updated: 2026-06-21T22:44:25+0200
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
