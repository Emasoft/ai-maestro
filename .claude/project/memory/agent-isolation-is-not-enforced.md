---
name: agent-isolation-is-not-enforced
description: "can one agent read another agent's token or impersonate it / is AID_AUTH visible in ps / can agent A drive agent B's tmux pane / why does per-agent identity not survive a shared tmux server / where should the isolation boundary be"
ocd: 2026-08-26
lmd: 2026-08-26
metadata:
  node_type: memory
  type: project
  tier: component
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
Whether that path is complete is UNVERIFIED.

## Notes and lessons learned
