---
trdd-id: Y3AGECQE
title: Stamp the CPV pre-install security verdict into the R27 install path
column: proposal
created: 2026-09-05T13:26:43+0200
updated: 2026-09-05T13:26:43+0200
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: security
min-approval-requirement: manager
assignee: governance-rules-session
approved: false
parent-trdd: 523V1N4I
project-id: ai-maestro
labels: [security, r27, cpv, decision]
---

# Stamp the CPV pre-install security verdict into the R27 install path

## Problem

TRDD-523V1N4I wraps the CPV pre-install security scan (`cpv_pre_install_scan.py <path|url> --json`, exit 0 clean / 1 do-not-install / 2 could-not-run) as a REPORT-ONLY script-layer surface. The card's own floor note says the natural home of that verdict is the server-side R27 install path, STAMPED so agents can read it later — and that stamping a security verdict into the install path changes enforcement posture, so its floor is `manager` per D3 and the hub may not decide it unilaterally. 523V1N4I therefore ships the wrapper without stamping and queues the stamping decision here, as a real card rather than a sentence.

## Proposed fix

Decide, at the `design` column with the MANAGER as approver, whether and how the R27 install path records the pre-install verdict: (a) stamp `{verdict, scan_rc, cpv_version, scanned_at}` beside the installed plugin (registry or a sidecar the runtime already reads), (b) refuse the install on rc 1, or (c) record only and let a later gate act. Preserve the three-valued rc — exit 2 (could-not-run) must never be recorded as clean. Implementation is a separate Tier-0 card once the decision is approved; this card carries the decision only.

## Verification

- The approved decision names the store, the field shape, and what rc 1 and rc 2 each do to the install.
- No wrapper from 523V1N4I writes into the install path before this card reaches `complete`.

## Estimated risk

MED — a stamped verdict that agents trust is an enforcement surface; a wrong default (treating could-not-run as clean) would be a silent bypass.

## Acceptance

- [ ] MANAGER decision recorded here with the store, field shape, and the rc 1 / rc 2 behaviour
- [ ] implementation card minted as an NPT-free Tier-0 child once approved, cited here

## Approval log

## Approval log
