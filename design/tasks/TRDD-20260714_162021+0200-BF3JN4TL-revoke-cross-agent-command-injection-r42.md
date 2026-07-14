---
trdd-id: BF3JN4TL
title: Revoke cross-agent command injection entirely (R42) — messaging becomes the only channel
column: testing
created: 2026-07-14T16:20:21+0200
updated: 2026-07-14T17:20:00+0200
current-owner: claude-opus-session
created-by: maestro
task-type: security
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: maestro
approval-datetime: 2026-07-14T16:20:21+0200
priority: 0
severity: critical
effort: medium
release-via: none
relevant-rules: [6, 10, 26, 32, 42]
labels: [security, governance, authorization, injection, r42]
blocks: [HGE9T6VT]
---

# Revoke cross-agent command injection entirely (R42) — messaging becomes the only channel

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**CODE LANDED. R42 is enforced at the API in BOTH server modes.** Full suite green (176 files
/ 2727 tests), `tsc --noEmit` clean. What remains is the *soak*: nothing has run against it yet
(the fleet is stopped), so the operational-risk item at the bottom — "enumerate the flows that
depended on a MANAGER/COS driving a pane" — is still open and is the reason this card is not
`complete`.

**SUPERSEDED — do NOT carry forward:**

- ~~"That single change closes all six routes in both server modes at once, and makes
  HGE9T6VT's headless hole unreachable rather than merely guarded."~~ **This was WRONG, and it
  was the most dangerous sentence on the card.** The headless router does not call the Next.js
  route handlers — it REIMPLEMENTS `/stop` and `/restart` with raw `execSync("tmux send-keys
  …")` and calls only `authenticateAgent`. A rule added to `lib/authorization.ts` cannot bind a
  code path that never calls `authorize()`. Had the plan been executed as written, R42 would
  have shipped enforced in full mode, unenforced in headless, and **green** — the exact
  authn-substituting-for-authz shape the audit exists to catch, reintroduced by the fix for it.
  Caught only by reading `services/headless-router.ts:864` instead of trusting the card.
  **Lesson: a claim about what a central edit "closes" is a claim about the CALL GRAPH. Verify
  the call graph, do not infer it from the architecture you expect.**
- ~~`DO NOT ship the "add authorize() to headless" fix on its own.`~~ Correctly stated at the
  time (it would have re-established the MANAGER/COS path R42 revokes), now moot: the R42 rule
  landed FIRST, so wiring `authorize()` into headless lands R42 there rather than the old grant.
  Both halves shipped together, in that order, deliberately.

**What shipped (see `## Implementation` below for the file-by-file):**

1. `lib/authorization.ts` — `DRIVE_ACTIONS = {send-command, restart-session}`; any caller whose
   `targetAgentId !== auth.agentId` is DENIED, **for every title, MANAGER included**. Fails
   CLOSED on an unresolved target.
2. Headless `/stop`, `/restart`, **and `/chat`** now authorize. `/chat` had **no auth call at
   all** — not even `authenticateAgent` — and it is the single most direct injection surface in
   the product (`sendKeys(session, msg, {literal, enter})`). It was found by sweeping the
   router for injection routes rather than by following the card. Worse than the bug the card
   was written about, and adjacent to it.
3. Both full-mode session routes had a **fail-OPEN**: `if (targetAgent) { authorize(…) }` — an
   unresolvable session name SKIPPED RBAC entirely. Rename a session, bypass R42. Now
   unconditional.
4. `POST /api/agents/[id]/ensure-core` re-mapped `restart-session` → `modify-agent`. It is a
   plugin *install* (configuration, R42.6), not a drive; the old label would have made
   MANAGER/COS lose the R17 self-heal as collateral damage. Zero behaviour change.

**The seam to NOT "harmonize" later:** `hibernate` also ends in a `sendKeys('/exit')`, and it
stays MANAGER/COS-permitted. That is not an inconsistency with `/stop` being revoked — it is
the DRIVE/LIFECYCLE line: hibernate injects ONE FIXED terminating key sequence and cannot make
the victim *do* anything, whereas the send-command family carries arbitrary text into a live
prompt. R9/R10/R11 grant hibernate/wake deliberately, and R31's freeze depends on it. Anyone
who later "unifies" the two by re-opening `/stop` has reopened R42.

## The USER's ruling (verbatim, 2026-07-14)

