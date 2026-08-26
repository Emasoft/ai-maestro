---
trdd-id: R268J32X
title: The route-authorization guard cannot see 17 mutating unauthorized routes outside app/api/agents
column: todo
created: 2026-08-22T22:38:35+0200
updated: 2026-08-26T13:40:00+0200
current-owner: user
created-by: user
task-type: security
implementation-commits: [a2e1f2d0]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:38:35+0200
---

# The route-authorization guard cannot see 17 mutating unauthorized routes outside app/api/agents

## Problem — the same "scan root too narrow" finding, one level up

TRDD-CAVCTULL found that `tests/unit/agent-route-authorization-coverage.test.ts` walked
`app/api/agents/[id]/` only, so the whole COLLECTION subtree had never been under any guard. It
was widened to cover both. **`app/api/` outside `agents/` is still not covered by anything.**

Measured 2026-08-22 across all of `app/api/**/route.ts`:

| | count |
|---|---|
| routes calling `enforceAuth` | 44 |
| of those, with a MUTATING verb (POST/PATCH/PUT/DELETE) | **33** |
| of those, with NO `authorize(` / `requireSudoToken(` / `canIssue(` | **26** |
| of those 26, INSIDE `agents/` (the guard's root) | 9 |
| of those 26, **OUTSIDE it — invisible to every guard** | **17** |

The 17: `conversations/parse`, `export/jobs/[jobId]`, `groups/[id]` · `groups/[id]/notify` ·
`groups/[id]/subscribe` · `groups/[id]/unsubscribe` · `groups`, `plugin-builder/build`,
`plugin-builder/scan-repo`, `sessions/[id]/rename`, `sessions/activity/update`,
`sessions/create`, `sessions/restore`, `settings/global-elements/convert-skill`,
`settings/mcp-discover`, `v1/mesh/chat`, and one more.

## This card does NOT claim 26 holes — and that distinction is the point

`enforceAuth` encodes a REAL policy. Its docstring: *"Handy for mutations where authorization is
uniform — e.g. 'any authenticated caller can call this'."* For several of these that is plainly
right (`sessions/activity/update` is an agent reporting its OWN activity; `conversations/parse`
may be read-shaped). The claim is narrower and harder to dismiss:

**Every use of `enforceAuth` on a mutating route is an unchecked ASSERTION that "any
authenticated caller" is the intended policy, and for 17 of them no guard can even see the
assertion being made.**

TRDD-DQVPODKW measured what that costs: of the first four such assertions examined in one
subtree, **three were wrong** — `create-persona`, `create-from-toml` and `docker/create` mint
agents and were reachable by any authenticated agent of any title, which is exactly what
TRDD-F1SL03CK had just closed on `POST /api/agents`. A 3-in-4 error rate on a sample is not proof
about the other 17, but it is the reason not to assume them fine.

## Proposed fix — the ledger shape, not a sweep

1. Widen the guard's scan root to **all of `app/api/`**, as a THIRD parallel block (the
   `agents/[id]` ledger is provably empty and the `agents/` collection ledger is shrinking; do not
   fold a new debt pile into either — that destroys both signals).
2. Seed the 17 as a debt ledger so the suite is green on day one. **Do NOT ship 17 fresh failures**
   — a wall of red is how a linter gets routed around, which is this guard's own stated reasoning.
3. Prove it fires: seed an unauthorized mutating route OUTSIDE `agents/` and confirm the suite
   goes red and NAMES it. A widened root that still matches nothing is indistinguishable from a
   clean tree.
4. Positive control on the count, so a mis-joined path cannot report clean by scanning nothing.
5. Decide the 17 one at a time, each real one getting its own card.

## Verification

- The walker reaches every `app/api/**/route.ts`, asserted by a floor derived from a real count
  (not a number copied from this card — re-derive it, this one has a silent timestamp).
- Seeding an unauthorized mutating route outside `agents/` reds the suite and names the file.
- The three ledgers stay SEPARATE and each may only shrink without a deliberate edit.

## Estimated risk

LOW to add (test-only). The risk lives in the 17 undecided routes, which this card makes visible
and does not change. Severity per route is unknown until decided — `sessions/create` and
`plugin-builder/build` look worth reading first, on blast radius alone.

## Provenance

Found while working TRDD-DQVPODKW's last acceptance box ("audit `enforceAuth`'s callers outside
this subtree"). Numbers measured by walking `app/api` and testing each file for a mutating verb, a
non-comment `enforceAuth(` call, and the absence of a strong authorization needle. **Re-derive
before acting** — a count in a card is a measurement taken once.

## LANDED — 2026-08-22T22:48:21+0200 — and the POPULATION nearly went wrong

Third parallel block in `tests/unit/agent-route-authorization-coverage.test.ts`. 10/10.

**The card's "17" was right, and I nearly built the guard on the wrong number.** Re-derived on
pickup (a count in a card has a silent timestamp), outside `agents/`: **122 mutating routes, 73 of
them with no `authorize`/`requireSudoToken`/`canIssue`/`enforceSystemOwner`.** Seeding 73 would
have been indefensible — that set contains `auth/login`, `auth/logout`, `v1/auth/token`,
`v1/auth/challenge`: **the authentication surface itself, which cannot require prior authorization
by definition.** A 73-entry ledger is exactly the "wall of warnings is how a linter gets routed
around" failure this file's own collection block warns about.

Both numbers are correct about DIFFERENT populations, and the narrower one is the one the card's
argument actually supports: a route calling `enforceAuth` has CHOSEN authentication-only, and that
choice is an unchecked ASSERTION. That set is **17**, reproduces exactly, and contains nothing
correct-by-construction.

**PROVEN TO FIRE**, because a widened root that still matches nothing is indistinguishable from a
clean tree: seeding `app/api/zz-probe-authn-only/route.ts` reddens the suite and NAMES the route;
moving the probe to `scripts_dev/probes/` (moved, not deleted — RULE 0) returns it to green.

