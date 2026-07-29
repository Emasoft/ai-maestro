# Security and threat detection

> **Optional — load ONLY when the task is about security**: auditing who can
> reach what on a tailnet, hardening device/key/ACL posture, hunting for
> unauthorised tailnet use, or reading tailnet-adjacent artefacts after an
> incident. An ordinary connectivity, install, `serve`/`funnel`, ACL-authoring,
> or routing task never needs this file — see `policy-and-identity.md`,
> `routing-and-topology.md`, `ssh-and-agent-access.md`, and
> `platforms-and-install.md` for those. Everything below assumes you already
> know the ACL/tag/SSH mechanics documented elsewhere and are here specifically
> to defend, audit, or investigate.

## 1. Audit who can reach what

Tailscale's ACL policy is **default-deny**: nothing is reachable until an
`"action": "accept"` rule grants it. Treat the policy file as the tailnet's
firewall rule set and audit it the same way:

- **Groups and tags are the unit of review**, not individual users/devices.
  Map `group:*` to real teams (`group:engineering`, `group:sre`,
  `group:security`, `group:management`) and `tag:*` to real environments
  (`tag:production`, `tag:staging`, `tag:development`, `tag:database`,
  `tag:monitoring`, `tag:internal-tools`). A rule granting `group:employees`
  (`autogroup:members`) broad access to `tag:internal-tools` is a red flag if
  "internal tools" quietly grew to include something sensitive.
- **Port-scope every `dst` entry.** `"dst": ["tag:production"]` (no port list)
  grants *all* ports; `"dst": ["tag:production:22,443,8080"]` is scoped. An
  audit should flag any rule missing a port restriction on a sensitive tag.
- **`tagOwners` is itself an access-control surface.** Whoever owns a tag can
  assign it to a device and thereby inherit every ACL rule written against
  that tag. Audit `tagOwners` with the same rigor as the ACLs — a
  mis-scoped tag owner is a privilege-escalation path (add `tag:production` to
  a device you control, inherit production reach).
- **`nodeAttrs` carries security-relevant deny flags** worth grepping the
  policy for: `"funnel:deny"` (block Funnel — internet-exposed serving) and
  `"mullvad:deny"` (block Mullvad exit-node use) applied to `autogroup:members`
  are hardening defaults, not decoration. Their absence means any member can
  turn on Funnel or route through a third-party exit node.
- **`autoApprovers`** auto-accepts subnet routes and exit-node advertisements
  from listed groups without human review. Audit this block for scope creep —
  a CIDR wider than the actual subnet, or a group broader than "the team that
  owns that subnet," silently expands the auto-approved blast radius.
- **Review cadence**: ACLs and tag ownership should be reviewed **quarterly**
  for stale rules, and access logs audited for policy violations. Update
  groups the moment team membership changes; remove deprecated tags/rules
  rather than letting them accumulate — an unused-but-still-accepting rule is
  exactly what an attacker who compromises one node looks for next.
- **Test before enforcing.** ACL policies support a `"tests"` block (ACL
  policy unit tests) — write one per sensitive rule and validate in a
  test/staging tailnet before promoting to production. Deploying an
  unreviewed ACL change straight to a production tailnet is the same class of
  mistake as deploying an unreviewed firewall rule straight to a production
  network.
- **Programmatic audit via the Tailscale API v2** (`Authorization: Bearer
  <api-key>` against `https://api.tailscale.com`):
  - `GET /api/v2/tailnet/{tailnet}/devices` — enumerate every device; cross
    check against your asset inventory for anything you don't recognise.
  - `GET /api/v2/tailnet/{tailnet}/acl` — pull the live policy for diffing
    against your git-tracked source of truth (drift between the two is itself
    a finding — someone edited the policy out-of-band).
  - `GET /api/v2/tailnet/{tailnet}/keys` — list outstanding auth keys; look
    for reusable, non-expiring, or unexpectedly broad-tag keys.
  - `DELETE /api/v2/device/{deviceid}` — the remediation action once a rogue
    or compromised device is identified: kick it off the tailnet immediately.
  - `GET /api/v2/tailnet/{tailnet}/webhooks` — confirm your SIEM/alerting
    webhook is still registered and hasn't been silently removed (an attacker
    who wants to operate unobserved will try to kill your alerting first).
- **CLI equivalents worth scripting into a recurring audit** (no admin-console
  click-through needed):
  ```bash
  # Machine-readable peer/device inventory for diffing against your asset list
  tailscale status --json | jq '.Peer | to_entries[] | {name: .value.HostName, online: .value.Online, os: .value.OS}'

  # Identify which tailnet identity owns a given IP — useful when correlating
  # an unexpected connection back to a specific user/device during an audit
  tailscale whois <ip-or-hostname>

  # Connectivity/relay diagnostics — confirms whether traffic to a peer is
  # direct (expected, low-latency) or falling back to a DERP relay (can
  # indicate a NAT/firewall change worth investigating, not just a perf issue)
  tailscale netcheck
  tailscale ping <peer-ip>
  ```
- **Structured audit reporting pattern (from a generic infra-audit tool, not
  Tailscale-specific, but directly reusable for tailnet audits).** Emit one
  JSON object per check so findings can be aggregated, ranked by severity,
  and diffed run-over-run instead of read as unstructured prose:
  ```json
  {
    "check": "tailscale",
    "status": "pass|warn|error",
    "severity": "critical|high|medium|low|info",
    "findings": ["node X has keyExpiryDisabled with no documented reason"],
    "evidence": ["tailscale status --json output, device list diff"],
    "suggested_fixes": ["set key expiry or document the exception"],
    "meta": {}
  }
  ```
  A `check_tailscale.sh`-style probe (node visibility + online peer
  connectivity) run alongside `check_docker.sh`, `check_nginx.sh` (proxy
  buffering directives), `check_authelia.sh` (auth-portal flow), `check_cron.sh`,
  and `check_git.sh` (dirty tree, embedded-repo warnings) as **parallel**
  checks, then compiled by one aggregator, catches "Tailscale is up but the
  peer I expect isn't visible" the same day it happens rather than at the
  next manual audit. [unverified: this pattern is generic infra-audit
  tooling, not Tailscale's own audit surface — adapt the specifics to your
  environment rather than treating the schema as a Tailscale API contract.]
