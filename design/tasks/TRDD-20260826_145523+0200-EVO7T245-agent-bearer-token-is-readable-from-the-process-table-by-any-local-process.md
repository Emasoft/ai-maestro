---
trdd-id: EVO7T245
title: The agent bearer token AID_AUTH leaks at three of five lifecycle stages — delivery argv, session environment, and 47 curl call sites
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T14:55:23+0200
updated: 2026-08-26T16:15:40+0200
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

### EXPOSURE 3 — DELIVERY. Raised by the USER 2026-08-26, missed by my first pass, PROVEN.

The USER asked whether an attacker could capture the token *at the moment the server injects it*.
**Yes.** `lib/agent-runtime.ts:386`:

```ts
async setEnvironment(name: string, key: string, value: string): Promise<void> {
  // Use execFileAsync (array args, no shell) to prevent shell injection (CC-P1-502)
  await execFileAsync('tmux', ['set-environment', '-t', name, key, value])
}
```

**The comment is correct and insufficient.** Array args do prevent shell *injection*; they do
nothing about argv *visibility*. The token is the 5th argv element of a `tmux` process.

A first probe missed it — `set-environment` exits far faster than a 0.4 s snapshot, and that false
zero would have read as "not exposed". A polling attacker is the right model, and it wins.
Captured verbatim by a same-user poll racing the injection:

```
tmux set-environment -t r292415 AID_AUTH aid_tk_EVIDENCE_92415
```

**Honest limit on the rate:** the window is demonstrably catchable — hit repeatedly across a 4 s
race — but I did **not** determine a per-injection probability and will not quote one, because
several polls can observe a single injection. What matters operationally is the USER's point:
**this fires once per agent per server restart**, so an attacker who polls across restarts
accumulates opportunities rather than needing to win once.

**This is the exposure that most strongly favours stage 2 and most weakens stage 1.** `curl -K -`
does nothing for it: the leak happens before any CLI runs. And there is no argv-free way to hand a
value to `tmux set-environment` — `tmux new-session -e KEY=VAL` has the same shape. **The only fix
is to stop delivering a secret at all**, which is precisely what UDS + peer credentials does.

### The one stage that is CLEAN — registration and minting, which the USER also asked about

*"Is the AID registration still using the CLI?"* **No, and this is the part with no finding.**

- Minting is in-process: `randomBytes(TOKEN_RANDOM_BYTES)` in `lib/aid-token.ts:375,426`.
- Registration is an in-process route. Swept `services/ lib/ app/` for shell-outs to
  `aid-init`/`aid-register`/`amp-register`: **2 hits, both rate-limiter KEY STRINGS** in
  `app/api/v1/register/route.ts:47,54` — read, not counted. Positive control: the same sweep style
  finds 12 real `execFileAsync('tmux'` shell-outs, so it can see a shell-out when one exists.

So the credential's lifecycle is clean at both ends and leaks in the middle three stages:

| stage | mechanism | exposed |
|---|---|---|
| mint | `randomBytes`, in-process | **no** |
| register | in-process route, no CLI | **no** |
| **deliver** | `tmux set-environment … <token>` | **YES — argv, proven** |
| **at rest** | tmux session environment | **YES — `ps eww`, proven** |
| **in use** | `curl -H "Authorization: Bearer …"` ×47 | **YES — argv, proven** |

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

## ⚠ CORRECTION 2026-08-26T15:3x — I CALLED STAGE 2 "IMPLEMENTABLE" WITHOUT CHECKING THE RUNTIME

The USER asked the load-bearing question: *if stage 2 delivers no secret, how does the server
identify the agent?* Answering it properly refuted my own feasibility claim.

**Node exposes NO peer credentials on a Unix socket.** Measured under the pinned Node 22:

```
socket props matching cred/peer/pid/uid: []
typeof c.getPeerCredentials: undefined
remoteAddress: undefined
```

`SO_PEERCRED` (Linux) and `LOCAL_PEERPID` (macOS `getsockopt(fd, SOL_LOCAL, …)`) are real syscalls
and **`net.Socket` surfaces neither**. I asserted "implementable" from the SYSCALLS EXISTING and
never asked whether our runtime can reach them — the same *mechanism exists ≠ available to us*
error this card already documents twice (a signature read as a behaviour; a name read as a
consumer). **Third instance, in my own proposed remedy.**

### What actually survives, and at what cost

