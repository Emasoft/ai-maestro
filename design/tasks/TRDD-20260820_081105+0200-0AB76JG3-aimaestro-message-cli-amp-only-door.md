---
trdd-id: 0AB76JG3
title: aimaestro-message.sh — the AMP CLI that becomes the only messaging door once the client tool is denied
column: todo
created: 2026-08-20T08:11:05+0200
updated: 2026-08-20T08:11:05+0200
current-owner: ai-maestro-hub
task-type: feature
scope: project
project-id: ai-maestro
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-20T08:11:05+0200
relevant-rules: []
implementation-commits: [556f340f]
---

# aimaestro-message.sh — the AMP CLI that becomes the only messaging door

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20

- **The deny is ALREADY LIVE in code** (`556f340f`): the `amp-only-messaging` agent-workdir
  invariant writes `permissions.deny: ["SendMessage"]` into every agent's
  `.claude/settings.local.json` on create/wake/periodic. Two attributed neuter runs recorded
  in the source.
- **This card is the OTHER half.** With the client tool gone, `amp-send.sh` is the only
  channel — and it is NOT one of the 14 CLIs in `design/specs/aimaestro-scripts-spec.md`,
  so the surface plugins must now depend on is unspecified. That is the gap.
- **NEXT ACTION:** collect the MAINTAINER's exact verb shape (asked 2026-08-20), write the
  spec section FIRST, then implement against it. Specs-first is the standing mandate for
  new capability.
- **NOT yet done:** the CLI, the spec section, and the sweep of plugin prose that still
  tells an agent to use the client tool.

## Problem

USER directive, 2026-08-20: *"inside the ai-maestro harness the SendMessage functionality
will be blocked, and the agents must be forced to only use AMP messaging."*

Denying the client tool is the easy half and it is done. The hard half is that it removes a
channel plugins currently reach for, and the replacement is not spec'd. The MAINTAINER
already hit this: its approval-gate skill calls `amp-send` directly, which sits outside the
14 spec'd CLIs — so a plugin is depending on an unspecified surface for the one thing that
is about to become mandatory.

## Root cause

AMP delivery was always available, but as a script the core plugin happened to expose rather
than as a spec'd, versioned CLI. That was tolerable while the client tool existed as an
informal fallback. It stops being tolerable the moment the fallback is denied: an
unspecified surface with no alternative is a single point of failure for every agent
conversation in the fleet.

## Proposed fix

1. **Spec first.** Add an `aimaestro-message.sh` section to
   `design/specs/aimaestro-scripts-spec.md` covering, at minimum, the two verbs the
   MAINTAINER asked for:
   - `send <recipient|--id UUID> <subject> <body> [--priority ...]`
   - `resolve <name-pattern>` — name → agent id, the lookup every caller hand-rolls today
     with `jq` over the index, degrading to a silent no-op when the index is absent.
2. **Implement against the spec**, as a thin transport over the existing SendMessage AIO
   pipeline — never a second delivery path. The R6 graph gate, the AID, and the log are the
   reason AMP is the mandated channel; a CLI that bypasses any of them defeats the directive
   it exists to serve.
3. **Regenerate** the spec (`yarn specs:gen`) so `specs:check` stays green.
4. **Sweep plugin prose** for instructions that route an agent to the client tool, and relay
   the correction to each plugin session. Prose is invisible to tsc, lint and the suite —
   an instruction naming a denied tool still executes and fails at runtime.

## Verification

- `aimaestro-message.sh resolve <name>` returns the id for a live agent and a DISTINGUISHABLE
  failure (never a silent empty) when the name does not resolve — the no-op degradation is
  the bug being replaced, so reproducing it would be a regression.
- `send` to a recipient the R6 graph forbids is REFUSED by the same gate the AIO pipeline
  applies, with the refusal reason surfaced — proving the CLI is a transport and not a
  second door.
- `yarn specs:check` exits 0 with the new section present.

## Estimated risk

MED. The implementation is thin, but it is the only messaging channel once the deny is live
on registered workdirs, so a defect here is fleet-wide and silent. Depends on nothing; the
MAINTAINER is the first consumer and has asked for it.

## Acceptance

- [ ] MAINTAINER's exact verb shape collected (arguments, output, failure modes)
- [ ] `aimaestro-message.sh` section written in the scripts spec BEFORE any implementation
- [ ] CLI implemented as a transport over the existing AIO pipeline, no second delivery path
- [ ] `resolve` fails distinguishably rather than degrading to a no-op
- [ ] a forbidden-recipient `send` is refused by the R6 gate, with the reason surfaced
- [ ] `yarn specs:check` green
- [ ] plugin prose swept for client-tool instructions; corrections relayed to each session

## Approval log

- 2026-08-20T08:11:05+0200 — MANDATE issued by the hub under the USER's standing Phase-2
  delegation (min-approval-requirement: none — in-scope server work on this project).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