**My first walker control was wrong and its failure was the useful part.** I asserted no scanned
file contains `/agents/`, and five legitimately do — `v1/agents/route.ts`,
`v1/agents/me/route.ts`, `v1/agents/resolve/[address]/route.ts` and two under
`sessions-browser/agents/[id]/`. They are NOT under `app/api/agents/` and do belong to this root.
A substring check calls those a bleed and reds a correct walker. Now asserts the PRECISE property
(path prefix), which is what "bleed" actually means.

## ⚠ THE PER-ROUTE SWEEP FOUND A SYSTEMIC ONE — see TRDD-8Q5EVGV1

Working this ledger route-by-route kept turning up the same shape: a guarded Next route beside an
UNGUARDED headless twin. Six of them, one at a time — `conversations/parse` (full transcript
disclosure), `sessions/restore` GET, `install-skills` (bypassing TRDD-D3RP7KQZ's own gate), and all
four `plugin-builder/*`, one of which had had its Next half fixed hours earlier the same session.

Enumerating the whole router instead of reading it route by route gave the real number:
**141 of 252 handlers (56%) have no per-handler auth at all**, sitting behind
`_headlessHasCredential`, whose own comment says it is *"a STRUCTURAL credential check ONLY …
we still don't validate the token itself"* — a hand-typable `Bearer aim_tk_AAAA…` passes it, which
the auth-mirror test already proves as its own control.

**That is a design property, not 141 bugs**, and it means every per-route fix in this card is
patching one instance of a 141-route surface. Filed as **TRDD-8Q5EVGV1** with the measurement, the
bounded severity (loopback bind by default; headless not running here) and the proposal that the
DEFAULT be ruled rather than the routes patched.

This ledger stays valid and useful — it governs the Next-side surface and it is what surfaced the
pattern — but it should be read alongside 8Q5EVGV1 rather than as the whole picture.

## Decisions — the 17, one at a time

### `help/agent` — 2026-08-26: read, NARROWED to one open question, NOT decided

Read first from my own triage list because it looked ungated. It is not ungated — both mutating
methods authenticate — but it IS genuinely forward-only, which is the tier's real subject.

- **POST**: `authenticateFromRequest` → 401, then `createAssistantAgent()`. Authn-only, and the
  target is the **fixed singleton `_aim-assistant`** — no caller-supplied name. "Create or return
  existing", so a second call is a no-op rather than a resource multiplier. Low stakes on its own.
- **DELETE**: `authenticateFromRequest` → 401, then `getAgentByName('_aim-assistant')` — again a
  **hard-coded name, not caller input** — and `DeleteAgent(assistant.id, { authContext:
  buildAuthContext(auth) })`.

**So the authorization decision is DELEGATED, and that is the whole question this tier asks.** The
route hands a verified identity to `DeleteAgent` and lets the pipeline decide. That is the correct
shape *if and only if* `DeleteAgent` actually refuses a non-owner `authContext`.

**THE ONE OPEN CHECK:** does `DeleteAgent`'s gate sequence refuse an agent-principal `authContext`
attempting to delete `_aim-assistant`? Read the gate that consumes `authContext` in
`services/element-management-service.ts::DeleteAgent`. If it refuses → this route is CLEAR and is
a model of correct forwarding. If it does not → the hole is in the PIPELINE, not here, and the
card belongs against `DeleteAgent` rather than against this route.

**Not chased now, deliberately:** that is a multi-file read of a gated all-in-one pipeline, and the
session is far past its compaction budget. Recording the narrowed question beats a rushed verdict —
and note the blast radius is bounded either way, because the target is a fixed singleton and not an
arbitrary agent id.

### `governance/user` — DECIDED 2026-08-26: FALSE POSITIVE (same shape as `auth/sudo-password`)

`authenticateFromRequest` → 401; `buildAuthContext` → `if (!ctx.isSystemOwner)` → **403 "only the
system owner can edit the local user profile"** (`:23-24`). Refuses every agent. Same
property-read gate, same needle gap described below.

### TRIAGE of the 8 still-undecided forward-only routes (2026-08-26) — NOT verdicts

Classified by shape so the next session has a sorted queue. **Every row still needs READING** —
this card's own history is why: a needle over `isSystemOwner` was 50 % wrong, and
`auth/sudo-password` + `governance/user` (refusals) vs `trdd/create` (a RANK) are the same token
meaning opposite things. Treat the table as ordering, never as an answer.

| route | `!isSystemOwner` refusal | owner compare | `enforceAuth` | read priority |
|---|---|---|---|---|
| `help/agent` | 0 | 0 | 0 (but DOES `authenticateFromRequest`) | **READ — narrowed to one question, see below** |
| `messages/forward` | 0 | 0 | **0** | **2 — forwards messages, no local gate** |
| `teams/[id]/kanban-config` | 0 | 0 | **0** | **3** |
| `teams/[id]/tasks` | 0 | 0 | **0** | **4** |
| `groups` · `groups/[id]` · `groups/[id]/notify` · `groups/[id]/subscribe` · `groups/[id]/unsubscribe` | 0 | 0 | 1-2 | 5 (authenticated at least) |

The top four call **nothing** locally — they authenticate nowhere and rely entirely on the
receiving service. That is precisely the theory TRDD-CAVCTULL found held for 11 routes and failed
for 1, so it is where a real hole is most likely.

> **INSTRUMENT NOTE, third glob failure of the session.** The first run of this classification
> emitted **4 rows for 10 inputs** — the shell expanded `[id]` as a CHARACTER CLASS, so every
> `teams/[id]/…` and `groups/[id]/…` path silently matched nothing and its row vanished. Only the
> row-count mismatch exposed it. Re-run under `set -f` with an explicit `[ ! -f ] && MISSING FILE`
> branch, so a path that does not resolve announces itself instead of disappearing.

### `auth/sudo-password` — DECIDED 2026-08-26: FALSE POSITIVE, and it exposes a NEEDLE GAP

Read first because it is the highest-stakes name in the forward-only tier and calls no
`enforceAuth`. It is not debt: it authenticates AND refuses.

```ts
const authResult = authenticateFromRequest(request)      // → 401 on error
const ctx = buildAuthContext(authResult)
if (!ctx.isSystemOwner) {                                 // R32.2 HARD GATE
  return NextResponse.json({ error: 'sudo_user_only', … }, { status: 403 })
}
```

Every authenticated AGENT is refused 403; only the operator can mint a sudo token. Its own comment
records that this CLOSED a prior violation where the route minted for `(ctx.agentId ?? 'unknown')`.

**THE NEEDLE GAP — this generalises past this route.** `STRONG_AUTHZ` matches
`enforceSystemOwner(` (a call) but NOT `ctx.isSystemOwner` (a property read). So a route that
refuses via the PROPERTY is invisible to the needle and lands in the debt tier no matter how hard
it gates. That is the third false positive in this tier, and the ledger's own note already warned
the mirror case: `trdd/create` uses `isSystemOwner` to compute an authority RANK, not to refuse.
**So `isSystemOwner` cannot be added to `STRONG_AUTHZ` — it is genuinely ambiguous, and a needle
that moves routes OUT of a debt ledger is worse than none when it is wrong.** The correct
disposition is what the card already does: read each one and record the verdict. Recording the
GAP here so the next reader does not attempt the tempting regex fix.

### The FORWARD-ONLY tier, enumerated 2026-08-26 — it was only ever a COUNT

`NON_AGENTS_FORWARD_ONLY_COUNT = 15` is stored as a bare number, so nobody could see WHICH 15
without re-deriving them. Derived here with the test's OWN predicate
(`MUTATING && !STRONG_AUTHZ && FORWARDS_CONTEXT` — note it does **not** require
`CALLS_ENFORCE_AUTH`) and it reproduces 15 exactly:

| route (rel. `app/api/`) | calls `enforceAuth`? | status |
|---|---|---|
| `auth/sudo-password` | NO | **DECIDED — FALSE positive** (`!ctx.isSystemOwner` → 403) |
| `governance/user` | NO | **DECIDED — FALSE positive** (`!ctx.isSystemOwner` → 403) |
| `groups/[id]` · `groups/[id]/notify` · `groups/[id]/subscribe` · `groups/[id]/unsubscribe` · `groups` | yes | undecided (5) |
| `help/agent` | NO | undecided |
| `messages/forward` | NO | undecided |
| `messages` | NO | **already read — FALSE positive** (uses `auth.agentId` to OVERRIDE a client param) |
| `sessions/create` | yes | **already DECIDED clear** |
| `teams/[id]/batch-create-agents` | NO | **already DECIDED clear** |
| `teams/[id]/kanban-config` | NO | undecided |
| `teams/[id]/tasks` | NO | undecided |
| `trdd/create` | NO | **already read — FALSE positive** (uses `isSystemOwner` for an authority RANK) |

So **8 genuinely undecided** (`auth/sudo-password` and `governance/user` both decided below), not 15. Two are known false positives and two are decided clear.

**The `NO-enforceAuth` column is new information and is where I would start.** A route that forwards
an auth context WITHOUT calling `enforceAuth` is relying entirely on the receiving service to
refuse — which is the exact theory TRDD-CAVCTULL found held for 11 routes and failed for 1.
`auth/sudo-password` and `governance/user` are the two whose names suggest the highest stakes.

**MY FIRST DERIVATION WAS WRONG AND SAID 6.** I added `CALLS_ENFORCE_AUTH` to the filter because
the sibling ledger uses it — i.e. I derived from my idea of the predicate instead of from the
code's. The 6-vs-15 mismatch is what exposed it; had I re-derived a number that happened to match,
the wrong filter would have shipped silently. Re-run the derivation from the test file's own
constants, never from the neighbouring block's.

### `vpn-chat/block` — DECIDED 2026-08-26: a REAL but MODERATE finding; recorded here, NOT filed yet

The route's hygiene is fine — all three methods call `enforceAuth` first, and the body is a
`.strict()` zod schema with a bounded `userId`. The finding is the RESOURCE, not the route.

`lib/vpn-chat-log.ts` — `getBlocklist(stateDir?)`, `addBlock(userId, stateDir?)`,
`removeBlock(userId, stateDir?)` — takes **no principal**. There is ONE host-level blocklist, so
**any authenticated agent can mutate the whole host's list**, and the dangerous direction is
`DELETE`: an agent can **silently UNBLOCK** someone the operator blocked. The file header notes
*"the blocked user is never notified"*; by the same design the OPERATOR is not notified of an
unblock either, so a protective control can be removed with no signal.

Unlike `export/jobs/[jobId]`'s DELETE, there is no owner field to compare against — a blocklist is
host policy, not per-agent state. So the fix shape is not an ownership check but a PRINCIPAL
question: blocking is a human moderation act, which argues `enforceSystemOwner` for POST/DELETE
while leaving GET readable. That is a ruling.

**NOT filed as its own card yet, deliberately, and this is triage rather than deferral — the
evidence above is complete.** Three p0 security cards from this same ledger pass are already
waiting on the owner (TRDD-NWTTU0AQ arbitrary command execution, TRDD-RC33OAFQ cross-agent
transcript read, TRDD-MFTDMSJY), and this one is materially less severe than any of them. Handing
over a fourth in the same batch buys nothing. **File it the moment those clear, or immediately if
the owner would rather rule on all four at once.**

### `v1/mesh/chat` — DECIDED 2026-08-26: authn-only is CORRECT on BOTH methods (CLEAR)

**POST is the pattern done RIGHT, and is worth citing as the reference for the rest of this
ledger.** It does not merely authenticate — it *derives* the sender from the authenticated
identity and refuses any body that claims otherwise: `getAgent(auth.agentId)` → 401 if absent;
`senderName !== agent.name` → **403 `sender_mismatch`**; `!isSelf(senderHostId)` → rejected
(cross-host needs Ed25519 attestation, not yet wired). That is exactly the "uses `auth.agentId` to
OVERRIDE a claimed field" shape this card's own note says makes an entry a FALSE positive.

**GET is a shared broadcast log, so there is no partition to enforce.** `getMessages(limit,
before)` takes no principal, and the file has no recipient / DM / private concept at all — mesh
chat is one room every participant sees by design. Authn-only is the correct posture for reading
it; an ownership check would have nothing to check against.

### `settings/mcp-discover` — DECIDED 2026-08-26: a CRITICAL hole, filed as TRDD-NWTTU0AQ

Two input modes; only one is contained. **`configPath` is fine** (resolve → realpath → must be
under `~/.claude/plugins/`, else 403). **`serverConfig` is an arbitrary caller-supplied object**
written straight into a tmp `.mcp.json` — `shellSafe()` is applied to `serverName`, `format`,
`method`, `toolName` and every `toolArg`, and NEVER to `serverConfig`. An MCP config names a
command to spawn, and the script spawns it: `scripts_dev/mcp_discovery.py:148-165`,
`popen_kwargs = {"args": command, …}` → `subprocess.Popen(**popen_kwargs)` (read first-hand).

So this is **arbitrary command execution by any authenticated agent**, not a disclosure. Filed as
**TRDD-NWTTU0AQ** (`min-approval-requirement: manager`).

**The route's own header is not a defence** — *"agents legitimately need this for the
mcp-discovery skill"* is sound for the `configPath` branch (discovering a plugin the operator
already installed) and does not extend to letting the caller DEFINE the server. It is evidence the
second branch was never considered under that ruling.

