---
name: agent-claims-the-api-was-never-delivered
description: "a capability is reported MISSING (an agent says 'the verbs were never delivered', or an issue asks to build X) — five times now it already existed: absent, unannounced, unauthorized, or BUILT AND SWITCHED OFF. Look before you build."
ocd: 2026-07-14
lmd: 2026-07-14
metadata:
  node_type: memory
  type: project
  tier: component
---

When anyone — a fleet agent, an issue, your own plan — reports that ai-maestro never
shipped a capability, **verify it before writing a line of code.** Five times now the
capability already existed and the real defect was elsewhere:

| Incident | The claim | What was actually true |
|---|---|---|
| janitor + fleet blocked (TRDD-K2WJH7RF, `d7531e53`) | "the TRDD write APIs were promised and never delivered" | All 10 strict routes **existed**. They 403'd every agent with `agent_policy_undefined` because nobody had **decided the agent policy** in `lib/sudo-guard.ts`. A decision was missing, not a guard. |
| MANAGER decoupling blocked (28 `/api/` call sites) | "two CLI verb sets do not exist: user-presence + team-tasks" | `aimaestro-agent.sh presence`, `aimaestro-agent.sh session user-input`, and `aimaestro-teams.sh tasks <id>` all **shipped, deployed byte-identical, and were agent-callable** (routes take `Bearer AID_AUTH`, none is `strict`). **Nobody had told the MANAGER they existed.** |
| governance issue #37 | "add these two rules" | Both **already existed** as R23 and R24. Adding them again would have created two numbers for one rule and broken the property that a citation resolves to exactly one rule. |
| #47 ask 2 — "make approvals verifiable" | (implicitly) the crypto must be built | **The crypto was complete AND WIRED IN, and switched off.** Ed25519 host signing, the R34 ledger anchor, the store, the mint/list/revoke API, **six passing test suites** — and `CreateTeam`/`CreateAgent` *already called* `matchPortfolioToken`. It always returned `ok:true` because **one map was empty** (`OPERATIONS_REQUIRING_TOKEN = {}`). What was missing was a **verification surface** (no endpoint, no CLI — `grep -rln portfolio scripts/` → nothing) and a **decision**. |

**The fourth row is the one to internalize**, because it is the hardest to see: the code was
not absent, not unannounced, not unauthorized — it was **built, tested, wired into its call
sites, and inert**, because a config that turns it on was never *decided*. A feature can be
100% implemented and 0% reachable. `grep` for the *type* and the *call site*, not just the
verb name — and when you find the call site, check whether the switch beside it is on.

## The triage, in order

1. **Does the verb exist in the repo?** `grep -n '<verb>)' scripts/*.sh` — the frozen
   surface is `docs/SCRIPT-MANIFEST.md`, generated from `scripts/*.sh`, never from a host's
   `~/.local/bin`.
2. **Is the deployed copy stale?** `diff -q scripts/<f>.sh ~/.local/bin/<f>.sh`. The
   installer copies and never prunes, so a bin dir carries scripts the source already
   deleted — and can equally lag one that was added.
3. **Does the route exist, and is it agent-callable?** Read its auth comment (`session
   cookie OR Bearer AID_AUTH`) and check `security-registry.json` — a route absent from it
   is not `strict`, so a plain AID bearer suffices with no sudo token.
4. **If it exists and 403s:** the gap is a *policy decision* in `lib/sudo-guard.ts`, not a
   missing endpoint. See [[strict-route-agent-policy]].
5. **Only then** conclude something must be built.

**Why:** an agent cannot see the server repo. Its evidence is its own `~/.local/bin` and a
401/403 — neither of which distinguishes "absent" from "present but unauthorized" from
"present but unannounced". Its report is honest and its inference is unfalsifiable *from
where it stands*. Ours is not.

**How to apply:** treat "the API is missing" as a **symptom**, never a diagnosis. And close
the loop the other way too: a shipped capability nobody was told about is not a capability
(`SCRIPT-MANIFEST.md` §5.3 — `aimaestro-session.sh`, `-panel.sh`, `-trdd.sh` shipped with
zero plugin references). Announce the verb, or it does not exist.

