---
trdd-id: TCKNOA72
title: Add a live JANITOR REPORT section to the settings page
column: blocked
pre-block-column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T06:43:03+0200
updated: 2026-08-05T06:43:03+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T06:43:03+0200
severity: medium
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: [14HI8ZPR]
release-via: none
labels: [janitor, settings-ui, observability]
external-refs: [Emasoft/ai-maestro#112, Emasoft/ai-maestro#111]
---

# Add a live JANITOR REPORT section to the settings page

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-05

**USER-MANDATED**, verbatim: *"open a feature request on the Emasoft/ai-maestro repo asking to
create a new section of the settings page called `JANITOR REPORT` that will generate and display
that exact html table as content, always up to date (updated in realtime as the user watches)"*.
Filed by the janitor as `ai-maestro#112`; this is the ai-maestro-side card.

`mandated-by: user`, so it is born approved — no approval round-trip was sent or needed.

**The reference artifact** is the janitor's own global-status HTML, one instance of which the user
supplied:
`/private/var/folders/j5/4vmcr_496wsbmt3dl3k8f11r0000gn/T/janitor-global-status-rfgj5x5r.html`

⚠ **That path is a TEMP FILE and will be swept.** It measured **27,231,702 bytes (26 MB)** on
2026-08-05 06:31. Copy it somewhere durable before relying on it, and note that its size is itself
a design input: a 26 MB document is not something to re-render into the settings page every second,
so "updated in realtime" must mean the DATA refreshes, not that the page re-materialises a 26 MB
artifact. Read `#112` for the janitor's own framing before choosing a shape.

**NEXT ACTION:** copy the sample HTML out of `/private/var/folders/...` into `reports_dev/` (it is
gitignored, and the file is 26 MB so it must not be committed), then read its actual table
structure. Do not design against the description of it — the source is on disk.

## Why this is blocked on TRDD-14HI8ZPR

`blocked-by: [14HI8ZPR]` is load-bearing, not bookkeeping. The report's headline content is the
per-chore status table — and today **every** chore reads as stale because the server never writes
`<task-name>.last-run.ts` (verified: `grep -rn "last-run"` over `lib/ services/ scripts/` returns
zero hits; `find ~/.claude/janitor-control -name '*.last-run.ts'` returns 0 files).

So building this section first would ship a settings page whose central table says everything is
dark, on a host where five of the eleven chores are demonstrably running
(`startAbsorbedDutyScheduler`, `server.mjs:1845`). That is a dashboard that lies in the alarming
direction, which is worse than no dashboard — and it would be read as evidence of an outage that
is really a missing stamp.

Fix the stamps, then render them.

## Open questions for the design

- **Where does the data come from?** Rendering the janitor's HTML verbatim couples the settings
  page to another project's output format. Reading the stamp files + registry ourselves and
  rendering our own table keeps the coupling at the DATA contract (`last-run.ts`), which is the
  one both sides already agreed on. The user asked for "that exact html table" — resolve whether
  that means the same INFORMATION or the same MARKUP.
- **What does "realtime" mean here?** The chores' cadences run from 60 s to 6 h, so sub-second
  refresh conveys nothing. A poll at the fastest cadence, or an SSE/WebSocket push on stamp
  change, both satisfy "up to date as the user watches" at very different costs.
- **Does it need the janitor installed?** The section should degrade honestly on a host with no
  janitor rather than render an empty table that looks like a fleet outage.

## Verification

The section is only correct when a chore that IS running reports as running. Given
TRDD-14HI8ZPR, that is testable end to end: touch a stamp, watch the row go green without a
reload.

## Estimated risk

LOW-MEDIUM. Additive UI plus a read-only data path. The risk is not breakage — it is shipping a
status display that is confidently wrong, which is why the blocker above is a real dependency
rather than a nicety.

## Acceptance

- [ ] the 26 MB sample copied somewhere durable and its real table structure read (not assumed)
- [ ] "same information" vs "same markup" resolved with the user
- [ ] refresh mechanism chosen and justified against the 60 s-6 h cadence range
- [ ] `JANITOR REPORT` section renders per-chore status from the stamp contract
- [ ] honest degradation when no janitor is installed on the host
- [ ] a chore that is running reads as running (the end-to-end check TRDD-14HI8ZPR unblocks)

## Approval log

- 2026-08-05T06:43:03+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: the USER directed this feature verbatim and it was filed as `ai-maestro#112` at
  their instruction. No approval request was sent.
