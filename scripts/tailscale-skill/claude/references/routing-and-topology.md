# Routing and topology — subnet routers, exit nodes, mesh

Configuration and topology only. For DERP/NAT/relay diagnosis, MTU, and container-router
live-debugging commands see `references/troubleshooting.md` §2 and §8 — not duplicated here.
`[unverified]` marks single-source or low-confidence claims; treat commands as recipes to run
yourself, not pre-executed facts.

## 1. Subnet routers — full lifecycle (7 stages, each with its own silent-failure mode)

The lifecycle, as a 7-stage model with corroborating detail folded in from every angle:

1. **Advertise** — `sudo tailscale set --advertise-routes=<CIDR>[,<CIDR>...]` (or `tailscale up
   --advertise-routes=...`). Verify: `tailscale status --json | jq '.Self.AllowedIPs'`.
2. **Approve** — a route existing + a client accepting it is NOT enough; it must be separately
   APPROVED. This is **"the single most commonly missed step"** and the #1 field-support issue.
   Two paths:
   - Manual: admin console → Machines page → device with "Subnets" badge → Subnets section →
     Edit → approve routes → Save.
   - Automatic via ACL `autoApprovers` (eliminates the manual click):
     ```hujson
     {"autoApprovers": {
       "routes": {"10.0.0.0/8": ["tag:subnet-router"], "192.168.0.0/16": ["tag:subnet-router"]},
       "exitNode": ["tag:exit-node"]
     }}
     ```
     Headscale equivalent: `headscale routes approve -r <route-id>`.
   - Approving a route only makes the PATH exist — grants/ACLs still separately gate WHO may use
     it.
3. **Distribute** — automatic, 30-60s propagation to peers.
4. **Accept** — client-side opt-in, **default OFF**, "most commonly missed":
   ```bash
   sudo tailscale set --accept-routes          # Linux — REQUIRED, not automatic
   ```
   Most non-Linux platforms auto-accept; **Linux clients must explicitly opt in** — non-Linux
   platform behavior may vary by release and is worth re-checking against current docs before
   prescribing it as a universal rule.
