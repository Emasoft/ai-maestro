---
name: agent-isolation-is-not-enforced
description: "can one agent read another agent's token or impersonate it / is AID_AUTH visible in ps / can agent A drive agent B's tmux pane / why does per-agent identity not survive a shared tmux server / where should the isolation boundary be / is a container required to isolate agents / are containers the only fix / can an agent patch the ai-maestro server / can an agent read another agent private key"
ocd: 2026-08-26
lmd: 2026-09-04
metadata:
  node_type: memory
  type: project
  tier: component
  topic: security-and-auth
publish-globally: false
---

# agent-isolation-is-not-enforced


^ATOM-42DO-S4GX [desc: "AID_AUTH leaks at three of five lifecycle stages — tmux set-environment argv on delivery, the session environment at rest, and curl argv at 47 call sites. Mint and register are clean.", keywords: is_AID_AUTH_visible_in_ps agent_token_in_the_process_table can_another_agent_read_my_bearer_token curl_Authorization_header_on_argv ps_eww_shows_the_environment token_leaks_at_delivery_time, ocd: 2026-08-26, lmd: 2026-08-26]

**THE AGENT BEARER TOKEN LEAKS AT THREE OF ITS FIVE LIFECYCLE STAGES.** All measured 2026-08-26
with live `ps` snapshots and positive controls, not read from source (TRDD-EVO7T245):

| stage | mechanism | exposed |
|---|---|---|
| mint | `randomBytes`, in-process (`lib/aid-token.ts`) | no |
| register | in-process route, no CLI shell-out | no |
| **deliver** | `execFileAsync('tmux',['set-environment',…,token])` — token is argv | **YES** |
| **at rest** | the tmux session environment | **YES** (`ps eww`) |
| **in use** | `curl -H "Authorization: Bearer …"` at 47 call sites | **YES** |

**`ps eww` prints a same-user process's ENVIRONMENT, and every agent is the same Unix user** — so
the at-rest leak is continuous, not confined to a request window. That is why "move it off argv
into the environment" is NOT a fix; env is the worse of the two, because argv at least closes
between calls.

The delivery leak is catchable in practice: a polling attacker racing the injection captured
`tmux set-environment -t <session> AID_AUTH <token>` verbatim. It fires **once per agent per server
restart**, so opportunities accumulate.

**The password path is the correct model and is airtight** — `read -rs` from the TTY, `printf`
(a shell BUILTIN, so no separate process exists) into `jq`, `printf` into `curl -d @-`, `unset`
after each. **"Use stdin" is not sufficient guidance on its own: the PRODUCER decides.** A builtin
producer leaks nothing; an EXTERNAL one (`/bin/echo secret`) puts it on argv. Check the producer,
not the presence of a stdin flag.