**One honest mitigating fact, stated so it is not mistaken for a control:** `scripts_dev/` is
gitignored (`.gitignore:123`), so on a clean deploy the script is absent and the route 500s at its
own `existsSync`. It is present on THIS host. Packaging luck, not a boundary.

### `plugin-builder/scan-repo` — DECIDED 2026-08-26: authn-only is CORRECT (CLEAR)

Read because its SIBLING was the one raise on this ledger: `settings/global-elements/convert-skill`
let any authenticated agent name a GitHub URL the server downloaded and wrote under `$HOME` via
`scope:'user'`. So the question was whether `scan-repo` shares that shape. **It does not**, and the
discriminator is where the fetched repo LANDS:

`services/plugin-builder-service.ts::scanRepo` — `fs.mkdtemp(path.join(os.tmpdir(), …))` per call,
`git clone --depth 1 --branch <ref> -- <url> <scanDir>` (argv array, no shell; `--` guards the ref
against flag injection), a 30 s timeout, and `fs.rm(scanDir, {recursive, force})` in a `finally`.
Ephemeral tmp, cleaned up, **nothing installed and nothing written under `$HOME`** — materially
unlike `convert-skill`, and the same reasoning that already cleared `plugin-builder/build`.

The route itself is also in order: `enforceAuth` FIRST, then `validateExternalUrl` (rejects
non-HTTPS, localhost and private IPs — SSRF closed), then type checks on `url` and `ref`.

