---
trdd-id: HGE9T6VT
title: Authentication is substituting for authorization — the headless router must be driven by the same table as the guard and fail closed
column: planned
created: 2026-07-14T15:52:55+0200
updated: 2026-08-15T01:30:26+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: security
min-approval-requirement: manager
approved: true
approval-judge: manager (emasoft-assistant-manager)
approval-datetime: 2026-08-15T01:30:26+0200
priority: 1
severity: high
effort: medium
release-via: none
relevant-rules: [9, 10, 17, 27, 28, 30, 32]
labels: [security, authorization, headless, governance, root-cause]
---

# Authentication is substituting for authorization — headless stop/restart let any agent silence the MANAGER

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**RE-SCOPED. The bleeding is stopped; the CLASS is untouched, and the class was always the
point of this card.**

**SUPERSEDED — do NOT carry forward:**

- ~~"NEXT ACTION: add the missing `authorize()` to the two headless handlers."~~ **DONE**, in
  `6dcc57fd` (TRDD-BF3JN4TL), and deliberately AFTER R42 landed in `lib/authorization.ts` — so
  what got wired into headless is the R42 self-only rule, not the MANAGER/COS grant this card
  originally proposed to restore. Sequencing was the whole risk: the same ten lines, shipped
  first, would have re-established exactly the cross-agent path the USER revoked, and would
  have looked like a completed security fix while doing it.

**WHAT REMAINS — and it is the more important half.** Patching those two handlers left the
CLASS fully intact. The proof arrived within the hour: sweeping the router for injection routes
turned up **`POST /api/agents/[id]/chat` with NO auth call at all** — not even
`authenticateAgent` — ending in `sendKeys(session, msg, {literal, enter})`. Same file, same
defect, *worse*, and it was not on anyone's list. It was closed in `6dcc57fd` too, but only
because a human went looking. **That is not a process; that is luck.**

- **NEXT ACTION (the systemic fix):** drive `services/headless-router.ts` from the SAME
  declarative table the Next.js guard uses (`STRICT_AGENT_RULES` in `lib/sudo-guard.ts`), and
  make an undeclared strict route **FAIL CLOSED** there exactly as it does in full mode. Today
  the two modes are two independent hand-maintained lists of who-checks-what, and a route added
  to one is simply *absent* from the other — silently, and in the permissive direction.
- **The invariant to test:** for every route present in both modes, the two modes must reach
  the SAME authorization decision for the same caller. A test that enumerates the headless
  routes and asserts each one either authorizes or is provably non-strict would have caught all
  three of these holes on the day they were written, and will catch the next one.

**The root cause, stated once so it is not re-derived:** `401` answers *who are you*; `403`
answers *may you*. Three sites, three authors, three months, three security-review IDs
(SVC2-MAJ-12, SVC2-CRIT-01/02) — each wrote a comment naming the operation "privileged" and
then added an **authn** check. The layer LOOKS present at every call site, which is precisely
why nobody saw it missing. **And a missing guard produces a SUCCESS, not an error** — so the
whole suite stayed green through all of it. See
`[[an-unenforced-rule-produces-a-success-not-an-error]]`.

## The bug (verified by reading the code, 2026-07-14)

```ts
// services/headless-router.ts:864 — POST /api/sessions/[id]/stop
// SVC2-MAJ-12 (2026-05-06): authenticate before sending Ctrl+C / /exit to a tmux pane.
const auth = authenticateAgent(getHeader(req,'Authorization'), getHeader(req,'X-Agent-Id'), getHeader(req,'Cookie'))
if (auth.error) { sendJson(res, auth.status || 401, { error: auth.error }); return }
const sessionName = decodeURIComponent(params.id)
execSync(`tmux send-keys -t "${sessionName}" C-c`,        { timeout: 5000 })   // ← no authorize()
execSync(`tmux send-keys -t "${sessionName}" -l '/exit'`,  { timeout: 5000 })   // ← no title check
execSync(`tmux send-keys -t "${sessionName}" Enter`,       { timeout: 5000 })   // ← no target resolution
sendJson(res, 200, { success: true, sessionName })
```

`POST /api/sessions/[id]/restart` (`:881`) has the identical shape.

**Exploit, concretely.** Run the server in its supported headless mode (`yarn headless`). An
**AUTONOMOUS** agent — the lowest tier in the system — holding a valid `aim_tk_*` bearer sends:

```
POST /api/sessions/manager-bot/stop
```

| mode | result |
|---|---|
| **full** (`yarn start`) | **403 `aid_title_forbidden`** — the guard maps the route to `restart-session`, resolves `manager-bot` → agentId, and `authorize()` denies a non-MANAGER / non-own-team-COS caller |
| **headless** (`yarn headless`) | **200 `{success:true}`** — and the MANAGER's Claude session receives `/exit` |

**Any agent can silence any other agent, including the MANAGER.** Since R9 makes the MANAGER
load-bearing for all team governance (no MANAGER ⇒ every team blocked, every team agent
hibernated — R9.8), a single AUTONOMOUS agent can trigger the fleet-wide blocking cascade at
will. It is a privilege escalation *and* a denial of service against the whole host.