- **Firewall/perimeter assessment is a distinct responsibility from
  enforcement.** One source's security-review skill explicitly separates
  "assess Tailscale perimeter posture, port exposure, UFW rules, and DNS
  security (port 53 Tailscale-only enforcement) and recommend changes" from
  "implement firewall rules" — the audit role reviews and recommends; a
  separate operational role applies the change. Keep that separation when
  designing your own audit workflow: an auditor account/role should not also
  hold write access to the ACL policy or the host firewall, or the audit
  loses its independence. [unverified: the "port 53 Tailscale-only
  enforcement" phrasing is one source's shorthand for restricting DNS egress
  to Tailscale's resolver — cross-check against §3's DNS-egress guidance
  before treating it as a distinct control.]

## 2. Harden device and key posture

- **Key expiry is a control, not a convenience default.** The coordination
  server defaults key expiry to 180 days; hardening guidance recommends
  tightening this to **90 days** so a compromised or lost device's
  credentials age out on a predictable schedule. Auditing `keyExpiryDisabled`
  on the device list surfaces every device that opted out of expiry — each
  one is a standing credential with no automatic revocation, and needs a
  documented reason (typically: an always-on server using an auth key
  instead of interactive login).
- **Ephemeral keys for anything transient.** CI/CD runners and other
  short-lived workloads should authenticate with **ephemeral, single-use**
  pre-auth keys (`tailscale up --authkey=$TS_AUTHKEY --hostname=ci-runner-...`)
  so the node is automatically removed when the container stops — it never
  becomes a stale, forgotten tailnet member. A **reusable** key handed to a
  CI system that never expires it is the tailnet equivalent of a shared root
  password baked into a pipeline.
- **Treat `TS_AUTHKEY` / `tskey-...` as a live credential, full stop.** It
  appears as plaintext in Docker Compose `environment:` blocks and in
  Kubernetes `Secret`/`stringData` manifests in common deployment examples —
  both are places secrets leak into git history if the manifest is committed
  verbatim. Move it to a secrets manager / sealed secret / CI secret store,
  never a checked-in YAML literal. If a `tskey-` value is ever found in a
  log, a transcript, a commit, or an AI-agent session file, treat it as
  compromised and rotate it (revoke + reissue) — redaction after the fact
  does not undo the exposure window. **This pattern is not currently covered
  by the vendor-token secret-scanner lists common in agent-log-audit
  tooling** (those enumerate Anthropic/OpenAI/GitHub/AWS/Google/Stripe/etc.
  prefixes but not `tskey-`) — if you maintain such a scanner, add
  `tskey-[a-z]+-[A-Za-z0-9-]+` explicitly.
- **Network Lock (tailnet lock)** is the strongest device-join control:
  `tailscale lock init` + `tailscale lock add nodekey:...` requires every new
  node to be cryptographically signed by a trusted key before it can join,
  which prevents an attacker who obtains a valid auth key (or compromises the
  identity provider account that could mint one) from silently adding a
  rogue node. Enable it once the tailnet's legitimate node set is stable;
  audit the signing-key list itself as a privileged asset.
- **Never tag a node whose SSH ACL relies on `autogroup:self`.** An untagged
  personal/dev node is authorized under `"dst": ["autogroup:self"]` by
  default; the moment ANY tag is applied to that node, `autogroup:self` no
  longer matches it and the SSH rule silently stops applying — **no error,
  no warning, just a lockout** (or, worse, a silent authorization gap if a
  broader tag-based rule happens to still match). Before tagging a node,
  check whether its authorization depends on being untagged.
- **`ssh` ACL rules: `"action": "check"` vs `"action": "accept"` is a real
  security/availability trade-off, not a style choice.** `check` forces
  periodic re-authentication against the identity provider (default cadence
  12h) — the right choice for interactive human sessions, especially to
  privileged destinations (`tag:production`, `root`/`admin` users). But on a
  **headless or automated** node, `check`'s periodic IdP re-auth will
  interrupt non-interactive reconnects (cron jobs, `tmux`/`mosh` resume,
  agent sessions like Claude Code) with no human present to satisfy the
  prompt — use `accept` for those, and compensate with tighter `src`
  scoping and shorter key expiry instead of relying on session re-auth.
  Concretely, an ACL `ssh` block making that trade-off explicit for both
  cases in one policy:
  ```jsonc
  "ssh": [
    {
      // Interactive humans reaching a privileged destination: force re-auth
      "action": "check",
      "src":    ["group:sre"],
      "dst":    ["tag:production"],
      "users":  ["root", "admin"]
    },
    {
      // Headless/automated peer-to-peer: no IdP re-auth to interrupt cron,
      // tmux/mosh resume, or an unattended agent session
      "action": "accept",
      "src":    ["autogroup:member"],
      "dst":    ["autogroup:self"],
      "users":  ["autogroup:nonroot"]
    }
  ]
  ```
- **`autoApprovers.exitNode` and `.routes` should be scoped as tightly as any
  ACL `dst`.** An auto-approved subnet route wider than the subnet it's meant
  to expose, or an auto-approved exit-node group broader than "people who
  should be able to route the tailnet's egress through this box," is a
  silent scope-creep vector because it bypasses the manual-approval review
  step entirely.
