---
trdd-id: 96ZED7BA
title: The scenario suite was testing the opposite of what matters — it puppeted the agents
column: todo
created: 2026-07-11T21:33:57+0200
updated: 2026-08-16T16:43:00+0200
current-owner: main
assignee: main
priority: 0
severity: CRITICAL
effort: M
labels: [scenarios, governance, false-pass, rule-0b]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
min-approval-requirement: none
mandate: true
mandated-by: self
created-by: main
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: []
audit-requirements: []
review-requirements: []
runtime-targets: [macos]
impacts: []
attempts: 0
test-failures: 0
last-test-result: not-run
implementation-commits: [13d813c8, 7582465c, c304bb5b, 00b0b43c, f944f4af, ae03fd1b]
external-refs: []
---

# The scenario suite was testing the opposite of what matters

## ⏹ TRIAGE 2026-08-02 — `dev` → `todo`, nobody is working this ([[5YRLA53W]])

Re-columned, not closed. Its own STATE carries a concrete NEXT ACTION (SCEN-014 S017/S019/S023, then
run 009 → 011 → 022 → 014) — real pending work that nobody has been doing for **21 days** while the
column claimed otherwise. Nothing about the work changed, only the claim.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**The suite could not fail a fleet that cannot self-organize.** Its rules told the
runner to puppet the agents, and its flagship scenarios handed each agent the answer
key in the directive itself. Both defects manufacture PASSes.

The USER's correction, verbatim: *"you must not artificially control the agents,
instead you must see if they behave correctly and use the skills spontaneously! that
is the most important test! the user can use the UI and give directives to the
MANAGER, and stop. nothing else."*

**Landed (rules + harness):** `13d813c8`, `7582465c`, `c304bb5b`, `00b0b43c`.
**Landed (scenario directives):** SCEN-009 S011, SCEN-011 S015, SCEN-022 (S004/S006/S011).
**NEXT ACTION:** SCEN-014 — S017, S019, S023 (see §4). Then run 009 → 011 → 022 → 014.

## 1. The defect

Three compounding failures, each of which alone is enough to make a PASS meaningless.

**1a. The rules told the runner to puppet the agents.** The How-To section of
`SCENARIOS_TESTS_RULES.md` said, verbatim:

> *"If an agent refuses to do its job, pushes back, or sits idle — talk to it. Push it
> to act. Don't let agents slack. You are the manager of the test."*

That is an instruction to supply, by hand, the organization the fleet is supposed to
supply itself. A suite following it reports a fleet that self-organizes when what it
actually observed was a human doing the organizing.

**1b. The scenarios handed the agent the answer key.** The directive the "user" typed
named the tool, the skill, the API, the flag, and even the governance rule:

| Scenario | The directive said |
|---|---|
| SCEN-022 S004 | ``Use the aimaestro-agent.sh CLI (NOT the web UI)`` + cited **R9.13** + named the role-plugin |
| SCEN-022 S006 | ``at --scope local using the agent-management skill / ChangePlugin API`` |
| SCEN-022 S011 | ``Use the aimaestro-agent.sh delete subcommand with --delete-folder`` |
| SCEN-014 S017 | the literal shell line ``amp-send … --attach <path>``, then ``Use the /amp-send and /amp-inbox skills`` |
| SCEN-009 S011 | named `/team-governance` **and designed the org chart** for the MANAGER |
| SCEN-011 S015 | told the MANAGER the comm graph — the very thing the scenario exists to test |

A real owner knows none of this. Testing that an agent can follow an instruction no
user could give tests nothing.

**1c. The runner was told to un-stick stalled agents.** SCEN-014 S019 and S023:

> *"Check terminal — the poet should have received a notification and started working.
> **If idle, type `/amp-inbox` to check.**"*

An agent that did not notice its own inbox **is the bug**. Typing the command for it
converts the highest-signal failure the suite can produce into a silent PASS.

## 2. Why it survived

Because every one of these looks like *helpfulness*. Naming the CLI looks like removing
an irrelevant ambiguity. Nudging a stalled agent looks like keeping the test moving. The
cost is invisible at the moment you pay it and only shows up as a suite that is green
against a fleet that does not work.[^1]

And the suite contradicted itself, which hid the problem: Rule 0 already said *"you are
the human user"*, while the How-To said *"you are the manager of the test"*. Both were
in the same file. The one the runner actually followed was the operational one.

