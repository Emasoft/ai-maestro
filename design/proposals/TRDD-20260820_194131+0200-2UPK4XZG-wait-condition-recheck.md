---
trdd-id: 2UPK4XZG
title: A card's wait condition is never re-evaluated after the thing it waits on completes
column: proposal
created: 2026-08-20T19:41:31+0200
updated: 2026-08-20T19:41:31+0200
current-owner: hub-session
created-by: architect
task-type: infra
scope: project
min-approval-requirement: manager
release-via: none
npt: []
eht: []
blocked-by: []
impacts: [config-schema]
labels: [kanban-hygiene, trdd-schema, drift-detection]
---

`min-approval-requirement: manager` — it adds a TRDD frontmatter field and a recurring host behaviour: schema +
governance, MANAGER's call. `impacts: [config-schema]` for the new field. `npt`/`eht` deliberately
empty: derived work is filed by whoever owns it *after* approval, not invented here.

**Open question for the approver, not for me:** whether this belongs upstream in the IND base
(`~/.claude/rules/trdd-design-tasks.md`) as a cross-repo janitor proposal, the way `janitor#103`
carried the scope discriminators. It probably does — the defect is a property of the TRDD format, not
of this repo — but that is a second decision, and filing it here first is the cheaper order.

---

## Body

### The defect

A TRDD records what it is waiting for, in prose, once. **Nothing ever re-evaluates that condition.**
The blocker clears in the world; the card never learns. It keeps asserting a gate that is already open,
and every later reader — human or agent — inherits the stale claim as current.

Two mechanisms compound:

1. **The STATE block is append-only.** The newest fact is at the BOTTOM; the first line a reader hits
   is usually the oldest. A reader who stops early gets a superseded fact and cannot tell.
2. **The wait condition is prose.** It can only be re-checked by a reader who happens to think of it,
   in a session that happens to have the context to know it matters.

### Evidence — three instances, one afternoon, all in one lane

Measured 2026-08-20 on branch `governance-rules`:

| card | waited on | cleared | still parked | stall |
|---|---|---|---|---|
| `5CIL7A07` | NPTs `6HEF0XLS` + `X8801GT4` | both `complete` **2026-07-24** (17:12, 21:10) | `design`, STATE still naming them as its gate | **27 days** |
| `U9UNWXMV` | `Emasoft/ai-maestro-janitor#103` shipping | **CLOSED 2026-08-12**; delta live at `~/.claude/rules/trdd-design-tasks.md:131-134` | `design` | **8 days** |
| `1GGQ4HWY` | activation of the OAuth rotator | USER go **2026-07-29**; live beat measured 2026-08-04 | `backburner` | **22 days** |

`5CIL7A07` is the sharpest: it was **created 2026-07-24T14:55**, and both NPTs it names as its gate
completed **that same afternoon**. Its NEXT ACTION was stale within hours of being written, and stayed
stale for four weeks.

Three instances in one lane in one afternoon is not three coincidences. It is consistent with the
INTEGRATOR's independent result that every card waiting on a verifiable ARTIFACT had already cleared.

### The distinction that makes it fixable

`U9UNWXMV` l.109 is the accident worth generalizing. Its wait condition names an **installed file**:

> WAIT for janitor#103 to be co-ratified + shipped in a plugin release
> (`~/.claude/rules/trdd-design-tasks.md` picks up the delta)

That is a **runnable test**: one grep, no credential, any session, any time — which is exactly how it
was caught today. Compare a wait written as *"blocked on the janitor's finalization, happening right
now"* (`OZZB3DJA`, 2026-07-01, still asserting "RIGHT NOW" seven weeks later): nothing can check it but
a human who thinks to ask.

**A wait condition expressed as a test can be re-run. One expressed as prose can only be re-read.**

### Proposal

Add an optional frontmatter field carrying a **machine-checkable** unblock condition, and re-run it on
a cadence. Today **zero** cards carry any such field (verified: no `wait-test:`/`unblock-when:` in the
corpus), so this is purely additive.

```yaml
unblock-when: gh-issue:Emasoft/ai-maestro-janitor#103:closed
unblock-when: trdd:6HEF0XLS:terminal
unblock-when: file-contains:~/.claude/rules/trdd-design-tasks.md:Cross-project scope discriminators
```

**Four constraints, each load-bearing:**

1. **Named probes with fixed arguments — NEVER free-form shell.** A TRDD is a git-tracked file any
   agent can write and a fork PR can propose. A daemon that executes a command string out of one is a
   remote-code-execution vector wearing a hygiene feature's clothes. So `unblock-when:` takes a probe
   *kind* from a closed set — `trdd:<ID>:terminal`, `gh-issue:<owner>/<repo>#<n>:closed`,
   `file-contains:<path>:<literal>`, `path-exists:<path>` — parsed and dispatched to code. Extending
   the vocabulary means adding a probe to the implementation, never writing shell into a card. **This
   constraint is not negotiable; without it the feature is a liability, not an improvement.**
2. **Tri-state, and INCONCLUSIVE is never PASS.** `PASS` (cleared) · `WAIT` (still blocked) ·
   `INCONCLUSIVE` (probe errored, path absent, network down, `gh` unauthenticated — today's 401 world
   is exactly this case). An INCONCLUSIVE that degrades to PASS would falsely announce cleared gates,
   which is worse than the defect being fixed.
3. **Report, never move.** A PASS emits a finding — *"card X's wait condition now passes; it has been
   parked N days"* — and a human or the owning agent decides. **No auto-promotion.** The INTEGRATOR's
   do-not-fix list is the proof: a scripted pass would have reported two half-done epics as delivered.
   The value here is *noticing*, and noticing is cheap; deciding is the part that needs judgement.
4. **Opt-in, not a sweep.** The field is added when a card is parked, and backfilled only by whoever is
   already touching a card for another reason. **This TRDD does not authorize a mass backfill pass.**

**Cadence:** the janitor heartbeat already sweeps this corpus; a PASS is a finding on the existing
findings channel. Probe cost is a grep or one `gh api` call, so a whole-corpus pass is cheap enough to
run on the normal heartbeat rather than a special schedule.

### Acceptance

- [ ] `unblock-when:` is documented in the frontmatter schema with the closed probe vocabulary.
- [ ] A parser that **rejects** any value not matching a known probe kind (fail-closed on unknown).
- [ ] Probes return the tri-state; INCONCLUSIVE is distinguishable from WAIT in the output.
- [ ] A detector runs every card carrying the field and emits a finding on PASS, including days parked.
- [ ] A test proves a card is **never** column-moved by the detector.
- [ ] A test proves a malformed/hostile `unblock-when:` value executes nothing.
- [ ] The three cards above are annotated with their real conditions as the first real users
      (`5CIL7A07` is already dispatched — use `U9UNWXMV`, `1GGQ4HWY`, `OZZB3DJA`).

### What this is NOT

Not a mass re-triage, not a scripted board repair, and not a replacement for reading the STATE block.
It answers exactly one question — *is this card still waiting for what it says it is waiting for?* —
and it answers it by re-running a check instead of trusting a sentence.

## Approval log