- **Install `tailscaled` as system infrastructure (apt/yum/the OS package),
  not a user-scope package manager unit.** On Linux, a `brew services`-style
  install can default to a `--user` systemd unit that can't own the TUN
  device and needs `loginctl enable-linger` to survive logout — which means
  the security posture of an always-on gateway/relay node is quietly tied to
  whether a human stays logged in. A root system unit
  (`/usr/lib/systemd/system/tailscaled.service`) starts at boot regardless,
  which is the correct posture for anything acting as a subnet router, exit
  node, or other shared infrastructure. Concretely, on a Debian/Ubuntu box,
  install via the vendor apt repo rather than a language/package-manager
  shim:
  ```bash
  # In the target host, as root. VERSION_CODENAME comes from the distro
  # itself, so this isn't pinned to one release:
  . /etc/os-release
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${VERSION_CODENAME}.noarmor.gpg" \
    -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl -fsSL "https://pkgs.tailscale.com/stable/ubuntu/${VERSION_CODENAME}.tailscale-keyring.list" \
    -o /etc/apt/sources.list.d/tailscale.list
  apt update && apt install -y tailscale
  systemctl enable --now tailscaled     # root system unit — starts at boot
  tailscale up                          # add --ssh only if you want Tailscale SSH
  ```
  This installs `/usr/lib/systemd/system/tailscaled.service` as a root system
  unit that owns the TUN device and survives logout without
  `loginctl enable-linger`. Verify with `systemctl is-enabled tailscaled` and
  `systemctl status tailscaled` — both should show the unit enabled and
  running independent of any interactive session.

### Deployment ordering when replacing a public port with Tailscale (VPS hardening)

The concrete order matters more than any individual command — get this
sequence wrong and you can lock yourself out with no recovery path but the
provider's out-of-band console:

```bash
# 1. Install and bring the node up (still has the public rule active)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Allow the encrypted tunnel interface through the host firewall —
#    this does NOT remove the public exposure yet, it only adds the private path
sudo ufw allow in on tailscale0

# 3. TEST before removing anything. Get the tailnet IP and connect via it
#    FROM A SEPARATE, ALREADY-OPEN SESSION (don't close your only session):
tailscale ip -4
ssh user@100.x.y.z          # confirm this actually works

# 4. ONLY once step 3 is confirmed working, close the public front door:
sudo ufw delete allow ssh
```

**Safety net (non-negotiable):** before step 4, confirm you have access to
the VPS provider's out-of-band web console/KVM (Hetzner/OVH-style panel). If
Tailscale ever fails afterward, that console is the *only* way back in —
`ssh` will no longer reach the box any other way. This is the same
"verify-before-you-cut-the-cord" discipline as any firewall migration; the
mistake this guards against is closing the public port before confirming the
private path actually works, which is silent and unrecoverable without
provider console access.

### Docker bypasses your host firewall — bind sensitive service ports explicitly

**A concrete and easy-to-miss trap:** UFW rules operate on the host's
netfilter chains, but Docker inserts its own iptables/nftables rules ahead of
them for published ports — so `docker run -p 8200:8200 ...` (or the
Compose `ports:` equivalent) can expose a container port to the whole
internet **even with UFW's default-deny active**, because UFW never sees the
traffic. This has burned real deployments (a backup-management UI exposed to
the public internet despite an apparently-locked-down host firewall).

The fix is to bind the published port to an address, not just a bare port
number — bind management/backup UIs to loopback or the Tailscale interface,
never `0.0.0.0`:

```yaml
services:
  duplicati:                       # or any admin UI you don't want public
    image: lscr.io/linuxserver/duplicati:latest
    ports:
      # WRONG — bypasses UFW entirely regardless of host firewall state:
      # - "8200:8200"
      # RIGHT — bind to an address; loopback-only, or your Tailscale IP:
      - "127.0.0.1:8200:8200"
      # - "100.x.y.z:8200:8200"   # to reach it from other tailnet peers
```

The same reasoning applies to any reverse-proxy admin dashboard (e.g.
Traefik's dashboard): don't publish its port at all — reach it via an SSH
tunnel (`ssh -L 8080:localhost:8080 user@host`, then browse
`http://localhost:8080/dashboard/`) or bind it to the Tailscale address
instead of exposing it through the proxy publicly.

## 3. Detect unauthorised tailnet use and egress

A tailnet is a private network, but "private" is not the same as
"unmonitored" — treat it like any other network segment for detection
purposes:

- **Audit outbound connections for beaconing patterns.** A process making
  regular, evenly-timed connections to a single unfamiliar IP (as opposed to
  the expected bursty pattern of normal browser/app traffic) is the classic
  signature of a beacon or C2 channel — whether it rides the public internet
  or, if a device has been compromised, the tailnet itself. Build a
  process→IP map (grouped by process) and flag: (a) unknown processes making
  regular contact with a single destination, (b) connections to raw IPs with
  no known-service correlation, and (c) a process whose displayed name in
  `lsof`/`ps` output looks truncated or version-numbered rather than a real
  binary name — verify identity with `ps -p <pid> -o comm=` before trusting
  the label, since some tools truncate or mis-render long process names. For
  continuous outbound monitoring rather than point-in-time snapshots, an
  always-on connection monitor (e.g. Little Snitch, or the free LuLu on
  macOS) is the durable answer; a one-shot audit only catches what's active
  at scan time.
- **Know your tailnet's normal DNS fingerprint.** `100.100.100.100` as a
  configured DNS server is Tailscale's MagicDNS resolver and is *expected*
  whenever Tailscale is active — do not flag it as suspicious on its own.
  What IS worth flagging: a DNS configuration pointing at an unfamiliar
  public resolver the user didn't configure, which suggests either
  traffic-interception tooling or a compromise that's rerouting DNS to
  observe or manipulate lookups.
  - Enforce DNS egress discipline on the perimeter: restrict outbound port
    53 to Tailscale-internal resolution only, so a compromised host can't use
    DNS as a covert exfiltration or C2 channel over the public internet
    (DNS tunneling is a long-standing technique precisely because port 53 is
    rarely inspected).
  - **Traffic-interception check independent of Tailscale itself**: audit
    `/etc/hosts` for anything beyond `localhost`/`broadcasthost` — a redirect
    of a bank or update domain to an unfamiliar IP is a classic
    traffic-interception indicator, unrelated to whether Tailscale is
    installed, but worth checking in the same pass since both live in the
    "what controls my traffic path" category. Also check for an enabled
    system HTTP(S) proxy that wasn't configured by you — everything routes
    through a third party's server if one is set.
- **Distinguish your own VPN/tunnel usage from someone else's.** Active
  Tailscale, WireGuard, or similar mesh interfaces are normal *if you set
  them up yourself* — but they establish reachability into the host that
  bypasses ordinary NAT/firewall assumptions, so periodically re-confirm who
  else is actually in your tailnet (ACL review, device list) rather than
  assuming a familiar-looking `100.x` address is automatically benign.
  **Reverse SSH tunnels** (`ssh -R`) forward a port on the local machine out
  to a remote server, meaning that remote server can reach back inside —
  fine for infrastructure you control, but it makes the trustworthiness of
  the remote endpoint a direct security dependency; audit which remote hosts
  hold that kind of reverse access.
- **Unexpected tunneling tools are a strong signal.** `ngrok`, `cloudflared`,
  or `frpc` processes you did not start are a common way for malware or a
  rogue insider to punch an outbound tunnel that bypasses your firewall and
  your tailnet's own ACLs entirely (these tools create their OWN encrypted
  egress path, independent of Tailscale). Treat any of them running without
  a known, documented purpose as an incident to investigate, not a curiosity.