> *"the rule that forbid the agents to send commands to other agents is absolute. no exceptions.
> neither the MANAGER or the CHIEF-OF-STAFF are exempt. only exception are the few global
> commands of the janitor. everything else is strictly forbidden. if the MANAGER must send a
> command it must use the messaging system, and so the chief-of-staff. the only interaction
> between agents in ai-maestro is mediated by the messaging system, and regulated by the
> communication rules (who can message who) that i already defined. no other way for an agent to
> influence another agent. […] but injecting commands to other agents? no, that must never
> happens."*

## Why it is absolute (the argument, not just the rule)

**A message lands in an inbox and the recipient decides whether to act. An injected command IS
the recipient's own action.** It bypasses the victim's judgment, its rules, and its governance
title — one agent typing into another's pane can make it do anything the victim is permitted to
do. That makes **every other rule in this document advisory**: the R6 comm graph is only a
boundary if messaging is the *only* channel. R26 (identity immutability) means nothing if I can
type into your session. R30's mandate means nothing if I can make the MANAGER type it for me.

## Current state — the capability exists, is sanctioned, and is broken

`lib/sudo-guard.ts` `STRICT_AGENT_RULES` — six routes carry the cross-agent capability:

| route | action |
|---|---|
| `POST /api/agents/[id]/queue` | `send-command` |
| `PATCH /api/agents/[id]/session` | `send-command` — *"types arbitrary text straight into a live pane"* |
| `POST /api/agents/[id]/panel` | `send-command` |
| `POST /api/agents/[id]/prompt/answer` | `send-command` |
| `POST /api/sessions/[id]/stop` | `restart-session` |
| `POST /api/sessions/[id]/restart` | `restart-session` |

`lib/authorization.ts` today: **self is allowed** (`SELF_DRIVE_ACTIONS`); **another agent
requires MANAGER, or COS within its own team.** And in **headless mode** the two session routes
skip `authorize()` altogether, so *any* authenticated agent can `/exit` the MANAGER
(`TRDD-HGE9T6VT` — verified, exploitable).

## Proposed change

1. **`lib/authorization.ts` — `send-command` and `restart-session` become SELF-ONLY.**
   `targetAgentId !== auth.agentId` ⇒ **denied, for every title, including MANAGER.** This is
   the whole fix; it closes all six routes in **both** server modes from one place, which is
   precisely why it is preferable to patching handlers.
2. **Keep self-drive** (R42.4) — an agent may still `/compact` itself, paint its own panel,
   answer its own prompt. `SELF_DRIVE_ACTIONS` already expresses this; it simply becomes the
   *only* permitted case.
3. **The janitor's GLOBAL operations stay** (R42.5): globally disarm/re-arm, pause/unpause the
   heartbeat, globally reload plugins + skills. These are **machine-wide switches, not commands
   targeted at an agent**, so they are outside R42's scope by construction — verify each is
   implemented as a global flag and not as a fan-out of per-agent injections. **If any of them
   is implemented by looping `send-command` over the fleet, it violates R42 and must be
   re-implemented as a flag.**
4. **Leave configuration authority intact** (R42.6). MANAGER/COS may still change an agent's
   skills / subagents / MCP / hooks / TEAM / TITLE. **Configuring an agent is not driving it** —
   different routes (`PATCH /api/agents/[id]` → `modify-agent`), different rule, unchanged.
5. **`TRDD-HGE9T6VT` is re-scoped by this.** Its headless hole closes automatically once (1)
   lands. Its *second* half — the systemic one — remains fully valid and should still ship: the
   headless router must be driven from the same declarative table and **fail closed** when a
   strict route has no recorded authorization decision. A forgotten `authorize()` failing OPEN
   is the defect that made this exploitable, and R42 does not fix that class.
6. **Update the UI.** Any dashboard control that drives another agent must go, or the UI will
   issue calls the server now rejects.

## ⚠ HONEST LIMIT — the tmux channel is NOT closed by this

All agents run under **one OS uid**, so `tmux send-keys -t <other-agent> …` succeeds no matter
what the API permits. **No in-process guard can stop it** — `agent-shell-guard.sh` overrides the
`cd` *shell function*, and a binary invoked by absolute path ignores it.

So R42 ships as: **enforced at the API**, and **mandated by rule** — a directive in
`rules/aimaestro/aimaestro-agent-rules.md`, which the server seeds read-only into every agent
workdir and which is injected into every agent's context on every turn (USER's explicit
instruction, 2026-07-14):

