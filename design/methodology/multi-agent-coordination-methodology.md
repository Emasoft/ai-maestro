# Multi-agent coordination methodology — distilled from the 2026-08-08 live experiment

- **status:** authoritative v1.0.0
- **provenance:** one full day of unsupervised fleet coordination (hub + 8 peer plugin sessions +
  3 background worker fan-outs), commissioned by the USER as a deliberate experiment: *"learn what
  works best and what works worse, and write down the optimal methodology."* Every practice below
  is named after a real incident from that day — nothing here is theorized.
- **consumers:** the MANAGER (AMAMA), CHIEF-OF-STAFF, and ORCHESTRATOR role-plugins (improvement
  TRDDs reference this doc by section); any session coordinating other sessions.

---

## 1. The citation convention (the single highest-leverage practice)

**Every factual claim exchanged between agents carries: TYPE + REPO + REACHABILITY +
WHEN-MEASURED, where the timestamp is PASTED from a clock, never composed.**

- *Proved by:* four independent stale-claim incidents in one day, each caught only because the
  convention exposed it — a "local-only" commit that had been pushed six hours after the probe
  (fresh probe, moved fact); a "245 behind" doc that was current (stale ref); an "unpushed skill"
  that had shipped two days earlier (inherited claim); a "partial menu" measured one release ago.
- *The refinement that matters:* WHEN-MEASURED belongs **per ROW, not per report**. A sweep that
  re-reads tips but reuses last week's per-item findings reports at the freshness of its oldest
  input, and nothing in the output says which row is which.
- *The failure it kills:* a claim true when uttered ages into a wrong current fact; two agreeing
  pre-push measurements are still one stale measurement.
- *Corollary:* for per-file questions use the **blob sha**, never the branch tip — the tip moves
  on unrelated commits, so tip-polling records "checked, current" over byte-identical content.

## 2. Corrections both ways, verified both ways

**Never accept a peer's correction on their word; never expect yours accepted on yours. Verify
before conceding, verify before insisting — then concede with proof.**

- *Proved by:* ~10 corrections crossing between hub and peers in one day, every one accepted
  after independent re-measurement, several REFINED in the re-measurement (a "stale probe" that
  was actually a fresh probe whose fact moved; a "TZ skew" that was actually a typed timestamp).
- *The norm that makes it work:* a correction is a gift with a receipt. The receiving agent runs
  the ONE command that would falsify it before replying. Cost: seconds. The alternative —
  relayed error — propagates at fleet scale.
- *The cultural marker:* "checked before sending" / "verified before accepting" appearing in
  message prose. When both sides do it, a wrong claim survives at most one hop.

## 3. The work-order shape

**A work order = a SPEC CARD in the orderer's repo + the peer authors its OWN Tier-0 card in its
own repo + a defined CLOSURE RECORD (release tag + tip sha + pasted timestamps).**

- *Proved by:* TRDD-O16UGID8 (async-approval refresh) and the RP-MODEL-01/RP-SKILL-MENU-01
  rollout — six sessions dispatched in parallel, each self-carding, each closing with a
  verifiable record the orderer re-measures.
- *Why the split:* it keeps every card Tier-0-honest (nobody writes in another project's tree),
  makes authority explicit, and gives the orderer a re-measurable closure instead of a claim.
- *Anti-pattern it replaces:* imperative instructions in chat with no durable spec, closed by
  assertion.
- *Fold-in rule:* when a session already holds an open work order, ADD to it ("fold both into
  the same release") rather than issuing a second — one release beats two.

## 4. Questions outrank confidence

**A peer stating "offered as a question, because I have NOT traced it" found three stacked
defects the repo owner had missed. Ask before building; answer questions with traces.**

- *Proved by:* the COS's wizard question (found a silent no-op + a latent fabrication + the
  rejection they suspected); the ARCHITECT's ruling request (surfaced a Tier-2 decision cleanly);
  AMOA refusing to originate kanban writes on its own reading of a MANAGER ruling.
- *The receiving discipline:* a question about your code is a WORK ITEM — trace it to ground
  before answering, and the answer names file:line, not recollection. "I will not confirm a
  contract from memory" is the correct sentence.

## 5. Refusal names the defect, the bar, and the re-propose path

**A refusal that names no defect authorizes nothing and destroys work downstream. Every "no"
carries: the precise defect, what would make it approvable, and an explicit invitation to
re-propose. Refuse the implementation, never the need.**

- *Proved negatively by history* (a bare denial once caused a peer to delete its own working
  skills); *proved positively today* by the ASSISTANT's option-ruling exchange — three options,
  one ruled with the rejection reasons stated, work continued immediately.
- *The proposer's half:* a refusal with no named defect does NOT authorize stripping dependent
  work; ask before destroying.

## 6. Parallel by default; the orchestrator owns the clock

**Dispatch everything independent simultaneously: background workers for bounded
measurement/extraction, SendMessage work orders for peer-owned changes, inline work only for
what genuinely needs the orchestrator's own judgment. Workers never wait; the orchestrator waits.**

- *Proved by:* the readiness sweep (3 audit workers over 41 files, concurrent), the #140
  verification + #134 contract extraction running while six work orders went out and spec edits
  landed inline. USER's own correction mid-day: "parallelize! otherwise what is the advantage
  of having multiple claudes?" — serialization is the default failure mode of a careful agent.
- *Worker contract:* explicit file scope, the invariant checklist IN the prompt, report to a
  path, 2-line return. Full accounting (every input CITED or CLEAN — a truncated report is
  indistinguishable from a thorough one otherwise).
- *The clock rule:* a spawned worker/runner never polls or sleeps on an external event; the
  orchestrator holds the wait and dispatches bursts whose preconditions are already true.

## 7. Zero findings is a claim to probe, not a result

**Every all-clean report gets one independent falsification attempt before being believed, and
every counting instrument gets a positive control before its zero means anything.**

- *Proved by:* batch B's zero validated by re-grepping the sharpest invariant myself (every hit
  was the protective banner); the DMI probe validated by its own denominator; two broken probes
  caught same-day (a menu probe grepping pathnames; a "64 entries" figure that was a
  prefix-mention count). *State the POPULATION beside every count* — "the ONLY finding" read as
  "the only instance" until a peer widened the glob and found seven more.

