---
trdd-id: 8Q5EVGV1
title: 141 of 252 headless handlers have no per-handler auth behind a gate that does not validate tokens
column: todo
created: 2026-08-23T00:10:05+0200
updated: 2026-08-23T01:07:13+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-23T00:10:05+0200
---

# 141 of 252 headless handlers have no per-handler auth behind a gate that does not validate tokens

## Problem — 141 of 252 headless handlers rely on a gate that does not validate the token

Measured 2026-08-23 over `services/headless-router.ts`, by enumerating every
`{ method, pattern, handler }` entry and testing each handler's block for ANY of
`authenticateAgent(` / `delegateNextRoute` / `enforceAuth(` / `enforceSystemOwner(` /
`authorize(` / `checkTeamAccess(`:

| | count |
|---|---|
| route handlers total | 252 |
| with per-handler auth | 111 |
| **with none** | **141 (56%)** |

> **⚠ CORRECTED 2026-08-23 — this table reads 2 too FAVOURABLY. The instrument counted a needle
> appearing in a NEIGHBOURING COMMENT as a guard**, and this router explains its own guards in prose
> at length. Re-derived with comment lines stripped: **109 guarded / 143 unguarded at `41cc9983`**
> (the commit that filed this card) and **110 / 142 at `6b40bfc7`**. `GET /api/docker/info` and
> `POST /api/agents/create-from-toml` are the two false positives here; a third,
> `GET /api/settings/element-content`, appeared later when `9534cc0f` added a comment block naming
> `delegateNextRoute` above `mcp-discover` — which is how the class was found. The ledger test
> carries the corrected enumerator and a control that reds if the stripping is removed. **Use 142.**
>
> **Those three names are an IDENTIFICATION, not a subtraction.** They were first derived as an
> arithmetic residue (`143 − 141 = 2`, and a set-diff returned 2 names) — which is consistent with
> the claim AND with a 3-in/1-out miscount netting to the same number, so it was not yet evidence.
> Re-derived per route by printing the MATCHED LINE: `docker/info` matches only at L773/L775,
> `create-from-toml` only at L3647, `element-content` only at L3783/L3785 — every hit a `//` line,
> zero code hits. Counts by that method: **2 at `41cc9983`, 3 at `6b40bfc7`**.
>
> **That re-derivation is NOT independent corroboration, and an earlier draft of this box wrongly
> called it "a different instrument".** The identifier is the ledger's own enumerator with the
> reporting swapped: same start anchor, same entry regex, same next-entry bounding rule, same six
> needles, same comment predicate. Only the AGGREGATION changed (per-route line printing instead of
> a set subtraction), so the two cannot disagree about which routes are comment-only — it is one
> computation printed twice. What it genuinely buys is the step from a NUMBER to the LINES: reading
> `// this: \`delegateNextRoute\` forwards the caller's real credentials` at L773 is direct evidence
> of the mechanism, which the residue could not give. A truly independent check would not share the
> enumerator (strip comments with a different tool first, or parse the array with an AST reader).
>
> **Provenance of that claim, stated because it is now PERMANENTLY unverifiable.** The shared-
> enumerator finding came from a reviewer's reading, and I struck the "different instrument" wording
> on that reading without re-diffing the two scripts myself. It was disclosed as pending for three
> turns; on the fourth I went to check and **both scripts are gone** — they were `/tmp` scratch,
> erased by an intervening session clear. So this cannot be settled later by anyone: it is not
> pending, it is closed as unverifiable. The direction is the safe one (striking an overclaim can
> only under-claim), and the box above now describes what the re-derivation BUYS rather than
> asserting what it proves, so nothing here rests on it. **The lesson is the disclosure pattern
> itself: "unverified, but safe direction" repeated each turn is how a claim becomes permanent
> furniture — it survived three reviews by being acknowledged instead of checked, and by the time I
> reached for the evidence it no longer existed.** Scratch that supports a committed claim belongs
> in `reports_dev/`, not `/tmp`.
>
> **One class is UNMEASURED, and it is bounded:** a trailing `code() // …delegateNextRoute…` would
> be scored a comment by the shared predicate. An earlier grep aimed at this was itself broken (the
> exclusion `^\s+[^/]` backtracks and matches ` //`), so the class is untested, not clean. The
> exposure is one-directional — it can only make a genuinely UNGUARDED route read as guarded, i.e.
> undercount 142. It cannot put a false entry in the ledger, so the ratchet is safe in the direction
> that matters and the count may be slightly optimistic.
>
> Raised by an adversarial review of the commit that published the names, which is the right time
> for a correction box to be audited: a correction that inherits the defect it corrects is the worst
> possible artifact here.