## 3. The fix

**Rule 0 is now two halves**, and everything else is subordinate to them:

- **0.a** — you are the HUMAN USER. Never an agent. The **terminal** section is a
  read-only observation stream; the **chat** section is the only input surface.
- **0.b** — you MUST NOT artificially control the agents. Brief the MANAGER, then
  **STOP and observe**. A PASS bought by intervening is **worse than a FAIL** — the
  correct verdict is FAIL, and the intervention is the bug report.

**The 5-step SCENARIO LOOP** (USER-dictated) is now canonical in the rules, the
`scenario-runner` agent, and the `scenarios-rules` skill: IMPERSONATE → ACT (through the
UI, always) → VERIFY (**by any READ-ONLY means** — filesystem, logs, debugger, API GET;
the truth usually lands on disk before it reaches the UI) → **STOP and FIX** if the
expected result did not come true (hot-swap; else rebuild+restart; retry; iterate with a
different fix, no attempt limit) → NEXT.

**Rule 0.b and Rule 4 are not in tension — they are the same loop.** 0.b forbids fixing
an agent's behaviour *by talking to it*. Rule 4 *requires* fixing the **cause** — in the
plugin prompt, the skill description, the rules, the server's enforcement — and retrying.
An agent that stalls or forgets a skill is a bug exactly as much as a 500 from an API.[^2]

**The methods moved from the directives into the Verify assertions**, which is where they
were always supposed to live. SCEN-022 S004 now says: *record which interface the MANAGER
actually used — the script layer is the PASS; a direct API call is an
abstraction-boundary violation and a MAJOR finding; doing nothing is a FAIL.* The
scenario can now, for the first time, detect all three.

## 4. Remaining — SCEN-014

- **S017** — strip the shell line, the skill names, and the 3-step org chart; state the
  outcome ("get a poem written and translated, combine into a PDF"). Also: it says *"Type
  and send"* into the **terminal** — move to the chat section (Rule 0.a).
- **S019 / S023** — delete *"If idle, type `/amp-inbox`"*. Observe only; a stalled agent
  is recorded as a finding and diagnosed read-only, never nudged.
- **S018, S020-S027** — loosen the assertions: they hard-code `amp-send`/`amp-download`
  as the only acceptable observation, so a different-but-valid mechanism would read as a
  mismatch once the directive stops dictating one.

## Acceptance

- [ ] SCEN-014 S017: shell line, skill names, and the 3-step org chart removed; directive states only the outcome; the "Type and send" instruction targets the chat section, never the terminal.
- [ ] SCEN-014 S019/S023: "If idle, type `/amp-inbox`" removed — a stalled agent is recorded as a finding, never nudged.
- [ ] SCEN-014 S018, S020-S027: assertions loosened so a valid mechanism other than `amp-send`/`amp-download` is not scored as a mismatch.
- [ ] SCEN-009, SCEN-011, SCEN-022, SCEN-014 all re-run end to end (009 → 011 → 022 → 014) after the fixes, and their reports show no puppeting-shaped intervention.
- [ ] `SCENARIOS_TESTS_RULES.md` no longer contains any "you are the manager of the test" / nudge-the-agent language anywhere outside Rule 0's historical citation of the old text.

## Notes and lessons learned

[^1]: [ocd:2026-07-11 lmd:2026-07-11] A test that helps the system under test is not a
  test — it is a demo. Every intervention here was locally reasonable and globally fatal:
  each one removed exactly the uncertainty the test existed to resolve. The tell is
  simple and worth remembering: **if the test would still pass with the component
  removed, it is not testing that component.** Take the MANAGER out of a suite that names
  the CLI in the directive and the CLI still gets run — by the human. That suite was
  never testing the MANAGER.

[^2]: [ocd:2026-07-11 lmd:2026-07-11] I first wrote Rule 4 (FIX-AS-YOU-GO) as an
  *exception* to Rule 0.b, and told the runner to "record the misbehaviour and move on".
  The USER corrected it: fixing is not an exception, it is the core loop — you fix when
  and only when you cannot otherwise execute the next step. My framing would have
  produced a suite that faithfully observes bugs and then ships them. The distinction
  that resolves it: **fix the CAUSE (in a file you commit), never the SYMPTOM (by talking
  to the agent).** The chat window is not a debugger.