5. **Install** — the client installs the route into **policy routing table 52**, NOT the main
   routing table. `ip route` (no table arg) **NEVER** shows Tailscale subnet routes — this is
   called out as "the single most common source of confusion." Use:
   ```bash
   ip route show table 52
   ```
   Table 52 sits alongside `ip rule` priority entries (e.g. `5270: from all lookup 52`) so it
   doesn't conflict with existing main-table routes to the same CIDR — analogous to a Cisco/MPLS
   VRF but priority-rule-based rather than interface-based. **Docker/container caveat:** table
   52 lives inside the container's own network namespace — inspect with `docker exec <c> ip
   route show table 52`, never from the host (live diagnostic commands: see
   troubleshooting.md §8).
6. **Forward** — the subnet router itself needs `net.ipv4.ip_forward=1` (+ `net.ipv6.conf.all.
   forwarding=1` for v6 CIDRs) and no firewall block. Linux:
   ```bash
   echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
   echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
   sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
   ```
   `firewalld`: `firewall-cmd --permanent --add-masquerade`. **macOS handles IP forwarding
   automatically** when advertising routes — no manual sysctl needed there.
   Repeatedly flagged as "the #1 setup issue" and a silent failure: **without IP forwarding,
   Tailscale WARNS but still starts — no hard failure to alert you**.
   Windows: `firewalld`-style masquerade is not applicable, but the same forwarding sysctls apply
   on any Linux subnet router regardless of distro (check the current sysctl path per distro
   before prescribing exact commands — `/etc/sysctl.d/99-tailscale.conf` is one common location,
   `/etc/sysctl.conf` another).
7. **Return** — the target's return traffic must reach back through the router. See SNAT
   section below.

Windows: `tailscale set --advertise-routes=...` via PowerShell (same flag). Both IPv4/IPv6
supported on every platform except Apple TV (IPv4 only). Android: app → Settings → Subnet
routing → Add route → CIDR.

Devices reachable only THROUGH a subnet router (i.e. behind it, not running Tailscale
themselves) do not count toward the plan's device limit.

**Docker container-boot gotcha:** if the auth key used by `containerboot` has invalid/missing
tags (`requested tags are invalid` in logs — the tag must exist in ACL `tagOwners` and the key's
creator must own that tag), route advertisement via the `TS_ROUTES` env var is **skipped
silently, with no clear top-level error**, and subsequent container restarts may
re-authenticate but not re-advertise the route. Runtime fix: `tailscale set
--advertise-routes=<CIDR>` inside the running container.

**Verification, end to end:** `tailscale ip -4` on the router, then `ping <tailscale-ip>`, then
`ping 192.168.1.100` (a target behind the subnet) from the client. A fuller check sequence:
`tailscale status --json` on the router to confirm `AllowedIPs`; from the client, `tailscale
ping <router-hostname>`; then reach an actual LAN target behind the router with `nc -vz
<LAN_TARGET_IP> <TARGET_PORT>`.

## 2. Firewall layering — tailnet ACLs vs the OS firewall are SEPARATE layers

**Stateful filtering** (`--stateful-filtering`, default ON) allows return traffic for
established connections without needing an explicit reverse ACL rule. This does NOT mean the
tailnet's ACL layer is the only firewall in play:

- Traffic **ENTERING** the tailnet via a subnet router or exit node is still subject to tailnet
  ACLs (the control-plane grants).
- Traffic **LEAVING** toward the advertised subnet (or out through an exit node) is filtered
  ONLY by that router/exit node's **own OS firewall** — Tailscale does not manage that side.

For exit-node egress filtering, apply iptables on the exit node itself, e.g.:

```bash
iptables -I FORWARD -s 100.64.0.0/10 -d 192.0.2.0/24 -j DROP
```

**Defense-in-depth takeaway:** tailnet ACLs alone are not a substitute for restricting
subnet/exit-node egress at the OS level — the two layers (control-plane ACLs, data-plane OS
firewall) must both be configured deliberately.

### Combine a host firewall with the `tailscale0` interface to hide a service port from the public internet

After exposing a service via `tailscale serve` (see `references/serve-funnel-tls.md`), the raw
service port must ALSO be blocked at the OS firewall level, or Serve's HTTPS wrapping doesn't
actually stop someone reaching the port directly on the public IP.

```bash
sudo ufw allow OpenSSH
sudo ufw allow in on tailscale0
sudo ufw deny YOUR_PORT
sudo ufw enable
```

(Confirm with `y` when UFW asks to enable.)

Effect: SSH stays reachable (needed for admin access), all traffic arriving over the
`tailscale0` interface is allowed (since it's already tailnet-authenticated), and the service's
raw port is explicitly denied to anything NOT arriving via `tailscale0` — i.e. the public
internet can no longer reach the service port directly, even though `tailscale serve` is
technically listening on it internally.

**Verification checklist (both directions matter):**

- SHOULD work: opening the tailnet-only `ts.net` URL from a device joined to the tailnet (e.g.
  a phone with the Tailscale app running, on cellular data).
- should NOT work: opening `http://<vps-public-ip>:<port>` from any browser, anywhere.

If the public-IP URL fails to load while the `ts.net` URL succeeds, the port is correctly
hidden — the service is then only reachable by tailnet members.

Command reference for checking the state of each layer later:

```bash
tailscale ip -4                # this host's tailnet IP
tailscale serve status         # the ts.net URL currently being served
sudo ufw status                # firewall rule state
```

### VPN (Tailscale) as a recommended required layer when running an autonomous AI agent on a home/local network

From a security-tiering writeup ranking where to run an autonomous AI agent (an
"OpenClaw"-style agent with broad host access) by risk:

- Tier ranking (best to worst): fully-isolated cloud sandbox > cloud VPS + Docker container
  isolation > dedicated local machine + container isolation > direct install on a VPS > direct
  install on a dedicated local machine > direct install on the user's MAIN daily-use PC (worst
  — full compromise of personal data risk).
- For the "cloud VPS + Docker" tier, the writeup notes that additionally deploying Tailscale to
  hide the SSH/web ports (i.e. the install + `tailscale serve` + firewall-restrict-to-`tailscale0`
  technique above) is what pushes that tier's safety close to a fully-isolated sandbox tier: "if
  you also introduce Tailscale to hide the SSH/web port, you get an operation where the agent
  effectively disappears from the network — this alone can approach the top isolation tier."
- For the "dedicated local machine + container isolation" tier (running on a spare machine on a
  home LAN, e.g. a Mac Mini, Intel N100 box, or Raspberry Pi, rather than on the main daily PC),
  the writeup treats a VPN (Tailscale is named explicitly) as management infrastructure that
  should be used ALONGSIDE a default-deny firewall and Docker container isolation, specifically
  to prevent lateral movement to other devices on the same home LAN if the agent host is
  compromised.

