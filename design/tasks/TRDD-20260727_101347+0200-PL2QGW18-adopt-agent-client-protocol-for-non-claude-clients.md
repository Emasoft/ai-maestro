---
trdd-id: PL2QGW18
title: Adopt the Agent Client Protocol for every non-Claude client
column: design
scope: project
project-id: ai-maestro
created: 2026-07-27T10:13:47+0200
updated: 2026-08-25T17:28:11+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
effort: large
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-27T10:13:47+0200
relevant-rules: [R18, R20, R50, R51]
blocked-by: []
npt: []
eht: []
external-refs: [https://agentclientprotocol.com/, https://agentclientprotocol.com/get-started/agents, https://github.com/agentclientprotocol/agent-client-protocol]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-27

**DEFERRED BY THE USER — do not start.** USER 2026-07-27: *"we have a priority now to make the
ai-maestro work perfectly with claude code. the other clients can wait."* This TRDD exists so the
finding is not lost, not so it can be picked up. It sits in `backburner` deliberately.

**THE FINDING (USER, 2026-07-27).** The **Agent Client Protocol (ACP)** is a protocol for
controlling a coding-agent client remotely. **30+ clients already support it natively** — opencode,
kimi and others — which means ai-maestro could drive them **without parsing the terminal and
injecting keystrokes**, the mechanism it uses today for Claude.

That is the load-bearing point: the current multi-client story is terminal-scraping plus curated-key
injection, which is fragile per-client work that must be redone for every client and every UI change
those clients ship. ACP replaces that whole surface with a protocol for every client that speaks it.

**THE CLAUDE EXCEPTION, and it is not a detail.** Claude is supported by ACP **only in API-SDK
token-usage mode**, which does NOT cover the owner's Pro Max subscription. So **Claude stays on the
existing direct/terminal path** and is the permanent exception; ACP covers everything else. Any
design that assumes "ACP for all clients" is wrong on the one client that matters most today.

**Codex needs an adapter** rather than native support — see the agents page below.

## Sources, and the order to read them in

1. **Read the WEBSITE FIRST** — <https://agentclientprotocol.com/>. The USER notes it is browsable
   as markdown, so it can be fetched as `.md` and read cheaply.
2. **The agent list + the Codex adapter recipe** — <https://agentclientprotocol.com/get-started/agents>
   (both the full list of supporting clients and what an adapter requires).
3. **The schema LAST** — the official repo
   <https://github.com/agentclientprotocol/agent-client-protocol>, which publishes the **v1 and v2**
   schemas as a release. Read it after the prose, not instead of it.

**USER instruction on HOW to read them:** use a cheap model — **sonnet[1m] at medium effort** — to
read and extract, not the orchestrator. This is bulk document reading; it is exactly the Stage-1
scanner case, and doing it in an expensive context is waste.

## What this would touch when it is eventually taken up

Not a design — a scope sketch, so the eventual estimate is not started from zero:

- `lib/client-plugin-adapters/` and `lib/client-capabilities.ts` — today's per-client abstraction;
  ACP would sit alongside or beneath it.
- The terminal-continuity automaton (TRDD flock E) — its per-client event registry exists precisely
  because there is no protocol. For an ACP client most of that registry becomes unnecessary; for
  Claude it stays. **Do not delete flock E's Claude path when ACP lands.**
- `ChangeClient` (see TRDD-B6NUEGMP) — client change is already the least-atomic pipeline; adding a
  protocol-driven client type must not make that worse.
- `services/cross-client-skill-service.ts` + the Universal IR — conversion is about PLUGIN FORMAT,
  which is orthogonal to ACP's CONTROL channel. A converted plugin still needs emitting; ACP does
  not remove that.

**Open question to resolve during the study, not now:** does ACP cover session lifecycle
(start/stop/resume) and inbox-style messaging, or only turn-level control? The answer decides
whether ACP replaces the per-client runtime enforcer (TRDD-D0SI66XM) or merely complements it.

## Acceptance (for the eventual work, not now)

- [ ] The website has been read via a sonnet[1m]/medium pass and the findings summarized in this TRDD
- [ ] The v1-vs-v2 schema difference is recorded, with which version ai-maestro targets and why
- [ ] The supporting-client list is captured with, for each, native vs adapter-required
- [ ] The Claude exception is explicit in the design and in the code path that selects a driver
- [ ] Codex's adapter requirement is specified before any Codex work starts

## Approval log

- 2026-07-27T10:13:47+0200 — MANDATE issued by USER (min-approval-requirement: none). The USER
  directed that this be written as a TRDD and scheduled for later; authoring it is the whole of the
  authorized work. Born approved, deliberately parked in `backburner`.