**Kept in the ledger rather than removed**, per this card's own convention: a decided-correct entry
still needs to stop the assertion changing unnoticed.

### `export/jobs/[jobId]` — 2026-08-26: TWO findings, and the first is NOT an authz question

**FINDING 1 — the GET has NO AUTH AT ALL.** Read in full: `DELETE` calls `enforceAuth` (with the
comment `#114: Authenticate before any side effect`) and **`GET` calls nothing**. So this entry is
mis-classified in `NON_AGENTS_AUTHN_ONLY`: on the read path it is not authn-only, it is
*unauthenticated*. The needle keys on the FILE, and one file here carries two methods with two
different postures — worth noting as a limit of the ledger's granularity, not just of this route.

What leaks: `getExportJobStatus` returns the full `ExportJob` — `agentId`, `agentName`,
`sessionId`, and **`filePath`** (the on-disk path of the completed export). So an unauthenticated
caller who can guess or enumerate a job id learns which agents exist, what they exported, and
where the artifact sits on disk.

**This class already has a precedent ON THIS CARD and it was FIXED, not filed:** `sessions/restore`
GET was "unauthenticated in BOTH modes", closed by commit `d6f78e2b`. Same disposition applies —
add `enforceAuth` to the GET. It is a one-liner, but NOT a compaction-boundary one-liner: it needs
the headless twin checked (a `grep -n "export/jobs" services/headless-router.ts` returned NOTHING,
so this route may have no twin — CONFIRM before assuming, because a Next-side-only fix is half a
fix wherever a twin exists, per TRDD-8Q5EVGV1), a test, a neuter, and the ledger updated in the
same commit.

**FINDING 2 — the DELETE is authn-only with NO OWNERSHIP CHECK.** Any authenticated agent can
cancel or delete ANY export job by id; `deleteExportJob(jobId)` takes the id alone and the route
never compares the job's `agentId` to the caller. That is the `sessions/[id]/rename` shape
(→ TRDD-OYNUJRSB): the correct policy is a ruling, not a one-liner.

**NOT DECIDED — deliberately.** Both findings are recorded with the evidence rather than fixed,
because the remaining context budget was not enough to land a security change with its twin check,
test, neuter and ledger edit — and a half-landed guard is worse than a recorded one. Next session:
finding 1 first (precedented, cheap), then finding 2 as its own card if the ruling goes that way.

### `conversations/parse` — DECIDED 2026-08-26: a REAL HOLE, filed as TRDD-RC33OAFQ