`[unverified]` — this is a risk-tiering opinion piece, not an authoritative Tailscale document;
the specific tier claims are the author's own judgment, but the underlying technique (Tailscale
+ default-deny firewall + container isolation as layered defense for an agent host) is
consistent with the concrete step-by-step method above.

## 3. SNAT / asymmetric-routing (the "Return" stage in depth)

**Default:** SNAT is ON (as of Tailscale **1.64+**, automatic). Traffic from tailnet clients
appears to originate from the router's own LAN IP, which simplifies return routing — the LAN's
existing default gateway doesn't need to know about the `100.64.0.0/10` CGNAT range at all,
because return packets just go back to the router's own known LAN address.

**Symptom without it (or on older releases):** if the subnet router is NOT the target's default
gateway, response packets go to the real gateway, which doesn't know `100.x.y.z` and drops them.
"Connections to subnet devices timeout."

**Fix — either:**
```bash
sudo tailscale up --advertise-routes=192.168.1.0/24 --snat-subnet-routes=true   # default since 1.64+
# OR, if disabled and you need the original client IP preserved instead:
ip route add 100.64.0.0/10 via 192.168.1.1        # static route on the LAN gateway/target
sudo iptables -I FORWARD -i tailscale0 -j ACCEPT
sudo iptables -I FORWARD -o tailscale0 -j ACCEPT
```

**Disabling SNAT** (`--snat-subnet-routes=false`) preserves the ORIGINAL client IP through the
router — needed when the downstream network requires the real client IP for logging, per-device
firewall rules, or ACLs (Headscale documents this same flag/behavior; a real-world Talos
deployment uses it specifically for audit-logging reasons). Trade-off: disabling it requires the
LAN's own gateway to carry an explicit static route back to `100.64.0.0/10` via the subnet
router, "or return traffic drops."

## 4. High availability / failover / longest-prefix-match

**HA pattern:** run 2+ routers advertising the **same** route. Tailscale auto-load-balances and
fails over between them with **no extra config**. Avoid `--accept-routes` on the subnet routers
THEMSELVES if they advertise identical routes to each other.

```bash
sudo tailscale up --advertise-routes=10.0.0.0/24 --advertise-tags=tag:subnet-router-primary
sudo tailscale up --advertise-routes=10.0.0.0/24 --advertise-tags=tag:subnet-router-secondary
```

**Failover timing** `[unverified — single source]`: oldest router is primary; failover after
15s offline; graceful switchover on maintenance. Inspect current primary per route:
```bash
tailscale status --json | jq -r ".Peer[] | select(.PrimaryRoutes[]? == \"$ROUTE\") | .HostName"
```

**Overlapping (but NOT identical) routes — longest-prefix-match wins.** Router A advertises
`10.0.0.0/16` (broad), Router B advertises `10.0.0.0/24` or `10.0.1.0/24` (more specific) —
traffic to an address inside the specific prefix uses the specific router; traffic elsewhere in
the broad prefix uses the broad router. Concretely: Router A advertises `10.0.0.0/16` (catches
broad traffic), Router B advertises `10.0.1.0/24` (more specific) — traffic to `10.0.1.5` goes
via B, traffic to `10.0.2.5` goes via A.

**Critical HA gotcha — no fallback on more-specific-router failure:** Tailscale does **NOT**
fall back to the less-specific route if the more-specific router goes offline. If Router B (the
specific `/24`) dies, traffic to its addresses does NOT reroute through Router A's broader `/16`
— it simply fails. **Mitigation: have every router advertise BOTH the broad and the specific
prefixes**, not just its "own" prefix, so genuine failover exists at every specificity level.

**Caveat on cross-router overlap:** avoid overlapping CIDRs between DIFFERENT (non-HA) routes —
"overlapping-subnet routing behavior is undefined" when the routes are not the deliberate
broad/specific HA pattern above.

## 5. 4via6 — routing genuinely-overlapping subnets (e.g. two sites both on `192.168.1.0/24`)

Assign a unique **site ID** per location; Tailscale maps each site's overlapping IPv4 range
through a distinct, non-overlapping, site-specific **IPv6** address ("4via6"). Use case: two
branch offices that both use `192.168.1.0/24` and need to be reachable simultaneously without
renumbering either. `[unverified — single source, no CLI syntax given]`.

