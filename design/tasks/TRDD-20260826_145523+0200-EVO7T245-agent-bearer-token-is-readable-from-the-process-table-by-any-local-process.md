---
trdd-id: EVO7T245
title: The agent bearer token AID_AUTH is readable from the process table by any local process — argv at 47 call sites and environment at every one
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:55:23+0200
updated: 2026-08-26T15:14:30+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: user
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
labels: [security, credential-exposure, agent-identity, local-attacker]
external-refs: [TRDD-R268J32X]
---

## Problem — raised by the USER 2026-08-26, and CONFIRMED EMPIRICALLY, not by reading

The USER's premise was that agents pass identity **as CLI arguments**, visible to `ps`. That is
**half right, and the half that is wrong makes it worse rather than better.**

### What is actually true

`AID_AUTH` is an **environment variable**, not a script argument. The server mints it and injects
it into the agent's tmux session at spawn (`services/sessions-service.ts:1088`,
`runtime.setEnvironment(actualSessionName, 'AID_AUTH', …)`). The CLI scripts read it from the
environment (`scripts/agent-helper.sh:190`). So no ai-maestro script carries a token on its own
argv.

**But it is then placed on `curl`'s argv**, at `scripts/agent-helper.sh:191`:

```sh
eval "${_arr_name}"'=(-H "Authorization: Bearer ${AID_AUTH}")'
# used as:  curl -s "${auth_args[@]}" ...
```

**47 call sites** across the script family build a curl invocation this way.

### EXPOSURE 1 — argv, world-readable. Proven, not inferred.

A live probe with a fake token, snapshotted from a separate process:

```
98652 curl -s --max-time 8 -H Authorization: Bearer aid_tk_PROOFQQ_98650 http://10.255.255.1/x
```

Positive control: 2 curl lines visible in the same snapshot, so the probe can see what it hunts.
**Any process on the host can read the token during the request window** — and an agent making API
calls in a loop keeps that window open more or less continuously.

### EXPOSURE 2 — the environment, and THIS is the one that breaks the obvious fix

The reflex fix is "keep it in the environment, off argv". **Measured on this platform, that is not
a fix:**

```
$ ps eww -p <pid>          →  env visible to a same-user reader: 1   (PROBE_SECRET found)
```

`ps eww` prints the environment of a process owned by the same user. **Every ai-maestro agent runs
as the same Unix user.** So `AID_AUTH` sitting in a tmux session's environment is readable by every
other agent on the host, continuously — not just during a request.

**The threat model this breaks is the real one:** agent A reads agent B's token and acts as B. The
governance system's entire authorization layer — titles, the R6 graph, team ACLs, every gate
decided under TRDD-R268J32X today — keys off an identity that any peer can steal.

### What the codebase ALREADY does right, which is why this is an oversight and not a policy

The MAESTRO password is handled correctly: `agent-helper.sh:203-204` documents *"password via
stdin at every hop (`jq -Rn 'input'`, `curl -d @-`)"*, and `aimaestro-governance.sh:449` /
`aimaestro-panel.sh:74` use `--data-binary @-`. **The technique is known, applied to the password,
and not applied to the bearer token.**

## The USER's proposed designs, assessed honestly

1. **"Reduce identification to a single token."** Already true — `AID_AUTH` IS a single opaque
   bearer. This is not the missing piece.
2. **"Never pass the token as a CLI argument."** Correct and achievable. `curl -K -` reads options
   from stdin, including `header = "Authorization: Bearer …"`. **Proven on curl 8.7.1:** argv shows
   only `curl -s -K -`, token absent, positive control passing. Caveat: stdin is already used for
   request bodies at some sites, so the two cannot both use `-` naively.
   **This fixes EXPOSURE 1 only.**
