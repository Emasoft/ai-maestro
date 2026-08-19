---
trdd-id: 523V1N4I
title: Wrap the verified PSS and CPV read surfaces for team configuration
column: todo
created: 2026-08-19T04:43:53+0200
updated: 2026-08-19T04:49:50+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
project-id: ai-maestro
labels: [teams, scripts, pss, cpv, decoupling]
external-refs: [TRDD-BRRJK57P, COS ASK 4 2026-08-19, TRDD-IBKR7F74, Emasoft/perfect-skill-suggester#15, Emasoft/claude-plugins-validation#212]
---

# Wrap the verified PSS and CPV read surfaces for team configuration

## Problem

A running COS must provide teams with correctly-configured members, but touches nothing
directly — everything goes through the `aimaestro-*` script layer (the mandatory
intermediary per the plugin-abstraction rule). The COS session asked (ASK 4, 2026-08-19)
which of four VERIFIED PSS/CPV capabilities the scripts should wrap. All four exist today
(PSS v3.13.0, CPV v5.6.0 — verified by those sessions against their own trees; re-verify
each invocation shape at implementation, per decide-on-facts):

1. **Pre-install security gate**: `cpv_pre_install_scan.py <path|url> --json` — exit 0
   clean / 1 do-not-install / 2 error, JSON on stdout, sandboxed static-only. Natural home:
   the server-side R27 install path, verdict STAMPED so agents can read it later.
2. **Installed-artifact health check**: `validate_plugin.py <cache-dir> --json` — exit
   0/1/2/3 by severity, works on the plugin-cache copy (what the runtime loads). Early
   signal before an R31 freeze. CPV's caveat stands: a cache finding means the installed
   artifact is broken, not necessarily the source.
3. **Member-profile fit at team-config time**: `/pss-setup-agent <member-agent.md> --fast`
   (binary emits raw JSON with `--format json`), 2-5 s, no LLM; companions
   `pss_validate_agent_toml.py` + `pss_verify_profile.py` anti-hallucinate the output.
4. **Reindex confirmation**: after fire-and-forget `/pss-reindex-skills`, `pss scan-log` +
   `pss changes-in-batch <scan_id>` confirm the reindex ran — closes the "sent, not
   confirmed" gap `/amcos-reindex-skills` documents. PSS also offers a flat stamp file if
   the wrapper prefers reading a file; the wrapper design decides and the hub relays.

## Proposed fix

One wrapper surface per capability in the `aimaestro-*` script layer (naming and exact
verbs decided at design), each preserving the wrapped tool's exit semantics rather than
collapsing them. **Floor note:** authoring this card is Tier-0 intake; item 1's R27
integration (stamping a security verdict into the install path) is a server security-surface
change — its floor is re-evaluated at the `design` column and escalates to `manager` if it
changes enforcement posture, per D3.

Out of scope here, riding the upstream trackers per how-to-fix-issues-of-other-projects
(hub green-lit 2026-08-19; COS files with byline, per each owner's own offer to build):
5. PSS `pss profile-drift <agent.toml>` → JSON {missing, extra, moved_scope} — on the PSS repo.
6. CPV version-skew installed-vs-marketplace-head compare — on emasoft/claude-plugins-validation.

No collision with TRDD-IBKR7F74 (its three verbs are registry/status/approval plumbing;
these four are config/health surfaces) — per the COS's own relation note, to be re-checked
at design.

## Verification

- Each wrapper invoked against a real member/plugin returns the wrapped tool's JSON and
  preserves its exit code (demonstrate every documented exit value, including the
  could-not-run one).
- COS's `/amcos-reindex-skills` honesty gap demonstrably closed (wrapper confirms a real
  reindex ran).

## Acceptance

- [ ] wrappers for surfaces 1-4 exist in the script layer with exit semantics preserved
- [ ] R27-stamping design decision recorded (with its re-evaluated floor) before item 1 lands
- [ ] COS notified of the wrapper names + the stamp-file-vs-exec decision for item 4
- [x] upstream filings for 5-6 confirmed on their trackers — COS filed with byline
      2026-08-19: perfect-skill-suggester#15 (profile-drift), claude-plugins-validation#212
      (version-skew); both hub-verified OPEN via gh, both request a distinct documented
      could-not-run exit value matching this card's verbatim-exit-semantics decision.
      COS notes PSS's flat stamp file reads cheaper for a server-side wrapper (no exec of a
      user-scope binary from the server path) — weigh at design; final call there.

## Approval log

- 2026-08-19T04:43:53+0200 — MANDATE issued as Tier-0 self-mandate for INTAKE + wrapper
  scripting in this repo (reversible, in-scope). Item 1's R27 integration explicitly
  carries a design-time floor re-evaluation.