- **(A) Native addon / FFI for `LOCAL_PEERPID`.** Works, and adds a compiled dependency to a
  project that already carries real native-module pain (node-pty pinned to NODE_MODULE_VERSION
  127, better-sqlite3 capped below Node 26). A new native module is not a small ask here.
- **(B) INHERITED FILE DESCRIPTOR — the strongest secret-free option, and UNVERIFIED.** The server
  creates a socketpair at spawn and passes one end INTO the tmux session as an inherited fd. The
  capability IS the descriptor: unforgeable, not in argv, not in the environment, and nothing to
  capture at delivery — the fd number may be public because a number is useless without having
  inherited the descriptor. This needs no peer credentials at all.
  **NOT YET MEASURED, and it must be before anyone commits to it:** does `tmux` preserve an
  inherited fd into a pane's process, and does the shell Claude Code's Bash tool spawns inherit it?
  If either answer is no, (B) is dead and (A) is the only secret-free route.
- **(C) Anything that keeps a long-lived secret** — file, env, argv — fails to EXPOSURE 2 by
  construction, because every agent is the same Unix user.

### (B) MEASURED AND DEAD — 2026-08-26, twice, for two independent reasons

I said (B) must be measured before anyone commits. It was, immediately:

```
parent holds fd 9 → tmux new-session → pane sees:  0 1 2 3      (existing server)
parent holds fd 9 → tmux -L fresh … → pane sees:   0 1 2 3      (BRAND NEW server)
```

**tmux daemonizes and closes inherited descriptors** — standard daemon behaviour, and the fresh
server confirms it is tmux's doing rather than an artefact of connecting to a pre-existing one.

**And it would have failed anyway, for a reason the fd test cannot see:** every pane is a child of
ONE shared tmux server process. An fd the server holds is held for ALL panes, so a single
descriptor is a shared capability, not a per-agent identity. Two independent kills.

### THE ROOT CAUSE, which every candidate has been failing against

Stepping back after (B): **every scheme here dies to the same fact — all agents run as the SAME
UNIX USER.** That is what makes `ps eww` readable across agents, what makes a 0600 file useless as
a separator, and what makes any at-rest secret stealable by a peer. No transport, token format, or
handshake fixes it, because the OS is being asked to distinguish principals it considers identical.

**The candidate that follows from that, and is UNVERIFIED:** give each agent its own **uid**, and
give each agent a socket owned by that uid at mode 0600. The kernel then enforces who may connect,
via ordinary file permissions — **no secret, no peer-credential API, and no native addon**, so it
sidesteps the Node limitation entirely rather than working around it. `ps eww` also stops exposing
one agent's environment to another, because that is a cross-user read.

**MEASURE 1 — DONE, and it PASSES.** macOS enforces filesystem permissions on `connect(2)` to a
Unix socket. A socket at mode `0000` refuses even its own owner:

```
mode after chmod: 0
RESULT: REFUSED EACCES — perms ARE enforced on connect()
```

So the kernel will enforce a per-uid socket with no help from us. **This is the design (call it
(D)), and it beats (A):**

| | (A) native addon | (D) per-uid socket |
|---|---|---|
| secret delivered | none | none |
| needs peer-credential API Node lacks | **yes** | no |
| needs a compiled dependency | **yes** | no |
| enforcement | our code, after reading the peer pid | **the kernel, before `connect` returns** |
| fixes EXPOSURE 2 (`ps eww`) | **yes — see the correction below** | **yes** |

(A) leaves `AID_AUTH`'s replacement enforceable only by code we write; (D) removes the shared-uid
premise that every exposure on this card rests on.

### ⚠ CORRECTION — I scored (A) wrong on EXPOSURE 2, and the USER caught it

The table above originally read *"(A) fixes EXPOSURE 2: no — env still readable by peers"*. **That
is wrong.** Under (A) the peer-credential lookup means there is **no token at all** — removing
`AID_AUTH` from the environment IS the design, not an extra step. So there is nothing left for
`ps eww` to expose, and (A) closes all three token exposures exactly as (D) does.

**What (A) actually leaves is not a token exposure — it is the shared-uid weakness itself.** Agent
A and agent B remain the same Unix principal, so A can still read B's files, signal B's processes,
and inspect its command lines. The credential stops being stealable; the isolation never existed.
That is a materially different and smaller claim than the one I put in the table.

**And the USER's follow-up — "can a custom binary hide the env, since we're building one anyway?"
— the answer is: you should not try.** Hiding is the wrong goal. An env var cannot be retracted
from same-uid `ps eww` by userspace (the kernel serves it; a process can scribble over its own
`environ` after start, but the value is also held in the tmux SESSION environment, and racing that
is a hack that fails open). **Delete the secret instead of concealing it** — which both (A) and (D)
already do. A concealment that half-works is worse than none, because it reads as protection.

