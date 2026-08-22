---
trdd-id: 8Q5EVGV1
title: 141 of 252 headless handlers have no per-handler auth behind a gate that does not validate tokens
column: todo
created: 2026-08-23T00:10:05+0200
updated: 2026-08-23T00:45:17+0200
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
> zero code hits. Counts by that method: **2 at `41cc9983`, 3 at `6b40bfc7`**, agreeing with the
> subtraction by a different instrument. Raised by an adversarial review of the commit that
> published the names, which is the right time for a correction box to be audited: a correction
> that inherits the defect it corrects is the worst possible artifact here.

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
