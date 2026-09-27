---
trdd-id: XD8Y62WY
title: D552QXOU closure review disposition — supersede pending-upstream reading
supersedes: [D552QXOU]
column: complete
status: archived
created: 2026-09-27T17:05:29+0200
updated: 2026-09-27T17:06:04+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: docs
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-09-27T17:05:29+0200
---

# D552QXOU closure review disposition — supersede pending-upstream reading

- 2026-09-27 — CLOSURE REVIEW DISPOSITION (D552QXOU, review of f7fe7cb8): (F-A) the same-day line "Card advances to todo pending upstream fix" is SUPERSEDED — the pending-upstream reading is not this card's completion condition; the ROUTE decision was the gate (route 1 taken, issue #313 filed), and the card's one pre-authorized complete-by-fix path did not fire, so closure rests on the route-gate reading. Recorded HERE (a new TRDD is not warranted) because the archived card is immutable under TRDD-MQE5D28T D8 and the two readings must not both read as current. (F-B) the box-2 claim "with symptom/reproducer/impact" was measured post-closure: gh issue view 313 — title names the defect, body 2258 chars, regex probes for symptom/reproducer/impact ALL true. The claim stands, now measured rather than imported.
- 2026-09-27 — REVIEW DISPOSITION (this card's own review): F-α recorded — F-A is MITIGATED, not fixed: the frozen D552QXOU card carries no pointer back here (its immutability makes the link law unsatisfiable against it), and this card's title substring is the only discovery path; the supersedes: [D552QXOU] frontmatter field is the sanctioned forward-link, added after the archive move in the same commit. The F-B evidence is REGEX SUBSTRING probes (the word "impact" in any sentence matches) — corroboration, not proof of the filing requirement's substance; cite it as such. Read together: D552QXOU (frozen, carries the stale reading) → this card (carries the correction and its own limits).

## Approval log

- 2026-09-27T17:05:29+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-27T17:06:04+0200 — COMPLETE by main-agent@ai-maestro. The disposition card's sole box is ticked; born complete..

## Acceptance

- [x] The disposition is recorded: F-A supersession + F-B measured claim, committed d4949c0a.