### VIABILITY VERIFICATION — USER directive 2026-08-26: "verify that A and D are truly viable"

**(A) — VERIFIED END-TO-END. Three links, each measured, none inferred.**

1. **The kernel really does report the peer PID.** `getsockopt(SOL_LOCAL=0, LOCAL_PEERPID=0x002)`
   over a UDS, exercised from Python (which can reach the syscall Node cannot):

   ```
   kernel says peer pid : 69080     client CLAIMS pid : 69080     kernel == claim : True
   kernel != server pid : True
   ```

   My FIRST version of this test used a same-process thread as the client, so `pid == os.getpid()`
   was trivially true and proved nothing. Redone with two real processes, which is the only shape
   that discriminates.
2. **A PID inside a pane walks up to that pane.** With a child spawned in a live tmux pane:
   `74982 74485 sleep` — the child's ppid is exactly the `pane_pid` tmux independently reports.
   Two failed attempts first: one `pgrep -P` chain that found nothing, and one that matched a
   DIFFERENT session's process because I grepped a generic command name globally instead of
   scoping to my own pane. Wrong-population, twice, in the same probe.
3. The server already owns session → agent, so PID → pane → session → agent is complete.

**And (A)'s cost is LOWER than I said.** I scored it as needing a compiled Node addon. It does not
necessarily: **Python3 ships with macOS and reaches `LOCAL_PEERPID` directly** — that is how the
test above ran. A small sidecar or helper can own the UDS listener and the peer lookup, so
"compiled dependency" is one implementation of (A), not a requirement of it. That materially
narrows the gap to (D).

**PID-reuse is not an exploit here**, worth stating because it is the obvious objection: the
credential is read from a LIVE connection, so the peer process necessarily still exists while the
lookup happens. There is no window in which a recycled PID answers for a dead one.

**(D) — VIABLE, WITH ONE CORE CLAIM I CANNOT VERIFY ON THIS MACHINE.**

Verified: macOS enforces permissions on `connect(2)` (mode 0000 → EACCES); tmux sockets are
relocatable, widenable, and take ACLs.

**NOT verified, and not verifiable here: that a DIFFERENT uid is actually denied.** Every test ran
as one user. Proving it needs a second account, and creating a system user is a privileged,
hard-to-reverse change I will not make unasked.

What the evidence supports is an INFERENCE, labelled as one: the EACCES at mode 0000 proves the
kernel **evaluates file permissions at connect time**, and file permissions are uid-based, so a
foreign uid lacking bits would be refused by the same check. Standard POSIX, consistent with the
measurement — but inferred, not observed.

**So the two are not equally proven.** (A) is verified in every link. (D) rests on one unobserved
step plus an unmeasured operational cost (per-uid provisioning, the privileged spawn helper). If
the ruling wants certainty today, (A) is the one that has it.

### ⚠⚠ (A) IS VIABLE AND **NOT** IMPERSONATION-PROOF — attack executed 2026-08-26

The USER's challenge: *"you only proved that A is viable, not that it is hack-proof."* Correct, and
attacking it broke it. **The attacker does not need to defeat the peer-credential mechanism at
all.**

**The attack, executed:** acting as agent A, inject a command into agent B's pane with
`tmux send-keys -t <B> …`. Then trace what runs:

```
victim pane_pid = 98120 ; injected sleep pid = 98511
ancestry: 98511 -> 98120
REACHES the victim pane: YES
```

A process **agent A caused to exist** has an ancestry that resolves to **agent B**. Under (A) the
server would attribute it to B — *correctly, by its own logic*. The identity system works
perfectly and the attacker still wins.

**Root cause: all agents share ONE tmux server.** The socket is per-USER (`/tmp/tmux-501`, mode
0700) and every agent is that user, so any agent can drive any other agent's pane. Agent A simply
makes B run the CLI.

**This defeats every scheme that binds identity to a process or session, including today's.** It is
not a flaw in `LOCAL_PEERPID`; it is that "which agent is this process" has a true answer that the
attacker controls. **And it cannot be fixed within one uid:** a per-agent tmux socket
(`-S /path/agent-N`) does not help, because file permissions and ACLs cannot separate principals
the kernel considers identical — the owner always has access.

**So the comparison inverts:**

