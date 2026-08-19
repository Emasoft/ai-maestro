---
trdd-id: Z70X3LEW
title: Normative 3P-TOOL clause family — role plugins bind to the pillar CLIs
column: proposal
created: 2026-08-19T04:40:55+0200
updated: 2026-08-19T04:40:55+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
task-type: docs
min-approval-requirement: manager
priority: 2
project-id: ai-maestro
labels: [governance, 3-pillars, role-plugins, spec]
external-refs: [TRDD-BRRJK57P, AMOA TRDD-8DH44UXH]
---

# Normative 3P-TOOL clause family — role plugins bind to the pillar CLIs

## Problem

During the TRDD-BRRJK57P fleet audit, the orchestrator role-plugin (AMOA) asked the hub an
open governance question: is adoption of the three pillar CLIs (`trddgrep`, `prrdgrep`,
`specgrep`) by role plugins NORMATIVE, or a per-plugin choice? The hub's interim ruling
(recorded in BRRJK57P's STATE, 2026-08-19 batch) was: **voluntary adoption now, normative
clause via a proposal card** — a spec `MUST` is not minted mid-flight during a remediation
program. This card is that proposal.

Without a clause, each role plugin hand-rolls its own greps/parsers over the TRDD/PRRD/spec
corpora. AMOA's audit showed the cost concretely: its own `transition_authority()` oracle
drifted from Part B2 on six transitions because it re-implemented what the pillar corpus
already answers. A second, independent hazard is exit-code collapse: `trddgrep` uses the
grep trichotomy (0 clean · 1 findings · 2 could-not-run), and a consumer writing
`trddgrep validate || handle_findings` silently converts *could-not-run* into *findings* —
the vacuous-gate failure class this repo's lessons file documents repeatedly.

## Proposed change

Add a new clause family **`3P-TOOL`** to `design/specs/3-pillars-spec.md` (registered in
3P-GREP per 3P-MNT-03), with this exact text:

> ## 3P-TOOL — the pillar query surface (CLIs a consumer binds to)
>
> `3P-TOOL-01` **bind-to-the-clis** — `MUST`: a role plugin (or any fleet tool) that queries
> a pillar corpus programmatically uses the pillar CLIs — `trddgrep` (TRDD corpus),
> `prrdgrep` (PRRD), `specgrep` (specs) — where they are installed, and MUST NOT ship a
> parallel parser or hand-rolled grep pipeline over the same corpus. Raw `grep` remains fine
> for interactive/ad-hoc reads; the ban is on a plugin's SHIPPED code re-implementing the
> query surface. Where the CLIs are absent on a host, degrade to read-only grep and SAY SO —
> never emulate the verbs.
>
> `3P-TOOL-02` **exit-trichotomy** — `MUST`: the pillar CLIs exit with the grep trichotomy —
> `0` clean · `1` findings · `2` COULD NOT RUN — and every consumer MUST branch on all
> three. `cmd || on_findings` is a violation: it collapses *could-not-run* into *findings*.
> A `2` is never a verdict about the corpus.
>
> `3P-TOOL-03` **specs-live-with-the-owner** — `MUST`: a spec lives in the repo of the
> contract's OWNER (the 3-pillars spec in ai-maestro; a plugin's own contract in that
> plugin's repo). A consumer cites by spec name + `spec-version` (3P-VER-02) and MUST NOT
> vendor a copy — a copied spec is a second source of truth that drifts.

Version bump: `spec-version` 2.0.0 → **2.1.0** (additive clauses; no existing clause
changes). If the approver reads 3P-VER-01's "MAJOR = a `MUST` changes" as covering *new*
MUSTs, the bump is 3.0.0 instead — the approver rules; the clause text is unchanged either
way.

Companion edit: one row in `role-plugins-spec.md` §RP-VAL pointing at 3P-TOOL ("plugin code
queries pillar corpora via the pillar CLIs, branching 0/1/2 — see 3-pillars spec 3P-TOOL"),
so the plugin-quality checklist reaches it. No RP clause duplicates the text (3P-META-02).

## Reference implementation

AMOA reports (its Phase-2 session, 2026-08-19 batch — attributed, not yet hub-re-verified)
voluntary adoption of the three CLIs at **7 sites** in its plugin. On approval, the
implementer verifies those sites in AMOA's tree and cites them in the spec commit as the
reference implementation; AMAMA v2.18.0 (D2 pillar-tool adoption) is a second adopter.

## Verification

- `specgrep` (or grep) shows `3P-TOOL-01..03` present, family listed in 3P-GREP, version
  bumped, `updated:` bumped.
- The RP-VAL row exists and cites 3P-TOOL rather than restating it.
- Neuter check for the trichotomy clause: `trddgrep validate` on a corpus made unreadable
  (e.g. a bogus root) exits 2, not 1 — already true; the clause pins it.

## Estimated risk

LOW. Additive spec clauses; no code changes in this card. The one dependency: role plugins
not yet adopting the CLIs become non-conformant on ratification — mitigated because
adoption was already dispatched as voluntary under BRRJK57P Phase 2 and the two largest
consumers (AMOA, AMAMA) have adopted.

## Approval log