- **Audit the perimeter, not just the endpoint.** Firewall posture review
  should explicitly include: overall port exposure, the Tailscale perimeter
  itself (which nodes are advertising routes/exit-node capability that
  shouldn't be), and UFW/host-firewall rules that might be inadvertently
  permitting traffic Tailscale's own ACLs are supposed to be gating (e.g. a
  host-level firewall that allows all traffic on the `tailscale0` interface
  is *appropriate if and only if* the ACL layer is the actual enforcement
  point — verify that assumption rather than taking it on faith).
- **A subnet router or exit node is a bigger blast radius than an ordinary
  peer** — it turns the whole advertised CIDR (or all internet egress, for an
  exit node) into something reachable/proxied through that one node's
  Tailscale identity. Treat these nodes as higher-value targets: tighter ACL
  scoping on who may reach them, and closer log/connection scrutiny.
- **MITRE ATT&CK mapping worth using as an audit checklist.** A zero-trust
  mesh deployment is commonly framed as mitigating: **T1133** (External
  Remote Services — the very problem Tailscale replaces by removing open
  inbound ports), **T1078** (Valid Accounts — mitigated by identity-provider-
  backed authentication + MFA rather than standing local credentials),
  **T1021** (Remote Services / lateral movement — mitigated by default-deny
  ACLs restricting which services a compromised node can reach next), and
  **T1572** (Protocol Tunneling — the thing to actively hunt FOR, since a
  compromised node could just as easily tunnel *through* the tailnet as
  around it). Walk each mapped technique and ask "is our configuration
  actually enforcing the mitigation, or just nominally present?" — e.g. a
  `check`-mode SSH rule mitigates T1078 far more than an `accept`-mode one.

## 4. Harden the identity and compliance layer

- **Identity provider is the actual trust anchor** — Tailscale delegates
  authentication to an OIDC-compatible IdP (Okta, Azure AD, Google Workspace,
  GitHub, etc.), so the tailnet's real security ceiling is the IdP's own
  posture: enforce MFA at the IdP, because Tailscale's ACLs are only ever as
  trustworthy as the identity behind the WireGuard key that established them.
- **Self-hosted Headscale trades control for capability.** It's a genuine
  open-source reimplementation of the coordination server (useful for data
  sovereignty and avoiding a SaaS dependency), but as of common deployments
  it supports only a **single tailnet** and does **not** support
  OIDC-group-based ACLs the way the hosted service does — plan group/tag
  management accordingly (you may need to hand-maintain what a hosted
  tailnet would derive automatically from IdP group membership), and treat
  the Headscale server itself (its DB, its private key, its DERP relay
  config) as a high-value asset requiring its own hardening, backup, and
  access control — it IS the trust root for every node that joins.
- **Compliance framing, when it's asked for:**
  - *SOC 2* — end-to-end WireGuard encryption satisfies data-in-transit
    controls; ACL-based access control satisfies authorization controls;
    Tailscale's audit logging covers connection-event logging; key
    management is centralized in the coordination server.
  - *GDPR* — Tailscale only routes traffic and does not inspect payload
    content (data minimization by design); all traffic is encrypted
    end-to-end; Headscale exists specifically for organizations that need
    data-sovereignty (keeping the coordination plane in their own
    jurisdiction); log retention is configurable per policy.
  - *NIST SP 800-207 (Zero Trust Architecture)* — Tailscale's model maps to
    identity-aware proxying (no implicit trust from network location),
    end-to-end encryption for data-in-transit, and least-privilege
    ACL-based access control; treat these as the specific claims to verify
    against your own configuration rather than assuming the product name
    alone satisfies the standard.