**Settled by the one check this entry named.** `enforceAuth` → `authenticateFromRequest`
(`lib/route-auth.ts`) → `authenticateAgent(Authorization, X-Agent-Id, Cookie)`
(`lib/agent-auth.ts:250`), whose success value is `{ agentId }` — so an **AGENT token satisfies
this route**. That is the agent-admitting branch: agent A can read agent B's full transcript.
Scale measured: **99 project dirs / 1841 `.jsonl`** under the allowlist root.

Filed as **TRDD-RC33OAFQ** (`min-approval-requirement: manager`) rather than patched, on the same
grounds as `sessions/[id]/rename` → TRDD-OYNUJRSB: the correct policy (operator-only vs
own-transcript-only) is a ruling, and choosing it needs an enumeration of the route's callers
across the plugin repos that has not been done. **The ledger entry stays** until that lands.

**For whoever fixes it:** raising this route's guard CHANGES `NON_AGENTS_AUTHN_ONLY` in
`tests/unit/agent-route-authorization-coverage.test.ts`. Shrink the ledger in the SAME commit —
this card's own acceptance box records a 30-minute red suite from exactly that oversight.

<details><summary>The original IN-PROGRESS note, kept — its framing named the check that settled it</summary>

### `conversations/parse` — IN PROGRESS, NOT decided (2026-08-26)

Read the route in full; recording where the question actually sits rather than closing it, because
the remaining budget was not enough to settle it and a half-read security verdict is worse than an
open one.

**What is already correct, and is NOT the question:** path traversal is properly closed —
`enforceAuth` first, a NUL check, `path.resolve` BEFORE the prefix compare (the safe direction),
an allowlist root of `~/.claude/projects`, `resolved !== allowedRoot && !resolved.startsWith(root
+ path.sep)`, and a `.jsonl` suffix requirement. API2-MAJ-14 did that job. Nothing to fix there.

**The actual question is DISCLOSURE, not traversal.** The route reads ANY conversation transcript
under `~/.claude/projects/` — i.e. any agent's full session history — and it is gated by
authentication ALONE. So the decision turns entirely on one thing:

> **Does `enforceAuth` admit an AGENT token, or only the human operator?**

- If human-only: authn-only is CORRECT. The dashboard legitimately shows the operator any agent's
  conversation, and there is no cross-tenant boundary to cross.
- If it admits an agent token: agent A can read agent B's ENTIRE transcript. That is a materially
  worse disclosure than anything else on this ledger — a transcript carries whatever the agent
  saw, including credentials pasted into logs (this session established that pm2 log lines have
  already been quoted into public issues, so "transcripts contain secrets" is not hypothetical
  here).

**THE ONE CHECK that settles it** — read `enforceAuth` in `lib/route-auth.ts` and determine which
principals it accepts; if it accepts an agent, this is a real hole and gets its own card (the same
disposition `sessions/[id]/rename` got as TRDD-OYNUJRSB, because the correct policy is a ruling and
not a one-liner). Do NOT decide it from the route file — the route only calls the helper.

</details>


Three decided 2026-08-22 — the two blast-radius picks this card named, plus the highest-risk name
the new forward-only tier exposed. **All three CLEAR.** Recording the reasoning, not just the
verdict, because "we looked and it was fine" is the finding that otherwise gets re-litigated by
the next reader.

**`sessions/create` — CLEAR. Forward-and-authorize, not authentication-only.** The route runs
`enforceAuth`, then ALSO `authenticateFromRequest` + `buildAuthContext`, and plumbs the context
into `createSession` under a comment tagged `SVC2-MAJ-01 (2026-05-06)`. The receiving end
authorizes on it — `services/sessions-service.ts:808` short-circuits a system owner and `:815`
calls `authorize(authResult, 'create-session', agentId)`, returning 403 on denial. **The ledger
mislabelled it**: this third root's needle is `MUTATING && CALLS_ENFORCE_AUTH && !STRONG_AUTHZ`,
and STRONG_AUTHZ is looked for IN THE ROUTE FILE, so a route that forwards to a service that
authorizes reads as authentication-only. The `agents/` root already separates a FORWARD-ONLY tier
for exactly this; the third root has no such tier, so its 17 conflates "authenticates only" with
"forwards to something that authorizes". That is a defect in the LEDGER's resolution, not in the
route — and CAVCTULL is the reason to check rather than assume, since there the same theory held
for 11 routes and failed for 1.

*Nearly filed a false finding here.* A sweep for `createSession` callers that omit `authContext`
returned 13, which looks like the FRRJ80YQ presence-gated-bypass shape. It is not: `lib/session-auth.ts:86`
exports a same-named `createSession(ip?)` for BROWSER LOGIN sessions, and the four `auth/*` and
`governance/password/reset` hits call THAT one — which legitimately has no authContext because it
IS the authentication boundary. Others were a different signature again (three positional args).
Discriminating by IMPORT rather than by name leaves **two** real callers: this route (passes it)
and `element-management-service.ts:10671` (omits it). That omission is the case
`sessions-service.ts:795` documents — EMS's CreateAgent pipeline already ran `gate0Auth('create-agent')`
before reaching it — so it is legitimate, though it should pass an explicit
`buildSystemAuthContext(...)` for audit traceability the way `fleet-hard-recovery-runner.ts:52`
does, rather than relying on the fallback. Cosmetic; noted, not filed.