^ATOM-CQIV-P55N [desc: "Any agent can drive any other agent's pane via tmux send-keys, so NO credential scheme provides isolation — the shared tmux server is the hole, and the boundary belongs at the container.", keywords: can_agent_A_control_agent_B tmux_send-keys_into_another_agent's_pane agents_share_one_tmux_server per-agent_identity_defeated_by_session_injection where_should_the_isolation_boundary_be is_a_credential_fix_enough, ocd: 2026-08-26, lmd: 2026-08-26]

**NO CREDENTIAL DESIGN GIVES AGENT ISOLATION, BECAUSE ANY AGENT CAN DRIVE ANY OTHER AGENT'S PANE.**
Demonstrated 2026-08-26 (TRDD-EVO7T245): `tmux send-keys -t <other-agent> …` injects a command, and
the injected process's ancestry resolves to the VICTIM's `pane_pid`:

```
victim pane_pid = 98120 ; injected sleep pid = 98511
ancestry: 98511 -> 98120        REACHES the victim pane: YES
```

The tmux socket is per-USER (`/tmp/tmux-<uid>`, mode 0700) and every agent is that user, so the
shared tmux server is the hole. **A peer-credential scheme (kernel-attested PID → pane → agent) is
verified to WORK and is still defeated**, because the attacker does not forge identity — it makes
the victim act. *"Which agent is this process"* has a true answer the attacker controls.

**This is a PRE-EXISTING hole, independent of any credential work.** It is present today.

**It cannot be closed within one uid.** Measured: POSIX permissions and ACLs cannot separate
principals the kernel considers identical (the owner always has access, so a per-agent socket path
buys nothing); and macOS `sandbox-exec` DOES enforce (`(deny default)` → `execvp failed`, exit 71)
but the permissive `(allow default)` + targeted-`deny` shape **failed to deny** in two rule forms.

**So the boundary must be a CONTAINER, not a credential** — a separate PID namespace means one
agent cannot even `ps` another, which removes the exposures rather than mitigating them, needs no
OS user accounts, and is cross-platform. `services/agents-docker-service.ts` already exists.
Whether that path is complete is UNVERIFIED. [^1]


^ATOM-KX6M-AXYR [desc: "Seatbelt DOES confine agents under one uid and a shared tmux server — the earlier dismissal used the wrong operation class AND an unresolved path, each independently decisive.", keywords: the_boundary_belongs_at_the_container is_a_container_the_only_way_to_isolate_agents can_seatbelt_sandbox_replace_containers sandbox-exec_deny_tmux_socket allow_default_plus_targeted_deny_failed_to_deny, ocd: 2026-08-26, lmd: 2026-08-26]

A UNIX-socket `connect()` is governed by seatbelt's **`network-outbound`**, NOT by `file-read*`,
and seatbelt matches the **resolved** path (`/tmp` -> `/private/tmp` on macOS). Isolating the two
variables:

| operation class | path | result |
|---|---|---|
| `file-read* file-write*` | `/private/tmp/tmux-501` | allowed |
| `network-outbound` | `/tmp/tmux-501` (unresolved) | allowed |
| `network-outbound` | `/private/tmp/tmux-501` | **DENIED** |

Get either wrong and the profile silently permits, which is what produced the earlier
"sandboxing does not rescue it" conclusion.

Measured properties of `(allow default)` + that one deny: `tmux send-keys` denied; a **raw
`AF_UNIX` connect with no tmux binary** denied (the block is on the syscall, so a custom tool does
not bypass it); a symlink to the socket denied; **inherited three subprocess levels deep**; and
normal work (file read, HTTPS, python, node) unaffected. Inherited fds keep working because
seatbelt checks `open()`, not existing descriptors.

Two adjacent rules bite: blanket `(deny signal)` **breaks the agent's own child management** — the
working form is `(deny signal)` + `(allow signal (target self))` + `(allow signal (target
children))`; and last-match-wins means `(deny … subpath ROOT)` then `(allow … subpath ROOT/own)`
gives per-agent confinement.


^ATOM-8T3J-J8FT [desc: "Encryption at rest closes theft of the store and does nothing about the copy DELIVERED to the agent — it must be paired with a design that delivers no credential at all.", keywords: encrypting_the_key_store_at_rest does_encryption_at_rest_stop_impersonation keychain_protected_tokens the_vault_is_locked_but_the_delivered_copy_is_not, ocd: 2026-08-26, lmd: 2026-08-26]

Encrypting tokens/keys at rest changes **where** an attacker steals a credential, not **whether**.
The server decrypts at runtime and hands the agent a plaintext credential; that copy lands in the
agent's `environ` and in `curl`'s argv, and **`sysctl(KERN_PROCARGS2)` reads any process's argv
cross-agent and survives every seatbelt deny form including a blanket `(deny sysctl-read)`**.

So encryption-at-rest is necessary and not sufficient. It becomes sufficient only paired with
kernel-attested identity (peer credentials over a UDS), where no credential is delivered at all —
because then there is nothing at rest OR in flight to steal.

Corollary worth stating because it looks like a win and is not: under seatbelt, `/bin/ps` is
setuid and cannot exec, so `ps` fails. That is concealment, not deletion — the `sysctl` path is
untouched. Do not count it as protection.


^ATOM-UBMF-AWTG [desc: "The root of impersonation is a shared same-uid key store — cat is the whole attack — and the 0600 fix that shipped for it is inert because every agent IS the owner.", keywords: where_is_the_root_of_agent_impersonation can_an_agent_read_another_agent's_private_key shared_key_store_one_uid 0600_does_not_protect_same_uid chmod_600_private.pem_fix, ocd: 2026-08-26, lmd: 2026-08-26]

Every agent's signing key lives in one tree under one uid (`~/.agent-messaging/agents/<uuid>/keys`,
`tokens/`). Measured on this fleet: dozens of agent directories, >100 key/token files, and a
control open of another agent's `private.pem` returned its bytes. **No tmux, no argv, no race, no
IPC — `cat` is the entire attack.**

An archived card had already applied the reflex fix: `private.pem` `0644 -> 0600`. **0600 means
owner-only, and under a single-uid fleet every agent IS the owner.** It defends against other Unix
users, and this system has none. A protection that reads as closed and enforces nothing.

This matters for prioritisation: it outranks every channel-level control, because an attacker who
can read the key never needs a channel. Closing it wants either encryption at rest (portable, works
on Linux too) or per-agent filesystem confinement — measured: sibling key DENIED, own key still
readable, agent still functions.


^ATOM-520Z-GGEF [desc: "PID reuse is closed for the PEER of a live connection and OPEN for every ancestor and the recorded pane_pid the identity walk touches.", keywords: kernel_peer_credentials_pid_reuse is_LOCAL_PEERPID_safe_from_recycled_pids identity_walk_ancestors pane_pid_recycled, ocd: 2026-08-26, lmd: 2026-08-26]

The peer-credential design resolves `peer PID -> walk ppid chain -> pane_pid -> session -> agent`.
The argument that retires PID reuse — *"the credential is read from a LIVE connection, so the peer
necessarily still exists"* — is TRUE of the peer and FALSE of the rest of the walk.

The ancestor pids, and the `pane_pid` the server holds on record, are ordinary integers the kernel
recycles. A pane exits; its pid is later recycled inside another agent's tree; that agent's
descendants now walk to a pid the records still associate with the dead pane's identity.

Fix: compare **(pid, start-time) pairs**, never bare pids, at every hop — a recycled pid has a
later start time than the record.

Same shape as the other traps on this page: a true statement about a narrow thing read as a
statement about the whole mechanism.


^ATOM-VCRP-8TJC [desc: "Every input the isolation design depends on — the server's own code, the identity map, persistence surfaces, shell rc — is writable by the agents it constrains.", keywords: what_outranks_channel_hardening can_an_agent_patch_the_ai-maestro_server is_registry.json_writable the_guarantor's_own_inputs_are_attacker-writable sandbox_escape_via_launchagent_plist, ocd: 2026-08-26, lmd: 2026-08-26]

Measured in one pass, all writable by the agent uid:

| surface | consequence |
|---|---|
| `<install>/server.mjs`, `lib/`, `node_modules/`, `.next/` | **patch the guarantor** — edit the peer-credential check, the auth resolver, or the profile generator |
| `~/.aimaestro/agents/registry.json` | **rewrite the identity map** the kernel-attested PID is resolved through |
| `~/Library/LaunchAgents/` | drop a plist — launchd runs it **outside** the sandbox at next login |
| `~/.zshrc`, `~/.zprofile`, `~/.claude/shell-snapshots/` | code executes in **every other agent's** shell |

The first two are the ones that matter: **a design whose own code and lookup tables are writable by
the parties it constrains is decorative, whatever is layered on top.** Encryption at rest makes it
worse, not better — the server is the one process authorised to unlock the keychain, so patching it
is how you ask the keychain nicely.

Prioritisation that follows: root-own or make immutable the server tree, the identity map and
`~/.aimaestro` FIRST; channel hardening is meaningless before that.

CLOSED by the OS, recorded so nobody re-tests: `task_for_pid` on another agent (SIP; control =
own task acquired), `TIOCSTI` injection (unavailable OS-wide; control = fails on own tty),
`launchctl submit` under seatbelt (control = works unsandboxed), `osascript do shell script`
(inherits the sandbox).


^ATOM-QUX1-YP3Q [desc: "VERIFIED end to end — Claude Code boots and completes an API call under the per-agent seatbelt profile while that same profile denies every measured cross-agent channel.", keywords: does_claude_code_run_under_sandbox-exec will_seatbelt_break_the_agent is_the_per-agent_sandbox_profile_viable verified_agent_confinement_profile, ocd: 2026-08-26, lmd: 2026-08-26]

The gate that could have killed the confinement design is measured and PASSES.

`sandbox-exec -f <per-agent profile> claude -p "…"` → **exit 0**, full boot, plugin load,
config read, network, model reply. Under the SAME profile, in the same shell:

| probe | result |
|---|---|
| tmux socket (binary or raw `connect`) | denied |
| `~/Library/LaunchAgents` plist drop | denied |
| `~/.zshrc` write | denied |
| `<install>/server.mjs` write | denied |
| `~/.aimaestro/agents/registry.json` write | denied |
| another agent's `private.pem` | denied |
| own settings.json / plugins / shell-snapshots read | **ok** |
| `git status` in the repo | **ok** |

Both halves matter: a profile that permits everything also passes the boot test, and a profile
that denies everything also passes the deny test. The pair is the evidence.

Profile shape that works — `(allow default)` plus targeted denies, with three non-obvious rules:
`(deny signal)` MUST be paired with `(allow signal (target self))` + `(target children))` or the
agent cannot manage its own subprocesses; shell-snapshots must be READ-allowed and WRITE-denied
(the Bash tool sources them); and paths must be the RESOLVED ones (`/private/tmp`, never `/tmp`).


^ATOM-AFY1-OPB8 [desc: "Confinement is defeated by anything UNCONFINED that consumes attacker-writable input — a script, a config naming a command, or an env var selecting a binary.", keywords: sandbox_escape_via_a_script_the_agent_can_write confinement_defeated_by_an_unconfined_process exec_from_agent-writable_tree is_a_sandbox_enough_on_its_own, ocd: 2026-08-26, lmd: 2026-08-26]

A sandbox confines a process. It does not confine what an UNCONFINED process will do on that
process's behalf. Two measured instances on this fleet, from opposite directions:

1. **An unconfined process EXECUTES an agent-writable script.** The janitor's
   `plugin_manage.py:194` `subprocess.run()`s `<install>/scripts/aimaestro-agent.sh`, which is
   `-rwxr-xr-x` and owned by the agent uid. A confined agent writes the script; the unconfined
   process runs it.
2. **A privileged SERVER exercises a capability on request.** `POST /api/teams/notify`
   authenticated the caller and never checked it, reaching a tmux send-keys primitive — so an
   agent denied the tmux socket by its profile simply asked the server to inject the keystrokes.

The general form: **confinement is defeated by anything unconfined that consumes
attacker-writable input** — a script, a config that names a command, or an env var that selects
a binary (`$AIMAESTRO_CLI` is a live third instance).

Two consequences for planning:

- **Route authorization and process confinement are NOT alternatives.** The sandbox is void on
  every capability the server will exercise on request, so a missing `authorize()` re-opens
  precisely what the profile closed.
- **Instance 1 grants NOTHING today** — under single-uid an agent that can write the script can
  already act as that uid directly. It becomes live exactly WHEN confinement ships, which makes
  it a PREREQUISITE on the sandbox work rather than a follow-up. Filing it as a live
  vulnerability would have been the easy overstatement and would have got it discounted.

Before shipping any confinement, enumerate: what does an unconfined process exec, source, or
resolve-what-to-exec from, that the confined party can write?


^ATOM-F8O3-0EVD [desc: "A guard in app/api/** protects ONE of this repo's two server modes — headless calls the service directly — and a route-level test reports the half-fix as fixed.", keywords: I_guarded_the_route_and_the_vulnerability_was_still_live headless_router_reimplements_routes my_fix_covered_one_of_two_server_modes route-level_test_reported_it_fixed, ocd: 2026-08-26, lmd: 2026-08-26]

Measured on TRDD-91TLL7DW: `POST /api/teams/notify` was guarded in
`app/api/teams/notify/route.ts`, tested at route level, 4/4 green, reported done. The
vulnerability stayed FULLY LIVE — `services/headless-router.ts` calls `notifyTeamAgents()`
directly and never executes `app/api/**`. That handler had **no auth at all**, not even
`authenticateAgent`, while its sibling three lines below did.

**Put the guard in the SERVICE both modes reach, and test it THERE.** A route-level test for a
service-level property is what makes the half-fix look complete.

What exposed it: `tests/unit/headless-handler-auth-ledger.test.ts` carries an
`UNGUARDED_LEDGER` whose rule is *"Guard one → delete its line here. Never add a line."*
`POST /^\/api\/teams\/notify$/` was in it, and following that line found the second code path.
**Treat that ledger as the index of where the second implementation lives.**

Passing identity: spread the body FIRST and the verified identity LAST
(`{...body, requestingAgentId: auth.agentId}`) — the other order lets a caller supply its own
`requestingAgentId` and authorize itself. Enforce a missing identity as a REFUSAL, never as
system-owner (the LIB2-CRIT-02 shape this repo has already been bitten by).

See also [[two-server-modes-the-headless-router-reimplements-routes]].

## Notes and lessons learned

[^1]: [id: ATOM-R6ML-4HWR, status: valid, supersedes: ATOM-CQIV-P55N, desc: "The container-only conclusion was measured-refuted on 2026-08-26 and the named hole was not the deepest one.", keywords: "the_boundary_belongs_at_the_container is_a_container_required_to_isolate_agents shared_tmux_server_is_the_hole containers_are_the_only_fix", ocd: 2026-08-26, lmd: 2026-08-26] DO NOT conclude that a container is the only boundary, or that the shared tmux server is THE hole, BECAUSE both were refuted by measurement on 2026-08-26. A seatbelt profile confines agents under one uid and a shared tmux server (see the seatbelt atom on this page) — the earlier dismissal of sandboxing used the wrong operation class and an unresolved path. And the tmux socket is not the deepest hole: the shared same-uid key store and the writable server tree both defeat every channel-level control, so ranking tmux first mis-orders the work. DO say instead: the shared tmux server is ONE control channel among an enumerable set, closable without containers; the container's real advantage is that it is default-deny while seatbelt is a deny-list needing an owner and a suite. SUPERSEDED BODY: **NO CREDENTIAL DESIGN GIVES AGENT ISOLATION, BECAUSE ANY AGENT CAN DRIVE ANY OTHER AGENT'S PANE.** Demonstrated 2026-08-26 (TRDD-EVO7T245): `tmux send-keys -t <other-agent> …` injects a command, and the injected process's ancestry resolves to the VICTIM's `pane_pid`: ``` victim pane_pid = 98120 ; injected sleep pid = 98511 ancestry: 98511 -> 98120 REACHES the victim pane: YES ``` The tmux socket is per-USER (`/tmp/tmux-<uid>`, mode 0700) and every agent is that user, so the shared tmux server is the hole. **A peer-credential scheme (kernel-attested PID → pane → agent) is verified to WORK and is still defeated**, because the attacker does not forge identity — it makes the victim act. *"Which agent is this process"* has a true answer the attacker controls. **This is a PRE-EXISTING hole, independent of any credential work.** It is present today. **It cannot be closed within one uid.** Measured: POSIX permissions and ACLs cannot separate principals the kernel considers identical (the owner always has access, so a per-agent socket path buys nothing); and macOS `sandbox-exec` DOES enforce (`(deny default)` → `execvp failed`, exit 71) but the permissive `(allow default)` + targeted-`deny` shape **failed to deny** in two rule forms. **So the boundary must be a CONTAINER, not a credential** — a separate PID namespace means one agent cannot even `ps` another, which removes the exposures rather than mitigating them, needs no OS user accounts, and is cross-platform. `services/agents-docker-service.ts` already exists. Whether that path is complete is UNVERIFIED.