3. **"Associate the PID with the agent token via a third guarantor that does not require the
   CLI."** **This is the strongest idea in the message and it is implementable.** The guarantor is
   the KERNEL: a Unix-domain socket carries peer credentials (`SO_PEERCRED` on Linux,
   `getpeereid`/`LOCAL_PEERCRED` on macOS) that the client cannot forge and that never appear on
   the wire, in argv, or in the environment. The server already spawns every agent and owns its
   tmux session, so it can map a connecting PID up the process tree to the owning agent.
   **This fixes BOTH exposures, and it is the only proposal here that fixes EXPOSURE 2.**
   The server listens on TCP 23000 only today — no UDS exists yet (verified).
4. **"TLS-like renegotiation, never the same key twice."** **This solves a different problem and I
   would argue against it.** The traffic is loopback; there is no wire attacker. The attacker reads
   *the endpoint's own memory-adjacent state* — argv and environ. Rekeying does not help when the
   adversary can read whatever key the client currently holds. It would add substantial complexity
   against a threat that is not the one measured here.
5. **"An agent cannot send network messages without a CLI."** True, and it does not matter. The CLI
   stays; what changes is how it authenticates. Under (3) the CLI opens a UDS and the kernel
   attests who it is — the agent needs no secret at all.

## "But the agent must pass the secret through the Bash tool" — NO. It passes nothing today.

The USER raised this as the objection that would sink stage 2: *the agent must call the script via
Claude Code's Bash tool, and Claude Code has no internal transport, so the secret must cross the
tool boundary as an argument.* **Measured: it does not, and it never did.**

- **The main agent CLI takes no identity argument.** `aimaestro-agent.sh <command> [options]`. An
  agent types a VERB. `AID_AUTH` is already in the process environment it inherited from its tmux
  session — the server put it there at spawn. Nothing secret is typed, so nothing secret crosses
  the Bash-tool boundary.
- **Where an identity IS typed, the server overrides it.** `aimaestro-message.sh --from <agent>` is
  a display/convenience claim, not an authorization one: `app/api/messages/route.ts:81` does
  `body.from = auth.agentId` for any authenticated agent. Same shape as `messages/forward`
  (decided CLEAR under TRDD-R268J32X). Argument-level spoofing is already closed.

**So the Bash tool's limitation does not bite, because the requirement was never "a special
transport" — it is "the secret must not have to be TYPED".** The script is a child process; it can
open a socket, consult the kernel, read a file. None of that has to be expressible in the command
line the agent writes.

**Stage 2 makes this strictly better, not harder.** Today the agent holds a secret it never types
(env). Under UDS + peer credentials the agent holds **no secret at all**: it types
`aimaestro-agent.sh list`, the script connects, the kernel reports the peer PID, and the server
maps PID → agent through the session tree it already owns. Removing `AID_AUTH` from the
environment is the POINT of stage 2, and it is what closes EXPOSURE 2.

### The residual this design does NOT solve, named so it is not mistaken for solved

If identity derives from the process tree, then **anything running inside agent A's session IS
agent A** — including whatever A was talked into running. That is correct behaviour (A cannot
become B), and it means a prompt-injected A still acts with A's full privileges. A confused-deputy
problem, not a transport problem; no authentication scheme here addresses it, and TRDD-V2BLADSF is
a live example of how A gets talked into things.

### One narrower argv exposure found while checking this

`scripts/aid-register.sh` takes `--token <jwt>` (an admin JWT) as an ARGUMENT — a genuine argv
exposure for anyone who runs it. It is a provisioning script against a 23blocks Auth server rather
than the per-call agent path, and under the USER's 2026-08-26 ruling an external instance must not
run registration at all. Recorded as in-scope-adjacent, not folded into the 47.

## Proposed fix — staged, because (3) is a design change and (2) is not