## 8. The channel hierarchy, and the fallback that must stay open

**SendMessage for live coordination; GitHub issues as the durable/fallback channel; the card as
the canonical record. When the reverse transport breaks, agents must know issues ARE a valid hub
channel — and the hub must actually poll them.**

- *Proved by:* three sessions independently discovering the hub unreachable by name and
  correctly falling back to issues (#134, #136, #138/#140) — work that would otherwise have
  stalled invisibly. USER's course-correction mid-day: "not all communications are made via
  sendMessage — check the issues."
- *The hub's duty:* `gh issue list` is part of the coordination loop, not an inbox of last
  resort. A request sitting unread in a working channel is indistinguishable to the sender from
  a refusal.

## 9. Never relay an unverified row (the G5 lesson)

**Before publishing any per-item claim in a report, check it against the freshest measurement
YOU hold — especially your own. The worst false negative of the day had the truth sitting in the
reporter's own clone while the ledger repeated an inherited claim.**

- *Generalization:* a sweep's summary must be DERIVED from the sweep's artifacts, never merged
  from memory. If a row wasn't re-measured, it carries its source's timestamp, visibly.

## 10. Guards, gates, and authority

- **A guard you cannot satisfy is a hostage, not discipline** — never arm a check whose only
  satisfying fix is outside your authority; draft it, surface it loudly, arm it the moment the
  blocking authority acts. (COS, on the golden-rule byline.)
- **Guard the class, not today's instance** — parametrize over every agent/file so the NEXT
  author inherits the rule (the no-pin test, the runtime-assembled-needle handle scan with a
  population floor, the menu-vs-shipped-count gate proven by negative control).
- **Authority is re-evaluated per item, never inherited from the conversation** — a hub ruling
  Tier-2 questions under an explicit USER grant still routes golden/USER-tier items upward, and
  peers correctly refuse relayed authority (permission laundering) even mid-collaboration.

## 11. Honest columns and honest completion

**A card's column is a claim someone will act on. `testing` when the round-trip is unverified
("marking it complete would claim a verification nobody performed"), `backburner` with the
promotion trigger written ON the card, `blocked` with `blocked-by:` naming the gate — each
prevented a false green today.** The trigger refinement worth keeping: gate on *"reachable along
MY OWN call path"*, not "dependency deployed" — a server capability is useless to a consumer
whose CLI cannot express it.

## 12. What worked WORSE (the anti-patterns, named)

1. **Serialized draining** of independent work (corrected by the USER mid-day — see §6).
2. **Ledger rows merged from memory** instead of derived from artifacts (§9; two incidents).
3. **Numbers without populations** (§7; three incidents — the same class from three directions).
4. **Typed timestamps** (§1; recurred despite a written lesson — only the pasted-output rule
   holds under pressure).
5. **Applying a superseded criterion to a fresh reading** — re-verified facts filtered through
  an outdated rule look MORE credible, not less ("backticks protect it" was re-argued from a
  doctrine the arguer had personally corrected in the governance doc).
6. **Counting on one channel** — everything sent only via SendMessage was invisible to sessions
  whose reverse transport was broken; everything filed only as issues waited for a poll.
7. **A workaround that avoids a path stops testing it** — two masked defects (DECOUPLE-BLOCKED
   hiding the CLI payload bug; the silent no-op starving the fabrication) surfaced only when the
   avoided path went live. Expect the newly-unblocked path to fail on something nobody has
   looked at since it was marked.

---

## Rollout

The MANAGER, CHIEF-OF-STAFF, and ORCHESTRATOR plugins absorb this doc's practices into their
personas/skills via their own Tier-0 cards against the hub's work orders (tracking card:
`TRDD-<rollout>` in design/tasks/). Sections most relevant per role: MANAGER — §3, §5, §8, §10
(authority) ; COS — §2, §4, §5, §11 (it authored half of them) ; ORCHESTRATOR — §3, §6, §11.
