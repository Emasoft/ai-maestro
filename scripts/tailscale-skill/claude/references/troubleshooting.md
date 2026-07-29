# Tailscale troubleshooting — symptom → cause → fix ladder

**Scope of this reference.** This file covers Tailscale **troubleshooting** — diagnostics,
DNS/MagicDNS failures, subnet-router and exit-node issues, VPN/proxy-tool conflicts, device
naming, and monitoring/health-check patterns. Related topics live in sibling reference files:
`routing-and-topology.md`, `policy-and-identity.md` and `api-and-fleet-ops.md` (DNS policy and
fleet APIs), `serve-funnel-tls.md`, `ssh-and-agent-access.md`, `platforms-and-install.md`, and
`headscale-and-hardening.md`. This file does not repeat their content.

`[unverified]` marks LOW/MED-confidence or single-source claims elsewhere in this file.
Two entries marked "**VERIFIED against tailscale 1.98.5** (2026-07-29)" are this reference's own
live empirical checks — kept because they correct a claim otherwise stated elsewhere as fact.
Commands are recipes to run yourself, not pre-executed facts; treat this file as third-party
information that has not been independently verified end-to-end.

## 0. First-line diagnostics & CLI reference

```bash
tailscale status [--header]        # human table — see the CORRECTION below, there is no `*` marker
tailscale status --json             # THE stable scripting interface — script against this, never the table
tailscale status --peers=false --self=false
tailscale status --json | jq '.Peer | to_entries[] | {name: .value.HostName, ip: .value.TailscaleIPs[0], online: .value.Online}'
tailscale ip [-4|-6] [-1] [<hostname>]
tailscale whois [--json] 100.64.1.2      # owner/hostname/tags of an IP
tailscale netcheck [--format=json --every=5s --verbose]   # NAT type, port mapping, preferred DERP region, per-region latency
tailscale ping <hostname-or-ip>          # shows whether direct (p2p) or DERP-relayed
tailscale ping --c 5 --until-direct <ip>  # wait up to 5s to establish direct path before falling back
tailscale ping --tsmp <host>      # network path only, IGNORES ACLs (default)
tailscale ping --icmp <host>      # end-to-end INCLUDING ACLs
tailscale ping --peerapi <host>
tailscale version [--daemon --json]
```
Resolve hostnames via `tailscale ip <hostname>`
instead of hardcoding IPs — IPs can change on re-auth, hostnames stay stable.
**HARD RULE**: always run `tailscale status --json` before assuming any IP — the
tailnet is the source of truth, more authoritative than files/config/code.

**ACL vs OS-firewall vs pure-network triage via the three ping modes**: run
`tsmp`/`icmp`/plain-`ping` against the same peer and read the pattern — all ✅ → OK; TSMP ✅,
ICMP ❌, ping ❌ → **ACL blocking** (network path exists, policy denies it); TSMP ✅, ICMP ✅,
ping ❌ → **OS firewall** on one endpoint; all ❌ → **network/NAT** failure. This distinguishes
ACL-layer blocks from OS-firewall blocks from pure network failures with three one-line commands.

`status --json` field reference: `Self.TailscaleIPs`, `Self.DNSName`; `Peer` keyed
by node key, each with `.TailscaleIPs`, `.DNSName`, `.OS`, `.Online` (connected to control
plane), `.Active` (traffic in last ~2 min), `.ExitNode`/`.ExitNodeOption`, `.Relay` (DERP
region if not direct), `.CurAddr` (direct endpoint), `.Tags`, `.PrimaryRoutes` (advertised
subnet routes). Status indicators in the `ping` output: `direct` (P2P, best),
`relay "location"` (DERP), `idle`, `offline`.

`netcheck` field semantics: `MappingVariesByDestIP: true` = symmetric
NAT, direct unlikely; `HairPinning` = router supports hairpin NAT; `UPnP`/`PMP`/`PCP` =
port-mapping protocol availability; `PreferredDERP` = lowest-latency region; `RegionLatency`
= per-region RTT table; `UDP: false` = outbound UDP fully blocked (ALL traffic relays via DERP);
**"no DERP latency data at all" for every region ⇒ outbound HTTPS/TCP-443 itself is blocked**
(DERP fallback needs it).

**⚠ CORRECTION — the `*`-means-direct claim is FALSE on 1.98.5 (VERIFIED 2026-07-29, this
reference's own live check).** The last column of `tailscale status` is free text, not a symbol:
```
100.99.233.43  mac-mini-di-emanuele  user@  macOS  -
100.68.40.29   ipad165               user@  iOS    active; direct 192.168.1.44:41641, tx 4574209016 rx 20844984
```
`-` = no active session; `active; direct <ip:port>` = direct p2p path; a relayed peer names its
DERP region instead of `direct`. `--header` prints column names. **Script against
`status --json`** — `--help` itself warns the table format "has changed between releases and
might change more in the future." (Corrects the older `*`-marker claim some sources state as
fact verbatim — the field semantics above still hold, just not the marker syntax.)

**⚠ VERIFIED against `tailscale 1.98.5` (2026-07-29) — the commonly-published field list is
incomplete and one name is wrong.** `tailscale netcheck --format=json` on 1.98.5 emits exactly:
```
CaptivePortal  GlobalV4  GlobalV4Counters  GlobalV6  GlobalV6Counters  ICMPv4
IPv4  IPv4CanSend  IPv6  IPv6CanSend  MappingVariesByDestIP  Now  OSHasIPv6
PCP  PMP  PreferredDERP  RegionLatency  RegionV4Latency  RegionV6Latency  UDP  UPnP
```
`HairPinning` is **NOT emitted** by this build — do not script against it despite some sources
naming it. Eight further fields are emitted and diagnostically useful but easy to miss — above all
**`CaptivePortal`** (a classic "Tailscale won't connect" cause not otherwise documented here),
plus `ICMPv4`, `IPv4CanSend`/`IPv6CanSend`, `OSHasIPv6`, and the v4/v6-split
`RegionV4Latency`/`RegionV6Latency` (finer-grained than the merged `RegionLatency`). Note the
flag spelling: `--format=json`, not `--json` — `status --json` fields (`Self.TailscaleIPs`,
`.DNSName`, peer `.TailscaleIPs .DNSName .OS .Online .Active .ExitNode .ExitNodeOption .Relay
.CurAddr`) all confirmed present on 1.98.5; `.Tags`/`.PrimaryRoutes` did not appear on a
single-peer untagged route-less tailnet, consistent with Go `omitempty`, not proof of absence.

### Full CLI command surface and `up`/`set`/`login` semantics

Full verb list (converged across sources, no material conflicts): `up`, `down`,
`login`, `logout`, `switch [--list]`, `set` (never triggers re-auth, accepts the same flags as
`up` minus `--auth-key`/`--force-reauth`/`--login-server`), `status [--json --active
--peers=false --self=false]`, `ping [--c N --until-direct --verbose --icmp]`, `netcheck
[--format=json --every=5s --verbose]`, `bugreport [--diagnose --record]`, `ip [--4 --6 --1
peer]`, `whois [--json] <ip-or-host>`, `metrics print|write <file>`, `dns status|query`,
`exit-node list|suggest`, `configure kubeconfig|synology`, `serve`, `funnel`, `file cp|get`,
`drive share|unshare|list|rename`, `cert`, `lock <sub>`, `version [--daemon --json]`, `update
[--yes --track=stable|unstable --version --dry-run]`, `completion bash|zsh|fish`.

| Command | When | Triggers re-auth? |
|---|---|---|
| `up` | initial connection, or changing `--login-server` | sometimes |
| `set` | runtime pref change on already-connected device | never |
| `login` | switch accounts / force fresh auth | always |

Notable `up`/`set` flags: `--auth-key`, `--hostname`, `--advertise-routes`,
`--advertise-exit-node`, `--accept-routes`, `--accept-dns`, `--exit-node`,
`--exit-node-allow-lan-access`, `--ssh`, `--shields-up`, `--stateful-filtering`,
`--force-reauth`, `--login-server` (up-only), `--operator` (which unprivileged Linux user may
run `tailscale` without sudo), `--reset` (up-only, resets prefs to default before applying
flags), `--snat-subnet-routes=false`, `--key-expiry=off`, `--advertise-tags=tag:x,tag:y`,
`--advertise-connector`, `--advertise-peer-relay`.

`tailscale up` connects/authenticates (opens browser first run); `--auth-key=tskey-auth-xxxxx`
for headless; other flags: `--login-server`, `--accept-routes`, `--accept-dns` (default true),
`--hostname`, `--shields-up` (block all inbound, outbound only), `--force-reauth`, `--reset`
(reset unspecified settings to defaults), `--advertise-tags` (must be pre-authorized),
`--timeout` (default 0 = wait forever). `tailscale down` disconnects **without** deregistering.
`tailscale logout` **DEREGISTERS** the device entirely (different from `down`). `tailscale
login` is an alt entry point to `up`. **`logout` deregisters, `down` doesn't — confirm user
intent before running either destructive one**.

Core `up` flags reference: `tailscale up` (interactive auth), `--authkey
tskey-auth-xxx` (automation), `--accept-routes`, `--advertise-routes 10.0.0.0/16`,
`--advertise-exit-node`, `--hostname mynode`, `--reset` (reset local state, force re-auth).

`tailscale switch --list` lists locally-known tailnet profiles; `tailscale switch
<profile>` changes the active one on the same machine without re-installing (multiple
tailnet/account profiles on one machine — Fast User Switching).

`tailscale switch [<tailnet>]` — lists/switches between multiple tailnet account
profiles, profiles stored locally with nicknames.

`tailscale status`/`ping` need no sudo; mutating commands (`serve`, `funnel`, `up`/`down` in
some configs) may need root or `tailscale set --operator=<user>`.

**Debug + bug-report subcommands**:
```bash
tailscale bugreport
tailscale debug daemon-logs
tailscale debug netmap
tailscale debug watch-ipn
tailscale debug firewall
tailscale debug derp
journalctl -u tailscaled -f                                              # Linux
log stream --predicate 'subsystem == "com.tailscale.ipn"' --level debug   # macOS
```
`tailscale up --force-reauth` re-authenticates when a token has expired; `tailscale
bugreport` produces a full diagnostic report "useful for bug reports"; `journalctl -u
tailscaled -f` tails daemon logs. If a peer is unreachable, `tailscale ping <peer>` diagnoses;
if NAT traversal fails, fall back to a DERP relay or an exit node.

**Discovery-first, never guess**: always run `tailscale status` (and `--json`)
before making changes — never guess device names/IPs. Extract self-node fields (`HostName`,
`DNSName`, `TailscaleIPs`, `OS`, `Online`, `ExitNode`, `KeyExpiry`) and tailnet fields
(`MagicDNSSuffix`, `CurrentTailnet.Name`) via a small `python3` one-liner piped from `status
--json`. Anti-hallucination rule: never assume device names/IPs/ACL rules/subnet routes —
always parse from `status --json` or verify via admin console/API.

## 1. The triage framework — walk it in order, don't skip rungs

**Pre-triage: don't assume the user needs Tailscale before you know their actual question.**
When a user asks for "browser/remote access to this host", triage the request BEFORE reaching
for Tailscale-specific advice — Tailscale is one of several transport choices, alongside plain
LAN access (same Wi-Fi, host-side runtime already running), a reverse proxy in front of the
host-side runtime, and a self-hosted public domain. Guidance rules distilled from this
framing: **lead with the product/vendor's own default remote-access path** unless the question
is explicitly an ops/self-hosting/self-built-network one — don't reach for Tailscale as the
first answer to a generic "how do I access my machine remotely" question; **"browser access
still works, but its nature changed"** is the correct framing when a product used to expose a
one-click remote-access toggle and no longer does — the capability (including reachability via
Tailscale/VPN) still exists, but it moved from a per-device toggle to a host-runtime/deployment
concern the operator configures explicitly; **don't repackage an ops/deployment path as a
default consumer setting** — LAN access, Tailscale/VPN, reverse proxy, and self-hosted
public-domain access are all legitimate and still supported, but they assume the operator is
knowingly running and securing a host-side service, not something to casually suggest to a
user who just wants convenient cross-device access; and **a dead/redirected old settings route
is a "legacy route", not a missing feature** — distinguish "the UI entry point moved/was
removed" from "the underlying capability (including Tailscale/VPN-based access) was removed"
when a user reports a stale settings URL. Operator notes specific to the Tailscale/VPN
transport in this framing: it is suited to accessing the host across networks without exposing
a public-internet entry point, and it still ultimately reaches the same host-side runtime as
the LAN path — Tailscale/VPN changes the transport/network boundary, not the thing being
accessed.

**Five conflated failure modes a good playbook separates first**: (1) exit-node
behavior vs subnet-router behavior (different symptoms/fixes); (2) DNS failures vs packet
transport failures (hostname resolution masquerades as routing failure); (3) route
advertisement vs route approval vs route acceptance — **three independent gates, all must
pass**; (4) router-overlay reachability vs LAN-service reachability (Tailscale ping success
≠ LAN path works); (5) firewall backend mismatches (iptables vs nftables in containerized
routers).

**6-rung generic diagnostic ladder** (from a companion net-ops skill — not
Tailscale-specific but the model Tailscale problems fit into): 1. Link (interface
up/IP/gateway) → 2. IP/ICMP reachability → 3. TCP/UDP socket reachability (raw UDP/53
essential) → 4. DNS infrastructure (bypass tool) → 5. OS resolver path (the hook layer,
usually the actual culprit) → 6. Application layer (real HTTP request). Each rung's binary
PASS/FAIL eliminates everything above it — **the most common misdiagnosis is jumping to
rung 6** ("HTTPS is broken, must be a cert/proxy issue") when the real cause is an orphaned
VPN DNS hook at rung 5. Some failures are stateful/intermittent (works 30s
then breaks, per-network, per-application) and won't show on one probe — loop the probe and
compare per-interface/per-app. `[gotcha]`

**Universal DNS discriminator**: on any OS, if a bypass tool (Windows `nslookup`,
macOS/Linux `dig @1.1.1.1`) succeeds while the OS resolver tool (`Resolve-DnsName`,
`dscacheutil -q host`, `getent hosts`/`resolvectl query`) fails, DNS infrastructure is healthy
and something is hooking the OS's name-resolution path — not a Tailscale/DNS-server problem at
all. `[gotcha]` `Resolve-DnsName -Server <ip>` still uses the Windows DNS Client API even with
`-Server` specified — it is NOT a clean wire-level probe; use raw UDP/53 (dig, or a custom
UdpClient) to actually test the wire.

**Cross-OS elimination order** once you've confirmed "bypass works, OS resolver fails":
(1) OS catch-all DNS hook (Windows NRPT / macOS `/etc/resolver`+scutil / Linux
resolvectl+resolv.conf symlink) → (2) HOSTS/nsswitch → (3) local `127.0.0.x:53` listener (DNS
proxy: NextDNS/AdGuard/Pi-hole/WARP) → (4) security software/kernel hooks (WFP
drivers/kexts/iptables-nftables).