## 6. Route conflicts with a client's OWN network stack

**Local-LAN overlap:** if an advertised subnet (e.g. `192.168.1.0/24`) overlaps the CLIENT's own
local network, the client kernel prefers the LOCAL route and never routes that traffic through
Tailscale — `ip route get <subnet-ip>` shows the local interface, not `tailscale0`. **No
automatic resolution.** Options: renumber one of the two networks, or route via a jump host
inside the remote subnet.

**Third-party VPN/proxy hijack on macOS:** a proxy tool (e.g. Shadowrocket) can install a
competing route to the same CGNAT prefix via `en0` instead of Tailscale's `utun`. Diagnose:
```bash
route -n get <tailscale-ip>            # should show interface: utunN (Tailscale's), not en0
ifconfig | grep -A2 'inet 100\.'        # confirm which utun is Tailscale's
netstat -rn | grep 100.64               # reveals two competing routes if present
```
MTU heuristic to tell them apart: 1280 = typically Tailscale, 4064 = typically a Shadowrocket
TUN. **macOS route-priority mechanics: `UGSc` (static gateway) beats `UCSI` (cloned static
interface) for the same prefix length** — so a VPN-added `en0` route always wins over
Tailscale's `utun` route for that prefix. Symptom: "everything broken except `tailscale ping`."
(Full proxy/VPN-conflict troubleshooting: see troubleshooting.md §6.)

## 7. Exit nodes — setup, selection, and the two-approval trap

**Prereqs:** Tailscale v1.20+ on both sides. Platforms that can BE an exit node: Linux, macOS,
Windows, Android, tvOS.

**Server side (advertise):**
```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale set --advertise-exit-node        # or: tailscale up --advertise-exit-node
```
`firewalld`: `firewall-cmd --permanent --add-masquerade`. Verify egress works before trusting it:
```bash
sudo tailscale up --advertise-exit-node                       # on the exit node
sudo tailscale up --exit-node=<exit-node-ip>                  # on the client
curl ifconfig.me                                              # should show exit node's public IP
```

**Per-platform exit-node performance:** Linux = kernel-level routing, **recommended, most
performant**. macOS = Tailscale menu → Exit Node → Run Exit Node (**userspace routing, less
performant**; prevent system sleep). Windows = system tray → Exit node → Run exit node
(userspace; enable "Run Unattended" to persist after logout; prevent sleep). Android = app →
Exit Node → Run as exit node (**battery-intensive**, keep plugged in). tvOS is a supported
exit-node platform but no per-platform performance note is available for it.

**Approval — a hard TWO-gate requirement, not just admin-console:**
1. Login auth (browser): running `--advertise-exit-node` opens a browser auth URL.
2. Admin Console approval: `https://login.tailscale.com/admin/machines` → find node → "⋯ → Edit
   route settings" → toggle **"Use as exit node" ON**.

Skippable entirely via `autoApprovers.exitNode` (§1 above).

**The trap this produces:** `tailscale status --json` can show `AdvertiseRoutes:
['0.0.0.0/0','::/0']` (gate 1 succeeded) while `tailscale exit-node list` still reports "no exit
nodes found" — because gate 2 (admin console) is still pending. **The CLI-side advertise
succeeding does NOT mean the exit-node capability is live.** Verify with:
```bash
tailscale up --accept-dns=false --accept-routes --advertise-routes=0.0.0.0/0,::/0
# wait ~10s
tailscale exit-node list          # should now show the node
```

**Client side (select):**
```bash
sudo tailscale set --exit-node=<hostname-or-ip>
sudo tailscale set --exit-node=                     # stop using / disable
sudo tailscale set --exit-node=auto:any              # auto-selection / multi-exit-node HA [unverified — single source]
tailscale exit-node suggest                          # auto-pick nearest / lowest-latency
tailscale exit-node list                             # list available candidates
```
Verify egress: `curl ifconfig.me` should show the exit node's public IP — this exact check is
reported independently by multiple sources.

**LAN-access default — the most commonly reported exit-node gotcha, from four independent
angles:** by default, using an exit node **BLOCKS local network access** — ALL traffic including
LAN goes through the exit node. Keep local LAN reachable with:
```bash
sudo tailscale set --exit-node=<ip> --exit-node-allow-lan-access=true
```
`--exit-node-allow-lan-access` exempts RFC 1918 addresses from the exit-node tunnel.

