---
trdd-id: c94c60e9-84bc-4f83-ba57-d81be49ba92a
title: Script SSOT and code-signing readiness — dedupe AMP tree, route hook through CLI, collapse helpers
status: proposal
column: proposal
approval-tier: 2
created: 2026-06-16T23:38:54+0200
updated: 2026-06-16T23:38:54+0200
current-owner: null
task-type: refactor
priority: 2
severity: HIGH
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-c94c60e9 — Script SSOT + code-signing readiness

**Source:** script↔API security audit, findings L1-A1, L1-A2, L1-A3 (`architecture-integrity` AI-01/02/03/04/05/06/07/08/09, `common` A-03/A-04/A-09).
**Tier 2 (MANAGER):** prerequisite for the future scan-before-execute / code-signing layer (governance-adjacent infra).

## Problem (WHY)

The future L1 control (sign / scan a script before it runs) is the ONLY thing that can close the no-server-boundary bypasses (TRDD-a6d93b9c). But the codebase is only **half-ready** for it, and two HIGH items block signing outright:

1. **In-repo byte-fork (L1-A1, blocks signing).** `scripts/amp-helper.sh` (73 293 B) and `plugins/amp-messaging/scripts/amp-helper.sh` (32 615 B) DIFFER (`diff -q` ⇒ differ; ~40 KB drift); the whole `amp-*.sh` set is duplicated. Two divergent canonical copies of every AMP executable live in ONE repo — a content-hash signer cannot pick a canonical hash.
2. **Production hook bypasses the immutable CLI (L1-A2, blocks signing + violates Plugin Abstraction Principle).** `scripts/ai-maestro-hook.cjs:60,79,140,155,182,212` calls `fetch('http://localhost:23000/api/...')` directly. The `aimaestro-hook.sh` intermediary that the CLAUDE.md Plugin Abstraction Principle mandates exists but is unused. The `.cjs` is also a 4th re-implementation (2nd language) of the cwd→agent resolution, and it even matches a PARENT dir (`agentWd.startsWith(cwd+'/')`) which the CLI deliberately does NOT (a wrong-target divergence the CLI comment warns caused cross-session prompt-injection).
3. **SSOT erosion (L1-A3, maintainability).** The canonical `get_auth_args` is bypassed by ~17 inline auth-arg builds + a duplicate `_build_auth_args`; two byte-identical `_api()` helpers (governance ≡ teams); 4 env-var names for one API base (`AIMAESTRO_API_BASE`/`API_BASE`/`API_URL`/`MAESTRO_URL`); the amp-*/aid-* families don't source `common.sh` at all (root cause of their bare-curl / wrong-env-var findings). Each duplicated auth-construction site is one more thing to audit/sign and one more place that silently diverges.

None of these is a runtime security gap (the server enforces regardless — `server_enforced=yes`/`n/a`), but L1-A1 and L1-A2 are must-fix before code-signing is viable, and L1-A3 reduces the audit/signing surface.

**Positives to preserve:** no script self-mutates at runtime (hashes stay stable, AI-11); per-machine state lives outside the executables (AI-12). The only embedded machine-ish constant is the hardcoded `localhost:23000` in a few scripts — externalize it via `get_api_base`.

## Proposed change

```
1. Delete one AMP script tree; keep exactly ONE canonical copy of each amp-*.sh.
   Installer symlinks/copies from the single source. (Decide which tree is canonical first.)
2. Rewrite ai-maestro-hook.cjs to execFile('aimaestro-hook.sh', ['activity'|'notify'|
   'check-messages', '--cwd', cwd, ...]) — the CLI already implements all three ops.
   Removes the direct-API coupling, centralizes auth, kills the parent-dir match divergence.
3. Add GET /api/agents/resolve?cwd=&session= server-side; all callers (CLI _resolve_agent_by_cwd,
   the hook, common.sh lookup_agent_by_*) use it — one authoritative match rule, no full-registry
   pull (kills the per-fire 3x GET /api/agents, AI-03), no language fork.
4. Collapse to one get_auth_args + one HTTP-status-aware _api() (promote the governance _api into
   common.sh, retire api_query/get_auth_header) + one get_api_base; delete _build_auth_args and
   every inline auth-arg build; converge the 4 base-URL env names onto AIMAESTRO_API_BASE.
5. Make amp-*.sh and aid-*.sh source common.sh and use get_api_base/get_auth_args.
6. _init_self_host (common.sh:30): honor AIMAESTRO_API_BASE before the hardcoded localhost probe.
```

## Acceptance criteria

- Exactly ONE on-disk copy of each `amp-*.sh` (a `find` for duplicate basenames returns none cross-tree).
- `ai-maestro-hook.cjs` makes ZERO direct `fetch('…/api/…')` calls (grep-clean); all server touches go through `aimaestro-hook.sh`.
- A single `GET /api/agents/resolve` endpoint; all four resolution call sites use it; no caller downloads the full registry to resolve one agent.
- One `get_auth_args`, one `_api()`, one `get_api_base`, one base-URL env var (others documented aliases); `amp-*`/`aid-*` source `common.sh`.
- A content hash over the script files is stable and unambiguous (signing-ready).
- Regression: every CLI verb + the hook still function end-to-end.

## Risk / blast radius

Medium-high (broad mechanical refactor across the script layer + a new server endpoint). Sequence: (1) dedupe AMP tree, (2) add the resolve endpoint, (3) route the hook + CLI through it, (4) collapse helpers. Each step independently testable. No server-authority behavior changes — this is consolidation, so the risk is regression, not new exposure.

## Approval log
