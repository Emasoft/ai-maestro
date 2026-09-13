---
trdd-id: 37LX5NKO
title: trddgrep write gate and its message disagree about --design-dir
column: cancelled
created: 2026-09-13T05:10:40+0200
updated: 2026-09-13T10:09:27+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-13T05:10:40+0200
---

# trddgrep write gate and its message disagree about --design-dir

## Approval log

- 2026-09-13T05:10:40+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-13T10:09:27+0200 — CANCELLED by emanuelesabetta. Premise refuted: the stale Aug-25 wrapper's gate never RAN (verb misdetection), which is issue 161's own bug, fixed by 9c07ffcc2. No defect exists in committed code..

## Problem

The write gate's MESSAGE says `fix` is "disabled outside the ai-maestro checkout". Its PREDICATE is narrower: it guards only the IMPLICIT cwd-resolved target. Passing --design-dir lifts it.
MEASURED 2026-09-13, single variable (same cwd /tmp, same card id 06G43RK2, no AIM_PILLAR_ALLOW_WRITE):
  A  trddgrep --design-dir <copy>/design fix 06G43RK2  -> rc=0, REPAIRED 1 file(s), lint 1->0
  B  trddgrep                            fix 06G43RK2  -> rc=2, gate message
B is the control and it fires the GATE, not a corpus error (a bad path gives "no TRDD corpus at ..."), so the two checks are distinguishable and B reached the gate.
NOT the 161 bug. 161 was verb MISDETECTION (--design-dir /foo fix made the verb /foo, so the gate never ran); that is fixed and verified. This is the gate RUNNING and permitting. Different mechanism, different fix.
ORIGIN UNVERIFIED: 9c07ffcc2 MOVED a pre-existing gate into scripts/pillar-cli rather than authoring it, and the source is unreadable under the code-tool gate, so whether the hole predates the move is unestablished.
SEVERITY LOW, task-type bugfix NOT security. Anyone who can pass --design-dir can set an env var, so this is no boundary against a caller who can already run the command. And five write verbs (new set append check-box move) are ungated in every directory, so the bypass grants nothing new. Judgement-call rules (BODY-STATE-CLAIM) are never auto-repaired.
(a') CODE — require AIM_PILLAR_ALLOW_WRITE when the target is outside the checkout. Matches the usage rule's own worked example, which already pairs --design-dir WITH the override.
(c)  MESSAGE — reword to say the gate guards the implicit cwd target only. Matches the same rule's "never cd to retarget, pass --design-dir" instruction.
REJECTED (a) target-must-be-inside-the-checkout: it would refuse every LOCAL (~/.claude/projects/<slug>/design) and USER scope write, both outside the checkout by definition.
REJECTED (b) target-must-be-a-registered-agent-workdir: same breakage, plus a registry lookup from a CLI documented to run standalone.
Neither (a') nor (c) breaks yarn trdd:fix, the API routes or the server — all call fixCorpus/lib directly, never the CLI wrapper.
DEFINITIVE 2026-09-13 — confound eliminated. Both arms from cwd=/tmp with `env -u AIM_PILLAR_ALLOW_WRITE`, same card, sha of the target file before/after:
  target corpus OUTSIDE the checkout (mktemp -d)  -> rc=0  target_changed=YES  "REPAIRED 1 file(s):"
  target corpus INSIDE  the checkout             -> rc=0  target_changed=YES  "REPAIRED 1 file(s):"
So the gate does NOT inspect where the target is; it simply does not fire when --design-dir is present. This rules out the alternative that it keys on corpus-identifiability, since the outside-the-checkout corpus was written too.
Ordering note: the gate is evaluated BEFORE corpus resolution — a no-flag run from /tmp (no /tmp/design) returns the GATE message, while a bad --design-dir path returns "no TRDD corpus at ...". The two refusals are distinguishable.
The stale Aug-25 wrapper on PATH derived the verb as the first non-flag argument:
    for a in "$@"; do case "$a" in -*) ;; *) verb="$a"; break ;; esac; done
    case "$verb" in fix|edit) ...gate... esac
So `trddgrep --design-dir /path fix ID` skipped `--design-dir` as a flag, took `/path` as the verb, never matched `fix|edit`, and THE GATE NEVER RAN. (Evidence preserved at reports/trdd-implementer/stale-wrapper-evidence/.)
That IS issue 161's verb-misdetection bug — not a second, different one. `scripts/pillar-cli` predicts it verbatim: "an omitted flag shifts the verb and defeats the gate SILENTLY". 9c07ffcc2 fixed it by scanning ALL arguments (`case " $* " in *" fix "*`) instead of picking a verb; `git show 9c07ffcc2 -- scripts/pillar-cli` shows those lines added by that commit.
It was reachable only because nothing had re-run the installer since Aug 25. After re-running install-messaging.sh on 2026-09-13 the same command is refused, and all three CLIs byte-match scripts/pillar-cli with correct exec bits (prrdgrep/specgrep 'help' rc=0).
CORRECTION TO MY OWN EARLIER CLAIM, recorded because it is in git twice (f80ccb49 and this card): I wrote "this is the gate RUNNING and permitting — different mechanism, different fix". That was asserted from black-box observation, which cannot distinguish "evaluated and allowed" from "never reached". A review said so at the time and was right. Reading the stale artifact shows it was NEVER REACHED.
The residual real issue — that installed tools go stale because nothing re-runs the installer — is the subject of plan Phase 2, not of this card.





## RESOLVED 2026-09-13 — THIS CARD'S PREMISE IS WRONG; the defect does not exist in committed code.


## The decision: which half is wrong, the code or the message





## Acceptance

- [x] USER or owner picks (a') code or (c) message
- [x] a test pins the chosen predicate, with a neuter naming the test that reddens
