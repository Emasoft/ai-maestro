---
trdd-id: JDEQSPOG
title: Twelve LOCAL wiki pages duplicate PROJECT subjects under different names
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-02T18:31:40+0200
updated: 2026-08-20T22:26:37+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
min-approval-requirement: user
mandate: false
approved: false
severity: medium
effort: large
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [wikimem, memory-scope, tech-debt]
---

# Twelve LOCAL wiki pages duplicate PROJECT subjects under different names

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

**`min-approval-requirement: user` and `approved: false` — this card is NOT self-mandated.**
Resolving it means moving pages from the machine-private LOCAL store into the git-tracked, **PUSHED**
PROJECT store. Promotion PUBLISHES, so the USER decides which pages cross that line. Do the ANALYSIS
freely; do not promote a page without their word.

## What was measured (2026-08-02)

The LOCAL store `~/.claude/projects/<slug>/memory/` holds **86 pages**. Grepping every page for
`/Users/…`, `/home/…`, a hostname, `localhost:<port>`, `.ts.net`, or "on THIS machine" found a
machine-private marker in only **9**. The other **77** are machine-agnostic project knowledge that
no other clone of this repo can see.

**Twelve cover subjects the 2026-08-02 CLAUDE.md migration also wrote into PROJECT**, under
DIFFERENT names:

| LOCAL page | bytes | PROJECT page on the same subject |
|---|---|---|
| `agent-first-architecture-hub` | 2 666 | `agent-first-architecture` |
| `agent-terminology-canonical` | 2 363 | `agent-title-role-persona` |
| `agent-architecture` | 2 273 | `agent-first-architecture` |
| `amp-comm-graph` | 3 009 | `amp-communication-graph` |
| `plugin-two-worlds-source-vs-install` | 12 676 | `plugin-architecture-source-vs-install-target` |
| `role-plugin-architecture` | 7 992 | `role-plugins` |
| `role-plugin-structure-spec` | 14 539 | `role-plugins` |
| `network-security-model` | 3 514 | `network-security-tailscale-bind` |
| `element-management-pipelines` | 6 783 | `element-management-service` |
| `marketplace_manifest_format` | 1 580 | `marketplace-manifest-format` |
| `plugin-ecosystem-naming` | 1 475 | `ecosystem-constants-and-repos` |
| `governance-r26-r40-security-model` | 19 006 | (no single PROJECT owner — largest, needs its own read) |

## ⚠ What this is NOT — a claim corrected the same day

An earlier version of this finding said LOCAL **shadows** PROJECT on recall, and that ~12 pages
were name COLLISIONS. **Both were wrong, and were asserted three times before being tested.**

- `memgrep recall <q> <PROJECT> <LOCAL>` returns pages from **every root passed to it**, ranked by
  relevance alone. "LOCAL beats PROJECT" resolves which fact a reader BELIEVES; it is not a search
  filter. Measured on a genuine duplicate: **both** came back.
- There was exactly **ONE** name collision (`runtime-install-tree`), now resolved — the LOCAL copy
  is a SUPERSEDED stub naming the PROJECT page, keeping all three of its links. Recall now returns
  the authoritative page FIRST.

So the cost here is **duplication, not invisibility**: two pages answer the same question, the
older one can outrank the newer, and nothing marks which is current. Real, and much smaller than
first reported. Do not re-inflate it.

## NEXT ACTION

**Per page, in this order — the analysis needs no approval, only the promotion does:**

1. **Diff the pair.** Does the LOCAL page hold any fact the PROJECT page lacks? Several are OLDER
   and thinner; some (`role-plugin-structure-spec` at 14.5 KB, `governance-r26-r40-security-model`
   at 19 KB) are LARGER than anything PROJECT has and may be the better text.
2. **Apply the write gate to the LOCAL page**: *"would this be TRUE and USEFUL for a stranger who
   clones this repo on a DIFFERENT machine?"* All twelve are expected to pass — that is why they
   are here — but check each, because a single `/Users/…` line changes the answer.
3. **Then choose, and ASK before acting on anything but (c):**
   (a) PROMOTE — the LOCAL text is better: move it to PROJECT, merge, supersede the LOCAL copy
       with a stub. **Needs the USER.**
   (b) MERGE — each has something: fold the LOCAL facts into the PROJECT page, then stub.
       **Needs the USER** (it publishes LOCAL text).
   (c) SUPERSEDE — PROJECT already covers it: replace the LOCAL body with a pointer stub, keeping
       every link. **No approval needed** — nothing is published, and the pattern is already set by
       `runtime-install-tree`.
4. **Never delete.** These pages carry `originSessionId` provenance and are linked by other LOCAL
   pages. A stub preserves both; a deletion breaks the LOCAL link graph.

The remaining **65** machine-agnostic LOCAL pages are out of scope here — they duplicate nothing.
Whether the project wants them shared at all is a separate question worth its own card.

## Verification

```bash
# after each page: the pair no longer both claim to be current
memgrep recall "<the subject>" <repo>/.claude/project/memory ~/.claude/projects/<slug>/memory
# the LOCAL link graph is intact
memgrep lint ~/.claude/projects/<slug>/memory 2>&1 | grep -c 'link-dangling'   # must not rise
```

## Estimated risk

MEDIUM. Option (c) is content-preserving and reversible. Options (a)/(b) **publish text to a pushed
store** — that is the irreversible part and the reason this card is USER-gated. Every page must pass
the write gate individually; one leaked home path is pushed to GitHub and inherited by every cloner.

## Acceptance

- [ ] all 12 pairs diffed, with the verdict (promote / merge / supersede) recorded per pair IN this card
- [ ] the write gate applied and recorded per LOCAL page, before any promotion
- [ ] every resolved LOCAL page is a stub NAMING its winner, with its links intact — none deleted
- [ ] `memgrep lint` on the LOCAL store shows no rise in dangling links
- [ ] recall for each subject returns the authoritative page FIRST
- [ ] no promotion happened without the USER's explicit word on that page

## Approval log

- 2026-08-02T18:31:40+0200 — FILED, not approved. Analysis is Tier 0; promotion is USER-gated
  because it publishes machine-private-scope text to a pushed store.
- 2026-08-20T22:26:37+0200 — UN-AUTHORIZED `todo` → `proposal`, moved `design/tasks/` →
  `design/proposals/`. It sat in the authorized-work set for 18 days while asserting
  `approved: false`, which violates the invariant `approved: true ⟺ column ∉ {proposal, refused,
  superseded}`. Its floor is `user` and its own final acceptance box requires the USER's explicit
  word before any promotion, so no agent may authorize it. Zero of its six boxes are checked and
  its `updated:` had not moved since creation, so nothing was in flight and no work is lost — the
  card was never being worked, only mis-filed. It now honestly reads as awaiting the USER. No
  approval was granted or implied by this edit.