**Destination-specific TCP/443 block ≠ general firewall**: test the SAME port
against multiple destinations. If `1.1.1.1:443` and `8.8.8.8:443` (known public DoH resolver
IPs) fail but `github.com:443` succeeds, the block is destination-specific — AV "Encrypted DNS
Detection" (ESET/Kaspersky/Bitdefender/Norton WFP callout drivers) or a consumer router
feature (Asus AiProtection, TP-Link HomeShield, Eero Secure, Netgear Armor, Synology Safe
Access, OPNsense/pfSense blocklists) blocking known DoH IPs. Confirmed identical failure
across multiple devices on the same LAN localizes it to the router, not per-device AV. This
distinguishes "my machine's security software" from "my network's security appliance" —
different remediation paths. `[gotcha]` this is often a legitimate, working-as-intended
security feature; only override with a specific reason (e.g. a legitimate DoH-for-privacy use
case).

**Subnet-router symptom classification decision tree**:
- Step 1 — internet dies before contacting ANY LAN IP → exit-node problem, go to Step 2.
  General internet fine, only `<SUBNET_CIDR>` impacted → subnet-router problem, go to Step 3.
- Step 2 (DNS vs transport):
  ```bash
  curl -I https://example.com; dig example.com          # DNS-dependent
  curl -I --insecure https://1.1.1.1; ping -c 2 1.1.1.1  # DNS-independent
  tailscale netcheck
  ```
  Hostname fails + raw IP works = DNS failure; both fail = broader transport/policy issue.
  Platform DNS inspection: macOS `scutil --dns`; Linux `resolvectl status` (or
  `/etc/resolv.conf`); Windows `Get-DnsClientServerAddress`.
- Step 3 (client route acceptance vs admin route approval — **independent gates**):
  ```bash
  tailscale status; tailscale set --accept-routes=true
  ```
  Verify in system table: macOS `netstat -rn -f inet | grep <SUBNET_CIDR>`; Linux
  `ip route show | grep <SUBNET_CIDR>`; Windows `route print`. Admin approval: Machines page
  → router node → route approved; or ACL `autoApprovers`; or router itself advertising via
  `tailscale set --advertise-routes=<SUBNET_CIDR>`.
- Step 4 (router-overlay vs LAN reachability):
  ```bash
  tailscale ping <ROUTER_NODE>            # router reachability
  ping -c 3 <LAN_TARGET_IP>               # LAN reachability from client
  nc -vz <LAN_TARGET_IP> <TARGET_PORT>
  curl -kI https://<LAN_TARGET_IP>:<TARGET_PORT>
  ```
  Router reachable + LAN target not → forwarding/NAT/firewall issue on router or target-host
  firewall. Both reachable → application-layer issue.
- Step 5 (NAT/SNAT/firewall backend mismatch — **high-probability branch for containerized
  routers**): `TS_DEBUG_FIREWALL_MODE=nftables`; verify host-network mode, `<SUBNET_CIDR>`
  advertised, SNAT/masquerade enabled, `sysctl net.ipv4.ip_forward`.

**Interpretation matrix — router vs LAN reachability**:

| Client→Router (ping) | Router→LAN target | Client→LAN target | Diagnosis |
|---|---|---|---|
| OK | OK | OK | Path healthy, issue is application-layer |
| OK | OK | FAIL | SNAT/masquerade issue, or client route not installed |
| OK | FAIL | FAIL | Router LAN path broken — fix router networking first |
| FAIL | -- | -- | Tailscale overlay issue — check node status/keys/connectivity |

**Testing multiple LAN targets**: test at least 2 distinct targets — one working +
one not = target-specific (firewall, service binding), not a routing issue.

**Ping-works-but-port-doesn't checklist**: target host firewall rules (may allow
ICMP but block TCP on `<TARGET_PORT>`); service not actually running/bound to correct
interface; network segmentation/VLAN rules between router and target.

**Recommended procedural triage flow for agents**: 1) gather env specifics (subnet
CIDR, LAN target IP/port, router node name, client OS) 2) classify symptom 3) exit-node-like vs
subnet-router-like 4) separate DNS failure from transport failure 5) confirm client route
acceptance 6) confirm admin route approval (console or ACL autoApprovers) 7) confirm router
overlay reachability (`tailscale ping`) 8) confirm router-to-LAN connectivity 9) check router
mode, SNAT, IP forwarding, firewall backend 10) if replacing a router, follow safe-replacement
pattern 11) record client's DNS-acceptance setting and whether it should be disabled for that
network context.

**Master troubleshooting map — symptom → likely cause → quick fix** (condensed from
a 14-row table, cross-corroborated by an independent parallel skill in the same source with
largely consistent coverage):

| Symptom | Likely cause | Fix |
|---|---|---|
| All traffic relayed via DERP | UDP blocked or symmetric NAT | open UDP 41641 outbound, check `netcheck` |
| Intermittent drops every few minutes | Aggressive NAT timeout or MTU mismatch | lower MTU to 1280, check NAT keepalive |
| Subnet route advertised but unreachable | Not approved OR `--accept-routes` missing on client | approve in admin console; set `--accept-routes` |
| Exit node set but traffic leaks | Exit node not accepted on client | re-run `up --exit-node=<ip>` |
| `tailscale ping` succeeds but plain `ping` fails | OS firewall blocking ICMP | check OS firewall rules |
| macOS system-extension prompt never appeared | Blocked by MDM | approve manually in Privacy & Security > Network Extensions |
| Linux `tailscaled` fails to start | Missing `/dev/net/tun` or iptables conflict | `modprobe tun`; check iptables |

**Fast diagnosis cheatsheet**:

| Symptom | Most likely fix |
|---|---|
| Internet dies on cellular/non-home network after Tailscale connects | `tailscale set --accept-routes=true --accept-dns=false` |
| Router online but LAN services unreachable | Check firewall backend: `TS_DEBUG_FIREWALL_MODE=nftables` |
| Replacement router not passing traffic | Approve the new route in admin console |
| Client reaches router but not LAN target | Test router-to-LAN reachability; verify SNAT and IP forwarding |
| Route table shows subnet but connections time out | Verify admin approval + firewall backend + SNAT |

**Multi-platform client diagnostic command sets**: macOS: `tailscale status;
tailscale netcheck; tailscale ping <ROUTER_NODE>; tailscale set --accept-routes=true;
tailscale set --accept-routes=true --accept-dns=false; netstat -rn -f inet | grep
<SUBNET_CIDR>; scutil --dns`. Linux: same + `ip route show | grep <SUBNET_CIDR>`,
`resolvectl status`. Windows (PowerShell): same + `route print`,
`Get-DnsClientServerAddress`. Service reachability (Unix): `ping -c 3 <LAN_TARGET_IP>`, `nc
-vz <LAN_TARGET_IP> <TARGET_PORT>`, `curl -kI https://<LAN_TARGET_IP>:<TARGET_PORT>`, `curl
--connect-timeout 5 http://<LAN_TARGET_IP>:<TARGET_PORT>`, `curl -I https://example.com`,
`curl -I --insecure https://1.1.1.1`. Windows equivalents: `ping -n 3`,
`Test-NetConnection -ComputerName <LAN_TARGET_IP> -Port <TARGET_PORT>`, `curl.exe`. Full
sequence: 1) `tailscale status` 2) `tailscale ping <ROUTER_NODE>` 3) check route table for
`<SUBNET_CIDR>` 4) `ping -c 3 <LAN_TARGET_IP>` 5) `nc -vz <LAN_TARGET_IP> <TARGET_PORT>` 6)
`curl -I https://example.com` 7) if DNS fails: `tailscale set --accept-routes=true
--accept-dns=false`.

**Troubleshooting pre-flight checklist** — an operator-facing checklist form of the
whole playbook above (symptom classification checkboxes, decision points, environment facts to
gather); its root-cause table and replacement-safety checklist duplicate the cheatsheet above and
the subnet-router-replacement rules below verbatim — included for completeness, not repeated as
separate content.

## 2. Subnet router & exit node routing failures

**Route lifecycle — 7 stages, each with its own silent-failure mode**: Advertise
(`tailscale set --advertise-routes=<CIDR>`; verify `tailscale status --json | jq
'.Self.AllowedIPs'`) → Approve (admin console or ACL `autoApprovers.routes`) → Distribute
(automatic, 30-60s) → Accept (`tailscale set --accept-routes=true`, default OFF, most commonly
missed) → Install (client installs into policy routing **table 52**, not the main table) →
Forward (subnet router needs `net.ipv4.ip_forward=1` + no firewall block) → Return (target's
return traffic must reach back through the router — SNAT/masquerade or a static route for
`100.64.0.0/10`). **`ip route` (no table arg) NEVER shows Tailscale subnet routes** — use `ip
route show table 52`; called out as "the single most common source of confusion".

**`--snat-subnet-routes` (default true since 1.64+) fixes asymmetric return path**:
if the subnet router is not the target's default gateway, response packets go to the real
gateway which doesn't know `100.x.y.z` and drops them. Fix: SNAT/masquerade on the router
(1.64+ does this automatically via `--snat-subnet-routes`), or a static route for
`100.64.0.0/10` on the target/gateway. Corroborated: `sudo tailscale up
--advertise-routes=192.168.1.0/24 --snat-subnet-routes=true`, OR a static route on subnet
devices back to the CGNAT range (`ip route add 100.64.0.0/10 via 192.168.1.1`) plus explicit
FORWARD-chain accepts (`sudo iptables -I FORWARD -i tailscale0 -j ACCEPT`; same `-o
tailscale0`) — symptom is "connections to subnet devices timeout", i.e. return traffic isn't
going back through Tailscale.

**Subnet-router/exit-node HA and failover**:
```bash
# two routers advertise the SAME route -> automatic failover
sudo tailscale up --advertise-routes=10.0.0.0/24 --advertise-tags=tag:subnet-router-primary
sudo tailscale up --advertise-routes=10.0.0.0/24 --advertise-tags=tag:subnet-router-secondary
tailscale set --exit-node=auto:any     # multi-exit-node HA
tailscale status --json | jq -r ".Peer[] | select(.PrimaryRoutes[]? == \"$ROUTE\") | .HostName"
```
Failover behavior: oldest router is primary; failover after 15s offline; graceful switchover
on maintenance `[unverified — "15 seconds" and "oldest is primary" are unsourced beyond this
single mention]`.

**Exit-node internet/DNS troubleshooting**:
```bash
tailscale status | grep "exit node"
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo iptables -t nat -A POSTROUTING -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE
tailscale set --exit-node=exit-node-name --exit-node-allow-lan-access   # for local-DNS access
```

**Known-good containerized subnet-router configuration** (the reference shape to
diff a broken deployment against):

| Setting | Value |
|---|---|
| Network mode | `host` (`--network=host` / `network_mode: host`) |
| Subnet advertisement | `TS_ROUTES=<SUBNET_CIDR>` (or `tailscale set --advertise-routes=<SUBNET_CIDR>`) |
| SNAT | enabled — `TS_SNAT_SUBNET_ROUTES=true` or default |
| Firewall backend | explicit, matching host kernel: `TS_DEBUG_FIREWALL_MODE=nftables` |
| IP forwarding | enabled on host: `sysctl -w net.ipv4.ip_forward=1` |
| State volume | dedicated, unique per router instance |
| Hostname | distinct per router instance |

**Container router failure patterns and fixes (consolidated)**: firewall backend
mismatch → `TS_DEBUG_FIREWALL_MODE=nftables` (or `iptables` matching host kernel), set as
container env var. IP forwarding disabled → check `docker exec -it <ROUTER_CONTAINER> sh -lc
'sysctl net.ipv4.ip_forward'`; fix on the HOST: `sysctl -w net.ipv4.ip_forward=1` then persist
`echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.d/99-tailscale.conf`. SNAT/masquerade not
active (symptom: router reaches LAN target but return traffic doesn't reach client —
asymmetric routing) → default enabled in official image; if explicitly disabled, re-enable
`TS_SNAT_SUBNET_ROUTES=true`. Route not approved (symptom: router online+advertising, no
client traffic flows) → approve in admin console or ensure ACL `autoApprovers` covers the
subnet.

**Safety: never run two host-network Tailscale router containers on one host**:
running 2+ host-network, kernel-mode Tailscale router containers on the same host
simultaneously risks competing packet-filter rule changes, ambiguous route ownership,
conflicting route advertisements, and hard-to-diagnose intermittent failures — this is an
explicit safety invariant, not just a performance note. Rule: only ONE such container active
per host at any time.

**Subnet-route overlap with local LAN — no automatic fix**: if an advertised subnet
(e.g. `192.168.1.0/24`) overlaps the client's OWN local network, the client's kernel prefers
the LOCAL route and never routes that traffic through Tailscale (`ip route get <subnet-ip>`
shows the local interface, not `tailscale0`). No automatic resolution — options: renumber
one network, or route via a jump host inside the remote subnet.

**Talos/Kubernetes-specific troubleshooting**: node unreachable via talosctl after
reboot → missing certSANs, add `100.64.0.0/10`. Kubelet binds to `100.x.y.z` → set
`validSubnets`. etcd peers flapping → set `advertisedSubnets`. Subnet routes not working →
enable `net.ipv4.ip_forward`. Nodes can't reach each other's tailscale IPs → open UDP 41641
between nodes.

## 3. DERP relay and NAT diagnosis

