---
name: tailscale
description: Tailscale and tailnet operations — install, connectivity failures, "can't reach my device", peers stuck on DERP/relayed instead of direct, MagicDNS not resolving, exit nodes, subnet routers, ACL/grants policy files, tags, auth keys and OAuth clients, key expiry, Tailscale SSH, serve and funnel, HTTPS certs, Headscale self-hosting, VPN/proxy conflicts on macOS, Docker and container networking, and exposing a local service to a tailnet safely. Use when a tailnet is misbehaving, when writing or reviewing a tailnet policy file, or when deciding how to expose a service.
---

# Tailscale

Every CLI-shaped claim here was arbitrated against a real `tailscale 1.98.5` binary — where the
published documentation and the binary disagreed, the binary won and the disagreement is
recorded, not erased.

## Route to the right reference — do not load them all

| You are… | Load |
|---|---|
| diagnosing anything broken (no connectivity, relayed instead of direct, DNS failing, proxy conflict) | `references/troubleshooting.md` |
| exposing a local service to the tailnet or the internet | `references/serve-funnel-tls.md` |
| writing/reviewing a policy file, ACLs, grants, tags, auth keys, key expiry | `references/policy-and-identity.md` |
| doing SSH over a tailnet, or running agents/remote dev on one | `references/ssh-and-agent-access.md` |
| setting up subnet routers, exit nodes, or planning topology | `references/routing-and-topology.md` |
| installing, or hitting a platform-specific quirk (macOS variants, Docker, systemd, mobile) | `references/platforms-and-install.md` |
| scripting the REST API, managing devices at fleet scale, CI/CD, Terraform | `references/api-and-fleet-ops.md` |
| self-hosting Headscale, or hardening a deployment | `references/headscale-and-hardening.md` |
| **OPTIONAL** — threat detection, incident forensics, spotting unauthorised tailnet use | `references/security-and-threat-detection.md` — load ONLY when the task is about security. No ordinary Tailscale task routes through it. |

## The skill also ships runnable material — read before you run

| directory | what is in it |
|---|---|
| `scripts/` | 54 scripts — 51 third-party (`ts_common.sh`, `ts_smoke.sh`, `ts_build_catalog.sh`, `ts-api.sh`, `quick_diagnose.py`, `dns-audit.sh`, `validate-policy.py`, `tailscale_manager.py`, `setup_exit_node.sh`, `setup_subnet_router.sh`, …) plus 3 written for this skill (`ts_call.sh`, `ts_catalog.sh`, `ts_toolkit_selftest.sh`). See `scripts/MANIFEST.md`. |
| `assets/` | 6 templates/checklists — `tailscale-checklist.md`, a zero-trust rollout report template, and sysadmin spec/runbook/bootstrap templates. See `assets/MANIFEST.md`. |

**The 51 third-party scripts are UNVETTED.** They ship non-executable (mode 0644) deliberately: read
one before you run it, and running it should be a deliberate act. A secret scan found only
placeholders (`--authkey tskey-auth…` in usage comments), and no prompt-injection text — but "no
known problem" is not "audited".

The 3 scripts written for this skill ship executable. `ts_call.sh` is catalog-driven and refuses any
non-GET operation unless you pass `--yes`, so the safe workflow is always `--dry-run` first. Verify
them with `./scripts/ts_toolkit_selftest.sh` — 16 checks, no network, no API key.

## The three things worth knowing before you touch anything

### 1. `tailscale status --json` is the source of truth — never the human table, never a config file

```bash
tailscale status --json          # THE stable scripting interface
tailscale netcheck --format=json # NAT type, port mapping, DERP latency  (NOTE: --format=json, not --json)
tailscale ping <host>            # direct (p2p) vs DERP-relayed
tailscale whois 100.x.y.z        # who owns this IP
```

Resolve peers by hostname (`tailscale ip <hostname>`), never by a hardcoded IP — IPs change on
re-auth, hostnames don't.

**Reading the `tailscale status` table (measured on 1.98.5 — commonly documented wrong).**
The last column is free text, not a symbol. There is **no `*` marker**. Device names and
tailnet IPs below are anonymized; the column shape and field semantics are verbatim:

```
100.101.5.12   workstation           user@  macOS  -
100.102.7.34   tablet                user@  iOS    active; direct 192.168.1.44:41641, tx 4574209016 rx 20844984
```

`-` = no active session. `active; direct <ip:port>` = a **direct** peer-to-peer path. A relayed
peer names its DERP region instead of `direct`. Relayed is working-but-slower, not broken. Add
`--header` for column names. Several sources claim a `*` denotes a direct peer — that is
**false on 1.98.5**; script against `status --json`, never the table.

### 2. Serve injects identity headers — and they are forgeable unless serve is the ONLY way in

`tailscale serve` reverse-proxies **from loopback**, so a backend behind it sees
`127.0.0.1` as the client address for *every* tailnet caller, plus these injected headers:

```
x-forwarded-for: 100.x.y.z                    # the real client
tailscale-user-login: someone@example.com     # tailnet-attested identity
tailscale-user-name: Some One
```

**Those headers are trustworthy ONLY because serve is the sole path to the backend.** If the same
service is also reachable on any other interface — a raw port, `0.0.0.0`, a LAN address, a
container port-map — a client on that path forges the identical header names and the backend cannot
tell the difference. **Bind the backend to `127.0.0.1` only, or do not trust the headers.**

Corollary that bites real systems: any auth logic keyed on "is the caller local?" silently starts
accepting *everyone* the moment serve is put in front of it.

### 3. Choose the exposure mechanism deliberately

| | reach | TLS | trust model |
|---|---|---|---|
| **direct bind to the Tailscale IP** | tailnet | none (plain HTTP) | network position only |
| **`tailscale serve`** | tailnet | automatic | + tailnet-attested identity headers (see §2) |
| **`tailscale funnel`** | **public internet** | required | **none — anyone, no Tailscale needed** |

Funnel is public. Never enable it to solve a tailnet-access problem. It is also restricted to
ports 443/8443/10000, always relays through Tailscale's servers, and needs an explicit `funnel`
nodeAttr in the policy file.

## Two commands that do more than they look like

- **`tailscale serve reset` wipes the node's ENTIRE serve config**, not one port. To remove a single
  route use `tailscale serve --https=<port> off`. (`tailscale serve clear` is a *Services/TailVIP*
  verb — "remove all config for a service" — not a path-removal verb.)
- **`tailscale serve --bg <port>` with no `--set-path` replaces all existing routes.**

## Honesty rules this skill follows

- Claims marked `[unverified]` are single-source or unresolved — treat them as leads, not facts.
- Each reference ends with `## GAPS` naming what is **not** covered. An absent topic reads
  as absent; nothing was invented to fill it. (`site-to-site`, for example, has no coverage.)
- Contradictions are shown with both sides and which is better-evidenced, never silently voted on.
  A 3-versus-1 majority produced a *false* claim here once; frequency is not truth.
- Version-gated behaviour always names the version — e.g. `serve status --json` is genuinely broken
  in **1.98.1** and working in **1.98.5**. "It's broken" without a version is not a usable claim.
- Two claims were caught FALSE against the binary and corrected: `tailscale debug policy lint`
  (widely cited, does not exist) and a `*` direct-peer marker in `status` (does not exist).