**Severe, recurring footgun (corroborated by two independent sources, HIGH confidence) — remote
lockout risk:** setting an exit node WITHOUT `--exit-node-allow-lan-access=true` **can drop the
very SSH session used to configure it**, requiring physical/console access to recover. **ALWAYS
pair `--exit-node` with `--exit-node-allow-lan-access=true`** when configuring remotely — this is
presented as a recurring, serious footgun, not a one-off edge case. Recovery command (needs the
dropped session restored some other way first): `sudo tailscale set --exit-node=`. Verify the
switch didn't break egress before trusting it: `curl -s --connect-timeout 10 https://example.com
-o /dev/null -w '%{http_code}'` — a `000` response means the exit node isn't routing correctly;
revert immediately.

**Enterprise/commercial extensions:**
- **Mullvad VPN integration** — commercial exit nodes in 30+ countries once linked in the admin
  console: `tailscale set --exit-node=mullvad.se`, `tailscale set --exit-node=mullvad.us-nyc`.
- **Mandatory exit-node MDM policy** — organizations can force mandatory exit-node usage via
  MDM/system policy for traffic-inspection compliance.
- **Destination logging (Enterprise):** admin console → Logs → Network flow logs (requires log
  streaming enabled).
- **Known platform caveat:** GCP Linux VMs have a documented exit-node issue with an unspecified
  workaround in Tailscale's own docs — not documented further.

## 8. Subnet router vs exit node vs app connector — which one to reach for

- **Subnet router** — routes specific PRIVATE IP SUBNETS only (e.g. `192.168.1.0/24`). Requires
  IP forwarding + advertising CIDRs.
- **Exit node** — routes ALL non-Tailscale traffic (full internet egress) through the node.
- **App connector** — routes DNS+TCP for specific **DOMAINS** (not IP subnets), without
  advertising subnets or needing IP forwarding:
  ```bash
  tailscale set --advertise-connector
  ```
  ```jsonc
  {"nodeAttrs": [{"target": ["*"], "app": {"tailscale.com/app-connectors": [
    {"connectors": ["tag:connector"], "domains": ["*.salesforce.com", "*.amazonaws.com"]}
  ]}}]}
  ```
  **v1.88+ ships preset app-connector profiles** for common SaaS: AWS Console/APIs, Salesforce,
  Microsoft 365, GitHub Enterprise. Domain routing is a control-plane concern, not a CLI flag.
  **Do not treat an app connector as a general exit node — keep its routes domain-scoped.**
  Connector auth-key/OAuth-credential expiry silently breaks routing; production reviews should
  include an expiry check.

## 9. CLI reference — `tailscale set` / `up` / `down` flags relevant to routing

`tailscale set` changes settings **without reconnecting** and is preferred over `tailscale up`
for adjustments once the tailnet connection already exists — it only updates the specified
settings, leaving everything else untouched:

```bash
tailscale set --exit-node=new-exit-node
tailscale set --exit-node=                    # disable exit node
sudo tailscale set --ssh
sudo tailscale set --advertise-routes=10.0.0.0/8
tailscale set --advertise-exit-node
tailscale set --exit-node=<ip-or-hostname>
tailscale set --accept-routes                 # Linux
tailscale set --hostname=my-server
tailscale set --shields-up                    # block incoming connections from other tailnet devices
tailscale set --operator=$USER                # allow a non-root user to manage tailscaled
tailscale set --auto-update
tailscale set --webclient
tailscale set --advertise-connector
tailscale set --exit-node-allow-lan-access
```

Most `up` flags are also accepted by `set` — no reconnect needed for either. **Gotcha:**
`tailscale set --reset` reverts every UNSPECIFIED flag to its default — confirm what is currently
set before running it, or a routing/exit-node config silently reverts alongside whatever you
actually meant to change.

**`tailscale up` / `down` key flags** — `up` accepts: `--ssh`, `--accept-routes`,
`--advertise-exit-node`, `--advertise-routes=<ip>`, `--exit-node=<ip|name>`, `--shields-up`
(block incoming connections from other tailnet devices), `--force-reauth`,
`--stateful-filtering` (relevant to subnet routers/exit nodes — see §2 above). `down` accepts:
`--accept-risk=<risk>` (`lose-ssh` to accept the SSH-loss warning specifically, `all` for all
risks; skips the interactive confirmation) and `--reason="<message>"` (required if the
`AlwaysOn.OverrideWithReason` policy is enabled). `tailscale down --accept-risk=all` disconnects
without any confirmation prompt.

## 10. Infrastructure-as-code patterns

**Idempotent shell scripts** — both `setup_subnet_router.sh <cidr> [auth_key]` and
`setup_exit_node.sh [auth_key]` share the same shape: install tailscale if missing, enable
IPv4+IPv6 forwarding via `/etc/sysctl.d/99-tailscale.conf` (falling back to `/etc/sysctl.conf` if
that path doesn't exist), verify `/proc/sys/net/ipv4/ip_forward == 1` (exit 1 if not — fail
fast rather than silently not-forwarding), optionally enable UDP GRO forwarding for performance
(`ethtool -K $NETDEV rx-udp-gro-forwarding on rx-gro-list off`), start `tailscaled` via systemd,
then run the appropriate `tailscale up --advertise-routes=...` / `--advertise-exit-node` with
`--auth-key=...` and `--advertise-tags=...`.

**Ansible:**
```yaml
- name: Setup Tailscale Subnet Router
  hosts: routers
  become: yes
  tasks:
    - name: Install Tailscale
      shell: curl -fsSL https://tailscale.com/install.sh | sh
      args: {creates: /usr/bin/tailscale}
    - name: Enable IP forwarding
      sysctl: {name: "{{ item }}", value: "1", sysctl_file: /etc/sysctl.d/99-tailscale.conf, reload: yes}
      loop: [net.ipv4.ip_forward, net.ipv6.conf.all.forwarding]
    - name: Configure Tailscale
      command: >
        tailscale up --auth-key={{ tailscale_auth_key }} --advertise-routes={{ advertised_routes }}
        --advertise-tags=tag:subnet-router --hostname={{ inventory_hostname }}
      changed_when: "'Success' in result.stdout"