> `- NEVER drive another agent — no command, keystroke, or queued input into its session, by API, CLI or tmux. NO title exempts you. Messaging is the ONLY channel: ask, never inject.`

**That is tamper-EVIDENT, not tamper-PROOF, and it must never be described as a sandbox.**
Closing the API while leaving tmux open is a locked door beside an open window — and the danger
is not the window, it is *believing the window is shut*.

**Real containment needs OS-level isolation** (a separate TRDD; USER: *"maybe a tmux expert can
help us with this in the future"*). Three candidates, honestly costed:

- **(a) Per-agent OS uid** — tmux's socket dir `/tmp/tmux-<uid>/` is mode `0700`, so a
  cross-agent `send-keys` becomes a kernel `EPERM`. Also closes cross-agent *file* writes for
  free. **Open question that decides viability: Claude Code's OAuth lives in the login keychain,
  which is per-macOS-user** — check whether `CLAUDE_CODE_OAUTH_TOKEN` can supply it per-uid.
- **(b) Per-agent tmux socket + a `sandbox-exec` seatbelt profile** denying each agent's `claude`
  process access to every socket path but its own. **Kernel-enforced and it sidesteps the
  keychain problem entirely** (same uid, same keychain). macOS-only; `sandbox-exec` is
  deprecated-but-functional.
- **(c) Containers per agent** — `TRDD-a1019073`. Strongest, heaviest, same auth question as (a).

## Verification (adversarial — a happy-path test proves nothing; see the aspect page)

- **MANAGER** → `POST /api/agents/<other>/queue` → **403**. (Today: 200. This is the test that
  proves the rule, because the MANAGER is the title everyone will assume is exempt.)
- **COS** → drive an own-team agent → **403**. (Today: 200.)
- **AUTONOMOUS** → `POST /api/sessions/<manager>/stop`, **headless** → **403**. (Today: 200.)
- Any agent → drive **itself** → **200** (R42.4 — must NOT regress).
- MANAGER → `PATCH /api/agents/<other>` (config / TITLE / TEAM) → **200** (R42.6 — must NOT
  regress; configuring is not driving).
- The janitor's global ops still work, and **none of them fans out per-agent `send-command`**.

## Estimated risk

**MEDIUM.** The code change is small and central (one authorize() rule, not six handlers). The
risk is **operational**: if any real flow depends on the MANAGER or COS driving an agent's pane,
it breaks the moment this ships. Enumerate those flows first — each must be re-expressed as a
message, which is exactly the point of the rule, but it is real work and should be discovered
now rather than in production.

## Implementation

| File | Change |
|---|---|
| `lib/authorization.ts` | `DRIVE_ACTIONS`; cross-agent drive DENIED for every title. Fails closed on an unresolved target. |
| `lib/sudo-guard.ts` | `ensure-core` → `modify-agent` (config, not drive); stale policy comments corrected. |
| `app/api/sessions/[id]/stop/route.ts` | authorize UNCONDITIONALLY (was fail-open on an unresolved session name). |
| `app/api/sessions/[id]/restart/route.ts` | same fail-open closed. |
| `app/api/agents/[id]/chat/route.ts` | doc comment: the MANAGER/COS grant is SUPERSEDED. |
| `services/headless-router.ts` | `/stop` + `/restart` now authorize (TRDD-HGE9T6VT's hole); `/chat` now authenticates AND authorizes — it had NO auth call at all. |
| `tests/authorization.test.ts` | the R42 adversarial block: MANAGER/COS refused; self-drive, configuration, lifecycle and the system-owner pinned as non-regressions. |
| `tests/unit/{chat-send,queue-cancel}-authorization.test.ts` | the two "a MANAGER may …" assertions INVERTED, not deleted. |
| `tests/unit/sudo-guard-strict-agent-coverage.test.ts` | "mapped" no longer proxied by "a MANAGER gets through" (R42 inverts that proxy); + the guard-layer R42 pin. |

**Adversarial by construction, because it has to be.** A missing guard produces a SUCCESS, not
an error, so a happy-path suite is *constitutionally blind* to one — every hole closed here was
live for months under a fully green run. The only test that can prove a prohibition attempts the
forbidden act and asserts the refusal. See `[[an-unenforced-rule-produces-a-success-not-an-error]]`.

## Approval log

- 2026-07-14T16:20:21+0200 — MANDATE issued by USER (maestro) (min-approval-requirement: user).
  Pre-approved; the issuer is the only authority above the tier floor. Verbatim ruling quoted
  above. No approval request was sent.