| | (A) peer-cred | (D) per-uid |
|---|---|---|
| stops token theft | yes | yes |
| **stops impersonation via `tmux send-keys`** | **NO — demonstrated** | yes — B's socket is another uid's, unreachable |

**The USER's objection to (D) stands and is not answered by this.** Hundreds of accounts per day
is a real operational mess, and per-uid is not cross-platform. **That tension is now the actual
decision**, and it is a genuine one — not a case where the cheap option is also safe.

**A third direction, NAMED AND UNVERIFIED, because I will not assert a mechanism I have not run:**
macOS `sandbox-exec` / seatbelt profiles can restrict which paths a process may open, which could
deny agent A access to the shared tmux socket without separate uids. Whether it survives tmux's
client/server model, whether Claude Code runs under it, and whether an equivalent exists on Linux
(seccomp/AppArmor/namespaces) are all **unmeasured**. It is a lead, not an option.

**Method note:** this attack took FOUR attempts, and three of them produced a FALSE NEGATIVE that
would have read as "the attack fails" — a payload broken by shell escaping, a `capture-pane` that
showed an empty pane, and two ancestry scans looking at the wrong DEPTH (the pane shell forks a
child shell, so the injected process is a grandchild). **A failed attack probe is the most
dangerous false zero on this card**, because it licenses shipping the thing it was meant to test.
Each was caught only by a positive control asking "did the injection land at all?".

### Q: can one user control another user's tmux? YES — mechanism verified

Relevant only to (D). Measured:

```
/tmp/tmux-501                       drwx------      ← the DEFAULT socket dir is per-uid, locked
tmux -S /tmp/shared-sock … 
  → srw-------                      ← relocatable
  → chmod 770 → srwxrwx---          ← widenable (the classic shared-session pattern)
  → /bin/chmod +a "user allow read,write"
    srw-------@  0: user:… allow read,write   ← macOS ACLs work on the socket
```

So the maestro server (uid 501) can drive an agent's tmux server owned by another uid, by putting
the socket at a known path and granting **exactly uid 501** via an ACL. ACLs matter here rather
than groups: a per-agent group would need one group per agent, and macOS has historically capped
supplementary groups (16) for some APIs — an ACL sidesteps that and grants one principal, so
agents still cannot reach each other.

**Caveat, stated because I cannot close it here:** every step above was run as ONE user. That the
grant actually works ACROSS uids needs a second account to prove. The mechanism exists and is
configurable; the cross-user behaviour is expected, not measured.

**(One instrument note: `chmod +a` first failed with `invalid mode: '+a'` because GNU chmod is on
PATH here. `/bin/chmod` is the one with ACL support — the GNU-vs-BSD trap this repo already
records.)**

**MEASURE 2 — PARTLY DONE, and it names the blocker precisely.** The server runs as
**`emanuelesabetta`, uid 501 — not root** (measured from the process table). Three consequences,
all POSIX, none avoidable by cleverness:

- it **cannot `chown`** a socket (or a containing directory) to another uid — only root may give a
  file away;
- it **cannot create users**;
- it **cannot spawn a process as another uid** — `setuid` needs privilege.

**So (D) is not a code change the server can make unilaterally. It needs a one-time privileged
provisioning step**, and that is the honest shape of its cost: the human (or an installer) creates
the per-agent uids once, and the server is granted a narrow privileged helper to spawn a session as
one of them. That is bounded and auditable — a small helper with one job — but it is a real
addition to the install story, and it is the part to weigh against (A)'s compiled dependency.

**MEASURE 2 — REMAINDER STILL OPEN.** Per-uid agents need: user creation on macOS,
tmux and Claude Code running as another uid, workdir ownership, and `chown` on the socket — which
needs privilege the server may not have. **This is an operational question, not a security one,
and it is the one that decides (D) vs (A).** Not measured; do not let the security verdict above
imply it is cheap.

**One claim in the table I have NOT verified here:** that `ps eww` cannot read another USER's
environment. It is standard Unix behaviour, but I could not test it without a second account, and
this card has already recorded three cases of me asserting a mechanism I had not exercised. Treat
it as expected, not measured.

### What this does to the staging

**Stage 2 is no longer "a design change with a known mechanism". It is a design change with an
OPEN feasibility question**, and that must be settled before it is ruled on rather than after.
Stage 1 is meanwhile weakened to near-nothing by EXPOSURE 3. So the honest position is: **the
credential design has no currently-verified secret-free implementation on this stack**, and the
next action is the (B) measurement, not a ruling.

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