**`plugin-builder/build` — CLEAR. `enforceAuth` follows blast radius here.** `buildPlugin(config: unknown)`
takes no auth context and so cannot authorize internally, which is the shape that made
DQVPODKW a hole — but the outcome differs because the *effect* differs. The build writes to
`$TMPDIR/ai-maestro-plugin-builds/<uuid>` and **nothing reads that directory**: the only two
references are its own declaration and use inside the service. It does not install, and it drives
a build script already present in the user's marketplace cache via `execFile` (not a shell) with
path segments validated against traversal, behind a concurrency slot. It mints no identity,
mutates no governance state, and touches no other agent. The subtree's guards track exactly that:
`push` — the one that PUBLISHES — is `enforceSystemOwner`. That is the opposite of the DQVPODKW
pattern, where the three agent-MINTING routes got the weak guard while their siblings got the
strong one. There is also no action to authorize WITH: `authorize()`'s vocabulary is
`approve archive change-title create-agent delete-agent edit export-agent manage-team manage-trdd
promote refuse register-agent unblock-prompt` — adding one is a governance-vocabulary change, and
nothing here justifies it.

**`teams/[id]/batch-create-agents` — CLEAR, and STRICTER than any ledger showed.** Picked next
because it is the highest-blast-radius name the new forward-only tier exposed — a route that
BATCH-mints agents, previously in no ledger at all, and DQVPODKW was 3-in-4 wrong on agent-minting
routes. It forwards into `CreateAgent`, whose only auth gate is `G00f:
assertForeignUserMayCall(authContext, 'create_agent')` — an R40 FOREIGN-USER check that returns
`null` for any non-foreign caller, so it is not a title check and would not stop a MEMBER. That is
the CAVCTULL false case exactly, and it is why `POST /api/agents` needed F1SL03CK. **But the route
gates itself**, at lines 36-38: `if (auth.agentId) return 403 'Only system owner can
batch-create agents'` — and `agentId` is undefined only for the cookie-session system owner. So it
is owner-only, hand-rolled rather than via `enforceSystemOwner`.

### Three separate blind spots in the needle, one of them unfixable

1. **Forwarding** — fixed, commit `57560112` (the tier).
2. **`checkTeamAccess(`** — a real authorization helper (`if (!access.allowed) return 403`) that
   `STRONG_AUTHZ` did not know, covering three team-scoped routes. Added after reading the call
   site; forward-only 18 → 15. Commit `31e87e80`.
3. **Inline owner gates — MEASURED AND DELIBERATELY NOT SHIPPED.** A needle for
   `if (auth.agentId)` / `isSystemOwner` matched 8 routes; reading four found **two false**.
   `messages/route.ts` uses `auth.agentId` to OVERRIDE a client-supplied param, and `trdd/create`
   uses `isSystemOwner` to compute an authority RANK — neither refuses anything. A 50%-wrong
   needle that moves routes OUT of a debt ledger is worse than no needle, because its errors are
   silent and in the reassuring direction. So the inline-gated routes stay counted and the number
   overstates the debt safely. This is the same use-vs-mention failure as the ledger's other
   blind spots, one layer down, and it is why `batch-create-agents` had to be read rather than
   classified.

**`sessions/activity/update` — CLEAR, and the best outcome a ledger entry can have: the assertion
was already checked, by whoever wrote it, in place.** Its comment states that any authenticated
agent can broadcast a fake activity status, that the worst case is a misleading UI badge for a few
seconds, that the route is fed by the Claude Code hook at high frequency, and that tightening to
"sessionName must resolve to the same agent as auth.agentId" was **rejected on perf grounds** with
a named O(1) upgrade path (cache the agent→session map). That is exactly the deliberate policy
`enforceAuth` exists to encode. **This is the discriminator that decided the two entries below it:
a decision leaves a record.**

### A second unauthenticated route — and this one had to be fixed TWICE

`GET /api/sessions/restore` took **no `request` parameter at all** — `export async function GET()`
in the Next route, `async (_req, res)` in the headless router — so it could not have authenticated
even in principle. Its POST and DELETE siblings ten lines away both do (SVC2-MAJ-12, 2026-05-06),
and both of those comments say *"authenticate before re-spawning"* / *"before deleting"*: that pass
reasoned about **side effects**, and a read that DISCLOSES was never in its scope.

What it disclosed: `listRestorableSessions` returns whole `PersistedSession` records
(`lib/session-persistence.ts:6-13`) — `id`, `name`, **`workingDirectory`** (an absolute home path),
`createdAt`, `lastSavedAt`, `agentId`. Unauthenticated, that enumerates the fleet and leaks the
owner's filesystem layout. No comment anywhere claims that is intended, which — against
`activity/update` above — is why it reads as oversight rather than policy.

**BOTH SERVER MODES, ONE COMMIT (`d6f78e2b`).** `services/headless-router.ts` REIMPLEMENTS this
route, so a guard added only to `app/api/` is half-applied by construction: under
`MAESTRO_MODE=headless` the Next route never runs. Pinned twice, because neither test can see the
other's regression — `tests/unit/sessions-restore-get-auth.test.ts` drives the Next route, and a
new case in `tests/unit/headless-router-auth-mirror.test.ts` drives the real router end-to-end with
a forged token. Neutered SEPARATELY: 1 red each, each naming only its own test.

**The neuter tool refused twice before the measurement was valid**, and both refusals were correct:
the first expression spanned two lines (perl is line-scoped, so it matched nothing and would have
reported a no-op "0 red" indistinguishable from an untested guard), and the second matched
`if (authErr) return authErr` at THREE sites — GET, POST and DELETE spell the guard identically —
which would have disabled two guards the test file does not cover and produced a red count about
the wrong code.

### The widest-reaching route in the ledger — `convert-skill` (FIXED, commit `1909b55d`)

`POST /api/settings/global-elements/convert-skill` shipped with `enforceAuth`, whose docstring is
for mutations where *"any authenticated caller can call this"*. Traced end to end, that let **any
authenticated agent of any title**:

- name a **GitHub URL** as `source` — `convertElements`
  (`services/cross-client-conversion-service.ts:26`) parses it and calls `downloadGitHubRepo(...)`,
  so the SERVER fetches a repo the CALLER chose;
- pass `scope: 'user'` — `lib/converter/convert.ts:209-212` returns **`process.env.HOME`** as the
  write root, and `:171` writes the converted files under it;
