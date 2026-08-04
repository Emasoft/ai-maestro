---
trdd-id: EZ4B12B9
title: The only unexposed terminal read is the RAW PANE TEXT — everything semantically useful is already readable
column: todo
created: 2026-08-04T23:34:08+0200
updated: 2026-08-04T23:39:45+0200
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: feature
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
priority: 3
severity: low
effort: small
release-via: none
labels: [agent-control, terminal, observability]
---

# The only unexposed terminal read is the RAW PANE TEXT — everything semantically useful is already readable

## ⛔ CORRECTION — this card's ORIGINAL claim was WRONG (2026-08-04, by the USER)

**As first filed, this card said terminal control was "open-loop" and that "no API can read
what a command produced". That is false, and the USER corrected it within minutes.** The
correction is kept in place rather than rewritten away, because the wrong version was
committed (`645e815c`) and a future reader who finds only a tidy card learns nothing about how
the mistake was made.

**What I got wrong and why.** I measured one thing accurately — no route calls
`AgentRuntime.capturePane`, and no `aimaestro-session.sh` verb returns pane text — and then
generalised it into "the terminal cannot be read at all". I never opened the **core plugin's
hook**, which is where the read-back channel actually lives:
`Emasoft/ai-maestro-plugin` → `scripts/ai-maestro-hook.cjs` (630 lines, 16 `writeState` calls).

This is the *wrong POPULATION* failure this repo already has a lesson for, in its purest form:
I searched `app/`, `lib/` and `services/` — a set that CANNOT contain the answer, because the
capture is performed by a hook shipped in a different repo. A clean result over the wrong
corpus reads exactly like a real absence.

## What ACTUALLY exists (measured after the correction)

The hook writes `~/.aimaestro/chat-state/<sha256(cwd)[:16]>.json` atomically (tmp + rename,
mode 0600) and captures far more than a status enum:

| captured | by |
|---|---|
| `status` (8-state ladder incl. `rate_limited`, `api_error`, `exited`) | every handler |
| `toolName`, `toolInput`, `description`, `options` | `permission_request` |
| `message` — the actual prompt/notification TEXT | `waiting_for_input` |
| `questions[]` — AskUserQuestion text + choices | the question handler |
| **`transcriptPath`** — the full JSONL conversation | every handler |
| `subagentCount`, `sessionId`, `endReason` | as applicable |

And it IS exposed to a remote caller:

- **`GET /api/agents/[id]/prompt`** → the pending prompt with its text and `options[]`. Its own
  header states the security reasoning: *"any authenticated caller may read ANY agent's pending
  prompt, so a governance agent can see what a stuck agent is asking and then answer it. It
  exposes only the same prompt text/options the agent's own terminal already shows."*
- **`POST /api/agents/[id]/prompt/answer`** → answer it.
- **`GET /api/agents/[id]/session`**, **`GET /api/sessions/[name]/pane-status`** → state.
- **`transcriptPath`** → the authoritative record of what the agent did. This project's own
  standing guidance says the JSONL transcript, not a terminal scrape, is the authoritative
  source.

So the loop is CLOSED for every question worth asking: *is it stuck, on what, what is it
asking, what did it do, and can I answer it.*

## What is genuinely still unexposed — and it is narrow

Only the **raw tmux pane text**. `AgentRuntime.capturePane` exists (`lib/agent-runtime.ts`,
full-history with a visible-pane fallback) and five internal modules use it —
`lib/fleet-continuity.ts`, `lib/session-restart.ts`, `services/agents-chat-service.ts` (×2),
`services/creation-helper-service.ts` — but no route and no script verb returns it. (`state
--pane` is not it: it merges `GET …/session` with `pane-status`, and the latter returns
`getPaneCommand` — the pane's command, not its text.)

The residual gap is therefore free-form pane output that is **neither a prompt, nor a
question, nor a status, nor part of the transcript** — e.g. text a slash command prints
directly to the pane. Real, but small, and the transcript covers most of what anyone would
want it for.

## Whether to build it at all

**Open question, and the honest answer may be no.** Against building it:

- the useful reads already exist (above);
- a raw pane scrape is a materially WIDER read than `/prompt`'s carefully-argued exposure — the
  prompt route is safe *because* it returns only what the pane already shows to that agent's
  own viewer, whereas a scrape returns scrollback: file contents, an echoed token, a peer's
  message;
- it would need `strict` classification AND declaration on `lib/sudo-guard.ts`'s agent branch.
  Classifying strict alone fails closed with a 403 that reads like policy — that trap already
  cost this repo 8 routes for the life of an epic marked `complete`.

For building it: closing the loop on a slash command whose only output is printed to the pane.

**Recommendation: do NOT build it unless a concrete need appears.** Priority dropped to 3,
severity to low. Left open rather than cancelled so the measurement survives — the next person
who asks "can we read an agent's terminal?" should find this answer, not repeat the search.

## Verification (only if it is ever built)

- Inject a known sentinel through the existing inject route and read it back — the closed-loop
  test no current test can write.
- A refusal test per authorization case asserting the REASON, not merely `success === false`.
- Neuter: remove the route's authorization and confirm exactly the refusal tests redden.

## Provenance

Filed 2026-08-04 while working the last of the three areas the USER's `/code-review --fix`
brief named. **Corrected the same day by the USER**, who pointed at the core plugin as the
place the hooks live. Everything in the "What ACTUALLY exists" table was then measured
first-hand in `scripts/ai-maestro-hook.cjs` and the route files.

## Approval log

- 2026-08-04T23:34:08+0200 — FILED as a proposal-tier finding, not self-mandated.
- 2026-08-04T23:39:45+0200 — **CORRECTED after the USER refuted the central claim.** Priority
  2→3, severity medium→low, effort medium→small. The card now records a narrow optional
  enhancement plus the measurement, instead of a defect that does not exist.

## Acceptance

- [x] the actual read-back surface is measured and written down, so the wrong claim cannot be
      re-derived from this card
- [ ] MANAGER (or USER) decides whether a raw-pane read is wanted AT ALL — the default answer
      is no
- [ ] if yes: the authorization contract is settled BEFORE the route (strict + declared on the
      agent branch; explicit self-vs-peer rule rather than inheriting `send-command`)
- [ ] if yes: `GET /api/agents/[id]/pane` + an `aimaestro-session.sh output` verb, with the
      closed-loop test and refusal tests above