The only thing in front of those 141 is `_headlessHasCredential` (`headless-router.ts:4449`),
and **its own comment states what it is**: *"a STRUCTURAL credential check ONLY … structural, not
semantic (we still don't validate the token itself)"*. It passes on any of:

- a cookie matching `aim_session=[A-Za-z0-9_+/=\-]{20,}`
- an `Authorization: Bearer (aim_tk_|amp_live_sk_|mst_|eyJ)[A-Za-z0-9_\-\.]{24,}`

**No secret is required to construct either.** `Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA` passes.
That is not a hypothesis — `tests/unit/headless-router-auth-mirror.test.ts` uses exactly that
string as its `FORGED_BEARER` and asserts, as its own load-bearing control, that it *"PASSES the
structural gate but is rejected by handler auth"*. For the 141 there is no handler auth to reject
it.

## What is behind the 141

Not a tail of harmless reads. A sample from the enumeration, by line:

- `POST /api/agents/docker/create` (1182), `POST /api/agents/import` (1187) — mint agents
- `POST /api/agents/:id/transfer` (1647)
- `PATCH` / `DELETE /api/agents/:id/metadata` (1752, 1763)
- `DELETE /api/agents/:id/repos` (1570)
- `POST /api/hosts` (1907), `PUT /api/hosts/:id` (1911), `DELETE /api/hosts/:id` (1915),
  `POST /api/hosts/register-peer` (1896), `POST /api/hosts/exchange-peers` (1900)
- `POST /api/organization` (747), `POST /api/agents/directory/sync` (1211)
- `GET /api/agents/:id/chat` (1418), `GET /api/agents/:id/messages` (1723) — conversation content

**Every governance title check is bypassed for these**, because the title is read from a token
nobody verified.

## Severity — bounded, and stated honestly

- **Not internet-exposed.** `server.mjs:100` defaults the bind to `127.0.0.1`. A non-localhost
  `HOSTNAME` **without Tailscale is REFUSED** and falls back to loopback (`server.mjs:1624-1633`);
  with Tailscale it binds `::` behind an IP filter. So the surface is local processes plus
  IP-filtered mesh peers.
- **Not active on this deployment.** `MAESTRO_MODE` is empty here, defaulting to `full`
  (`server.mjs:128`), and the headless router is mounted only under `headless` (`server.mjs:2575`).
- **But `yarn headless` is a documented, supported mode**, and every agent on the host is a local
  process. Under headless, any agent of any title can forge the header and reach all 141 —
  which is precisely the governance model this repo spends its enforcement budget on.

## This is a DESIGN property, not 141 bugs

The 111 guarded handlers got their auth **one at a time**, under separate cards — SVC2-MAJ-01,
SVC2-MAJ-12, SF2, D3RP7KQZ, and (2026-08-22/23) R268J32X. That is the tell: the model is
"structural gate by default, per-handler auth added when someone notices". Patching route 142
does not change the shape.

**It also means a Next-side fix is half a fix by default.** Measured the same night: `conversations/parse`
(full transcript disclosure), `sessions/restore` GET, `install-skills` (TRDD-D3RP7KQZ's own gate),
and all four `plugin-builder/*` handlers each had a guarded Next route and an unguarded twin —
including one whose Next half had been fixed hours earlier in the same session.

## Proposed fix — a RULING, then a mechanical sweep

1. **Rule on the default.** Either the structural gate becomes semantic (validate the token there,
   once, for every handler), or the router adopts delegate-by-default so the Next route's guard is
   the single source. Both are one decision; neither is a per-route patch.
2. **Whichever is chosen, make the DEFAULT safe** — a new handler added tomorrow must inherit the
   guard rather than need one remembered.
3. **A conformance test that FAILS on a new unguarded handler**, seeded with the current 141 as an
   explicit shrinking ledger — the shape already used by
   `tests/unit/agent-route-authorization-coverage.test.ts`. Do NOT ship 141 fresh failures; a wall
   of red is how a linter gets routed around.
4. Only then sweep the ledger by blast radius.

## Verification

- The enumeration is reproducible: parse `{ method: 'VERB', pattern: /^\/api\/…$/` entries, take
  each handler block to its closing `}},`, test for the six guard needles. Re-derive the counts
  rather than trusting the ones above — they have a silent timestamp.
- `_headlessHasCredential` accepts a hand-typed bearer: the existing `FORGED_BEARER` control in
  `headless-router-auth-mirror.test.ts` already proves it.
- Any fix must be checked in BOTH modes; the same-night evidence is that a Next-only fix is the
  default failure.

### The 2 red test files you will see, and why they are NOT this card

`yarn test` reports **2 failed | 458 passed (460 files)** — `6180 passed | 2 skipped` of 6184 tests
— and the two red files are `pillar-grep-cli` and `trdd-doctor`. Measured 2026-08-23T00:55, full
run. **An earlier version of this line said "457 pass / 2 fail", a figure inherited across two
sessions and never re-run.** It differed in BOTH halves — and the cause is not aging, it is
**self-attribution**: since the 2026-08-23T00:20 handoff that recorded 457, **exactly ONE test file
was added and ZERO removed** — `tests/unit/headless-handler-auth-ledger.test.ts`, added by commit
`6b40bfc7` at 00:40:08, **this card's own ledger test, added by this session**. Calling it "stale"
asserted an aging nobody measured; I had moved the number myself.

> **Two instrument errors had to be fixed before that count meant anything, and both produced a
> confident wrong number first.**
> **(i) Wrong baseline date.** The first run used `--since=2026-08-22T00:20` and returned **16**
> added files, which refutes a +1 delta. The handoff header reads **2026-08-23** ~00:20 — an
> off-by-one-day that made the window 24× too wide. Read the baseline's own timestamp; do not
> retype it.
> **(ii) `git ls-files 'tests/**/*.test.ts'` returns 412; the same string in `vitest.config` matches
> ~451.** In a git pathspec `*` CROSSES `/` (so `tests/*.test.ts` → 451, every depth) while `**/`
> requires at least one intermediate directory (→ 412, silently dropping depth-1 files). picomatch,
> which vitest uses, reads `**/` as *zero* or more. **The same glob string means different things to
> git and to the test runner, and git's reading is the counter-intuitive one.** The corrected count
> above was taken with NO pathspec at all, filtering the names afterwards.

Re-run it rather than quoting it — the counts have a silent timestamp, the
failing PAIR is the stable fact. Neither is caused by this card's work, but the story handed down
for them was **WRONG**, and it is written here because a commit message is not searchable by the
next session that sees 2 red.

**The inherited claim was "2 frozen archived-TRDD corpus ERRORs, pre-existing, unfixable."** Two of
its three parts are wrong; **the FROZEN part was right**, and this section relies on it below.
Measured 2026-08-23 (`yarn trdd:doctor`, full output read, not tailed): the corpus has exactly two
ERRORs, and only ONE of them causes the failures.

| ERROR | card | entered the corpus | is it the cause? |
|---|---|---|---|
| `BODY-STATE-CLAIM` | `7123D51A` (`design/archived/`) | 2026-07-10, commit `124b4e26` | **no** — both tests already allow it: `pillar-grep-cli` asserts on it BY NAME as the expected single error, and `trdd-doctor` carries it in a `PERMANENTLY_EXCLUDED_BY_JANITOR_139` set |
| `TERMINAL-WITHOUT-CHECKLIST` | `G6A54OYK` (`design/archived/`) | **file created** 2026-08-22 17:28:07 `b949b912` as `column: backburner` — **not yet an ERROR**. **The ERROR was introduced at 17:30:49 by `b746c558`**, which flipped `column: backburner → completed` AND renamed it into `design/archived/` (R077) | **YES — this alone reds both files** |

> **That cell has been wrong TWICE, in opposite directions, and both are worth keeping.**
> v1 cited `b746c558` and quoted its subject — _"throwaway card **B**"_ — as the origin of a file
> whose slug is card **A**. v2 "corrected" it to `b949b912` and thereby moved the citation OFF the
> commit that actually caused the failure: `TERMINAL-WITHOUT-CHECKLIST` fires on `column: completed`,
> and `git show b949b912` shows the card was born `column: backburner`. **So v1 was wrong about the
> FILE and right about the FAILURE; v2 was the reverse.** Both facts belong in one cell, which is
> what it now carries. A correction that fixes one fact and breaks another is the failure mode this
> whole box exists to warn about, committed inside the box itself.
> **Instrument cause: `git log -- <archived path>` cannot see a commit that touched the PRE-RENAME
> path.** Measured, all four: plain `git log` → 2 commits (misses `b949b912`); `--full-history` →
> **the same 2, it does not help**; `--follow` → **3, it does surface it**; `git show --name-status`
> → the explicit `R077 <tasks path> <archived path>`. Note `git show --stat` ELIDES the path prefix
> (`...ke-of-the-…-798oahmx-a.md`) so pre- and post-rename paths render IDENTICALLY and the rename is
> invisible there. Use `--follow` or `--name-status` when provenance is the question; both are
> verified, and an earlier version of this line recommended `--follow` **without having run it**.

So the suite is designed to be GREEN on the frozen corpus. It fails because a **new, unexcluded**
ERROR appeared **one day ago**: a throwaway card left behind by the TRDD-798OAHMX e2e smoke of the
manage-trdd write verbs. It is `column: completed` with **zero** acceptance boxes, which is exactly
what `TERMINAL-WITHOUT-CHECKLIST` fires on. `pillar-grep-cli`'s own docstring census was last
re-measured 2026-08-21 — the day before the card landed.

> ## ⚠ RETRACTED — "uncleaned test litter" was WRONG, and it was the root of this whole section
>
> Three versions of this section called `G6A54OYK`, `W7B0TC9B` and `8I0JUCK9` *"uncleaned test
> litter (Rule 1 CLEAN-AFTER-YOURSELF, owed by that run)"* and **recommended deleting them**. That
> is false, and a citation sweep of all three — rather than the one card a reviewer happened to name
> — refutes it. **They were retained DELIBERATELY, and the retention is documented in open cards
> filed the same hour:**
>
> - **`G6A54OYK`** — `TRDD-P6MSMQ2I` (*"archive route bypasses the terminal checklist gate"*,
>   `column: todo`, OPEN) says verbatim: *"That card is left in place **deliberately as the live
>   reproduction**; it is terminal and therefore frozen, so it must not be 'repaired' by adding
>   ticked boxes for work nobody did."* **The ERROR reddening both test files IS that bug's
>   evidence.**
> - **`W7B0TC9B`** — cited by `TRDD-MWKCBLQN` (*"create with column proposal mints a card no write
>   verb can act on"*, `column: todo`, OPEN) as the measured artifact for a second bug.
> - **`8I0JUCK9`** — cited at `.claude/rules/lessons-verification.md:558` as the measured control
>   (*"closed via `approve` → exit 0 VERIFIED"*).
>
> **The measured claim, and only it:** two OPEN cards cite these artifacts as their reproductions,
> therefore they are not litter. That is sufficient for the retraction and it is all that was
> checked. **I read "throwaway" in a commit subject and inferred abandonment**, without checking
> whether anything cited them — the same count-is-not-an-identification shape as everything else in
> this box. Deleting them would have destroyed the live reproductions for two OPEN bug cards.
>
> An earlier version of this retraction said the 798OAHMX run *"did the right thing end to end"*.
> **That was the opposite overstatement, from the same evidence class** — a narrative read off commit
> SUBJECTS, never measured. That run's own log contains `676a5030 "retract the verifiable-provenance
> claim"` and `c824039e "record the e2e scope honestly"`, i.e. it made claims it had to retract too.
> Swinging from "uncleaned litter" to the most flattering possible reading, neither measured, is one
> defect wearing two faces.
>
> `P6MSMQ2I` has since been read IN FULL (43 lines), not excerpted: it carries no condition for
> retiring the reproduction. Note one tension it owns, flagged and NOT resolved here — its
> `## Verification` expects `trddgrep validate` **clean afterwards**, while its Problem section says
> the card must never be repaired. Whoever fixes it has to reconcile those.

**Do not "repair" `G6A54OYK`'s body** — it is terminal, hence frozen by IND rule 12. And do not
delete it: it is `P6MSMQ2I`'s reproduction. **The real fix is to fix `P6MSMQ2I`** (make the archive
route enforce the checklist predicate the linter applies); the reproduction can be retired with it.

Until then the two red files need their CENSUS updated to expect a known, deliberate reproduction —
exactly the treatment `7123D51A` already has. **The two options are NOT equivalent**, and an earlier
version of this section wrongly said "both failures clear either way":

- **(a) ~~delete the throwaway litter~~ — RETRACTED, see the box above.** It would clear both files
  and destroy two open bugs' evidence.
- **(b) add `G6A54OYK` to the doctor test's exclusion set** — clears **ONE**. Measured:
  `grep -rn 'PERMANENTLY_EXCLUDED' tests/ scripts/ lib/` returns **3 hits, all in
  `tests/unit/trdd-doctor.test.ts`** (`PERMANENTLY_EXCLUDED_BY_JANITOR_139 = new Set(['7123D51A'])`,
  line 1021). It is a constant inside one test file and has no reach into a SUBPROCESS.
  `pillar-grep-cli` shells out to `trddgrep validate --min-severity error` and asserts on that
  stdout — `toHaveLength(1)` plus `lines[0]` matching `/^ERROR\tBODY-STATE-CLAIM\t7123D51A\t/`. No
  test-local set can change what the subprocess prints, so (b) leaves `pillar-grep-cli` red and
  clearing it separately means editing the census, the length assertion AND the matcher.

The false-equivalence came from reading BOTH mechanisms, then generalizing the exclusion-list
property from the test that has one onto the test that does not — the same one-member-of-a-family
error already recorded in `.claude/rules/lessons-verification.md`, committed two edits after the
reading that refutes it.

**There is no option (d) — the tool cannot suppress.** The evidence is `trddgrep help`, which
ENUMERATES the surface: `validate` takes only `--min-severity` and `--rule`, and both *narrow what is
SHOWN*. That closes the option space regardless of what identifiers exist internally. (I also
grepped six suppression-shaped names I invented — `IGNORED|SUPPRESS|WAIVE|…` — and got nothing.
**That grep is not evidence and is recorded only to be dismissed**: a needle keyed on NAMES I guessed
cannot answer a capability question, which is the blind-at-a-rename failure already in
`.claude/rules/lessons-verification.md`. The help output was sufficient on its own.)

**Recommended: fix `P6MSMQ2I`; until then pin `G6A54OYK` in BOTH tests** — with a comment naming
`P6MSMQ2I` so the pin retires with the bug. This keeps the reproduction, clears the red, and weakens
nothing unknown.

**But the two pins are NOT the same edit, and the `7123D51A` precedent does not transfer.** Measured,
not remembered — `trddgrep validate --min-severity error` currently prints, in this order:

```
ERROR   TERMINAL-WITHOUT-CHECKLIST   G6A54OYK
ERROR   BODY-STATE-CLAIM             7123D51A
```

So `trdd-doctor` is a one-line set addition, while `pillar-grep-cli` needs **three** coordinated
edits — the prose census, `toHaveLength(1)` → `(2)`, and the `lines[0]` matcher, which currently
expects `7123D51A` and would now be handed `G6A54OYK`. Prefer making that assertion ORDER-INDEPENDENT
over hardcoding the observed order; the sort is not part of any documented contract and I did not
establish what governs it.

**Deleting governance cards is NOT authorized here, and is now affirmatively contraindicated.**

## Estimated risk

Fixing is MEDIUM-HIGH blast radius (touches every headless route) and must not be attempted as a
drive-by. Leaving it is LOW today (headless not running here, loopback bind) and HIGH for anyone
who runs `yarn headless` on a host with agents.

## Provenance

Found by enumerating the headless router's whole route table after the per-route sweep of
TRDD-R268J32X kept turning up unguarded twins one at a time. Reading routes individually found six;
enumerating found 141 — the same lesson the plugin-builder subtree taught four hours earlier, at
the scale of the whole file.

## Approval log

- 2026-08-23T00:10:05+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.

## RULING 2026-08-23 — the default, decided on verified facts (implementation NOT started)

Ruled under the USER's standing grant to decide from verified facts. **The two options are not
alternatives — they answer different questions**, and reading them as a choice is what makes this
look like a large decision.

**RULE: make the structural gate SEMANTIC. That is the floor, and it is small.**
`_headlessHasCredential(req, pathname)` already receives everything `authenticateAgent(authHeader,
agentIdHeader, cookieHeader)` needs; the swap is mechanical. It closes the forged-token bypass for
**all 252 handlers at once** rather than one at a time, which is the only property that actually
changes the shape of this problem.

**It is safe because the whitelist already isolates what must stay anonymous.**
`HEADLESS_AUTH_WHITELIST` bypasses the gate entirely and is a short, deliberate list: `auth/login`,
`auth/logout`, `auth/session`, `auth/setup-init`, `auth/setup-verify`, `v1/health`, `v1/info`,
`v1/register`, `v1/auth/challenge` (anonymous AID bootstrap, mirroring `middleware.ts`), and the
statusline ingest — whose own comment explains that Claude Code runs the statusline with no cookie
and no token, and that a route anonymous in full mode and 401 in headless would be "a forked gate,
which is the bug class this whole file's delegation pattern exists to avoid". Every entry is either
the authentication surface itself (which cannot require prior authentication) or carries a written
justification. So a semantic gate breaks exactly one class of caller: **one holding a forged token**.

**DIRECTION (not the fix): delegate-by-default, incrementally.** Delegation removes the TWINS, which
is a different defect from the missing gate — it is why `conversations/parse`, `sessions/restore`,
`install-skills`, four `plugin-builder/*` handlers and `mcp-discover` each drifted from their Next
counterparts. But it is a migration, not a floor: some headless routes have no Next counterpart, and
delegation has real edges (a `params` Promise mismatch broke one delegated route at compile time
this session). Convert opportunistically, whenever a handler is touched.

**WHAT THIS RULING EXPLICITLY DOES NOT BUY — state it, because the number is seductive.**
A semantic gate gives **AUTHENTICATION, not AUTHORIZATION.** After it lands, all 252 handlers know
*who* the caller is; the 141 still perform no title check, no ownership check, no `authorize()`
call. `POST /api/agents/docker/create` would go from "any forged token" to "any authenticated agent
of any title" — a real improvement and NOT the end. The per-route authorization work stays exactly
as scoped in TRDD-R268J32X. Anyone reading "141 fixed" off this ruling has misread it.

**THE COST, named rather than discovered later.** The structural check is a regex; a semantic one
validates a token per request. That cost is likely why it was written structurally. It is already
paid on the 111 guarded handlers, which call `authenticateAgent` themselves — so implementing this
without refactoring those means they validate **twice per request**. The implementer should either
thread the gate's result down to the handlers or accept the duplication deliberately; discovering
it mid-migration is how a performance objection kills a security fix.

**NOT IMPLEMENTED.** The card's own MEDIUM-HIGH blast-radius warning stands, and the resume
directive for this session says to rule it and stop. The ruling exists so the decision is not
re-litigated and the default is not invented under time pressure later.

## Acceptance

- [x] the DEFAULT is ruled: **semantic structural gate as the floor** (closes the forged-token
      bypass for all 252 at once; safe because `HEADLESS_AUTH_WHITELIST` already isolates the
      bootstrap routes), with **delegate-by-default as the incremental DIRECTION** for removing the
      twins. Full reasoning, the named cost, and what the ruling explicitly does NOT buy
      (authorization) are in `## RULING 2026-08-23`
- [ ] whichever is chosen, a NEW handler added afterwards inherits the guard rather than needing
      one remembered
- [x] a conformance test fails on a newly-added unguarded handler, seeded with the current count as
      a shrinking ledger — NOT shipped as 141 fresh failures.
      `tests/unit/headless-handler-auth-ledger.test.ts` (2026-08-23). It enumerates the route table
      from source, names the current unguarded set in `UNGUARDED_LEDGER`, and fails only on an
      ADDITION; a handler that gets guarded must be DELETED from the ledger, so it cannot silently
      stop shrinking. Two neuters, each reddening a different test, are recorded in its header
- [x] the counts are re-derived at fix time rather than taken from this card — **and they MOVED,
      which is why this box exists.** Re-derived 2026-08-23 with comments stripped before matching:
      **252 total / 110 guarded / 142 unguarded** at `6b40bfc7`, and **109/143** at `41cc9983`, the
      commit that filed this card. **The `111 / 141` in `## Problem` above is INFLATED BY 2 comment-
      only false positives** — this router documents its own guards in prose, so an unstripped
      handler body matches every needle aimed at its code. `GET /api/settings/element-content`,
      `GET /api/docker/info` and `POST /api/agents/create-from-toml` each read as guarded off a
      NEIGHBOURING comment; the first only after `9534cc0f` added the `delegateNextRoute` comment
      block above `mcp-discover`, which is what exposed the class. Take 142, not 141, and re-derive
      again at fix time rather than taking 142 from here
- [ ] any route touched is verified in BOTH modes, since the same-night evidence is that a
      Next-only fix is the default failure

## Approval log