A contributing cause, now fixed (`d6b802fd`): `check_api_running()` reported **every**
non-200 as *"AI Maestro is not running — start the server"*. On a 401 that is a false
diagnosis that makes a present-but-unauthorized verb look absent.

## The consumer's half — a STALE BLOCKER is worse than an open bug

The producer's duty is R23.8 (*announcing a verb is part of shipping it*). The **consumer's**
duty is the mirror of it, and the MANAGER stated it better than I did:

> *"I sat on a `DECOUPLE-BLOCKED` marker for weeks and never re-checked it. The marker was
> true when written and became false without anyone noticing. **A stale blocker is worse
> than an open bug — a bug gets triaged, a blocker gets respected.**"*

**Re-verify a blocker before you cite it.** A blocker is a claim with a timestamp, and the
world moves under it. It decays silently, because nobody re-runs a test they already
"know" the answer to.

**And do not conflate two senses in one marker.** `DECOUPLE-BLOCKED` was used for both:

| Sense | Example | Decays? |
|---|---|---|
| *waiting on the other side to ship something* | "no `presence` verb yet" | **yes** — and it did |
| *deliberately impossible, by design* | "no `set-governance-password` agent verb (R32: it is a USER/UI action)" | **never** |

The first must be re-checked; the second must never be "unblocked" by a future session
trying to be helpful. Same marker, opposite meanings — so state the design intent in prose
rather than tagging it with a marker that invites removal.

## Notes and lessons learned

[^1]: [ocd:2026-07-14 lmd:2026-07-14] The first instinct on both incidents was to go build
  the missing API — and on the janitor one, several turns were burned hunting through logs
  and AMP inboxes for a spec that never existed. The cheap check (does the route already
  exist? does the verb already exist?) costs one grep and would have short-circuited both.
  Lesson: when a downstream consumer reports an absence, the first move is to look, not to
  build.

[^2]: [ocd:2026-07-14 lmd:2026-07-14] A **third** trap, distinct from both halves above:
  *asserted* identity is not *proven* identity. `#46` resolves "which agent am I?" from the
  session's own environment — sufficient for self-identification, and NOT sufficient for
  "grant this capability to the janitor and to nobody else", which needs an identity a
  SERVER can verify. The two bars are different and the fleet will conflate them the moment
  one of them turns green. Never let "X is unblocked" be read as "X is trustworthy".
  (This footnote also used to say R41's **authentication** was "still convention — the
  Approval-log line is forgeable". That half is now FALSE; see [^3].)

[^3]: [ocd:2026-07-14 lmd:2026-07-14] **CORRECTION.** [^2] and the R41 implementation note
  both said the approval *signature* was unenforceable and needed, in sequence: mandate
  tokens → a `verify` verb → the per-agent identity of #46. That sequence was wrong in its
  premise — **the tokens already existed** (row 4 of the table), so only the *surface* and a
  *decision* were missing, and #46 was never a prerequisite at all: the token is signed by
  the **HOST**, not by the issuing agent, precisely so it does not depend on per-agent keys.
  Approving now mints a host-signed, ledger-anchored token pinned to the card
  (`1e0cbad4`), and `aimaestro-trdd.sh verify` exits non-zero on a forged approval.
  **WHY it was wrong:** I reasoned about what *would be needed* to build the feature instead
  of checking what was *already there* — the same error as rows 1–4, committed while writing
  the very rule that warns about it. A blocker written from a plausible mental model outlives
  the model, and this one would have sent the next session off to build a signing layer that
  was sitting in `lib/portfolio-sign.ts`.
  Lesson: **before writing "X needs A, B, C first", grep for A, B, and C.** And when you
  correct a stale blocker, correct it *everywhere it was asserted* — this one was in a
  memory footnote AND in `GOVERNANCE-RULES.md`, and fixing only the doc would have left the
  memory quietly re-teaching the error.