- **Patch discipline still applies behind the mesh.** Hiding a service
  behind Tailscale removes it from opportunistic internet-wide scanning, but
  it does not patch it. Two concrete cautionary examples worth citing when a
  team treats "it's on the tailnet" as sufficient: **regreSSHion
  (CVE-2024-6387)**, an unauthenticated remote-root bug in OpenSSH's
  signal-handler path that affected millions of exposed instances — a bug
  like this is exploitable by *anyone already reachable*, tailnet peers
  included, if the box is unpatched; and the **xz/liblzma backdoor
  (CVE-2024-3094)**, a supply-chain compromise in a dependency of sshd
  itself, which is a reminder that "reduce exposure" (what Tailscale does
  well) and "patch/verify supply chain" (what it does not do for you) are
  two separate, both-necessary disciplines.
  - **regreSSHion in detail**: disclosed 2024-07-01, a signal-handler race
    condition in sshd's `LoginGraceTime` path — a regression of an older bug
    (CVE-2006-5051) reintroduced in OpenSSH 8.5p1. Affects sshd 8.5p1 through
    (not including) 9.8p1, and pre-4.4p1, on **glibc-based Linux only**
    (OpenBSD is unaffected). Qualys estimated roughly 14 million
    internet-exposed potentially-vulnerable instances at disclosure time.
    Fixed in 9.8p1 — **the fix is the mitigation, not any ACL or key-expiry
    setting**, because the bug is pre-authentication. [unverified: exact
    exploitation difficulty figures (lab timing on 32-bit targets) vary by
    source and are not restated here as a hard number.]
  - **The general lesson generalizes to any access-plane software you put in
    front of a tailnet, not just sshd.** A heavier access-control plane
    (Teleport, Cloudflare Access, a bastion) is itself a high-value target
    precisely because it terminates authentication for many hosts at once —
    a critical remote-auth-bypass vulnerability in such software undoes the
    whole point of putting it there, so "we added an access plane" is not a
    substitute for patching that access plane on its own release cadence.
    [unverified: this is a single-source claim about access-plane software in
    general — treat "the access plane needs its own patch discipline" as the
    durable lesson, not any specific CVE number attributed to a named
    product, since those change as vendors patch.]
  - **Practical takeaway for a tailnet operator:** track the OpenSSH (or
    equivalent daemon) version on every node the same way you'd track it on
    an internet-facing host — "it's behind Tailscale" reduces *who* can reach
    the bug, it does not remove the bug. Automate security-only updates
    (`unattended-upgrades` on Debian/Ubuntu) specifically so this class of
    pre-auth bug gets patched without relying on a human noticing an
    advisory.

## 5. Reading tailnet-adjacent artefacts after an incident

If a device that participates in a tailnet is suspected of compromise, the
following host-level artefacts are where the forensic trail actually lives —
read them as **evidence**, not as a routine "is this normal" checklist:

- **Persistence mechanisms** — enumerate LaunchAgents/LaunchDaemons (macOS)
  or systemd units/cron/`at` jobs (Linux) added around the suspected
  compromise window. On macOS specifically, `sfltool dumpbtm` (Background
  Task Management registry, macOS 13+) is the most complete modern
  persistence artefact — it captures login items/agents/daemons that other
  views miss, and a hidden or unknown-developer entry there is a strong
  compromise indicator, not noise. Authorization plugins
  (`/Library/Security/SecurityAgentPlugins`) should normally be empty or
  contain only known smart-card software; an unexpected plugin there can
  intercept the login password itself.
- **Process provenance** — a running process launched from `/tmp`,
  `/var/tmp`, `/Users/Shared`, or another world-writable/hidden location, or
  one that is unsigned/ad-hoc-signed in a location where signed binaries are
  expected, is a strong indicator worth tracing back to its parent
  (`lsof -p <pid>`, then the launchd/BTM/cron entry that started it).
- **Privilege-escalation vectors** — check `sudoers.d` for `NOPASSWD` entries
  that shouldn't exist, check `$PATH` for a world-writable directory (an
  attacker who can drop a binary into a writable `$PATH` dir gets code
  execution the next time a normal command is typed), and check the process
  environment for `DYLD_INSERT_LIBRARIES` / other `DYLD_*` variables (library
  injection into running processes — normal state is empty).