```

**Cloud-init** (Hetzner/AWS/GCP/Azure/DigitalOcean):
```yaml
#cloud-config
runcmd:
  - ['sh', '-c', 'curl -fsSL https://tailscale.com/install.sh | sh']
  - ['tailscale', 'up', '--auth-key=TS_AUTHKEY_PLACEHOLDER', '--advertise-tags=tag:worker', '--ssh']
```
Hetzner-specific: use `cx22` or higher for RAM headroom; allow UDP **41641** inbound in the cloud
firewall for DIRECT WireGuard connections (avoids DERP-relay latency, ties to troubleshooting.md
§2); after Tailscale is up, remove all other cloud-firewall rules (Tailscale ACLs become the
enforcement point); a fuller example additionally provisions a sudo `deploy` user, installs
`ufw`/`curl`/`jq`, and locks down with UFW (`default deny incoming` / `allow outgoing` / `allow in
on tailscale0` / `--force enable`) in the same `runcmd`.

**Talos/Kubernetes subnet routing** — two DISTINCT concerns, both required:
1. **Bind kubelet/etcd to the physical subnet, NOT the Tailscale IP** — without this, kubelet
   binds to `100.x.y.z` and etcd peers over the tailnet, **breaking the cluster on node
   reboot**. Flagged as "critical, easy to miss":
   ```yaml
   machine:
     kubelet:
       nodeIP:
         validSubnets: ["192.168.1.0/24"]
     cluster:
       etcd:
         advertisedSubnets: ["192.168.1.0/24"]
   ```
2. **Advertise pod/service CIDRs as subnet routes:**
   ```yaml
   machine:
     files:
       - content: |
           TS_AUTHKEY=<redacted>
           TS_ROUTES=10.244.0.0/16,10.96.0.0/12
           TS_EXTRA_ARGS=--advertise-tags=tag:talos --snat-subnet-routes=false --accept-routes
         path: /var/etc/tailscale/auth.env
         permissions: 0o600
         op: create
     sysctls:
       net.ipv4.ip_forward: "1"
       net.ipv6.conf.all.forwarding: "1"
   ```
   `--snat-subnet-routes=false` here preserves the original client IP for audit/logging;
   `--accept-routes` lets the node use routes advertised by OTHER tailnet devices; the IP
   forwarding sysctls are required for subnet routing to function at all. Routes still need
   admin-console approval unless `autoApprovers` is configured. (Talos troubleshooting commands
   — unreachable via talosctl, missing certSANs, etc. — live in troubleshooting.md §8.)

**Minimal manual pattern (self-contained, no orchestration tool):**
```bash
sudo tailscale up --advertise-routes=10.0.0.0/24,192.168.1.0/24
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
sudo tailscale up --accept-routes
```
Gotcha restated: without `net.ipv4.ip_forward=1` (and the v6 equivalent for v6 CIDRs), the
advertised routes are accepted by peers but packets are silently dropped AT the router node —
this is the #1 cause of "route is advertised and approved but nothing gets through."

## 11. Safe subnet-router replacement / cutover

1. Keep the existing router available but **STOPPED** — do not delete until the replacement is
   proven stable.
2. Prepare the replacement with a **distinct hostname + a separate state volume** — never reuse
   the same state path while testing a separate node identity.
3. Stop the existing router before starting the replacement, if both use host networking on the
   same physical host.
4. Start the replacement, verify route advertisement: `docker exec -it <ROUTER_CONTAINER>
   tailscale status` — confirm the subnet CIDR is advertised.
5. **Approve the new node's route in the admin console** — "this step is easy to miss and blocks
   real traffic."
6. Verify from a client: `tailscale ping <ROUTER_NODE>`, `tailscale status`, check the route
   table, `ping -c 3 <LAN_TARGET_IP>`, `nc -vz <LAN_TARGET_IP> <TARGET_PORT>`.
7. If the replacement fails, stop it and reactivate the previous router — "keep rollback simple
   and fast."

## 12. Mesh topology, and where it differs from hub-and-spoke VPNs

**Full mesh vs hub-and-spoke — resilience framing (rare 3-way independent-source agreement):**
hub-and-spoke (classic WireGuard/OpenVPN) has a **single point of failure** — hub
down means the whole VPN is down. Mesh (Tailscale) has **no single point** — one node failing
leaves every other pair still connected, and device-to-device traffic can be faster since it
skips a central bottleneck. "Choose topology based on failure-tolerance requirements, not just
convenience."

**Cross-corroborated protocol comparison table** (three independent sources agree on every row):

| | WireGuard | Tailscale | Headscale | Nebula | ZeroTier | OpenVPN | IPsec/strongSwan |
|---|---|---|---|---|---|---|---|
| Topology | hub-and-spoke / site-to-site | full mesh | full mesh (self-hosted) | large mesh, no central relay | mesh via controller | hub-and-spoke, TAP=L2 | site-to-site |
| Key mgmt | manual | automatic (SSO) | automatic (OIDC) | certificate-based | API keys | TLS/x509 PKI | IKEv2 |
| NAT traversal | manual port-forward | automatic (STUN+DERP) | automatic (DERP) | lighthouse + hole-punch | root servers | none | none |
| RAM | ~5 MB (kernel module) | ~30-50 MB (userspace) | same as Tailscale client | low | low | moderate | high (most complex) |
| DNS | manual | MagicDNS | MagicDNS | manual | manual | manual | manual |
| Cost | free (GPLv2) | free ≤100 devices | free/self-hosted | free | 50 free devices, paid beyond | free | free |
| Best for | P2P/general, resource-constrained, zero external deps | teams/remote access, NAT-traversal-heavy | privacy/homelab/data-residency | large "Slack-scale" mesh | quick setup, IoT | legacy, TCP-tunneling around UDP-blocking firewalls | cloud-VPN-gateway interop (AWS/Azure/GCP IKEv2), enterprise gear (Cisco/Juniper/PANW), FIPS/gov compliance, subnet-to-subnet traffic selectors |

**Hybrid pattern, stated independently by more than one source:** run Tailscale for day-to-day
zero-config remote access, AND keep a WireGuard hub-and-spoke as a backup gateway for full-tunnel
routing or for when Tailscale's own coordination server is unreachable.

**Feature comparison, general-VPN framing** `[unverified — mixes general VPN folklore with a
Tailscale-specific free-tier device cap that should be re-verified against current pricing]`:
Tailscale = zero-config mesh, MagicDNS, ACLs, exit nodes, subnet routing, but requires an
account. WireGuard = manual peer/key config, lighter/faster, "does not work on all kernels —
check the version." OpenVPN = TLS/certs/routes/client-configs, good for **site-to-site** and max
compatibility; UDP is faster but may be blocked by restrictive firewalls, so keep TCP as a
fallback. General gotchas from the same source: oversized MTU causes problems for WireGuard (test
1280); misconfigured split tunneling causes DNS leaks (test with ipleak.net); never disable a VPN
kill switch, as it exposes real traffic if the tunnel drops.

**Multiple coexisting overlay networks on the SAME hosts — not a defect, but a naming hazard:** a
documented topology mixes Tailscale (the `100.x.y.z` overlay) with a SEPARATE WireGuard mesh
(its own private range, e.g. `10.6.0.0/24`, and its own hub node, e.g. `fgsrv06` at
`10.6.0.5:51823`) on the same boxes. "Tailscale may use WireGuard as underlying transport — this
is normal" (verify with `tailscale netcheck`), but in a topology like this the two are genuinely
**independent overlays**. Naming-collision risk between the two address spaces is called out
explicitly as easy to confuse — e.g. two different hosts on two different overlays with visually
similar names and addresses (`agldv07` at `100.64.175.89` vs `archon` at `100.80.30.59`) are
explicitly warned as easy to mix up in runbooks and inventory. Keep the two overlays' node names
and address ranges visibly distinct in inventory/documentation.

**Three coexisting Tailscale-deployment architectures — pick one per box** `[unverified — MED
confidence]`:
1. OS-baked daemon (systemd service baked into the image — the box owns its own tailnet
   identity).
2. Tailscale-as-a-tool inside a nested-container harness (e.g. rootless podman with
   Tailscale-backed outbound).
3. Deploy-time sidecar container giving an app pod a tailnet identity without baking the daemon
   into the app image.

"All three can coexist, but for most cases you want exactly one" — mixing architectures on the
SAME box multiplies which layer owns the tailnet identity and complicates debugging.

**Network-boundary isolation for one human operator across separate tailnets** `[unverified —
MED confidence]`: a corporate-managed device (e.g. a corporate-managed Mac) and a personal
device/LAN (e.g. a personal Mac/LAN) can be on entirely separate Tailscale identities/tailnets
even for the same human operator; the personal-network node is **unreachable** from the
corporate device by design. Never use the personal-tailnet node as a relay or LAN vantage point
from the corporate environment — it would bridge two identities that are deliberately kept
apart.

## 13. LAN-only WireGuard tunnels adjacent to Tailscale infrastructure

`[unverified — single source, router-vendor-specific feature name, but the underlying WireGuard
mechanic is standard]`. Setting `Endpoint = 192.168.8.1:<listen_port>` (a router's LAN IP, not a
public IP/DDNS name) in a WireGuard client config, with `local_access: true` on a GL-iNet-style
server side, keeps the WireGuard handshake entirely on the local LAN segment while the client
still gets full-tunnel egress THROUGH the router — zero external port-forwarding required.
Useful for building/testing a WireGuard tunnel before exposing the server publicly, or for
devices that never leave the LAN. This is WireGuard configuration adjacent to a
Tailscale-adjacent device, not a Tailscale feature itself.

## GAPS

- **`site-to-site` category: essentially nothing documents a dedicated Tailscale site-to-site
  topology**, beyond the generic comparison-table entry that labels WireGuard/OpenVPN/IPsec as
  "site-to-site" tools (§12) and the app-connector domain-routing alternative (§8). If the skill
  needs explicit site-to-site guidance (e.g. two full remote-office LANs bridged purely via
  Tailscale subnet routers on both ends, with no app-side changes), that content is not present
  here and must be sourced elsewhere or written from first principles against current Tailscale
  docs.
- **4via6 syntax** (§5) is asserted with no CLI/HuJSON example — needs verification against
  current Tailscale docs before being presented as executable guidance.
- **HA failover timing** ("15s", "oldest is primary", §4) is single-source and explicitly flagged
  unverified.
- **Linux-vs-other-platform `--accept-routes` default** (§1 step 4) is stated confidently for
  Linux, but non-Linux platform behavior "may differ" and should be checked against current docs
  before being asserted as a universal rule.
- **`autoApprovers` HuJSON schema key casing** (`routes`/`exitNode` vs any `ipSets`-adjacent
  variant) is not independently resolved here — this shares the same schema family as the
  ACL/grants-scoped `ipsets` vs `ipSets` casing question covered elsewhere in this reference.
- **The free-tier device-cap number** quoted in the general-VPN comparison (§12) should be
  re-verified against current Tailscale pricing before reuse — it is mixed in with general VPN
  folklore from a single source.
- No concrete answer is documented for whether `--stateful-filtering` (§2) can be
  disabled per-peer vs only tailnet-wide, or what the precise interaction is with `--shields-up`
  — both flags affect inbound connection acceptance but their combination is not documented.