**Connection model**: three paths tried in order, all
WireGuard end-to-end encrypted: (1) direct P2P (preferred, NAT traversal via STUN/port-mapping),
(2) peer relay (user-operated relay device on tailnet, lower latency than DERP), (3) DERP
relay (Tailscale's global relay, final fallback, always works). Relays forward encrypted
packets BLINDLY — cannot decrypt. Choice is per-peer-pair, not tailnet-wide. **DERP also serves
connection negotiation** — even direct connections briefly use DERP to exchange DISCO packets
before switching direct.

**NAT matrix**: No-NAT+Any=Direct; Easy+Easy=Direct; Easy+Hard=Relayed;
Hard+Hard=Relayed. "Easy NAT" = UPnP/NAT-PMP/PCP, full-cone, consistent port mapping (IPv6
treated as Easy). "Hard NAT" = symmetric NAT, CGNAT, strict firewalls.

| NAT Type | Direct connection? |
|---|---|
| Full cone | Yes |
| Address-restricted | Yes |
| Port-restricted | Yes (simultaneous send required) |
| Symmetric | No — falls back to DERP |
| UDP blocked by firewall | No — falls back to DERP |

Diagnose with `tailscale netcheck` — `MappingVariesByDestIP: true` = symmetric NAT.
NAT traversal techniques: STUN discovers public IP:port, then simultaneous UDP
hole-punching (both peers learn each other's mapped endpoint via the control server, send UDP
simultaneously); also UPnP/NAT-PMP/PCP port mapping and proprietary "hard NAT
piercing"/birthday-paradox port prediction for symmetric-NAT-adjacent cases.

**Relay-only connection causes and resolution**:

| Cause | Indicator | Resolution |
|---|---|---|
| UDP blocked one side | `netcheck` shows no UDP | open UDP 41641 outbound |
| Symmetric NAT both sides | `MappingVariesByDestIP:true` both | subnet router, or accept relay |
| CGNAT on WAN | private IP in `100.x.x.x` on WAN | enable UPnP/PMP on router, or accept relay |
| Firewall blocking inbound | direct works one-way only | open inbound UDP 41641 on receiving side |

Symmetric NAT on BOTH endpoints makes relay unavoidable regardless of firewall config, short
of moving one peer to a full-cone/port-restricted network.

**Firewall/UDP diagnosis and corporate-network fallback ceiling**: without
UDP 41641 outbound, ALL connections relay through DERP (slower, functional, no hard error).
Tailscale also needs UDP 3478 for STUN. If the firewall is stateful and allows return traffic,
an outbound-only rule for UDP 41641 suffices. `--operator=$USER` at first `tailscale up` lets
a non-root user run subsequent `tailscale` commands without sudo. On corporate
networks blocking all outbound except HTTP/HTTPS, Tailscale falls back to DERP-over-HTTPS
(TCP 443) — slower but works; **there is no workaround for networks that block ALL outbound
except HTTP/HTTPS** other than accepting that ceiling.

**Same-host containers routing via DERP is expected, not a bug** `[MED confidence]`:
two Tailscale containers on the same Docker host may show `via DERP(xxx)` in `tailscale ping`
because a direct WireGuard connection would use the Docker bridge IP as endpoint, which
Tailscale reports as DERP — not a bug in lab environments; separate network namespaces with
routable IPs are needed for direct connections.

**Intermittent-drop diagnosis: NAT timeout vs MTU vs sleep/wake**: NAT timeout
(aggressive routers expire UDP mappings after 30-60s idle despite Tailscale keepalives —
keepalive interval is NOT user-configurable; mitigate with periodic traffic, e.g. a ping
loop). MTU mismatch (WireGuard overhead can push packets over path MTU; symptom: large
transfers stall/fail, small packets like ping succeed; fix: `sudo ip link set tailscale0 mtu
1280` on Linux — 1280 is the safe IPv6-minimum floor). Sleep/wake: WireGuard re-handshakes
after laptop sleep, taking 1-5s; apps timing out during this window need longer connection
timeouts or TCP keepalives.

**`tailscale ping` output text distinguishes direct vs DERP**: a DERP-relayed pong
reads `pong from homelab-1 (100.64.1.10) via DERP(nyc) in 45ms`; a failed connection reads
`timeout waiting for pong`. Checking `tailscale status` for "direct" vs "DERP relay" per-peer
classifies expected latency: direct <50ms, DERP relay 100-200ms. A quick,
no-extra-tooling way to detect whether a slow connection is relay-bound (NAT traversal /
firewall issue) versus genuinely healthy direct.

**DERP-relay usage is a reachability/performance signal, never a plaintext risk**:
traffic stays end-to-end WireGuard-encrypted regardless of relay. Common causes of falling
back to DERP: UDP blocking, restrictive NAT behavior, firewalls, captive portals, asymmetric
routing. Diagnose with `tailscale netcheck` (local UDP/NAT/DERP conditions) and `tailscale
ping --verbose <peer>` (per-peer path: direct vs DERP vs peer-relay); only optimize for a
direct connection after confirming policy/DNS/route/service config is otherwise correct.

**`tailscale ping`/`netcheck` for NAT/direct-vs-relay diagnostics**: `tailscale
netcheck [--json]` for NAT type/DERP/UDP diagnostics; `tailscale ping <ip-or-host>` reports
direct vs relayed; `tailscale ping --c 5 --until-direct <ip>` waits up to 5s for a direct path.
`[gotcha]` if `tailscale status` shows "relay <region>" instead of "direct", check for UDP
41641 being blocked/filtered by firewall (`netcheck` will report "UDP blocked or filtered").

**DERP self-hosting / custom DERP map**

Official DERP map: `https://controlplane.tailscale.com/derpmap/default`. Running
your own DERP is NOT generally recommended — peer relays solve latency with less complexity
and without losing device-sharing/cross-tailnet features. Custom map config:
```jsonc
{"derpMap": {"OmitDefaultRegions": false, "Regions": {"900": {"RegionID": 900,
  "RegionCode": "myderp", "RegionName": "My Custom DERP",
  "Nodes": [{"Name": "myderp1", "RegionID": 900, "HostName": "derp.example.com"}]}}}}
```
Disable a default built-in region: set it to `null`, e.g. `"Regions": {"1": null}`.
Self-host via the open-source `cmd/derper` binary: needs TLS on TCP 443 (HTTPS-upgrade-to-
WebSocket), optionally UDP 3478 for STUN. 20+ regions globally, most with 3+
servers for redundancy; clients auto-select nearest by latency.

**Peer Relays (Beta/GA, v1.86+)** `[MED confidence — verify current GA status]`:
use existing TAILNET NODES (not Tailscale infra) as high-throughput relay servers when
direct fails. `tailscale set --advertise-peer-relay` to enable. Two free peer relays
included on all plans.

| Feature | DERP | Peer Relays |
|---|---|---|
| Managed by | Tailscale | Customer |
| Throughput | Limited/shared | Near-direct |
| Setup | Automatic | Manual opt-in |
| Cost | Included | Customer egress |

Peer relay config on the relaying device: `tailscale set --relay-server-port=<port>` (port
must be publicly reachable), plus a capability grant:
```json
"grants": [{"src": ["autogroup:member"], "dst": ["tag:relay"], "app": {"tailscale.com/cap/relay": []}}]
```

**Performance/measurement recipes and kernel tuning**:
```bash
NETDEV=$(ip -o route get 8.8.8.8 | cut -f 5 -d " ")
sudo ethtool -K $NETDEV rx-udp-gro-forwarding on rx-gro-list off
ping -M do -s 1400 $(tailscale ip -4 target)
ip link set dev tailscale0 mtu 1280
```
```
# /etc/sysctl.d/99-tailscale-perf.conf
net.core.rmem_max = 26214400
net.core.rmem_default = 26214400
net.core.wmem_max = 26214400
net.core.wmem_default = 26214400
net.core.netdev_max_backlog = 5000
```

**DERP relay diagnostics (CLI)**:
```bash
tailscale netcheck        # UDP connectivity, DERP latencies, NAT type, preferred region
tailscale status | grep -E "direct|relay"
tailscale debug derp
```
DERP is the fallback relay when direct P2P NAT traversal fails (UDP 41641 blocked, no
UPnP/NAT-PMP). `[gotcha]` relay connections have materially higher latency; fix by allowing
UDP 41641 outbound or enabling UPnP/NAT-PMP on the router.

**`ts-diagnostics.sh` — connectivity diagnostic bundle**: `ts-diagnostics.sh
[--peer <ip|hostname>] [--json]`. Collects `tailscale status --json`, `tailscale version`
(3-line: client/daemon/commit), `tailscale netcheck` (first 50 lines), and optionally
`tailscale ping --verbose -c 3 <peer>`. Parses `status --json`'s `Peer` map into per-peer
`primary_path` (`relay` if `Relay` field set; `direct` if `CurConnection=="direct"` OR nonzero
tx/rx with no relay; else `unknown`). Reusable technique: deriving direct-vs-relay from
`status --json` without needing `netcheck` per-peer.

**`ts-connectivity-report.py` — interpret diagnostics JSON**: reads the JSON from
the bundle above and computes: per-peer health (`offline`/`healthy`(direct)/`derp_relay`/`unknown`),
latency tiers (green <10ms, yellow 10-50ms, red ≥50ms), overall summary `issues[]` covering:
offline peers, peers stuck on DERP relay ("NAT traversal may need investigation"), high-latency
peers, `UDP is blocked or disabled` (from `netcheck.UDP==false`), MagicDNS not configured,
client/daemon version mismatch. `health: "healthy"` iff `issues` is empty. Reusable technique:
a real-time ping result showing `path_type: direct` UPGRADES a peer's health from `derp_relay`
to `healthy` even if the connection map showed relay — live ping is treated as more
authoritative than the cached netmap.

**Gotchas list — tailscale-client skill**: port conflicts on 8080/8443 (Serve
defaults) — check with `lsof -i :8080`. Subnet overlap with local LAN breaks routes — review
advertised routes. DERP-only fallback detectable via `status --json` showing `"relay":"..."`
instead of tx/rx-only direct path. `tailscaled` not running blocks ALL CLI commands. MagicDNS
needs `--accept-dns` or nodes are reachable only by Tailscale IP (100.x.x.x). Key expiry:
`--force-reauth` or plain re-run of `tailscale up`; non-expiring keys need `--expiry=false`
at creation.

**`tailscale netcheck` output fields for monitoring**: external IP, NAT type
(UPnP/PMP/PCP availability), DERP relay regions with per-region latency, e.g. `DERPs: 6/6
available; sfo: 15.2ms, 15.1ms; syd: 142.3ms, 141.7ms`.

### DERP under Headscale

**DERP = Designated Encrypted Relay Protocol, the TURN-like NAT-traversal fallback**:
used when direct peer-to-peer fails: symmetric NAT, restrictive corporate
firewalls blocking UDP/STUN, double/carrier-grade NAT, or blocked STUN (UDP 3478 filtered).
Traffic through DERP is still fully encrypted — WireGuard packets tunneled inside TLS — but
adds ~5-15ms overhead vs a direct connection, which is always preferred when available.

**Headscale's embedded DERP server config + when to move to standalone**:
`config.yaml` embeds a DERP server enabled by default:
```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "headscale"
    region_name: "Headscale Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: "/var/lib/headscale/derp_server_private.key"
```
Runs STUN on 3478 and relays on the Headscale listen port (typically 443); suitable for
tailnets under ~50 nodes. Additional keys: `derp.urls` (external DERP map URLs), `derp.paths`
(local DERP map JSON files), `derp.auto_update` (default true, fetches Tailscale's default
map). Under heavy relay traffic on the embedded server, control-plane performance degrades —
deploy a standalone DERP via the official `tailscale/derper` Docker image for >50
actively-relaying nodes:
```bash
docker run -d --name=derper --restart=always -p 3478:3478/udp -p 443:443 \
  -v /etc/letsencrypt:/certs -v /var/lib/derper:/var/lib/derper \
  tailscale/derper --hostname=derp.example.com
```
`[gotcha]` both port 3478/UDP (STUN) and 443/TCP (DERP relay, TLS) must be reachable from
clients. DERP map changes take up to 5 minutes to propagate to clients (cached) — use
`tailscale netcheck` to force a look.

**DERP map JSON structure and region-selection algorithm**: a DERP map is JSON
with a `Regions` object keyed by numeric `RegionID`, each with `RegionCode`, `RegionName`, and
`Nodes[]` (each: `Name`, `RegionID`, `HostName`, `DERPPort`, `STUNPort`, `STUNOnly`). Clients
STUN-probe all configured regions, measure round-trip latency, and pick the lowest-latency
region, falling back to the next-closest on failure. `tailscale netcheck` surfaces this: `*
Nearest DERP: Dallas` + a `DERP latency:` list per region.

**DERP TLS cert options**: `tailscale/derper` supports automatic Let's Encrypt
issuance (listens on port 80 for the ACME HTTP-01 challenge), manual certs via
`--cert=/path/cert.pem --key=/path/key.pem`, or TLS termination at an external reverse proxy
(nginx/Caddy/Traefik) forwarding to the local DERP port. A helper `deploy-derp.sh` script
generates the DERP map JSON and an optional docker-compose file, enforcing `--cert`/`--key`
XOR `--acme`.

**DERP relay health check technique: TCP + TLS handshake + STUN probes**: a DERP
health checker runs three independent checks against a relay host: (1) raw TCP connect to
`relay:3478` timing the handshake, (2) full TLS handshake to `relay:443` capturing TLS
version/cipher/cert subject+issuer+SAN, (3) a STUN binding request (RFC 5389, magic cookie
`0x2112A442`, 16-byte transaction ID) sent over the STUN port to confirm the relay answers. A
companion `test-derp-latency.sh` wraps `tailscale netcheck` (preferring `--json` when
available) to parse per-region latency and nearest-DERP into structured JSON, falling back to
text-parsing when `--json` isn't supported by the installed client version.

**`--snat-subnet-routes=false` preserves the original client IP through a Headscale subnet
router** `[unverified — single source]`: by default Headscale enables Source NAT on
subnet-router traffic, so traffic reaching the advertised subnet appears to originate from the
gateway node's own IP. Disable with `tailscale up --advertise-routes=192.168.1.0/24
--snat-subnet-routes=false` when the downstream network needs the ORIGINAL client IP for
logging, ACLs, or per-device firewall rules.

## 4. MTU / path-MTU issues and stacked tunnels

Default Tailscale tun MTU is 1420 (WireGuard overhead ≈80 bytes = 32 WG header + 8 UDP +
20-40 IP + 16 auth tag). Some other sources state Tailscale's conservative default
is 1280 — treat 1420 as the steady-state WireGuard default and 1280 as the safe
floor recommended for stacked/lossy paths; both figures recur across sources and are not a
contradiction, just different operating points.

**Path-MTU discovery via ICMP DF-bit probes**: standard Ethernet MTU is 1500.
Send a 1472-byte ICMP payload with Don't-Fragment set (1472+20 IP+8 ICMP=1500 total): macOS
`ping -D -s 1472 -c 1 -t 3 1.1.1.1`; Linux `ping -M do -s 1472 -c 1 -W 3 1.1.1.1`. If 1472
fails but a smaller payload (1400 on macOS) succeeds, path MTU is below 1500 — likely a
VPN/PPPoE overhead issue. **If BOTH fail, treat as inconclusive** (ICMP DF blocking or
destination unreachable), not as an MTU finding.

**Performance/MTU measurement recipe**: `iperf3 -s` / `iperf3 -c <ts-ip>` (UDP
variant `-u -b 100M`); compare tunneled vs direct-network throughput — a big gap points to
encryption overhead, relay routing, or MTU. CPU: WireGuard encryption is CPU-heavy on
platforms lacking hardware acceleration (Raspberry Pi/embedded routers); `top -p
$(pgrep tailscaled)`; kernel WireGuard (Linux 5.6+) is more efficient than userspace. MTU
test: `ping -M do -s 1400 <ts-ip>` and increase size until fragmentation/drop, then
`ip link set tailscale0 mtu <largest-working-minus-~80>`.

**MTU selection table for stacked/nested tunnels** (cross-corroborated: WireGuard
1420, OpenVPN ~1400, VXLAN 1450):

| Underlying path | Recommended client MTU | Rationale |
|---|---|---|
| Direct Ethernet, 1500 path | 1420 (default) | one layer of encapsulation |
| Wi-Fi to a router device | 1380 | Wi-Fi MTU surprises + encapsulation |
| WG client behind another NAT'd VM/container guest network | 1280 | two hops of NAT/encap, conservative |
| Inner overlay (Tailscale) on top of a WG client | ≤1200 | WG already ~80 bytes overhead; overlay adds another ~80 |

Symptoms of a stacked-tunnel MTU mismatch: TSMP/small-UDP probes work but large TCP
transfers stall/hang on the first DATA packet; `tailscale netcheck` reports `UDP: false`;
`wg show` transfer counters increment slowly/unevenly; `ping -s 1400` succeeds but `-s 1500`
doesn't. Fix: `sudo ip link set dev tailscale0 mtu <n>` (persist via a oneshot systemd unit
or the outer WG client's own `PostUp`).

**wg-quick full-tunnel policy-routing internals** `[HIGH confidence, author-verified]`:
with `AllowedIPs = 0.0.0.0/0, ::/0`, `wg-quick` does NOT install a bare default route — it
creates routing table `51820` (`0.0.0.0/0 dev wg0`, `::/0 dev wg0`) and two `ip rule`s:
priority `5208` (`from all lookup main suppress_prefixlength 0` — non-default-prefix traffic
still uses the main table) and priority `5209` (`not from all fwmark 0xca6c lookup 51820` —
everything WITHOUT WireGuard's own outbound fwmark routes via wg0). `0xca6c` = listen port
`51820` in hex, stamped on wg0's own egress socket (visible in `wg show wg0`). Net effect:
application traffic is forced into the tunnel while the ENCRYPTED WireGuard handshake/data
packets themselves fall through to the main table and reach the real NIC — the standard
wg-quick kill-switch shape. If `wg0` goes down, routes in table 51820 persist briefly until
`PreDown`, so the failure mode is a clean disconnect rather than a leak — useful context
when a Tailscale-over-WireGuard stack looks "stuck" rather than actively failing.

**Tailscale-on-WG-client stacking — TWO independent leak modes and their fixes**
(kept close to verbatim given its precision):
running Tailscale on a host whose default route is ALREADY a full-tunnel WireGuard client is a
common stack, but naive stacking leaks two ways SIMULTANEOUSLY.

**Leak 1 — Tailscale's own defensive fwmark bypass escapes to the underlay.** Tailscale stamps
`fwmark 0x80000` on its own UDP sockets (confirm: `ss -lunpe | grep tailscaled`) and installs
its own ip rules at priorities `5210`/`5230`/`5250` (`from all fwmark 0x80000/0xff0000 lookup
main|default|unreachable`) — this bypass exists so Tailscale's OWN encrypted traffic doesn't
loop back through `tailscale0`. It is interface-agnostic, so when `wg0` is the default route
these rules send Tailscale's STUN probes / DERP-TLS / direct-peer UDP OUT THE PHYSICAL NIC,
bypassing wg0 entirely. Fix — insert a HIGHER-priority (lower-number) rule that redirects the
same fwmark into wg0's table first: `ip rule add priority 5200 fwmark 0x80000/0xff0000 lookup
51820`.

**Leak 2 — wg-quick's OWN catch-all (rule 5209) shadows the tailnet routes.** Rule 5209 sends
ALL unmarked egress through wg0, including packets destined for `100.64.0.0/10` (the tailnet
CGNAT range) — Tailscale's per-peer `/32` routes live in table 52 (consulted at priority 5270),
but 5209 fires FIRST, so the kernel routes them out wg0 and `tailscale0` never even sees the
packets. Result: ICMP/TCP to mesh peers time out; only TSMP (Tailscale's userspace-direct
probe, bypassing kernel routing) appears to work — a classic false-positive that hides the
real breakage. Fix — TWO destination-based rules at higher priority than 5209:
```
5205  from all to 100.64.0.0/10        lookup 52
5206  from all to 100.100.100.100/32   lookup 52
5205  from all to fd7a:115c:a1e0::/48  lookup 52   (ip -6 rule)
```
Both fixes live in `wg0.conf`'s `PostUp`/`PreDown` (idempotent, `|| true`):
```ini
PostUp  = ip    rule add priority 5200 fwmark 0x80000/0xff0000 lookup 51820 || true
PostUp  = ip -6 rule add priority 5200 fwmark 0x80000/0xff0000 lookup 51820 || true
PreDown = ip    rule del priority 5200 fwmark 0x80000/0xff0000 lookup 51820 || true
PreDown = ip -6 rule del priority 5200 fwmark 0x80000/0xff0000 lookup 51820 || true
PostUp  = ip    rule add priority 5205 to 100.64.0.0/10        lookup 52 || true
PostUp  = ip    rule add priority 5206 to 100.100.100.100/32   lookup 52 || true
PostUp  = ip -6 rule add priority 5205 to fd7a:115c:a1e0::/48  lookup 52 || true
PreDown = ip    rule del priority 5205 to 100.64.0.0/10        lookup 52 || true
PreDown = ip    rule del priority 5206 to 100.100.100.100/32   lookup 52 || true
PreDown = ip -6 rule del priority 5205 to fd7a:115c:a1e0::/48  lookup 52 || true
```
`PostUp` runs AFTER wg-quick installs its OWN rules, so priority numbers stay stable and
predictable. After editing, `sudo systemctl restart wg-quick@wg0 && sudo systemctl restart
tailscaled` (Tailscale's sockets must reopen for the new rule set to bind them correctly).
Final annotated rule layout (lower number = evaluated first, "shadowed" = never matches
because a higher-priority rule already claimed the packet):
```
0     from all lookup local
5200  from all fwmark 0x80000/0xff0000 lookup 51820         # OURS — Tailscale → wg0
5205  from all to 100.64.0.0/10        lookup 52            # OURS — tailnet → tailscale0
5206  from all to 100.100.100.100      lookup 52            # OURS — MagicDNS → tailscale0
5208  from all lookup main suppress_prefixlength 0          # wg-quick
5209  not from all fwmark 0xca6c lookup 51820               # wg-quick catch-all → wg0
5210/5230/5250  fwmark 0x80000/0xff0000  main/default/unreachable   # Tailscale's own (now shadowed)
5270  from all lookup 52                                    # Tailscale general (now shadowed by 5205/5206)
32766/32767  main/default
```
Generalizes to any overlay that installs its own ip rules — ZeroTier (no ip rules by default,
conventional routes, usually needs no fix), Nebula (`nebula1` tun, conventional routes, no
fwmark), OpenVPN (conventional default route — pushing one conflicts with wg-quick's own
catch-all; pick ONE as the "outer" tunnel), Headscale-managed nodes (identical to Tailscale —
same client binary).

**Leak-check verification recipe (tcpdump-negative-proof pattern)**:
```bash
# 1. tcpdump that EXCLUDES the outer WG's own known-good traffic (its own UDP port,
#    ARP/ICMPv6, host mgmt SSH, host mgmt DNS) — anything ELSE captured is a leak.
sudo timeout 10 tcpdump -i <underlay-NIC> -n \
  'not (udp port 51820 and host <wg-server-LAN-IP>)
   and not arp and not icmp6
   and not (host <host-mgmt-IP> and tcp port 22)
   and not (host <host-mgmt-IP> and udp port 53)' &
# 2. representative traffic mix in another shell (mesh ICMP+TCP, public-internet TCP, DNS):
ping  -c 2 -W 2 100.64.0.<peer> >/dev/null
ssh   -o BatchMode=yes user@100.64.0.<peer> 'true'
curl  -s -m 3 https://ifconfig.me >/dev/null
nslookup example.com >/dev/null
wait
```
Expected: ZERO packets captured. If anything shows up, cross-check the offending source/dest
with `ip route get <dest> mark <fwmark>` and `ss -anpe` to find the socket and its fwmark.
Corroborating checks: `curl -s https://ifconfig.me` should report the WG SERVER's WAN IP (not
the client's), `tailscale ping <peer>` should succeed, `ssh user@<peer-tailnet-ip>` should
connect. Diagnostic command table: `ip route get <dest>` (add `mark <fwmark>` to simulate
Tailscale-marked traffic, `from <src>` for a specific source), `ss -tunpe` (per-process
sockets incl. fwmark — `grep tailscaled`), `ip route show table 52` (Tailscale's live
per-peer `/32` routes), `tailscale ping <peer>` (line ends `via 1.2.3.4:port` = direct, `via
DERP(<region>)` = relay), `tailscale ping --until-direct=false <peer>` (forces DERP to
confirm relay path works while direct doesn't), `tailscale ping --tsmp <peer>` (bypasses
kernel routing entirely — isolates Tailscale's OWN dataplane health from a policy-routing
problem), `journalctl -u tailscaled -f` (look for `disco: node [...] now using <ip>:<port>
mtu=<n>` — the reported `mtu` is the path MTU MagicSock actually picked; if larger than the
outer wg0's MTU, expect drops), `wg show wg0` (handshake freshness + transfer counters).

**4-tier IPv6 stack classification**: not a binary works/broken check — (1) any
non-loopback v6 address? if not → `disabled`; (2) any GLOBAL address (not ULA `fd00::/8`)?
if not → `ula_only` (router not delegating a public v6 prefix; macOS fix: `sudo networksetup
-setv6off <service>`); (3) actual non-link-local default v6 route? if not → `no_route` (RA
not received/NDP broken); (4) else test real connectivity (`dig AAAA` + `curl -6`) →
`healthy` or `path_broken` (address+route exist but traffic dies — VPN/firewall/ISP
black-holing v6). Each state maps to a different fix.

**GL-iNet Tailscale integration — explicit conflict list with other overlay/VPN features on
the SAME router firmware**: GL-iNet firmware 4.x ships Tailscale as a BETA built-in
toggle (Admin Panel → Applications → Tailscale → device-bind-link auth flow); options: Allow
Remote Access WAN, Allow Remote Access LAN, Exit Node. **Explicit vendor warning**: do not run
Tailscale simultaneously with WireGuard Client, OpenVPN Client, ZeroTier, GoodCloud
Site-to-Site, or AstroWarp on the SAME device — "routing conflicts result." (This is precisely
the conflict class the ip-rule surgery above solves for a Linux HOST stacking Tailscale over a
WG client manually — the router vendor's advice is simply "don't," where the surgery above
shows how a power user CAN make it work.)

## 5. Tailnet Lock (TKA) — cryptographic node-join signing

Prevents a compromised coordination server from injecting rogue nodes —
every joining node's WireGuard pubkey must be cryptographically signed by a trusted signing
key first. Pieces: Tailnet Lock Key (TLK, Ed25519 keypair on signing node), Tailnet Key
Authority (TKA, local signed chain "like git" tracking trusted TLKs + signed node keys),
Authority Update Message (AUM, signed state-mutating message), disablement secrets.
```bash
tailscale lock init                       # or: tailscale lock init --gen-disablement-secrets=3
tailscale lock status                     # nodes awaiting signature + trusted keys
tailscale lock sign <nodekey:...> tlpub:<key>
tailscale lock sign tskey-auth-<key>      # pre-sign an auth key for automated deployment
tailscale lock add tlpub:<key>
tailscale lock remove tlpub:<key>
tailscale lock revoke-keys tlpub:<key>    # revoke compromised signing keys (co-signing required)
tailscale lock disable <disablement-secret>
tailscale lock local-disable              # emergency, single node, recovery only
tailscale lock log                        # TKA audit log / change log
```
Disablement secrets: **10 generated at init**; ANY ONE disables Tailnet Lock (the ONLY way to
disable it); lose them all (without contacting Tailscale support) and the tailnet is
**permanently locked** with no recovery. Store offline in separate secure locations — a
safe/password manager, split across locations, is recommended.

**Constraints and gotchas**: max 20 signing nodes per tailnet; rotate TLKs
at most once/year (bounds TKA growth); Android CANNOT be a signing node (can receive
signatures but not sign); **mutually exclusive with the "Device Approval" feature — pick
one**; NOT supported on Headscale; initial trust is "trust on first use" from the coordination
server — verify `tailscale lock status` on multiple nodes after init.

## 6. App connectors (brief)

Routes DNS+TCP for specific DOMAINS through a connector node without advertising
full IP subnets or requiring IP forwarding.
```bash
tailscale set --advertise-connector
```
```jsonc
{"nodeAttrs": [{"target": ["*"], "app": {"tailscale.com/app-connectors": [
  {"connectors": ["tag:connector"], "domains": ["*.salesforce.com", "*.amazonaws.com"]}
]}}]}
```
v1.88+ ships preset app-connector profiles for common SaaS: AWS Console/APIs, Salesforce,
Microsoft 365, GitHub Enterprise. Use case: identity-aware access to SaaS apps without exposing
them to the public internet, and without exposing entire subnets.

## 7. DNS / MagicDNS

**Client DNS override breaks internet on non-home networks** — reported as a
high-frequency recurring root cause: symptom is internet appearing broken when Tailscale
connects over cellular data or a network where MagicDNS resolvers are unreachable. Fix:
`tailscale set --accept-routes=true --accept-dns=false` — keeps subnet-route acceptance while
preventing Tailscale from overriding client DNS config. This is a CLIENT-side symptom that
looks like a routing failure but is DNS.

**MagicDNS fails to resolve external domains (SERVFAIL) right after a Tailscale version
upgrade** — a routine `tailscaled` point-release upgrade (observed 2026-02-13, `1.94.0 →
1.94.1`) can silently break external domain resolution even though nothing was reconfigured.
Symptom: raw IP connectivity is fine but any domain lookup fails:
```bash
$ ping google.com
ping: google.com: Name or service not known
$ host google.com 100.100.100.100
Host google.com not found: 2(SERVFAIL)
```
Diagnose in this order — confirm it's DNS-only, not general connectivity loss
(`ping -c 1 1.1.1.1` succeeds, `ping -c 1 google.com` fails); check `/etc/resolv.conf` shows
only `nameserver 100.100.100.100` (MagicDNS is the sole resolver); check Tailscale's own view
of its resolvers (`tailscale dns status` → `Resolvers: (no resolvers configured)`, `System DNS:
(failed to read system DNS configuration: Access denied)`); check `tailscaled` logs for the
SERVFAIL cause (`journalctl -u tailscaled | grep 'no upstream resolvers'`). Root cause: no
global nameserver was ever configured in the Tailscale admin console (`DefaultResolvers:[]` —
a pre-existing gap), and Tailscale used to silently fall back to the system DNS (e.g. via
DHCP) when no global resolver was set. The version upgrade changed the OS-DNS fallback
mechanism (`dns-osconfig dump access denied` on this OS in 1.94.1) so the daemon can no longer
read the system DNS config, and the silent fallback stops working — the upgrade didn't
introduce a new bug, it surfaced a pre-existing missing-configuration issue that had been
masked. Fix — set a global nameserver in the Tailscale admin console
(`https://login.tailscale.com/admin/dns`): add a Global nameserver (e.g. Google Public DNS
`8.8.8.8`+`8.8.4.4` or Cloudflare `1.1.1.1`+`1.0.0.1`, plus IPv6), then enable "Override DNS
servers". `[gotcha]` "Override DNS servers" sounds risky but is actually a security
IMPROVEMENT here — it prevents a malicious local network from hijacking DNS resolution. No
`tailscaled` restart is needed; the fix applies live — confirm with `host google.com` and
`journalctl -u tailscaled --since '5 min ago' | grep DefaultResolvers`. Lesson: when using
MagicDNS, ALWAYS explicitly configure a global nameserver — relying on the implicit
system-DNS fallback means a routine version upgrade can silently break external domain
resolution with no warning.

**Windows NRPT catch-all = classic VPN-residue DNS hijack**: VPN clients (Proton,
Mullvad, Cisco AnyConnect, NordVPN, DirectAccess) install a Name Resolution Policy Table rule
with `Namespace = "."` routing every DNS query to their in-tunnel gateway; buggy disconnect
cleanup leaves it active (often triggered by sleep/hibernate during an active session).
Detect: `Get-DnsClientNrptRule | Where Namespace -eq '.'`. Telltale gateway IPs: `10.2.0.x`
=Proton, `10.64.0.x`=Mullvad, `10.211.x.x`/`10.212.x.x`=Cisco AnyConnect, `10.5.0.x`=NordVPN.
The rule's `Comment` field often self-identifies the origin verbatim — read it before chasing
AV/WFP as the cause. Resolves "nslookup works but browsers fail" — the single most common
Windows DNS complaint per this source.

**Linux systemd-resolved stuck per-link DNS**: VPN clients (OpenVPN, WireGuard,
Mullvad, Proton CLI) push per-link DNS via `resolvectl dns <iface> <servers>` on connect;
disconnect cleanup should call `resolvectl revert <iface>` but many scripts forget. Detect:
`resolvectl status` shows DNS on an interface no longer routing.

**Linux `/etc/nsswitch.conf` hosts-line NSS order can silently bypass resolved**:
if `hosts: files dns` (missing `resolve`) on a systemd-resolved system, glibc bypasses the
`resolve` NSS module entirely and reads `/etc/resolv.conf` directly — if that's broken, all
libc-based resolution fails even though `resolvectl query` works. Healthy line: `hosts: files
mymachines resolve [!UNAVAIL=return] dns myhostname`. Detect: `grep "^hosts:" /etc/nsswitch.conf`.

**Cross-OS elimination order** (see §1 above) is the general process-of-elimination
summary these three VPN-residue findings feed into.

**MagicDNS basics** `[MED confidence — no version/flag citation given]`: MagicDNS
enabled by default in new tailnets; `ping my-server` resolves via MagicDNS. Custom DNS via
admin console: Split DNS routes specific domains to internal DNS servers; Global nameservers
override default resolution.

**Tailscale IP of a workload changes across recreation; MagicDNS hostname stays stable**
`[MED confidence]`: "the GPU pod's Tailscale IP changes between
termination/recreation but the hostname `airco-gpu` stays constant while the pod is alive" —
recommend referencing peers by MagicDNS hostname, not a cached/hardcoded IP, for anything that
survives pod recreation.

**China ISP DNS hijack breaking MagicDNS-based SSH**: China ISP DNS server
`114.114.114.114` doesn't return NXDOMAIN for unknown domains — returns fake IPs in
`198.18.0.0/15` (ad-redirect range). Symptom: `ssh user@hostname` connects briefly then closes,
no SSH banner; `ping hostname` works but SSH fails; `nslookup hostname` resolves to
`198.18.x.x`. `[gotcha]` `198.18.x.x` coincidentally overlaps OrbStack's internal range, so it
LOOKS like an OrbStack conflict but is DNS hijacking — verify with `nslookup
non-existent-domain-xyz123.com 114.114.114.114`: any IP instead of NXDOMAIN confirms
hijacking. Diagnose: `nslookup hostname` (may be fake) vs `nslookup hostname.ts.net` (should
be real if MagicDNS works), `dscacheutil -q host -a name hostname`, `scutil --dns` (look for
nameserver entries), `networksetup -getdnsservers "Wi-Fi"`, `tailscale status` (find real
100.x.x.x), `scutil --dns | grep -B2 -A2 'ts.net'` (should show `domain: ts.net` with
nameserver `100.100.100.100`; "Not Reachable" = MagicDNS not being used), `ping -c1
100.100.100.100`. Fix: `sudo networksetup -setdnsservers "Wi-Fi" 223.5.5.5 119.29.29.29`
(repeat per interface), `sudo dscacheutil -flushcache`. Optional hosts pin: `sudo sh -c 'echo
"100.86.50.21 m3max" >> /etc/hosts'`. `[gotcha]` if ISP/router-level hijacking persists even
after switching DNS servers, use SSH `HostName` with the full `*.ts.net` MagicDNS name
(Tailscale resolves `*.ts.net` internally, bypassing system DNS): `Host m3max` /
`HostName m3max.tailcc8506.ts.net` / `User m3max`.

*Deeper DNS-hijack forensics (Windows registry paths for NRPT, macOS `/etc/resolver/<domain>`
orphan files, the generic safe-cleanup pattern with a protect-regex for `100.100.100.100`, and
the cross-OS IP-attribution cheat table) are covered in a sibling reference — not duplicated
here; see the scope note above.*

## 8. Proxy/VPN-tool conflicts on macOS (Shadowrocket/Clash/Surge-class tools)

This is the largest single failure-class covered in this file — cross-corroborated across five
independent sources describing what is functionally the same "tunnel-doctor" workflow, each
adding its own detail. The canonical shape, folding in every source's contribution:

**Four-to-five independent conflict layers** — distinguish
by which OTHER tool still works:

| Layer | Symptom | What else works | Root cause |
|---|---|---|---|
| 1. Route hijacking | Everything broken (SSH, curl, browser) | `tailscale ping` still works | proxy `tun-excluded-routes` for `100.64.0.0/10` adds a competing `en0` route |
| 2. HTTP proxy env vars | curl/Python/Node fetch broken | SSH unaffected (ignores `http_proxy`) | `http_proxy` set without Tailscale ranges in `NO_PROXY` |
| 3. System proxy bypass | Browser gets HTTP 503 | curl and SSH both work | browser uses OS/VPN-profile system proxy; a `DIRECT` rule for `100.64.0.0/10` still routes "directly" via Wi-Fi (en0), which has no route to `100.x` |
| 4. SSH ProxyCommand double-tunnel | `git push/pull` fails intermittently, small ops (`ssh -T`) succeed | — | `ProxyCommand connect -H` stacked on an already-active proxy TUN drops large/long-lived HTTP-CONNECT transfers |
| 5. VM/container proxy propagation | `docker build`/`docker pull` fail differently from host `curl` | host curl works | OrbStack/Docker Desktop VM bridge takes a different network path than the host TUN (§9 below) |

`[gotcha]` an older 3-layer variant of this model (missing layer 4) is widely circulated —
treat the 4/5-layer version as the more complete/superseding one.

**Fast component isolation**: SSH does NOT use `http_proxy`/`NO_PROXY`. `curl` uses
`http_proxy` env var, NOT system proxy; browser uses system proxy. `tailscale ping` works but
plain `ping` doesn't → route table corrupted (Layer 1). `ssh -T` works but `git push` fails
intermittently → double tunnel (Layer 4). Host curl works but `docker pull` times out → Layer 5.

**Verify with the component's own health check before committing to a hypothesis**:
HTTP proxy → `curl -x http://127.0.0.1:<port> -m 10 https://api.github.com` returns 200;
Tailscale daemon → `tailscale status` lists peers; DNS resolver → `dig @<ns-ip> +tries=1
+timeout=3 example.com` <100ms; routing → `route -n get <ip>` shows expected interface.
Overlapping symptoms across layers can send you down the wrong path — verify the specific
suspect component directly rather than reasoning by elimination.

**TUN measurement contamination — several diagnostic probes LIE while a TUN proxy is active**:
under TUN/global mode (Shadowrocket/Clash/Surge): `nc -z host port` showing
`0.00s` = TUN answered locally, not the real remote; `ping` near-zero RTT can be fabricated
ICMP; `curl -w '%{remote_ip}'` always shows the local TUN endpoint; foreign IP-geo lookups
report the exit node's IP, not your real IP; QUIC/HTTP3 comparisons are meaningless (TUN
usually doesn't forward UDP/443). Trustworthy instead: `curl`'s
`time_appconnect`/`time_starttransfer`, an in-region IP-geo source, and the proxy config
decoded from disk + its own GUI. `[gotcha]` a `0.00s` connect or sub-ms ping to another
continent is physically impossible — that's the tell you measured the TUN, not the network.

### Layer 1 — route hijacking

Diagnose with `route -n get <tailscale-ip>` — healthy
shows `interface: utunN` (verify it's Tailscale's own via `ifconfig | grep -A2 'inet
100\.'`, since not every utun is Tailscale's); hijacked shows `gateway: 192.168.x.1 interface:
en0`. Confirm: `netstat -rn | grep 100.64` — a competing `100.64/10 → en0 (UGSc, Static
Gateway)` beats Tailscale's own `100.64/10 → utunN (UCSI, Cloned Static Interface)` for the
same prefix (macOS route priority quirk). **MTU fingerprint**: Tailscale's utun is typically
MTU 1280; Shadowrocket's TUN is typically MTU 4064 — a utun with MTU 4064 in the route output
means the packet is hitting the proxy's TUN, not Tailscale's, even if the interface name
pattern matches. Root cause is the proxy's `tun-excluded-routes` setting for `100.64.0.0/10`.
`[gotcha]` manually deleting the bad route (`sudo route delete -net 100.64.0.0/10
<gw>`) is only TEMPORARY — the proxy re-adds it on next VPN reconnect/toggle. **The only
PERMANENT fix is removing `100.64.0.0/10` from the proxy's `tun-excluded-routes` setting.**

### Layers 2/3 — the fix, and why `skip-proxy` ≠ `tun-excluded-routes`

Add Tailscale ranges to the proxy tool's **`skip-proxy`** (NOT `tun-excluded-routes`, which causes
Layer 1 instead):
```
skip-proxy = 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, localhost, *.local, captive.apple.com
```
Universal cross-tool Clash/Surge-style `[Rule]` config (a separate mechanism from both
skip-proxy and tun-excluded-routes):
```
IP-CIDR,100.64.0.0/10,DIRECT
IP-CIDR,fd7a:115c:a1e0::/48,DIRECT
```
Per-tool specifics: Shadowrocket `[Rule] IP-CIDR,100.64.0.0/10,DIRECT`; `[General]
skip-proxy = 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, localhost, *.local,
captive.apple.com`. Clash/ClashX Pro: add `- IP-CIDR,100.64.0.0/10,DIRECT` before `MATCH` in
`rules:`. Surge: same `[Rule]` entries plus `skip-proxy = 100.64.0.0/10,
fd7a:115c:a1e0::/48` and `always-real-ip = *.ts.net`.

CLI/HTTP-client tools obey `NO_PROXY`/`no_proxy` (a THIRD, independent layer):
```bash
export NO_PROXY=localhost,127.0.0.1,.ts.net,100.64.0.0/10,192.168.*,10.*,172.16.*
```
**All three settings act at different protocol layers and must ALL be set** — fixing only one
leaves a subset of tools (browser vs curl vs system routing) still broken.
`[gotcha]` `skip-proxy` (bypass proxy layer only, traffic still flows through TUN → Tailscale)
is safe; `tun-excluded-routes` (removes the CIDR from TUN routing entirely, creates the
competing en0 route) breaks everything — these two settings LOOK similar and have OPPOSITE
correct answers for the same CIDR.

**`NO_PROXY` syntax portability matrix**:

| Syntax | curl | Python requests | Go `net/http` | Node.js | Meaning |
|---|---|---|---|---|---|
| `.ts.net` | Yes | Yes | Yes | Yes | domain-suffix match (safest, portable) |
| `*.ts.net` | No | Yes | No | varies | glob — curl/Go do NOT support it |
| `100.64.0.0/10` | Yes (curl 7.86+) | Yes (requests 2.25+) | **No — silently ignored** | No | CIDR notation |
| `100.*` | Yes | Yes | No | Yes | TOO BROAD — also matches public `100.0-63.*`/`100.128-255.*` |
| `workstation-name` | Yes | Yes | Yes | Yes | exact hostname match — safest for Go |

**Go-specific gotcha**: Go's `httpproxy.Config.ProxyFunc` has no CIDR matcher
— `NO_PROXY=100.64.0.0/10` is silently ignored and Go binaries (custom CLIs, Go test suites)
route through the proxy anyway even when curl/Python correctly bypass it. Fix: use MagicDNS
hostnames or explicit single IPs for any Go-based tool. Example:
`NO_PROXY=100.64.0.0/10 go-program http://100.101.102.103:8002/health  # → goes through proxy`.

**Distinguishing Tailscale's utun from another VPN's utun by MTU**: not
every `utun` interface is Tailscale's. `ifconfig | grep -A2 'inet 100\.'` finds the interface
with a `100.x.x.x` address. MTU 1280 → typically Tailscale; MTU 4064 → typically Shadowrocket
TUN. If `route -n get <tailscale-ip>` shows traffic hitting a `utun` with MTU 4064, that is
Shadowrocket's TUN, not Tailscale's — still a route conflict even though the interface name
pattern matches.

**Local vanity-domain proxy interception**: symptom `https://local.<domain>` fails
via proxied curl/browser but succeeds with `env -u http_proxy -u https_proxy curl -k -I
https://local.<domain>/health`. Fix: add the domain to both the proxy app's bypass list
(`skip-proxy`) AND shell `NO_PROXY`/`no_proxy`; trust the local CA if using internal TLS.

**`quick_diagnose.py` — automated macOS proxy/Tailscale conflict scanner**:
`python3 scripts/quick_diagnose.py --host <h> --url <u> [--tailscale-ip 100.x.x.x] [--json]`.
Detects: (1) shell `NO_PROXY`/`no_proxy` vs proxy env mismatch for the target host, (2)
`scutil --proxy` system exceptions mismatch, (3) direct vs proxy-forced curl path divergence,
(4) TLS trust failures via a proxy-stripped strict curl, (5) optional route-ownership check
comparing `route -n get <ip>`'s interface/MTU against the auto-detected Tailscale utun to flag
both en0-hijack and wrong-utun (e.g. hitting a 4064-MTU VPN utun instead of Tailscale's
1280-MTU one). Consolidates the manual Layer-1/2/3 checks into one command with structured
findings + fix suggestions. Requires macOS.

**Per-process proxy from WSL as prevention against host TUN single-point-of-failure**:
for a workstation whose real proxy consumers live inside WSL, prefer explicit
per-process proxying against the host's HTTP/SOCKS port over host-wide TUN mode: `export
http_proxy=http://$(ip route show default | awk '{print $3}'):<proxy-port>`; critically also
set `no_proxy` including `localhost,127.0.0.1,::1,<gateway-ip>,100.64.0.0/10,.ts.net,
192.168.0.0/16,10.0.0.0/8` — without it, localhost and Tailscale-peer requests get proxied
too, and a proxied `curl http://localhost:<port>` returning 503 FROM THE PROXY (instead of
connection refused) is the tell that `no_proxy` is missing.

**TUN DIRECT split-brain — domain-routed sites fail while proxied sites keep working**:
symptom: every DIRECT-rule domestic/cloud/own-API site fails simultaneously
(curl: `SSL routines::unexpected eof`; proxied curl: `CONNECT tunnel failed, 503`; Node CLIs:
`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`) while overseas proxied sites keep working. Cause:
fake-IP mode TUN tool has two independent forwarding planes (proxied vs DIRECT); the DIRECT
plane's fake-IP↔domain table can corrupt independently (stale after network change) while the
proxied plane stays healthy — traffic gets forwarded to the WRONG backend, presenting a
mismatched TLS cert. Diagnosis: `dig +short <domain>` returns a `198.18.x.x` fake IP; `dig
+short @223.5.5.5 <domain>` gets the real IP from a public resolver bypassing the broken path;
`curl --resolve <domain>:443:<real-ip> https://<domain>/` connecting by real IP with correct
SNI proves the physical network is fine and only the TUN's DIRECT state is broken. Fix:
restart the tunnel then flush the OS DNS cache (`sudo killall -HUP mDNSResponder`) since stale
fake-IP entries survive a reconnect. `[gotcha]` an automated proxy health watchdog that only
probes an overseas endpoint through the proxy will report "healthy" for hours while the DIRECT
plane is completely dead — verify all 4 planes independently (domestic direct, own
DIRECT-rule domain, cloud API, overseas via proxy).

**Stalled DNS resolver in the macOS `getaddrinfo` chain — full diagnosis + fix**:
symptom: `ssh`/`curl`/`git` hang ~60s resolving a hostname, `ssh -vvv` freezes after `debug2:
resolving`; `nslookup` is instant but `dscacheutil -q host -a name <host>` takes 60s+. Root
cause: macOS `getaddrinfo` consults every `scutil --dns` resolver matching (or with no domain
filter), and if one nameserver is unreachable while its interface stays in the routing table,
it waits the full UDP retry timeout before falling through. Most common trigger: a VPN/tunnel
daemon (Tailscale et al.) crashed without unregistering its resolver entry. Bisection: `for ns
in <nameservers>; do dig @$ns +tries=1 +timeout=3 +short example.com; done` — dead ones return
`connection timed out` after exactly 3.01s. A resolver with NO `domain:` line participates in
EVERY lookup (unbounded blast radius); one with `domain: foo.com` only stalls `*.foo.com`
lookups. Fix: restart the owning app cleanly (`osascript -e 'quit app "Tailscale"' && sleep 3
&& open -a Tailscale`) so its teardown hooks remove the stale interface — NOT `dscacheutil
-flushcache` (rebuilds from cached results, not from network config, so the dead resolver
survives a flush). `[gotcha]` `ping <resolver-ip>` can succeed in <1ms even when port 53 is
dead, because the `utun` interface still answers ICMP locally while the actual daemon process
is gone — don't infer DNS health from ping. Verification must be 4-dimensional: daemon health
(`tailscale status`), per-resolver dig, `dscacheutil`, AND the original failing command run
WITHOUT any workaround — a workaround left in place hides whether the underlying system path
was actually healed.

### Layer 4 — SSH ProxyCommand double-tunnel

Symptom: `ssh -T git@github.com` succeeds
consistently, but `git push`/`pull` fails intermittently with `FATAL: failed to begin relaying
via HTTP. Connection closed by UNKNOWN port 65535`. Fix: remove `ProxyCommand`, switch to
GitHub's SSH-over-443 endpoint (single tunnel):
```
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    ServerAliveInterval 60
    ServerAliveCountMax 3
    IdentityFile ~/.ssh/id_ed25519
```
Why port 443 helps: HTTP/landing proxies grant longer timeouts and larger buffers to port-443
traffic and don't apply deep-packet-inspection sometimes triggered by port 22. Trade-off:
~6s vs ~2s connection setup. Diagnose: `GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push
origin main` (confirms removing ProxyCommand fixes it); `ifconfig | grep '^utun'` (confirms a
proxy TUN is active); `ssh -v -T git@github.com 2>&1 | grep 'Connecting to'` should show
`ssh.github.com [...] port 443`.

**TUN DNS hijack breaks SSH-over-443 to GitHub (198.18.x.x virtual IPs)**: symptom:
`git clone/fetch/push` fails with `Connection closed by 198.18.0.x port 443`; DNS resolves
`ssh.github.com` to a `198.18.0.0/15` virtual IP instead of the real IP (proxy-tool TUN DNS
hijack for protocol-aware proxying — works for HTTPS, mishandles SSH-over-443). Fix: hardcode
the real IP in `~/.ssh/config`: `HostName 140.82.112.35` (or `.36`), `Port 443`. Diagnose
direct-IP bypass: `ssh -o HostName=140.82.112.35 -o Port=443 git@github.com`. `[gotcha]`
hardcoded IPs break if GitHub rotates them — monitor with a weekly cron `dig +short
ssh.github.com @8.8.8.8`. Alternative if you control the proxy rules:
`IP-CIDR,140.82.112.0/24,DIRECT` / `IP-CIDR,192.30.252.0/22,DIRECT`.

**End-to-end leak-verification recipe**:
```bash
route -n get <tailscale-ip>              # must show Tailscale's OWN utun (check MTU/inet 100. to confirm)
netstat -rn | grep 100.64                # should show exactly ONE 100.64/10 route
nc -z -w 5 <tailscale-ip> 22
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no <user>@<tailscale-ip> 'echo SSH_OK && hostname && whoami'
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://<ts-ip>:<port>/
curl -s -o /dev/null -w "%{http_code}" http://<ts-ip>:<port>/    # both with/without proxy must return 200
```
ALL checks must pass. Partial failure interpretation: route wrong → revisit proxy config
(Layer 1); TCP connect fails → check remote sshd/firewall; TCP connects but SSH
`kex_exchange_identification` → Tailscale SSH proxy intercept; other SSH errors → ACL/local
issues.

**Related proxy-adjacent fixes**: SSH local port-forward beats changing `APP_URL` for
remote-dev auth-redirect loops — `ssh -NL PORT:localhost:PORT
<tailscale-ip>` (or `autossh -M 0 -f -N -L ... -o "ServerAliveInterval=30" -o
"ServerAliveCountMax=3" -o "ExitOnForwardFailure=yes" <ip>`), because `localhost` is always
exempt from proxy interception; no code/env changes needed, and it matches the industry
pattern (VS Code Remote-SSH, GitHub Codespaces). Multi-port: stack multiple `-L` flags in one
tunnel; if ANY port is already bound, `ExitOnForwardFailure=yes` aborts the WHOLE tunnel. Kill:
`pkill -f 'autossh.*<tailscale-ip>'`. Makefile pattern:
```makefile
REMOTE_HOST ?= <tailscale-ip>
TUNNEL_FORWARD ?= -L 3010:localhost:3010
tunnel:    ; ssh -N $(TUNNEL_FORWARD) $(REMOTE_HOST)
tunnel-bg: ; autossh -M 0 -f -N $(TUNNEL_FORWARD) -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" -o "ExitOnForwardFailure=yes" $(REMOTE_HOST)
```
`autossh -M 0` disables autossh's OWN monitoring port (relies on `ServerAliveInterval` instead
— more reliable through NAT); `ExitOnForwardFailure=yes` fails FAST if the local port is
already bound rather than silently running unforwarded.

**`localhost`-in-Makefile proxy interception**: always pass
`--noproxy localhost` (e.g. `curl --noproxy localhost -sf
http://localhost:9000/minio/health/live`), because `http_proxy` is often set globally (common
in China) and any script/Makefile target that curls `localhost` (health checks, warmup routes)
silently routes through the proxy and fails/times out unless `no_proxy` includes it.
Alternative global fix: `export no_proxy=localhost,127.0.0.1` in the shell rc alongside
`http_proxy`/`https_proxy`. `docker exec`, `redis-cli`, `pg_isready` connect via raw TCP and
are UNAFFECTED. `[gotcha]` some proxy implementations only match the literal string
`"localhost"` in no-proxy, not the resolved `127.0.0.1` — prefer `curl
http://127.0.0.1:PORT/health` over `curl http://localhost:PORT/health` in scripts for
reliability.

**Non-login SSH shells don't load `~/.zshrc`/`~/.bashrc`**: `REMOTE_CMD = ssh
$(REMOTE_HOST) 'source ~/.zshrc 2>/dev/null; $(1)'` — prefix every remote command run via
Makefile with `source ~/.zshrc 2>/dev/null;` because non-login SSH shells don't load nvm/
Homebrew/proxy env vars; `bash -lc` loads `.bash_profile` but NOT `.zshrc` on macOS zsh.

## 9. Docker / OrbStack proxy propagation (VM-runtime layer)

**Four distinct sub-failures, one root-cause family**: root cause family: VM-based Docker runtimes (OrbStack, Docker Desktop) run the
daemon inside a lightweight VM whose outbound traffic takes a DIFFERENT network path than
host processes (`Host curl: process → TUN → landing proxy → internet` vs `VM Docker: daemon →
VM bridge → host network → TUN → ???`), and the TUN may not correctly handle VM-bridged
traffic (different TCP stack/MTU/keepalive). **`docker pull` vs `docker build` use DIFFERENT
proxy config paths** — fixing one does NOT fix the other:

| Operation | Proxy source |
|---|---|
| `docker pull` | Docker daemon config (`~/.orbstack/config/docker.json` or `docker info`) |
| `docker build` (`RUN apt/apk`) | Build-container env (`--build-arg http_proxy=` or `--network host`) |
| `docker run` | Container env (`-e http_proxy=` or inherited from daemon) |

**Sub-1**: `RUN apk add`/`apt-get install` inside `docker build` fails `Connection refused` in
<0.2s even though host `curl` works. Cause: OrbStack's `network_proxy: auto` creates
a TRANSPARENT proxy inside the VM that intercepts HTTPS; when the host TUN is also active, the
transparent proxy's upstream breaks and redirects HTTPS to `127.0.0.1` inside the VM (nothing
listening — smoking-gun diagnostic: `docker run --rm alpine:latest sh -c "wget -q --timeout=5
-O /dev/null https://dl-cdn.alpinelinux.org/"` → `can't connect to remote host (127.0.0.1)`).
Fix: `docker build --network host -f Dockerfile -t myimage .` bypasses the VM bridge entirely
(trade-off: loses build-time network isolation — fine for local dev, prefer fixing the daemon
proxy config for CI/CD).

**Sub-2**: fix `docker pull` by writing `~/.orbstack/config/docker.json` with proxies pointed
at `host.internal` (OrbStack-specific hostname resolving to the HOST's IP — NOT `127.0.0.1`
which points to VM loopback, and NOT `host.docker.internal` which "may not resolve in all
contexts"):
```json
{"proxies": {"http-proxy": "http://host.internal:1082", "https-proxy": "http://host.internal:1082",
 "no-proxy": "localhost,127.0.0.1,::1,192.168.128.0/24,100.64.0.0/10,host.internal,*.local"}}
```
then `orbctl stop && sleep 3 && orbctl start` (a FULL restart is required — reload alone is
insufficient; `orbctl config set network_proxy none` does NOT clean up this cached
`docker.json` — the stale proxy persists, diagnose with `docker info | grep -i proxy` showing
a proxy even though `orbctl config get network_proxy` says `none`).

**Sub-3 decision matrix**:

| Docker config | Traffic path | Result |
|---|---|---|
| Proxy ON (`127.0.0.1`), no `no-proxy` | Docker→VM proxy→??? | pull may work, LOCALHOST PROBES BROKEN |
| Proxy ON (`host.internal`) + `no-proxy` | external via host proxy; local direct | BOTH WORK |
| Proxy OFF (`network_proxy: none`) | Docker→VM bridge→host→TUN→internet | TLS handshake TIMEOUT (counter-intuitive: removing the proxy makes it WORSE, because the VM-bridge→TUN path itself is broken) |
| `--network host` (build only) | build container→host network→TUN→internet | build WORKS |

**Sub-4**: deploy scripts/healthchecks that `curl`/`wget` `localhost` INSIDE a container leak
through the proxy because Docker inherits BOTH uppercase (`HTTP_PROXY`) and lowercase
(`http_proxy`) proxy env vars from the host — clearing only the uppercase
form (a common oversight) leaves the healthcheck's `wget` (which checks lowercase) still
routing through the (broken, VM-internal) proxy port; the compose symptom reads `(unhealthy)`
with logs showing `wget: can't connect to remote host (127.0.0.1): Connection refused` (a
proxy port, not the app port). Fix: clear BOTH cases in compose (`HTTP_PROXY= HTTPS_PROXY=
http_proxy= https_proxy= NO_PROXY=* no_proxy=*`); verify with `docker exec <container> env |
grep -i proxy` (expect nothing set); prefer `curl http://127.0.0.1:PORT` over `curl
http://localhost:PORT` in probe URLs.

## 10. SSH-over-Tailscale specific issues

**SSH relay caveat — Tailscale SSH authorizes the source NODE, not the human identity that
first logged into it**: example: if `rahul@debian` SSH access is permitted, and
`debian` is separately permitted to SSH to `shaurya@asuna`, then the hop `rahul → debian →
asuna` is viable purely from Tailscale's authorization perspective — Tailscale SSH does not
track the original human identity through a relay hop. Changing the destination username alone
does NOT prevent the second hop. Mitigation: remove the relay permission entirely, or isolate
the relay node so `rahul` cannot reach it. This is a security-relevant gotcha — least-privilege
SSH policy design must account for transitive hops through intermediate nodes, since node-level
ACLs don't propagate the original caller's identity.

**TCP reachability between peers**: `ssh <host> "nc -zv <TAILSCALE_IP> <port>"`;
combine with `ss -tlnp` on the target to confirm the process is actually listening (not just
"port open").

**Tailscale quick-reference + known issues (managing-ssh skill)** `[MED confidence —
mixes a host-specific detail with generic troubleshooting order]`:
```bash
tailscale status
tailscale up      # re-authenticate on expiry
tailscale ip -4
```
Known issue: `sudo` strips `SSH_AUTH_SOCK`, breaking SSH-agent-based auth after `sudo` — fix
with `sudo -E` or preserve `SSH_AUTH_SOCK` in sudoers. Diagnostic order: (1) if it's an auth
failure, check the desktop SSH-agent status first; (2) `invalid format` key errors → check
file line-endings; (3) if it's timeout/no-route rather than an auth failure → check `tailscale
status`/`tailscale up` — the generic part (timeout/no-route ⇒ check Tailscale connectivity,
not SSH auth) is broadly applicable. Stated as a documented step in this same skill's
SSH-troubleshooting procedure: the two failure classes (auth vs. connectivity) point to
disjoint root causes and should not be debugged with the same first step — its "Known Issues"
summary line for this case reads "Tailscale expired or disconnected → confirm with `tailscale
status`, `tailscale up`."

**Worked example — SSH over Tailscale times out because the CLIENT's own session expired**
(not the target's): symptom is a plain connect timeout, not an auth failure —
```bash
$ ssh greenhead@100.79.80.95
ssh: connect to host 100.79.80.95 port 22: Operation timed out
```
Check the Tailscale admin console's machine list: the CLIENT shows `Expired <date>` while the
TARGET shows `Connected` —
```
macbookpro          100.126.197.36    Expired Sep 18, 2025
greenhead-minipc     100.79.80.95      Connected
```
Fix — re-authenticate Tailscale on the CLIENT (macOS GUI: menu-bar Tailscale icon → Log in; or
CLI `tailscale up` if installed). Verify with `tailscale status` (the peer should show
`active` in place of `-`), then retry the SSH connection. Prevention: renew the Tailscale key
before it expires, or enable key auto-renewal / disable key expiry in the admin console.

**OpenSSH version-gated feature floors (commonly misattributed)**: `ed25519-sk`,
default touch-to-sign, `-O resident` → OpenSSH 8.2 (2020-02-14). `-O verify-required`
(per-use PIN) → OpenSSH **8.4**, NOT 8.2 (a commonly repeated error). `ssh-rsa`/SHA-1 off by
default since 8.8. DSA removed in 10.0 (2025-04), which also defaults to post-quantum hybrid
KEX `mlkem768x25519-sha256`. `PerSourcePenalties` (in-daemon rate-limiting, makes fail2ban
largely optional) arrived in 9.8. As of mid-2026 the OpenSSH series is 10.3.

**Auto-attaching tmux on inbound SSH must exclude non-interactive command sessions**:
if login shells auto-wrap into tmux so long jobs survive drops, the wrap must:
always yield a raw shell on the break-glass relay (`:2222`) recovery path, skip wrapping when
`$SSH_ORIGINAL_COMMAND` is set (editor / Claude Code bootstrap shells must NOT be wrapped), and
bound the check with `timeout … || true` so a wedged tmux server can never hang the login.

## 11. Platform-specific gotchas

### macOS

**Mac Tailscale is App mode, not daemon — restart via app, not launchctl**:
`launchctl kickstart system/com.tailscale.tailscaled` will FAIL on Mac (Tailscale.app is not a
plain launchd daemon in this configuration). Use `tailscale logout` → `tailscale up`, or quit +
reopen the App, to restart.

**Stale LocalAPI port scenario** — distinguish precisely
from a different bug. The standalone macOS Tailscale.app (bundle ID `io.tailscale.ipn.macsys`,
from tailscale.com — NOT the Mac App Store version) bundles CLI+daemon in one binary; the CLI
talks to the in-process daemon over a TCP LocalAPI on a random loopback port. After certain
updates/partial-crash states, the GUI process keeps running and Tailscale traffic keeps
flowing (other nodes still see the host as reachable in their own `tailscale status`) but the
LocalAPI listener is gone — every local CLI invocation then fails, breaking launchd jobs using
`tailscale file cp` (Taildrop), `tailscale ip`, `tailscale set`, etc. Diagnostic
error: `Failed to connect to local Tailscale daemon for /localapi/v0/status; not running?
Error: dial tcp 127.0.0.1:53755: connect: can't assign requested address` (port number varies).

Confirm precisely — all simultaneously true: `pgrep -f Tailscale` shows GUI running;
`tailscale status` from a DIFFERENT node shows this host reachable (possibly `idle, tx N rx
M` — control plane caches registration, byte counters can look stale); `lsof -nP -p
$TAILSCALE_PID` shows almost no FDs — no LISTEN sockets, no unix sockets, just `cwd`/`txt`
(the smoking gun of a half-dead process); `lsof -nP -iTCP -sTCP:LISTEN | grep -i tailscale`
returns nothing; the `/usr/local/bin/tailscale` CLI is just a shim to the bundled binary and
fails the same way. `[gotcha]` if `lsof` DOES show FDs but the CLI still fails, this is NOT
the stale-port scenario — check `~/Library/Logs/Tailscale/` for crashes instead. **The control
plane's remote view is never a reliable health signal for the LOCAL daemon** — the only
reliable signal is running a CLI command ON the affected host itself. Distinct
macOS install paths fail differently: standalone (`io.tailscale.ipn.macsys`) has the
stale-port bug; Mac App Store build (`io.tailscale.ipn.macos`) is sandboxed differently;
Homebrew `tailscaled` formula requires sudo and its LaunchAgent crash-loops (`tailscaled
requires root; use sudo tailscaled`) if accidentally enabled alongside the GUI app.

**Silent Taildrop cron failure compounding the stale-port bug**: a launchd cron
script invoking `tailscale file cp ... 2>/dev/null` suppresses stderr, making the failure
silent; downstream consumers of the pushed file (e.g. a sticky-state presence model) continue
using the last successfully-pushed value for hours/days, causing silent misattribution.
Hardening: surface stderr instead of discarding it:
```bash
err=$(echo "$result" | tailscale file cp - dylans-mac-mini: 2>&1 >/dev/null)
if [ $? -eq 0 ]; then log "Pushed"; else log "WARN: Failed to push: $err"; fi
```
`[gotcha]` `tailscale file cp` hangs indefinitely (rather than failing fast) when the LocalAPI
is unreachable in some versions — a cron firing every ~30s for hours can leave many stuck
processes; clean up with `pkill -f 'tailscale file cp'`.

**Fix stale LocalAPI port: restart Tailscale.app, with a self-lockout bootstrap trap**:
primary fix: `killall Tailscale; sleep 2; open -a Tailscale` (from a GUI session,
or via SSH if a GUI session is logged in). `open -a` from SSH only works if a GUI session is
logged in; if it silently no-ops, fall back to `launchctl asuser $(id -u) open -a Tailscale`.
Verify: `tailscale status` (peer list, not LocalAPI error), `tailscale ip -4`. `[gotcha]`
**bootstrap trap**: if your remote session (SSH/VNC) reaches the affected Mac VIA ITS OWN
Tailscale IP, killing Tailscale severs your own control channel before relaunch — the most
common way to brick yourself out. Avoid it: use a NON-Tailscale recovery path (macOS built-in
Screen Sharing over Apple ID relay — System Settings → General → Sharing → Screen Sharing →
"Allow for Apple Account" — works without Tailscale; or LAN/Bonjour/.local/wired console). If
you must go over Tailscale, make kill+restart one self-contained detached command: `ssh
affected-mac 'nohup sh -c "sleep 1; killall Tailscale; sleep 3; open -a Tailscale" >/dev/null
2>&1 </dev/null & disown'`, then wait ~30s and reconnect. Test on a non-critical host first.

**Inbound-blocked traffic on macOS (Clash/pf/utun conflicts)**: identify the
Tailscale utun by iterating `utun0..30` for an `inet 100.` address:
```bash
for i in $(seq 0 30); do addr=$(ifconfig utun$i 2>/dev/null | grep "inet " | awk '{print $2}'); [ -n "$addr" ] && echo "utun$i: $addr"; done
```
Capture: `sudo tcpdump -i utunN -n host 100.X.X.X` while the remote pings — no packets = network-
layer/Clash interception; packets but no reply = macOS kernel dropping. Check Clash/Mihomo:
`ps aux | grep -i "clash\|mihomo" | grep -v grep`; count utun interfaces (`ifconfig | grep -E
"^utun[0-9]+:" | wc -l` — normal 1-3, 10+ = conflict). Fix: fully quit Clash Verge (not just
toggle TUN off — toggling does NOT stop the mihomo process); verify `ps aux | grep -i
"clash\|mihomo"` returns nothing; or exclude Tailscale CIDR in Clash TUN config (`tun:
{enable: true, auto-route: true, auto-detect-interface: true, dns-hijack: []}`). `tcpdump`
localizes further: `sudo tcpdump -i utunN -n 'host <remote_ip> and port 22'` — zero
SYNs seen = dropped at Tailscale app layer ("Allow Incoming Connections") or Clash TUN
interception; SYNs arrive but no SYN-ACK = macOS kernel-level filtering or sshd config issue.

### Linux

`/dev/net/tun` missing → `modprobe tun`; in containers the HOST must pass through
`/dev/net/tun` or grant `NET_ADMIN`; iptables conflicts with Docker/firewalld/ufw — check
`iptables -L -n -v | grep tailscale`; if firewalld active, `firewall-cmd --zone=trusted
--add-interface=tailscale0 --permanent && --reload`; kernel <5.6 falls back to slower userspace
WireGuard.

**Persist IP forwarding via sysctl.d drop-in for exit nodes/subnet routers**:
```bash
sysctl -w net.ipv4.ip_forward=1
sysctl -w net.ipv6.conf.all.forwarding=1
cat > /etc/sysctl.d/99-tailscale.conf << 'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
```
`[gotcha]` without IP forwarding, exit node and subnet routing silently do not work — Tailscale
WARNS but still starts (no hard failure to alert you).

**Verify unattended boot readiness independently (systemd units)**: `systemctl
is-enabled tailscaled`; `systemctl is-active tailscaled`; `systemctl is-enabled
NetworkManager`. For a dedicated always-on worker, disable sleep only after owner approval:
`sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`; undo
with `systemctl unmask` (same target list).

**Move a Wi-Fi credential from user wallet to system NetworkManager profile for headless
boot**: if a worker only appears after graphical login, inspect without printing the
secret: `nmcli -g connection.id,connection.permissions,connection.autoconnect,802-11-wireless-
security.psk-flags connection show '<connection>'` — `psk-flags=1` means a user secret agent
(KDE Wallet) owns the password (unavailable before desktop login, so the worker can't come up
unattended). Store it system-wide: read the PSK invisibly (`read -rsp 'Wi-Fi password:
' WIFI_PSK; echo`) then `sudo nmcli connection modify '<connection>' 802-11-wireless-security.psk
"$WIFI_PSK" 802-11-wireless-security.psk-flags 0 connection.permissions '' connection.autoconnect
yes; unset WIFI_PSK`. `[gotcha]` only do this on a trusted, physically secure worker whose
administrators may access that credential; prefer wired Ethernet for unattended servers.

### Other platforms

**Windows**: firewall rules can be stripped by security software/group policy — verify with
`netsh advfirewall firewall show rule name="Tailscale"`; some ops need Administrator
elevation; antivirus can intercept WireGuard UDP — add binary + `tailscale0` to AV exclusions.

## 12. Container router (Docker/Podman subnet-router) diagnostics — command layer

**Failure patterns and fixes** (see §2 for the full triage flow): firewall backend
mismatch → `TS_DEBUG_FIREWALL_MODE=nftables` (or `iptables` matching host kernel) as a
container env var. IP forwarding disabled → check via `docker exec -it <ROUTER_CONTAINER>
sh -lc 'sysctl net.ipv4.ip_forward'`. SNAT/masquerade not active → default enabled in official
image; if explicitly disabled, re-enable `TS_SNAT_SUBNET_ROUTES=true`. Route not approved →
approve in admin console or ensure ACL `autoApprovers` covers the subnet.

For Podman, substitute `podman` for `docker` throughout.

## 13. Kubernetes / Talos / sidecar patterns

**Sidecar proxy pod manifest (K8s, non-operator)**:
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: tailscale-proxy
spec:
  hostNetwork: true
  containers:
    - name: tailscale
      image: tailscale/tailscale:latest
      env:
        - name: TS_AUTHKEY
          valueFrom: {secretKeyRef: {name: tailscale-auth, key: TS_AUTHKEY}}
        - name: TS_ROUTES
          value: 10.244.0.0/16,10.96.0.0/12
        - name: TS_KUBE_SECRET
          value: tailscale-proxy-state
      securityContext:
        capabilities: {add: [NET_ADMIN, SYS_MODULE]}
```

**Kubernetes Operator features: Ingress, Egress, API-server proxy, Connector/ProxyGroup/
ProxyClass/Recorder**: Ingress exposes a K8s Service to tailnet clients under a
Tailscale identity — for private admin tools/internal APIs/preview environments that should
have no public load balancer (does NOT replace NetworkPolicy or service annotations — use
both where needed). Egress lets in-cluster workloads reach tailnet resources; restrict by
namespace/workload/proxy-tag and write grants from the specific proxy tag to only needed
destinations/ports. The API-server proxy exposes Kubernetes API access over Tailscale — treat
as sensitive infra, tailnet reachability is NOT a substitute for K8s RBAC. `Connector`
resources cover cluster-managed subnet routers/app connectors; `ProxyGroup`/`ProxyClass`
control proxy grouping/customization for HA/scheduling; `Recorder` supports session recording
(treat recordings as sensitive audit material). CRD names/fields change across operator
versions — always `kubectl explain connector.spec` etc. and check installed CRDs before
generating manifests, rather than writing from memory.

**Talos/Kubernetes-specific troubleshooting table** — see §2 above.

**Headscale self-hosted deployment workflow — infra prep → install/config → onboard →
maintain** `[MED confidence]`: Step 1 Prepare infra (public IP + domain, TLS cert
via Let's Encrypt, PostgreSQL or SQLite DB, firewall for port 443 + DERP relay ports) → Step 2
Install/configure (download binary, generate config, configure OIDC provider integration, DNS
records for coordination server, configure DERP relay servers) → Step 3 Onboard users/devices
(create users/namespaces, generate pre-auth keys, connect clients, configure ACLs via
Headscale policy file) → Step 4 Operational maintenance (monitor server health, rotate
pre-auth keys regularly, backup DB/config, update Headscale + client versions, review/rotate
DERP relay config). Notably names Postgres OR SQLite as a valid backing store and calls out
explicit DERP relay port firewall requirements.

## 14. Serve / Funnel troubleshooting

**Port conflict**: "Port already in use" → `lsof -i :8080`, pick a different port, or stop
the conflicting service.

**Verification/troubleshooting order for a Serve-exposed local server**:
```bash
launchctl print gui/$UID/ai.opencode.web           # (or your own service manager equivalent)
lsof -nP -iTCP:4096 -sTCP:LISTEN
curl -o /dev/null -sS -w '%{http_code}\n' http://127.0.0.1:4096/global/health
tailscale serve status
tailscale status
```
The listener must be bound to `127.0.0.1:<port>`, and an unauthenticated health request
returning `401` proves Basic Auth is actually enforced. Common failures: locked/missing
Keychain item, closed laptop lid, disconnected Tailscale, stale cached password on phone,
port already used by a second process.

**Restarting a Serve-shared service disconnects its current clients** — run
restarts from an independent terminal ("restarting the server disconnects agents currently
using that server"); expect current tailnet clients to drop.

**Self-curl from the serving host can hang (hairpin/self-connect)**: curling a
Service's own hostname FROM the same host proxying it can time out or hang, even when the
Service works fine for every other node. Don't conclude a Service is broken from a failed
self-test — verify from a different tailnet node first.

**6-step "serve status looks wrong" troubleshooting checklist**: (1) bare vs
`--json`? Bare misses Services — always add `--json` for Services. (2) Did you sudo
unnecessarily, or is sudo scoped only to `serve *` not `status`? Try without sudo first. (3)
Does the target Service exist in the admin console yet? A serve command against an undefined
Service "succeeds" but does nothing. (4) Testing with `ping` against a Service VIP? Use `curl`
against the hostname instead. (5) Testing from the same host serving the proxy? Test from a
different node. (6) Only after 1-5 ruled out: check tailscaled itself (`systemctl status
tailscaled`, `tailscale status`, node's `BackendState`). `[gotcha]` restarting tailscaled on a
shared host is a real action, not a diagnostic one — it affects connectivity for every service
that host proxies; don't do it reflexively while chasing a display confusion on an
already-working Service (distinct from a restart being a required step when standing up a
brand-new Service).

**CORS + relay design rationale for a Tailscale-fronted service** `[MED confidence —
one author's own risk judgment, not a Tailscale-endorsed pattern]`: `Access-Control-Allow-Origin:
*` set unconditionally because the page is mirrored across multiple tailnet hosts and
"cross-origin POSTs are tailnet-private, so a permissive origin is acceptable" — i.e. the
security boundary is the Tailscale network perimeter itself, not CORS. The one relay route
forwards to exactly ONE fixed upstream shape using a server-side-only key file (never exposed
to the client), explicitly documented as "not a general proxy." A documented, deliberate
counter-example precedent for a SERVE-VS-DIRECT security discussion.

## 15. Taildrop

**Receiver-side collision jam: pusher gets 500, receiver silently delivers stale data**:
`tailscale file get` refuses to overwrite existing files in the destination dir.
If the receiver doesn't drain EVERY file from `RECV_DIR` on each invocation, stragglers
accumulate (`stdin (1).txt` … `stdin (9).txt`) and eventually collide with new arrivals. From
then on: pusher's `tailscale file cp` gets `500 Internal Server Error: too many retries trying
to rename ".../stdin.txt.<random>.partial" to "stdin.txt"`; receiver's `tailscale file get`
returns SUCCESS without delivering; downstream consumers silently act on stale data. Compounded
by Tailscale 1.56+ renaming stdin pushes from `stdin` → `stdin.txt`, which breaks legacy `if [
-f stdin ]` receiver checks. `[gotcha]` the pipeline fails silently — no LaunchAgent/systemd
failure, exit code 0, only downstream staleness reveals it.

(See §11 macOS section for the stale-LocalAPI-port silent Taildrop-cron failure.)

## 16. Reverse-proxy and tunnel alternatives

**Reverse-proxy general playbook context**: non-Tailscale-specific reverse-proxy
comparison (Caddy: auto-HTTPS/ACME, simplest config, experimental L4; Nginx: highest
traffic/static-file throughput, manual/certbot TLS, `stream` module for L4; Traefik:
Docker/K8s-native dynamic backends, auto-ACME, native TCP/UDP; HAProxy: pure L4/L7 load
balancing, manual TLS). Caddy WebSocket proxying is automatic (`reverse_proxy` handles the
`Upgrade` header transparently); Nginx needs explicit `proxy_set_header Upgrade
$http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 86400;` (long
read-timeout to keep the WebSocket alive). Caddy can also integrate with Tailscale's
certificate module directly for internal services needing browser-valid certs.

**What NOT to expose via any tunnel** (Cloudflare Tunnel/ngrok/etc., recommending
Tailscale/WireGuard instead): admin panels (router/hypervisor/NAS UIs), password
managers (Vaultwarden and similar), LAN-only tools (IoT hubs, printer dashboards assuming a
trusted network), sensitive-data portals (private document/database systems). "A tunnel makes
services accessible, not secure — weak credentials, missing MFA, or unpatched software remain
exploitable regardless of the tunnel." (This framing recurs across sources.)

**Cloudflare Tunnel (`cloudflared`) — outbound-only architecture, contrasted with
Tailscale/direct exposure** `[MED confidence — version pin single-source and
unverifiable]`: creates OUTBOUND-only encrypted connections from the origin to Cloudflare's
edge — no inbound ports needed anywhere, since the tunnel dials OUT to Cloudflare, which then
proxies public traffic back through it. Architecture: `Internet → Cloudflare Edge (CDN, WAF,
DDoS, Access) → cloudflared → Origin server`. `[gotcha]` streaming media (Jellyfin/Plex)
through a CDN-fronted tunnel can violate the media platform's ToS if edge caching is enabled —
disable caching for media subdomains; non-HTTP protocols (SSH, databases) proxied through such
tunnels can behave unexpectedly — use a real VPN (Tailscale/WireGuard) for non-web protocols
instead.

## 17. Security hardening for Tailscale-only servers

**Firewall + service-binding discipline for a Tailscale-only server**: "Tailscale
is the ONLY way to reach this server. There is no public IP access, no fallback SSH. Losing
Tailscale connectivity means losing the server entirely." Core rules: (1) every listening
port binds to the Tailscale IP (`tailscale ip -4`) or `127.0.0.1` — **never `0.0.0.0`**; (2)
firewall rules must always allow the `tailscale0` interface; (3) never restart `tailscaled`,
networking, or `sshd` without explicit user approval; (4) always verify connectivity after any
network change.
```bash
# before any change — snapshot
tailscale status; ss -tlnp; ip addr show tailscale0
# after any change — verify immediately, roll back if disconnected
tailscale status; ss -tlnp
TSIP=$(tailscale ip -4)     # for config files that need the IP at write time
```
```nft
chain input {
  type filter hook input priority 0; policy drop;
  iif lo accept
  iif tailscale0 accept              # CRITICAL — never remove this
  ct state established,related accept
}
```
For services that can't bind to a specific address (only `0.0.0.0` or `127.0.0.1`): bind to
`127.0.0.1` and put a reverse proxy or Tailscale Funnel in front if external access is
genuinely needed. `[gotcha]` "if Tailscale shows disconnected after a change, immediately roll
back." Denying the `tailscale0` interface in the firewall locks you out entirely with no
fallback.

**Do-not-do defaults for a tailnet ops assistant**: don't modify sudo policy just to
avoid a password prompt. Don't promote a user to admin/sudoers without explicit approval.
Don't wipe/replace remote `~/.ssh` to "fix" login. Don't change firewall/network settings
before confirming the actual failure mode. Don't operate on an ambiguously matched device name
(confirm which device when multiple labels match).

**NIST SP 800-77 (IPsec VPN guide) comparison** `[MED confidence]`: WireGuard is
framed as an alternative to IPsec with reduced complexity; Tailscale automates key
distribution and NAT traversal; mesh topology eliminates single point of failure. Positions
Tailscale/WireGuard against a traditional IPsec VPN guide for compliance narratives.

## 18. Mobile

**Wireless ADB deploy over Tailscale — TCP mode must be fixed via USB once per boot**:
Android's Developer-Options "Wireless Debugging" only works over the SAME WiFi
network. To deploy over ANY network (including cellular, via Tailscale), the ADB daemon must
first be switched to TCP mode over a one-time USB connection: `adb devices` (confirm
state=`device`) → `adb tcpip 5555` → disconnect USB → the phone now listens on port 5555 over
any network reachable via its Tailscale IP. This must be repeated after every phone reboot
(the TCP mode setting does not survive a reboot). If no USB device is detected, the skill
surfaces a mandatory notice and lets the user either confirm they already ran `adb tcpip
5555`, explicitly opt into the WiFi-only Wireless-Debugging path instead, or cancel — it never
silently assumes either path.

**iOS/Android platform gotchas**: background-app suspension can disconnect Tailscale — enable
Background App Refresh (iOS) / disable battery optimization (Android; MIUI/One UI need
ADDITIONAL manufacturer-specific exemptions); deleting the iOS VPN profile drops connectivity
— re-enable from the app to reinstall it.

## 19. Bug reports / escalation evidence

**"Offline" vs "not connected" mean different root causes** `[MED confidence]`: in
`tailscale status`, "offline" = reachable but hasn't been seen recently (network issue);
"not connected"/"authentication required" = auth expired (policy issue, needs `sudo tailscale
up --force-reauth`).

**Debugging an ephemeral node that never joins the tailnet** `[MED confidence]`:
checklist — (1) confirm bootstrap container is actually running (0 `uptimeSeconds` in the
platform API means it crashed before reaching the tailscale step); (2) inspect `tailscaled`
log for auth errors; (3) auth key expired → regenerate; (4) stale node identity in persisted
state file → delete it and re-auth; (5) "failed to connect to local tailscaled" in bootstrap
log → daemon needs `--tun=userspace-networking` on that platform, kernel-TUN unreliable.

**Collect, for any bug report** — the general commands (bugreport, netcheck, status --json,
logs) are in §0 above. Note: **never share a state directory
(`/var/lib/tailscale/` or equivalent) — it contains private keys**, and `tailscale bugreport`
is specifically designed to be safe to share (its report ID links to server-side logs, excludes
private keys/traffic content).

## 20. Monitoring / health-check patterns

**Discovery-first, never guess** (see §0).

**Enumerate peers, key expiry, ACL, DNS, exit nodes from JSON status** — covered
in a sibling reference; not duplicated here.

**Tailnet health-check subprocess pattern** — covered in a sibling reference; not
duplicated here.

**`--quick` health-cache mode** `[from a companion net-ops probe, not Tailscale-specific but
directly reusable]`: cache pass/fail + first-failure rung to a JSON file with a
10-minute default TTL (`NETOPS_CACHE_MAX_AGE`, override via env); `--quick` skips slow
lower-layer rungs (link/ICMP/socket/DNS-infra) if the cache says healthy, re-running only the
fast-to-regress layers (OS resolver + application) — the layers most likely to regress quickly
(VPN reconnect, browser DoH toggle) without the underlying network having changed.

**`--watch=N` continuous mode**: the OS-dispatching `probe` script loops the
underlying probe in `--json` mode, extracting only the `{"type":"summary"...}` line and
comparing it (whitespace-stripped) to the previous iteration's state — printing "initial
state", "CHANGED: ...", or "(no change)" per tick, timestamped. Avoids flooding output on an
unchanged flapping check every 30s.

**Reusable opsec redaction filter for diagnostic output**: a `redact_filter()`
perl one-liner masks private/CGNAT/link-local IPv4 (`10.x`, `172.16-31.x`, `192.168.x`,
Tailscale CGNAT range `100.64-127.x` EXCEPT the magic anchor, `169.254.x` link-local), MAC
addresses (both `:`/`-` separators), and `*.ts.net` tailnet hostnames (→`REDACTED.ts.net`) —
while explicitly preserving `100.100.100.100` and public anchor IPs (`1.1.1.1`, `8.8.8.8`) as
"diagnostic landmarks" not secrets. Applied via a self-reinvocation trick (`maybe_redact_self`)
that re-execs the script without `--redact` and pipes stdout through the filter, avoiding
bash 3.2 exec-redirect quirks. Lets diagnostic scripts be shared/pasted (e.g. to a support
ticket or LLM) without leaking the caller's actual tailnet name, MAC addresses, or internal
LAN topology, while keeping the information load-bearing for diagnosis (which nameserver,
which CGNAT range). `[gotcha]` regex order matters — Tailscale's own CGNAT-range address
`100.100.100.100` is first swapped to a placeholder token (`__TS_MAGIC__`) BEFORE the general
`100.64-127.x` CGNAT mask runs, then restored at the end, so the anchor survives the same
regex pass that would otherwise catch it (100.100.100.100 falls inside the 100.64.0.0/10 CGNAT
block).

**Reverse-probe pattern: diagnose a target FROM OUTSIDE when its own local probe says "all
good"**: `reverse-probe.sh <host> [extra_tcp_ports...]` runs FROM the operator's
machine against a target (LAN, tailnet, or public IP): (1) resolve via `dig +short` (bypasses
local resolver, isolates DNS from reachability); (2) ICMP ping; (3) TCP port sweep (default
22/80/443 + extras, de-duplicated); (4) TLS/HTTPS health via curl with timing (`-k` when
connecting by literal IP since SNI won't match); (5) `traceroute`/`mtr` for path/routing.
Useful for the "target's own local probe says all good, but external users still report
problems" case — directly applicable to a Tailscale peer/service unreachable from a specific
vantage point.

**Caching TTLs recommended for fleet status queries** `[MED confidence — this
project's own recommended values, not empirically justified]`: host-status cache 60s TTL
("host status doesn't change rapidly", manual invalidation on connectivity change);
load-metrics cache 30s TTL ("load changes frequently", auto-invalidation on timeout);
group-configuration cache 5 minutes TTL ("group membership rarely changes", manual
invalidation when groups are modified). A reusable pattern for scoping cache TTL to the actual
volatility of each data type, rather than one blanket cache duration — directly transferable to
any Tailscale fleet-status dashboard/skill design.

## 21. Device management

**`tailscale set --hostname=X` vs `tailscale up --hostname=X --reset` — the registered tailnet
device name does NOT auto-follow local hostname changes**: `tailscale set
--hostname=X` updates LOCAL prefs only and only affects the tailnet-registered name on a
NODE'S FIRST AUTH. For an already-authed node, the registered device name stays whatever it
was at first `tailscale up` — Tailscale deliberately keeps names sticky in the control plane
to keep ACL rules/DNS caches/audit trails stable. Two remediation paths: (1) admin-console
rename (safe, no reconnect, preserves all prefs — recommended), (2) `sudo tailscale up --reset
--hostname=<name>` which WIPES every non-default flag (exit-node config, advertised routes,
accept-routes, accept-dns override, advertise-tags) — only safe on a node with zero
non-default flags. Explains a name-divergence class of bug that looks like a Tailscale sync
failure but is by-design. `[gotcha]` verify with `tailscale debug prefs | grep -E
'"OperatorUser"|"Hostname"'` (proves `--operator` and hostname prefs took effect) vs `tailscale
status --self --json | jq .DNSName` (proves control-plane registered name) — these two can
legitimately disagree.

**`tailscale set` only changes explicitly-passed flags; `tailscale up` requires re-specifying
the FULL desired flag set (or `--reset`)**: `Client.SetNetworking` builds one
`tailscale set` call from whichever fields are non-nil, so toggling exit-node/subnet-routes/
accept-routes/SSH doesn't disturb the hostname (set elsewhere) or any other preference.
Exit-node advertisement has NO separate preference field — it's implemented as the pair of
default routes `0.0.0.0/0` + `::/0` inside `AdvertiseRoutes`; a helper must detect that pair to
derive `AdvertiseExitNode` and exclude those two CIDRs from the custom-subnet-routes field
shown to users. `net/netip.ParsePrefix` should reject host-bit-set CIDRs and reject
`0.0.0.0/0`/`::/0` directly in a "custom routes" field (those must go through the dedicated
exit-node toggle).

## GAPS

Content covered in sibling reference files is intentionally **not** duplicated here (see the
scope note above) — most notably: deep ACL/Grants troubleshooting and policy-level DNS-hijack
forensics (Windows registry paths, macOS `/etc/resolver` orphan-file cleanup scripts,
IP-attribution cheat table) live in `policy-and-identity.md`; the v1.98.1 `serve --json`
regression, Funnel-specific error table, and curl-from-localhost SNI gotcha live in
`serve-funnel-tls.md`; the full platform install/health matrix (macOS system-extension approval
flow, Windows AV/firewall exclusions detail beyond what's in §11, Android/iOS platform notes
beyond §18) lives in `platforms-and-install.md`; non-login-shell SSH nuances beyond §10/§11's
SSH section live in `ssh-and-agent-access.md`; `netcheck`/`status --json` fleet-enumeration
scripts and the composite load-score / cache-invalidation design for a multi-host scheduler
live in `api-and-fleet-ops.md`.

Not covered here:
- Framework-specific Serve/Funnel breakage beyond what a sibling file covers — no coverage here
  of Next.js or other SPA-framework specifics.
- WebSocket/long-lived-connection behavior specifically through Serve/Funnel — only the
  generic, non-Tailscale reverse-proxy WebSocket handling in §16 is documented here.
- Mobile MagicDNS resolution behavior, Safari/mobile-browser secure-context requirements, or
  `*.ts.net` vs raw-IP handling on phones — beyond the general iOS/Android platform notes in
  §18, this is not covered here.
- The exact JSON field name to grep for the tailnet name in `status --json` output — a sibling
  reference says "check with grep -i tailnet" but never confirms the literal field;
  `CurrentTailnet.Name` is used elsewhere — cross-reference that field instead of the unverified
  grep when you reach the sibling file.
- Whether `NO_PROXY` CIDR support varies further by curl/requests MINOR version beyond the two
  version floors given (curl 7.86+, requests 2.25+) — not independently verified here.