- pass `force` to overwrite, plus an arbitrary `projectDir`.

Converted skills/agents/instructions are **prompt content Claude Code loads**, so the composition is
remote content → the owner's home directory → loaded as instructions.

**Raised to `enforceSystemOwner`, not to a new `authorize()` action.** Every other mutating route
under `app/api/settings/**` is already `enforceSystemOwner` or `requireSudoToken` — including the
sibling in the SAME directory, `global-elements/install-skill`. Installing a skill globally required
the owner; CONVERTING one into the same place did not. That is the DQVPODKW shape again, and
matching the subtree needs no new governance vocabulary (`authorize()` has no verb for this, and
adding one would be a governance change rather than a fix). Its GET had no guard at all and now has
`enforceAuth` — only authentication, because it returns static capability metadata.

UI safety was verified EMPIRICALLY, not inferred: `components/settings/GlobalElementsSection.tsx` —
the same settings UI as the calling `ConvertButton.tsx` — already calls two `enforceSystemOwner`
routes successfully, because a cookie session resolves to the system owner.

### A PREVIOUSLY-CLOSED HOLE WAS HALF-APPLIED — headless `install-skills` (FIXED, same commit)

Found by following `convertElements`' other callers. `POST /api/agents/:id/install-skills` exists in
both modes. The **Next** route authenticates and then calls `authorize(auth, 'manage-skills', id)`
under **TRDD-D3RP7KQZ**, whose comment states the invariant: *"installing skills is CONFIGURATION,
so no agent may do it to itself, and only a MANAGER (or the target's own COS) may do it to
another."* The **headless** twin took `_req` — no authentication, no authorization — while doing the
same work through `convertElements(..., scope: 'user')`, i.e. writing under `$HOME`.

Under `MAESTRO_MODE=headless` the Next route never runs, so D3RP7KQZ's gate **did not exist on that
path**. The structural credential gate is not a substitute: a shape-valid FORGED token passes it and
lands in the handler, which is the precise failure class
`tests/unit/headless-router-auth-mirror.test.ts` was created for (its header: several handlers
*"protected ONLY by the structural gate"*). Fixed by mirroring the Next route's own `authorize()`
call — the drift-free pattern that file's `authorize` import already documents.

**Half of that gate is UNPINNED and it is recorded as such.** Neutering the authentication line reds
this file's test; neutering the `authorize` line reds NOTHING (0/52), because a forged token fails
authentication one line earlier and never reaches it. That zero measures the FIXTURE, not the guard.
Pinning it needs a genuinely issued token for a non-authorized agent, which the forged-credential
harness cannot mint — and the unpinned half is the one carrying D3RP7KQZ's actual invariant.

### The remaining four survey routes — verdicts, recorded rather than remembered

Measured by a delegated read-only survey (report under gitignored `reports/route-authz-survey/`,
positive control passed), every claim then verified first-hand before acting. Recording the CLEAR
ones too, because this ledger's own lesson is that a decision leaves a record and an oversight
leaves silence.

**`v1/mesh/chat` — CLEAR, and the best-guarded route in the set.** `GET` uses `enforceAuth`;
`POST` does its own `authenticateFromRequest` with the stated reason (`API2-MAJ-09`: *"full token
verification (not just middleware) so we know the actual identity behind the call and can reject
sender-spoofing"*) and binds behaviour to `auth.agentId`. Identity-scoped, not a blanket allow.

**`vpn-chat/block` — CLEAR at the ledger's question.** All three verbs (`GET`/`POST`/`DELETE`)
carry `enforceAuth`. Whether a blocking action should additionally be ownership-scoped is a
separate question this card does not ask.

**`export/jobs/[jobId]` — CLEAR, and unusually so: there is nothing behind it.** `GET` takes
`_request` and therefore cannot authenticate, but both service functions are 501 STUBS —
`getExportJobStatus` and `deleteExportJob` (`services/config-service.ts:727`, `:764`) return
*"not implemented yet (no export-job store exists)"* unconditionally, with a comment recording
"NO export-job store yet (Phase 5)". Nothing is read, written or disclosed. Worth `enforceAuth`
for SF-058 consistency when the store lands; worth nothing before then, and adding a guard to a
stub would only make the store's arrival look already-guarded.

**`settings/mcp-discover` — a real bug, FIXED, and the most instructive one.** Its headless handler
was a HAND-ROLLED copy of `delegateNextRoute` that built its `fakeReq` with only `Content-Type`,
so the caller's Authorization/Cookie/X-Agent-Id never reached the real handler and its
`enforceAuth(fakeReq)` saw no credentials — a guaranteed 401, i.e. the route was DEAD in headless
mode. It fails CLOSED, so unlike its neighbours this was a functionality bug rather than a hole.
The instructive part: the helper already existed, ~30 handlers already used it, and a second copy
was written anyway and got wrong the single detail the helper exists to get right
(`forwardAuthHeaders`). Now delegated.

**One question this card deliberately does NOT answer.** The `conversations/parse` NEXT route
authenticates and confines reads to `~/.claude/projects/`, but has **no ownership check** — any
authenticated agent may read ANY transcript under that root, not merely its own. Whether that is
intended is a policy question with the same shape as `sessions/[id]/rename` (TRDD-OYNUJRSB), and
inventing a scoping rule here would be the error the HW72YBZW warning names.

### And the subtree sweep found a real hole the ledger cannot see

`GET /api/plugin-builder/builds/[id]` had **no guard of any kind** — the only unauthenticated
route in an otherwise-guarded subtree. Its sole protection was the entropy of the build id, minted
by `buildPlugin` as `randomUUID()` and returned only to the authenticated POST caller: a
capability URL, not an authorization decision. `lib/agent-auth`'s own header records the ruling it
contradicted — *"SF-058 CLOSED: No auth headers AND no session cookie → rejected. There is no
'free' system-owner access anymore."*

Fixed with `enforceAuth` (not `enforceSystemOwner`: a build status is not a governance object, so
there is no owner to compare against and no title that should widen or narrow the answer).
Verified safe for the UI BEFORE editing — `components/plugin-builder/BuildAction.tsx:137` polls it
with a plain same-origin fetch and no Bearer header, and `authenticateFromRequest` resolves the
`aim_session` cookie to a system owner, which is already how that same component's POST at :97
passes `enforceAuth`. `enforceAuth`'s write-block is a no-op on GET, so this adds authentication
only. Commit `70f9d67c`; `tests/unit/plugin-builder-build-status-auth.test.ts`, 3 tests, neuter
1 red / 2 green.

**This is the second acceptance box's class, and it was invisible to the first's needle by
construction** — a route that calls NO guard, on a NON-mutating verb, fails both conjuncts of
`MUTATING && CALLS_ENFORCE_AUTH`. The ledger catches authentication standing in for authorization;
it is blind to no-authentication-at-all. One instance found and closed does not sweep the class,
so that box stays open.

## Acceptance

- [x] third parallel root over `app/api/` excluding `agents/`, leaving the other two ledgers intact
- [x] population re-derived rather than taken from this card — and the 73-vs-17 distinction
      settled before seeding, not after
- [x] the 17 seeded as a debt ledger, not shipped as 17 failures
- [x] PROVEN to fire on a seeded route, and to go green when it is removed
- [x] walker control asserts a real scan set (>100 files) and no bleed into `app/api/agents/`
- [x] non-vacuity: the needle must find >0, so a broken regex cannot read as "all decided"
- [ ] **the ledger is part of any route-guard change, not a separate chore.** Fixing `convert-skill`
      made STRONG_AUTHZ match it, so the needle returned 10 against a ledger of 11 — the guard went
      red and I did not notice for ~30 minutes, because I re-ran the three tests I had just written
      and not this one. Shrinking the ledger IS the deliberate edit its contract requires
      (commit `a255a521`); the lesson is that changing any route's guard changes this needle
- [ ] the 17 decided one at a time, each real one its own card. **6 decided** — `sessions/create`,
      `plugin-builder/build`, `teams/[id]/batch-create-agents` and `sessions/activity/update` CLEAR;
      `sessions/restore` GET FIXED (unauthenticated in BOTH modes, commit `d6f78e2b`);
      `sessions/[id]/rename` **is a real hole → filed as TRDD-OYNUJRSB**, because the correct
      policy is a ruling and not a one-liner. Reasoning under `## Decisions`. Remaining debt:
      **~9 authn-only + 14 forward-only** unchecked
- [ ] **the ledger's own entries are not equal in kind, and the discriminator is cheap.** Of the
      four CLEAR verdicts, exactly one (`sessions/activity/update`) was *already decided* — it
      carries a comment stating the policy, the worst case, and why tightening was rejected. The
      others had to be traced. **A decision leaves a record; an oversight leaves silence.** Reading
      for that comment first would have sorted this ledger faster than reading the code
- [x] the third root needs a FORWARD-ONLY tier like the `agents/` root has — **done**, commit
      `57560112`. The needle was wrong in BOTH directions: 6 of the 17 were forwarders (the five
      `groups/*` + `sessions/create`), so the authn-only debt is **11**; and **18** mutating
      routes outside `agents/` forward a context while calling nothing stronger, **12 of them in
      no ledger at all** — including `teams/[id]/batch-create-agents` and `trdd/create`, which
      create governed objects. `sessions/create` is additionally pinned BY NAME, because a tier
      that COUNTS cannot see a receiver that authorizes the WRONG action: the neuter changing
      `'create-session'` to `'create-agent'` leaves `authorize(` present, so every count stayed
      green and only the named pin went red
- [ ] the 73-minus-17 remainder — routes with NO authentication at all — is a DIFFERENT question
      this guard deliberately does not ask. Worth its own card if anyone wants it asked.
      **One instance surfaced and was closed** (`GET plugin-builder/builds/[id]`, commit `70f9d67c`)
      while sweeping the subtree above — found by reading siblings, NOT by the needle, which cannot
      see a non-mutating route that calls no guard. One instance is not a sweep, so this stays open.
- [ ] INHERITED FROM DQVPODKW (2026-08-26, review-fork finding — the back-link that makes the
      deferral bidirectional): the HEADLESS router carries a systemic auth-shape class this
      card's audit is the natural home for. `services/headless-router.ts` uses bare
      `!auth.agentId` as an isSystemOwner proxy at multiple handlers (`userTitle` = 0 hits
      file-wide; the sync-defaults handler was converted to `buildAuthContext(auth).isSystemOwner`
      under DQVPODKW, the rest were not) — under the R36/R37 user-authority model that proxy
      grants a logged-in non-maestro web user whom enforceSystemOwner refuses. Riding with it:
      the DISCRIMINATING test the sync-defaults suite cannot express (model-ON, mock
      `isUserAuthorityModelEnabled`) — the existing suite pins gate-EXISTENCE only (observed:
      reverting the swap reddened 0 of 2). Closing this card without these two leaves both
      cards internally consistent and the gap unowned. DISTINCT FROM TRDD-8Q5EVGV1 (settling
      grep 2026-08-26: `isSystemOwner|!auth.agentId` = 0 hits on that card): 8Q5EVGV1 is
      "no per-handler AUTHENTICATION" (141 handlers); this class is "authenticates but derives
      isSystemOwner with the wrong predicate". Same 252-handler surface though, so a router-wide
      8Q5EVGV1 redesign may fix this as a side effect — close this bullet against WHICHEVER
      card lands the fix, re-verified by the userTitle grep AND the 0-red revert-neuter
      flipping red, never by the sibling card's closure alone (the stale-parked-blocker shape).

## Approval log

- 2026-08-22T22:38:35+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
