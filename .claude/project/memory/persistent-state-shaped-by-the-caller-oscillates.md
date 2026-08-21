---
name: persistent-state-shaped-by-the-caller-oscillates
description: "two tools keep overwriting each other's config and both report success / a setting flips back after the other one runs / branch protection differs across repos and I cannot tell which shape is right / the ruleset changed and nobody changed it / my conformance check passes here and fails on the same repo elsewhere"
ocd: 2026-08-21
lmd: 2026-08-21
metadata:
  node_type: memory
  type: project
  tier: aspect
publish-globally: false
---

# persistent-state-shaped-by-the-caller-oscillates


^ATOM-ZSOQ-K4RN [desc: "A persistent resource whose shape comes from the CALLER's env or cwd oscillates by construction; agreeing payloads cannot fix it", keywords: two_writers_overwrite_each_other setting_flips_back ruleset_differs_per_repo split_by_writer_not_by_repo ambient_context caller_env_decides_payload oscillation_by_construction, type: project, ocd: 2026-08-21, lmd: 2026-08-21]

**Ask of any persistent resource: is its shape a property of the RESOURCE, or of the moment
someone wrote it?**

Measured on the branch-protection baseline across 9 public fleet repos (`TRDD-SX5FPMG0`,
2026-08-21). BOTH halves of the payload came from the applier's ambient context:

- `pull_request` ← `require_pull_request_for()` → `in_ai_maestro_agent_env()`, reading
  `AIMAESTRO_AGENT` / `AID_AUTH` **from the calling process**. Its docstring says TRUE "inside
  the ai-maestro harness" — a fact about the CALLER, never about the repo.
- `required_status_checks` ← `detect_required_status_checks()`, reading `.github/workflows`
  **from the caller's CWD**; no local checkout ⇒ empty ⇒ the rule is omitted entirely.

One applier inside a harness agent wrote `pull_request`; another running standalone removed it.
**Six repos carried one shape and three the other — the split was by WRITER, not by repo.**

Neither applier was buggy on its own terms. It is ONE predicate honestly answering two callers,
which is strictly worse than two payloads disagreeing: **making the payloads agree cannot fix
it**, because the same applier flips against ITSELF depending on where it is invoked from.


^ATOM-WT5B-2MRV [desc: "Cross-process divergence is invisible because each writer's post-condition is true of what it SENT, and the checker re-derives in its own context too", keywords: both_tools_report_success post-condition_passes_but_state_is_wrong conformance_check_passes_here_fails_there no_test_catches_it divergence_only_across_processes, type: project, ocd: 2026-08-21, lmd: 2026-08-21]

**Why an ambient-context divergence is invisible — two independent blindfolds, and the second
one catches the people who go looking.**

1. **Each writer's post-condition is true OF WHAT IT SENT.** It reads back the resource and
   confirms the payload it just wrote. Both writers pass. Neither can observe that the other
   exists, let alone that it will reverse the change.

2. **A conformance checker that re-derives the expected payload IN ITS OWN CONTEXT inherits the
   same bug.** It agrees with whichever writer shares its context and flags the other — so the
   VERDICT depends on where the CHECK runs. Running the audit "to settle it" produces a
   confident answer that is an artifact of the auditor's environment.

Consequence worth stating on its own: **no single-process test can see any of this.** Each
applier is internally consistent; the divergence exists only ACROSS processes. So a green suite,
a green post-condition and a green conformance run are all compatible with a resource that
flip-flops. Detect it by comparing the RESOURCE across time and writers (`updated_at` plus which
process last wrote), never by asking one process whether it is satisfied.


^ATOM-G9K0-SQF1 [desc: "Fix by pinning the evaluation context and deriving from a repo-scoped fact; a fix reconciling today's two callers leaves the next one free to flip it", keywords: pin_the_evaluation_context repo-scoped_fact_not_caller-scoped test_both_caller_shapes_agree fleet-wide_apply discriminating_evidence, type: project, ocd: 2026-08-21, lmd: 2026-08-21]

**The fix is NOT "make the payloads match".**

Two parts, and the second is what makes it durable:

- **Derive the shape from a REPO-SCOPED fact.** "Is this repo worked by harness agents?" is a
  property of the repo; "am I currently running inside a harness agent?" is a property of the
  moment. The intent behind the original predicate was right; the proxy was not.
- **Any fleet-wide apply PINS its evaluation context** rather than inheriting it from whatever
  process happens to run it, and records the pinned value in its run log.

**The acceptance test must pin BOTH caller shapes against one target and assert they AGREE** —
a fix that merely reconciles today's two callers leaves the NEXT caller free to flip the resource
again. (That stricter form came from the peer who owned the predicate, not from the card that
reported it.)

**Choosing discriminating evidence mattered more than collecting more of it.** Three repos lacked
the checks rule. Two had no local checkout — consistent with the story, but unable to separate
"the apply context was wrong" from "the repo genuinely has no CI". The third HAD a checkout AND a
workflow file and still got no rule: only that one DEMONSTRATES the cwd-dependence instead of
merely fitting it. One discriminating case beats two corroborating ones.

## Notes and lessons learned