- **STAGE 1 (contains EXPOSURE 1, no design change):** route the auth header through `curl -K -`
  at all 47 sites, in the shared helper so no site decides for itself.

  **"Use stdin" is NOT sufficient as an instruction — the PRODUCER decides whether it works, and
  this is easy to get wrong.** `ps` shows argv, so pipe CONTENTS never leak; the exposure moves to
  whatever puts the bytes on the pipe. Measured 2026-08-26 with a positive control (an external
  process holding the secret in argv WAS visible; a builtin-fed pipeline with a live reader was
  not):

  | producer | leaks to `ps`? |
  |---|---|
  | shell BUILTIN (`printf`, `read`, `echo` under bash/zsh) | **no** — no separate process exists |
  | EXTERNAL command with the secret in its argv (`/bin/echo s`, `python -c "print('s')"`) | **yes** |

  So stage 1 must specify a builtin producer, and a reviewer must check the producer rather than
  the presence of `-K -`. **The password path already models this exactly**
  (`scripts/agent-helper.sh:228-233`): `read -rs` from the TTY, `printf` (builtin) into `jq -Rnc`,
  `printf` (builtin) into `curl -d @-`, with `unset` after each. Copy that shape.

  **Fragility worth knowing rather than discovering:** this rests on `printf` resolving to the
  BUILTIN. `/usr/bin/printf` exists, and a shell that resolves to it would expose the secret in
  that process's argv. Measured as a builtin here — but that is a property of the shell, not of
  the technique.

  **Resolve the stdin collision with request bodies explicitly** — some sites already pipe the
  body, and both cannot naively use `-`. Options: a `--config` FIFO for the header, or the body via
  `--data @file` with a 0600 temp — noting a 0600 temp is same-user-readable and therefore
  acceptable for the BODY only, never for the token.

  **And none of this touches EXPOSURE 2.** Stdin says nothing about `ps eww` /
  `/proc/<pid>/environ`, nor about a same-user debugger attaching to process memory.
- **STAGE 2 (closes EXPOSURE 2):** UDS + kernel peer credentials, with the server resolving PID →
  agent from the session tree it already owns. Retire `AID_AUTH` from the agent environment
  entirely once this lands — while it remains in the environment, stage 1 is cosmetic.
- **NOT proposed:** rekeying/renegotiation (item 4), and any scheme that keeps a long-lived secret
  in a place a same-user process can read.

**Ordering matters and stage 1 alone must not be reported as a fix.** With the token still in the
tmux environment, removing it from argv narrows the window from "during each request" to "always"
— i.e. it changes nothing for a patient attacker. Stage 1 is worth doing because it is cheap and
removes the world-readable half; it is not a resolution.

## Verification

- A test asserting the built curl invocation contains no `Bearer` on argv, with a neuter.
- A live probe repeating the measurement above against a REAL agent CLI call, asserting a `ps`
  snapshot taken during the call contains no token — with a positive control proving the snapshot
  can see the curl process at all (the first attempt at this measurement returned a false zero
  because curl to a closed port exited before the snapshot).
- For stage 2: a test that a forged PID cannot authenticate, and that agent A's process cannot
  resolve to agent B.
- `ps eww` on a live agent session must show no `AID_AUTH` once stage 2 lands.

## Acceptance

- [ ] USER ruling on stage 2's architecture (UDS + peer credentials) — it changes how every agent
      authenticates, so it is user-tier, not manager-tier
- [ ] Stage 1 implemented in the shared helper, all 47 sites, stdin collision resolved
- [ ] Neuter recorded for the argv assertion
- [ ] Live `ps`-during-call probe with its positive control
- [ ] Stage 2 implemented; `AID_AUTH` removed from the agent environment
- [ ] `ps eww` on a live agent shows no token

## Approval log

- 2026-08-26T14:55:23+0200 — FILED at `min-approval-requirement: user`, priority 0, severity
  critical. Raised by the USER; every claim here measured first-hand rather than reasoned:
  the argv exposure with a live `ps` snapshot (after one false-zero attempt whose instrument
  failed), the environment exposure with `ps eww`, and the `curl -K -` mitigation with a positive
  control. The USER's premise was corrected in one direction (identity is not on the SCRIPT's argv)
  and confirmed worse in another (it is on curl's argv AND permanently in the environment).