## THE ROOT CAUSE — and why this is not three bugs

Read the three comments. Three different authors, three different months, three security-review
IDs. **Every one of them identified the danger and then checked WHO the caller is, never
WHETHER they may:**

| Site | The comment the author wrote | What they actually added |
|---|---|---|
| `app/api/agents/route.ts` POST | *"CC-GOV-008: Auth required — agent creation is a **privileged mutation**"* | `authenticateFromRequest()` |
| `services/headless-router.ts:864` | *"SVC2-MAJ-12: **authenticate** before sending Ctrl+C / /exit to a tmux pane"* | `authenticateAgent()` |
| `services/headless-router.ts:881` | *"SVC2-MAJ-12: **authenticate** before relaunching the agent client"* | `authenticateAgent()` |

**Authentication is not authorization.** `401` answers *"who are you?"*. `403` answers *"may
you?"*. Every one of these handlers asks the first question, gets a satisfying answer, and
ships.

**This is why the holes cluster in the authorization layer and why they were invisible:** the
layer *looks* present at every call site, because there is always an auth check right there at
the top of the handler. A reviewer skims, sees `auth`, and moves on. Combined with
[[an-unenforced-rule-produces-a-success-not-an-error]] — a missing guard yields a **success**,
not an error — nothing in the code, the tests, or daily use ever objects.

## Why the headless router is the worst place for it

`services/headless-router.ts` **re-implements** the Next.js routes by hand. The Next.js path
gets its authorization from the `requireSudoToken → requireAidTitle → authorize()` chain in
`lib/sudo-guard.ts`, driven by the declarative `STRICT_AGENT_RULES` table. **Headless has no
such chain** — each handler must mirror the decision by calling `authorize()` itself.

The author knew this: the router's own comment block (`:3108-3111`) says each strict handler
must reproduce the guard's `authorize()`, and it *was* done — for the role-plugin trio and for
`export-agent` (`:1363-1374`). It was simply **missed** here. That is the failure mode of a
hand-mirrored security boundary: it is correct until someone adds a route and forgets, and
nothing tells them.

**So the security posture of a strict route silently depends on which server mode you run.**
That is the deeper defect, and no amount of care will fix it — only a mechanism will.

## Proposed change

**1 — Stop the bleeding (do this first, it is ~10 lines).**
Add to both headless handlers, mirroring `export-agent`'s existing pattern:
```ts
const agentId = getAgentBySession(sessionName)?.id
const decision = authorize(auth, 'restart-session', agentId)
if (!decision.allowed) { sendJson(res, 403, { error: decision.reason }); return }
```

**2 — Kill the class (this is the real fix).**
The headless router must not be *able* to serve a strict route without the guard:
- Drive headless from the **same declarative table** (`STRICT_AGENT_RULES` /
  `security-registry.json`) that the Next.js guard uses — one dispatcher, applied in the
  router's `handle()` before any handler runs, instead of 40+ hand-copied checks.
- **Fail closed:** a route present in `security-registry.json` as `strict` but with no
  authorization decision recorded on the request must be **refused**, not served. Today a
  forgotten `authorize()` fails *open*, which is the worst possible default for the one
  mechanism whose entire job is to say no.
- Extend the existing coverage guardrail test (TRDD-6A2I6ZO0 — which already pins every strict
  route to exactly one of the three sudo-guard sets) so it **also** asserts every strict route
  served headless applies its AuthAction. The guardrail already exists; it simply never looked
  at headless.

**3 — Rename the trap.** `authenticateAgent()` / `authenticateFromRequest()` return an *identity*.
Nothing in their names or types stops a caller from treating them as permission, and three
authors did exactly that. Consider a type-level split so an un-authorized identity cannot be
passed to a privileged operation — make the compiler enforce what the comments only asked for.

## Verification (adversarial — a happy-path test proves nothing; see the aspect page)

- **The exploit, as a test:** headless mode + an AUTONOMOUS agent's valid bearer +
  `POST /api/sessions/<manager-session>/stop` → must be **403**. Today: **200**.
- **Parity, as a test:** for every route in `security-registry.json` marked `strict`, assert the
  headless and full-mode responses agree for the same caller. This is the test that would have
  caught it, and its absence is the reason it shipped.
- A MANAGER stopping another agent's session, headless → **200** (unchanged).
- An agent stopping **its own** session → whatever `restart-session` says today (self is denied);
  headless must match full mode exactly.

## Estimated risk

**The fix is LOW risk. NOT fixing it is CRITICAL.** Step 1 is additive — it can only turn a 200
into a 403 for a caller who should never have had the 200. Step 2 is a refactor of a security
boundary and must land with the parity test, not before it.

**Blast radius today:** any authenticated agent, on a headless host, can stop or restart any
session including the MANAGER's — and via R9.8, thereby hibernate every team agent on the host.

## Approval log

- 2026-08-15T01:30:26+0200 — APPROVED by ASSISTANT-MANAGER (min-approval-requirement:
  manager), §D4 APPROVAL-UNAPPROVED-IN-WORK-ZONE drain. Column stays as-is per the ruling.
