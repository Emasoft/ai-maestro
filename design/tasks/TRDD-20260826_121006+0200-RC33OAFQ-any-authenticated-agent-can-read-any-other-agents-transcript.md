---
trdd-id: RC33OAFQ
title: Any authenticated agent can read any other agent's full conversation transcript via conversations/parse
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T12:10:06+0200
updated: 2026-08-26T12:24:00+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
labels: [security, disclosure, route-authz]
external-refs: [TRDD-R268J32X, TRDD-OYNUJRSB]
---

## Problem

`POST /api/conversations/parse` is gated by **authentication only** and reads **any** `.jsonl`
under `~/.claude/projects/`. That directory holds the transcripts of every Claude session on the
host — measured 2026-08-26: **99 project directories, 1841 `.jsonl` files**, including other
agents' sessions and the owner's own.

**The gate admits agents, not just the operator** — this is the fact that decides it, and it was
read first-hand rather than assumed:

- `app/api/conversations/parse/route.ts` calls `enforceAuth(request)`.
- `lib/route-auth.ts::enforceAuth` → `authenticateFromRequest(request)`.
- `lib/agent-auth.ts:250 authenticateFromRequest` → `authenticateAgent(Authorization, X-Agent-Id,
  Cookie)`, whose success value is `{ agentId }`.

So a valid **agent** token satisfies the route. Agent A can POST a path naming agent B's
transcript and receive its parsed contents.

**Why this is worse than an ordinary read hole.** A transcript is not one datum — it is everything
that agent saw and did: file contents, command output, tool results, and any credential that
passed through its context. This session alone established that log lines containing secrets and
PII reach disk routinely (TRDD-MFTDMSJY: a keychain argv carrying an OAuth token, and account
emails, both nearly written to `pm2-error.log`). "Transcripts may contain secrets" is not a
hypothetical on this host.

## What is NOT the problem

Path traversal is properly closed and must not be re-litigated: a NUL check, `path.resolve`
**before** the prefix compare (the safe direction), an allowlist root of `~/.claude/projects`,
`resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path.sep)`, and a `.jsonl` suffix
requirement. API2-MAJ-14 did that job correctly. **The allowlist is exactly the boundary being
abused** — it confines the read to the transcript store, and the transcript store is the sensitive
thing.

## Proposed fix — the shape is a RULING, not a one-liner

Same disposition as `sessions/[id]/rename` (TRDD-OYNUJRSB): the correct policy is a decision, so
this is filed rather than patched. The candidates, in the order I would argue them:

1. **Operator-only.** The dashboard's legitimate use is a human reading any agent's conversation.
   If no agent needs this route, require the operator principal and the hole closes completely.
   Needs: confirm no in-tree agent-side caller (a `grep` for the endpoint across plugins/scripts,
   not just this repo).
2. **Own-transcript-only.** If agents do legitimately read their own history, resolve the caller's
   `agentId` to its transcript slug and require the requested path to be under it. Narrow, keeps
   the feature, and is the shape most likely to survive review.
3. Anything that merely *narrows the allowlist* is NOT a fix — the allowlist is already the
   boundary, and the disclosure happens entirely inside it.

## Verification

- A test driving the route with agent A's token against agent B's transcript path must be REFUSED
  (403), with a neuter proving the test reddens when the check is removed.
- A test proving the legitimate path still works (operator, or own-transcript, per the ruling).
- Re-run `tests/unit/agent-route-authorization-coverage.test.ts` — this route sits in that card's
  `NON_AGENTS_AUTHN_ONLY` ledger, and raising its guard CHANGES that ledger. R268J32X's own
  acceptance box records a 30-minute red suite from exactly this oversight; shrinking the ledger is
  the deliberate edit its contract requires.

## Estimated risk

LOW to fix, HIGH to leave. The route is small and the change is a guard, not a redesign. Option 1
risks breaking an agent-side caller nobody has enumerated yet — which is why enumeration is the
first step and not an assumption.

## Acceptance

- [x] **Enumerate every caller — DONE 2026-08-26T12:2x. Result: every caller is the OPERATOR UI;
      there is NO agent-side caller.** So **option 1 (operator-only) breaks nothing** and is the
      ruling to make.

      ```
      components/ConversationDetailPanel.tsx:84    `${hostUrl}/api/conversations/parse`
      components/MobileConversationDetail.tsx:111  fetch('/api/conversations/parse', …)
      services/headless-router.ts:778              the headless twin (forwards to the same route)
      services/config-service.ts:15,546            the service's own doc comment
      ```

      Swept `ai-maestro` + `ai-maestro-assistant-role-agent` + `ai-maestro-web-scenario-tester` +
      `claude-plugins-validation` + `~/.claude/plugins/cache` in three FORMS (literal path;
      `conversationFile`/`parseConversationFile`; UI/client fetch), because one needle proves
      nothing. Zero hits outside this repo. **NOTE the headless twin at
      `services/headless-router.ts:778` — it forwards to the same route, so any guard must be
      mirrored there or the fix is half a fix** (exactly the failure TRDD-8Q5EVGV1 documents).

      > **⚠ I FIRST GOT THIS WRONG AND THE MECHANISM IS WORTH MORE THAN THE ANSWER.** My first
      > sweep reported **zero callers**. Its `--include` list DID cover `*.tsx` — but I piped it
      > through `head -20`, and both component hits sorted below the cut. A truncated list and an
      > empty one are indistinguishable, and I was one step from ruling "dead code, delete it" on
      > a route the dashboard actively uses. Never terminate a sweep whose result is an ABSENCE
      > claim with `head`; count first (`| wc -l`), then look.
- [ ] Ruling recorded here on which principal the route serves
- [ ] Guard implemented per the ruling
- [ ] Refusal test (agent A → agent B's transcript = 403) + neuter recorded
- [ ] Legitimate-path test still green
- [ ] `agent-route-authorization-coverage.test.ts` ledger updated in the SAME commit as the guard

## Approval log

- 2026-08-26T12:10:06+0200 — FILED as a proposal-grade finding, `min-approval-requirement: manager`
  (cross-cutting security policy affecting what every agent may read). Found while deciding
  `conversations/parse` for TRDD-R268J32X; the three-hop read of `enforceAuth` ->
  `authenticateFromRequest` -> `authenticateAgent` is what settled it, and the previous session
  had recorded it as an open question rather than guessing.
