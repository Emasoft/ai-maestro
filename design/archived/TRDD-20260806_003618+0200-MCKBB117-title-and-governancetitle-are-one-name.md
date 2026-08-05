---
trdd-id: MCKBB117
title: title and governanceTitle are ONE concept under two names — unify them
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T00:36:18+0200
updated: 2026-08-06T01:32:16+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T00:36:18+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [taxonomy, governance, owner-ours]
external-refs: [Emasoft/ai-maestro#122]
---
# title and governanceTitle are ONE concept under two names — unify them

## The USER statement (2026-08-06, verbatim)

> "also `governanceTitle` and `title` are the same thing. why they are called with 2
> different names is beyond me.."

Said in the same thread as the role-taxonomy ruling ("there is no such thing as a
`role`. There is the `title`, and there is the `role-plugin`."). So the canonical
taxonomy vocabulary is **TITLE** and **ROLE-PLUGIN** — and the persisted/API field
spelling `governanceTitle` is the same concept wearing a longer, accidental name.

## Problem

The docs, rules, and UI say TITLE (`TitleBadge`, `TitleAssignmentDialog`, "the eight
titles", `min-approval-requirement` values); the record and API say `governanceTitle`.
Every reader must know the two are one thing — the exact class of gratuitous-synonym
confusion that made `role: "autonomous"` beside `governanceTitle: "manager"` read as a
contradiction (TRDD-4Z62YRDG). One concept, one name.

The likely origin of the long name: bare `title` is a heavily-overloaded word in the
codebase (UI panel titles, TRDD `title:` frontmatter, issue titles, HTML title
attributes), so the field was disambiguated at birth. That is a REASON, not a
justification — the fix is scoping, not synonymy.

## Scope (decide before building)

1. Measure the surface: every declaration/read/write of `governanceTitle` in types,
   lib, services, app, components, tests, `rules/aimaestro/*` overlays, GOVERNANCE
   docs, role-plugin repos, and the AMP/attestation wire format.
2. Decide the target shape with the blast radius in front of us:
   - (a) rename the field to `title` everywhere, with a `loadAgents` migration for
     persisted records and a deprecation window for API consumers; or
   - (b) keep the storage/API spelling, and make every human-facing surface say
     TITLE with a single normative note that `governanceTitle` is its storage name.
3. Whatever is chosen: ONE name per surface, no third spelling, and the decision
   recorded in the terminology memory page (`agent-title-role-persona`) and the
   governance spec.

## Acceptance criteria

- [x] Surface census done (counts per file class, wire-format impact named).
      — Measured 2026-08-06: lib 54 · services 88 · app 35 · components 28 · types 6 ·
      scripts 5 (= 216 production) · tests 1819 · docs/design/rules 58. Wire:
      `governance_title` is a field of the SIGNED `aim_tk_*` token payload
      (`lib/aid-token.ts:27,49,383,406,434,457`). Persisted registry records carry the
      key. Deployed fleet CLIs parse `.governanceTitle` from API JSON.
- [x] Target shape decided: **(b) BIND, do not rename** — ruled under the USER's
      2026-08-06 delegation ("decide by yourself after careful analysis. base your
      decision on verified facts and tests"). The deciding fact: signed tokens held by
      live agents embed `governance_title` and cannot be rewritten, so a rename forces
      the server to accept two spellings through a rotation window — mandatory
      backward-compat code, forbidden by the no-legacy rule. The rename is re-openable
      only as a coordinated flag-day (token rotation + fleet CLI redeploy + every
      consumer repo at once).
- [x] Implemented per (b): normative note in `governance-spec.md` TERM-02
      (spec-version 2.4.1 → 2.4.2) — TITLE on human surfaces, `governanceTitle` in
      code/API/storage, `governance_title` on the token wire, no fourth spelling.
- [x] The terminology memory page updated —
      `agent-title-role-persona#ATOM-XER0-P82F` (validated, lint-clean).

## Approval log

- 2026-08-06T00:36:18+0200 — SELF-MANDATE (Tier 0) to AUTHOR the card recording the
  USER statement. The RENAME itself, if chosen, touches the public API surface and
  the governance spec — it will be re-tiered at decision time, not self-approved.
- 2026-08-06T01:32:16+0200 — COMPLETED under the USER's explicit delegation ("decide
  by yourself after careful analysis. base your decision on verified facts and
  tests"). Decision (b) BIND, on the measured census and the signed-token wire fact;
  the rename would have required forbidden dual-spelling compat. USER retains veto —
  reversing means the flag-day plan named in the RESOLUTION note of the spec clause.