- **TCC / Automation permissions (macOS)** — Accessibility and Input
  Monitoring grants are equivalent to keylogging/full-control capability;
  Automation (Apple Events) grants let one app drive another (browser,
  terminal, GUI) programmatically. Pay particular attention to what AI-agent
  tools and bare interpreters (`python`, `node`) hold here — a
  prompt-injection or supply-chain compromise of an agent with Automation
  rights over a browser or terminal is a direct path to actions taken *as
  you*, and residual grants left over from a disabled feature (e.g. an SSH
  helper's TCC entry surviving after Remote Login was turned off) are exactly
  the kind of stale permission worth revoking during a review, not leaving
  "because it's probably fine."
- **Trusted root certificates** — a custom-trusted root CA effectively
  grants its holder the ability to forge HTTPS for any site (a MITM vector).
  Expect only deliberately-added roots (employer MFA/VPN CA, a government
  digital-signature CA, or a locally-installed intercepting proxy like
  Charles/Proxyman/mitmproxy that you set up yourself). An unfamiliar root,
  or an *expired* root that was manually marked "trust anyway," is worth
  investigating and — after backing it up first — removing.
- **Outbound connection history correlates with beaconing (§3).** When
  investigating a specific incident, the process→IP map isn't just a
  detection tool, it's the timeline: correlate the first appearance of an
  unfamiliar regular connection with other artefacts (a new LaunchAgent, a
  new TCC grant, a new browser extension) to establish the compromise
  window.
- **Secrets exposure scope.** Once any credential is confirmed to have been
  present in a compromised environment — plaintext `.env`/`.netrc`/`.aws`
  files, shell history, or leaked into an AI-agent's session transcript — the
  correct response is to **rotate**, not merely delete or redact the
  artefact. Redaction after the fact removes the *evidence* of the leak but
  does not undo the exposure window; only rotation (revoke the old
  credential, issue a new one) actually closes it. This applies equally to a
  `tskey-` auth key as to any vendor API token — treat it as burned the
  moment it's found outside its intended secret store.
- **Never destroy evidence while investigating.** Every remediation action
  above (removing a LaunchAgent, deleting a certificate, revoking a device)
  should be preceded by a backup/export of the artefact being removed, and
  performed only after you've captured what you need for the incident
  timeline — an audit/investigation workflow is read-first, act-second,
  exactly like the routine security-posture audits it complements.

## 6. Endpoint-level checks worth running on any tailnet node (macOS example, generalizes)

A **read-only, local host audit** run on each tailnet member (not a Tailscale
feature itself, but directly relevant — a compromised endpoint compromises
its tailnet reach too) surfaces the artefacts an attacker who lands on a
tailnet peer would actually leave behind. The commands below are macOS
specifics from a dedicated host-audit tool; the categories generalize to any
OS (Linux equivalents in parentheses where obvious).

| # | Category | What normal looks like | Command to check | Fix (with rollback) |
|---|---|---|---|---|
| 1 | OS protections | SIP `enabled`, FileVault `On`, Gatekeeper `enabled` | `csrutil status`; `fdesetup status`; `spctl --status` | `csrutil enable` (Recovery-mode only); enable FileVault in System Settings; `sudo spctl --master-enable` |
| 2 | Firewall | `Firewall is enabled. (State = 1)` | `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate` | `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on --setstealthmode on` (rollback: `--setglobalstate off`). Note: this filters **inbound only** — it does not affect a VPN/tunnel you set up yourself. |
| 3 | NAT/port-forward (pf) | Only Apple system anchors (`com.apple/*`), no `rdr` rules | `sudo pfctl -s nat` | Investigate any non-Apple `rdr` rule before removing |
| 4 | Remote login (SSH) | Off unless you actually SSH into this box | `sudo systemsetup -getremotelogin` | `sudo systemsetup -setremotelogin off` (rollback: `... on`). If you need it, at minimum `PasswordAuthentication no` in `sshd_config`. |
| 5 | Trusted root certificates (MITM vector) | Only deliberately-added roots (employer MFA/VPN CA, government e-signature CA, a proxy tool you installed yourself) | `security find-certificate -c "NAME" -Z <keychain>` to get the SHA-1 | **Backup first**, then remove: `security find-certificate -c "NAME" -p > ~/Desktop/backup.pem` then `security delete-certificate -Z <SHA-1> ~/Library/Keychains/login.keychain-db` (or `sudo … /Library/Keychains/System.keychain` for the system store). Rollback: re-import the `.pem`. |
| 6 | Persistence (basic) | Vendor updaters, your own LaunchAgents, package-manager services | inspect `~/Library/LaunchAgents`, `/Library/Launch{Agents,Daemons}` | Remove a malicious agent **only after confirming it's malicious**: `launchctl bootout gui/$(id -u)/<label>` then delete the plist |
| 7 | Persistence (advanced, macOS 13+) | Known apps only in the Background Task Management registry | `sfltool dumpbtm` | Disable in System Settings → Login Items |
| 8 | System/network extensions | Known VPN clients, AV, capture tools | `systemextensionsctl list` | Investigate any unfamiliar network extension — it can see your traffic |
| 9 | Process provenance | Processes launch from `/System`, `/usr`, `/Applications`, signed Apple/Developer ID | `lsof -p <pid>`; `ps -p <pid> -o comm=` | A process from `/tmp`/`/var/tmp`/a hidden dir, or unsigned/ad-hoc-signed where a signed binary is expected, is a strong indicator |
| 10 | SSH key hygiene | Private keys `600`, passphrase-protected | `ls -l ~/.ssh` | `chmod 600 ~/.ssh/<key>`; add a passphrase: `ssh-keygen -p -f ~/.ssh/<key>`; store in the agent+Keychain: `ssh-add --apple-use-keychain` |
| 11 | Privilege escalation | `sudoers.d` empty/standard; no world-writable dir in `$PATH`; empty `DYLD_*` env | `sudo cat /etc/sudoers /etc/sudoers.d/*` (look for `NOPASSWD`); check `$PATH` dir perms; check env for `DYLD_INSERT_LIBRARIES` | `chmod o-w <dir>` for a world-writable `$PATH` entry; investigate any `DYLD_*` variable set outside a deliberate debugging session |
| 12 | Sharing services | Everything off unless deliberately enabled | check listeners on `445` (SMB), `548` (AFP), `631` (print), `3689` (media), `5900` (screen), `88` (Kerberos) | Disable via System Settings → General → Sharing |
| 13 | Secrets in AI-agent session logs | No live tokens in `~/.claude/projects`, `~/.codex/sessions`, editor history dirs | scan for vendor-token prefixes (`sk-ant-`, `sk-`/`sk-proj-`, `ghp_`/`pat`, `AKIA`/`ASIA`, `AIza`/`ya29.`, Stripe `sk_live_`, SendGrid `SG.`, JWT `eyJ…`, PEM private keys, connection strings) | Redact without deleting history: `bash redact-agent-secrets.sh` (dry-run), `--apply` (backs up first, STRICT patterns only), `--apply --aggressive` (adds generic `api_key=`/`secret=`/`password=`, higher false-positive rate but safe for logs). **Redaction ≠ rotation — rotate anything that ever leaked, regardless of whether you also redact it.** |

**VPN/tunnel-specific rows from the same audit** (directly relevant to a
tailnet host):
- **Active Tailscale/WireGuard/OpenVPN tunnels are normal *if you set them up
  yourself*** — but remember they create reachability paths into the host
  that bypass ordinary NAT/firewall assumptions; periodically re-confirm tailnet
  membership rather than assuming a familiar `100.x` address is still benign.
- **`100.100.100.100` as a configured DNS server is Tailscale's MagicDNS and
  is expected** whenever Tailscale is active — don't flag it on its own.
- **Reverse SSH tunnels (`ssh -R`)** forward a local port to a remote server,
  meaning that remote server can reach back inside your machine — fine for
  infrastructure you control, but it makes the remote endpoint's own security
  a direct dependency of yours.
- **Unexpected tunneling tools** — `ngrok`, `cloudflared`, `frpc` processes
  you did not start are a common way to punch an outbound tunnel that
  bypasses both your host firewall and your tailnet's own ACLs, since they
  create their own independent encrypted egress path.

**Standing rules that apply to every row above** (from the same source, and
worth repeating because they're easy to skip under time pressure): the audit
itself is **read-only** — never add a mutating command to an audit script.
**Nothing destructive without explicit user confirmation.** Before any fix,
explain what changes, what could break, and how to roll it back. **Back up
before deleting** any certificate or key. Never request or log a
password/passphrase. **Never publish the audit report** — it contains host
identifiers, IPs, and infrastructure detail; only the audit script itself is
shareable.

## 7. Windows host forensics — proving Tailscale execution after the fact

Sections 1-6 cover auditing a tailnet from the **admin console / control
plane** side. This section answers a narrower, DFIR-flavored question: *a
Windows host may have run Tailscale without authorization, or a Windows
endpoint that is a known tailnet member is now suspected of compromise —
which on-disk artefacts prove `tailscale.exe`/`tailscaled.exe` **ran**,
**when**, **under which account**, and **what it did**, even if the
attacker uninstalled Tailscale or cleared logs afterward?

Windows keeps multiple independent, overlapping execution-history stores
specifically so that deleting or disabling any one of them does not erase
the evidence. Read them **together** — the artefacts below are ordered
from "proves the binary once existed on disk" to "proves it actually ran"
to "proves what it did once running," and a gap in one artefact right
where you'd expect an entry is itself a finding, not a dead end.

| Artefact | What it proves for a Tailscale investigation | Where it lives | How to read it |
|---|---|---|---|
| **Amcache — Program Entries** | A Tailscale MSI/installer was registered on this host, and when (`InstallDate`) — including a portable copy dropped outside `Program Files` (`PathsList`) | `C:\Windows\appcompat\Programs\Amcache.hve` (+ `.LOG1`/`.LOG2` transaction logs) | `AmcacheParser.exe -f "Amcache.hve" --csv Output`, then open `Amcache_ProgramEntries.csv` and filter `ProgramName` for `[unverified: exact display string, expect something containing] "Tailscale"` |
| **Amcache — Associated File Entries** | `tailscale.exe` / `tailscaled.exe` **existed on disk** with a specific SHA-1, path and timestamp — survives even if the binary was later deleted or the app uninstalled | same hive | filter `Amcache_AssociatedFileEntries.csv` on `FullPath contains: \Tailscale\` and record the `SHA1` for hash-based correlation |
| **Amcache — Driver Binaries** | The kernel-mode tunnel driver Tailscale installs on Windows loaded on this host — a rootkit-adjacent artefact that survives a userspace uninstall longer than the app itself | same hive, `Amcache_DriverBinaries.csv` | filter `DriverInBox = false`; `[unverified: exact driver file name — commonly reported as Wintun-derived]`. A signed, correctly-attributed entry is expected on an authorized host; an **unsigned** or **unexpectedly-named** tunnel driver is the anomaly worth escalating |
| **Prefetch** | `tailscale.exe`/`tailscaled.exe`/`tailscale-ipn.exe` **actually executed**, how many times (`run_count`), and up to 8 most recent execution timestamps (Win8+) | `C:\Windows\Prefetch\*.pf`, naming pattern `EXECUTABLE_NAME-HASH.pf` | `PECmd.exe -d "C:\Windows\Prefetch" -k "tailscale" --csv Output --csvf tailscale_prefetch.csv` (the `-k` keyword filter mirrors the source tool's own `-k "powershell,cmd,wscript,cscript,mshta"` pattern) |
| **Security.evtx — Event ID 4688 / 4689** | WHEN a Tailscale process launched and exited, and — if command-line auditing is enabled — the exact arguments (e.g. a `tailscale up`/`tailscale login` invocation) | `C:\Windows\System32\winevt\Logs\Security.evtx` | `EvtxECmd.exe -f Security.evtx --csv Output` or the Python `PyEvtxParser` snippet in the source skill, filtering `EventID == '4688'` |
| **Security.evtx — Event ID 4624 / 4648** | WHICH ACCOUNT was logged on (and how — `LogonType`, `AuthenticationPackageName`) at the moment a Tailscale process ran; correlate `TargetUserName` against the process-creation event's account | same file | same tooling; cross-reference the `TargetLogonId` between the 4624/4648 logon and the 4688 process-creation event for that PID |
| **Security.evtx — Event ID 4697 ("Service Installed")** | The Tailscale Windows **service** was installed — this is the persistence artefact, distinct from a one-off interactive run of the GUI/CLI | same file | `EvtxECmd.exe -f Security.evtx --csv Output`, filter `EventID == '4697'`; the `System.evtx` channel (prioritized in the source skill's own collection list as "System services, drivers, hardware events") is the fallback if Security auditing for service creation was not enabled |
| **Microsoft-Windows-Sysmon%4Operational.evtx (if Sysmon is deployed)** | If present, Sysmon's process-creation and network-connection events give the fullest "what did it connect to" picture without relying on Tailscale's own logs | `C:\Windows\System32\winevt\Logs\Microsoft-Windows-Sysmon%4Operational.evtx` | same EvtxECmd/Chainsaw/Hayabusa tooling pointed at this channel instead of Security.evtx |
| **Security.evtx / System.evtx — Event ID 1102 / 104 ("Audit Log Cleared")** | Anti-forensics: if this event lands in the window right around a suspected unauthorized tailnet join, treat log-clearing itself as the finding, not an obstacle that ends the investigation | either file | search explicitly for these IDs even when nothing else in the log looks abnormal — their mere presence is the signal |

### Practical sequence

1. **Collect first, parse second.** Pull `Amcache.hve` (+ both `.LOG` files),
   the full `C:\Windows\Prefetch\` directory, and the relevant `.evtx`
   channels from the image or a live triage copy (KAPE target `KapeTriage`
   collects all of these in one pass) before running any parser, and hash
   everything for integrity exactly as the source workflow does:

   ```powershell
   sha256sum /cases/case-2026-001/evtx/*.evtx > /cases/case-2026-001/evtx/evtx_hashes.txt
   ```

2. **Confirm the binary existed, then confirm it ran, then confirm what it
   did** — the three-artefact chain (Amcache → Prefetch → EVTX) is
   deliberate: Amcache alone proves file *presence*, not *execution*;
   ShimCache/Prefetch is what upgrades that to execution evidence, exactly
   as the Amcache source material itself insists ("Do not use \[Amcache\]
   as sole proof of program execution"). Do not close an investigation on
   an Amcache hit alone.

3. **Search Sigma-based tooling with the Tailscale keyword directly**,
   the same way the source workflow searches for `mimikatz`:

   ```bash
   /opt/chainsaw/chainsaw search /cases/case-2026-001/evtx/ \
      -s "tailscale" --json

   /opt/hayabusa/hayabusa csv-timeline \
      -d /cases/case-2026-001/evtx/ \
      -o /cases/case-2026-001/analysis/hayabusa_timeline.csv \
      -p verbose
   ```

   then grep the resulting timeline/CSV for `tailscale` case-insensitively
   rather than relying only on a purpose-built Sigma rule, since a generic
   Sigma ruleset is unlikely to ship a Tailscale-specific detection.

4. **Rotate, don't just record, anything found in a command line.** If a
   4688 event's command-line field captured a `tailscale up
   --authkey=<value>` invocation (or the value appears in Prefetch's
   referenced-files list, PowerShell history, or an AI-agent session
   transcript per §5), the auth key is burned the moment it's found
   outside the admin console's own key-management UI — revoke it in the
   admin console and issue a new one; do not treat redaction/deletion of
   the log entry as sufficient remediation.

5. **A gap is a finding.** If the incident window overlaps a period with
   no Prefetch entry, no 4688 event, and no Amcache update for a host that
   the admin console (§1's device list) shows as an active tailnet member,
   that mismatch — not the absence of evidence — is what needs escalating:
   either logging was disabled/cleared (check for 1102/104 first), or the
   device list itself is stale and needs re-verifying against `tailscale
   status` on the actual host.

## GAPS

- The sources behind this reference contain **no explicit offensive
  tradecraft for using a tailnet as a C2/exfiltration channel** — the one
  security-focused Tailscale source
  (`deploying-tailscale-for-zero-trust-vpn`) is framed entirely as a
  defensive deployment guide with MITRE ATT&CK technique mappings for what
  the architecture *mitigates*, not a red-team playbook. Nothing needed
  inverting because nothing offensive was present; the ATT&CK mappings and
  the beaconing/tunnel-detection guidance above are that same
  defensive content, reorganized and made explicit as a hunting checklist.
- **`tskey-` auth-key patterns are not covered by the vendor-secret-scanner
  pattern lists documented in the available sources** (those cover
  Anthropic/OpenAI/GitHub/AWS/Google/Stripe/SendGrid/Twilio/npm/DigitalOcean/
  JWT/Telegram/connection-strings/PEM keys, but not Tailscale). This is
  flagged as an actionable gap in §2 rather than silently left out.
- Available sources describe Headscale's **single-tailnet, no OIDC-group
  ACL** limitation as a general capability gap; they do not specify a
  version number where this might change, so treat it as "true of common
  deployments as documented" rather than a permanently fixed constraint —
  verify against the Headscale release you're actually running before
  relying on it as a hard limit.
- No available source covered Tailscale-specific SIEM/webhook payload
  formats in detail beyond "audit logs available in the admin console;
  integrate via webhook or API" — the exact webhook event schema was out of
  scope for what is documented, and is not fabricated here.
- **A second, independent macOS host-audit tool's secret-scanner also lacks
  `tskey-` coverage** (its documented pattern list is the same vendor set:
  Anthropic/OpenAI/GitHub/AWS/Google/Stripe/SendGrid/Telegram/JWT/connection-
  strings/PEM keys). Two independently-authored scanners both
  miss the Tailscale auth-key prefix — reinforcing §2's actionable gap rather
  than being a one-off oversight.
- **The general SSH-hardening/remote-access material alongside the
  Tailscale-specific sources covers a large amount of non-Tailscale ground**
  (OpenSSH version-gated features, certificate authorities, FIDO2 hardware
  keys, mosh, WSL2 host-interop) that is out of scope for a *Tailscale*
  security reference and is not duplicated here — only the parts that
  directly concern Tailscale-as-transport, Tailscale SSH, and the
  regreSSHion/xz cautionary examples were pulled in. Consult
  `ssh-and-agent-access.md` (if present in this skill) or the original
  `securing-remote-access` skill for the full SSH-generations model.
- **The Teleport CVSS 9.8 auth-bypass (CVE-2025-49825) is mentioned in only
  one source**, as a supporting example that an access-control plane is
  itself a high-value target — it is not Tailscale-specific and is not
  independently verified here beyond that single citation; treat the
  specific CVE number as [unverified] and the general lesson (patch your
  access plane) as the durable takeaway.
