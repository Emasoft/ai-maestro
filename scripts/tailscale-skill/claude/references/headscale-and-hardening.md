# Headscale (self-hosted control plane) and security hardening

Reference covering: self-hosting Tailscale's coordination server (Headscale), tailnet/OS-level
security hardening, Taildrop/Taildrive file-sharing exposure, and adjacent context (reverse
proxies, remote-desktop-over-tailnet, Tailscale's own AI-gateway). Compiled from multiple sources.

A claim resting on a single source, or flagged LOW-confidence in that source, is marked
`[unverified]`. Version-gated behavior names the version it applies to. Where two sources disagree,
both positions are shown with a note on which is better-evidenced — contradictions are never
silently resolved.

---

## PART 1 — Headscale: self-hosted control plane

### 1.1 What it is, and the capability gap that matters most

Headscale is an **open-source reimplementation of Tailscale's coordination server** (not a fork of
the client). Standard, unmodified Tailscale clients (Linux/macOS/Windows/iOS/Android) connect to it
by pointing `--login-server` at it — no special client build required.

**Feature-parity matrix (merged from 4+ independent sources; all agree on the gaps themselves):**

| Feature | Headscale support |
|---|---|
| MagicDNS | Yes |
| ACLs (HuJSON policy file) | Yes |
| Tailscale SSH | Yes |
| iOS/Android clients | Yes |
| `tailscale serve` | Yes |
| **`tailscale funnel`** | **No — requires Tailscale's SaaS control plane** |
| Kubernetes Operator | No |
| **Tailnet Lock** | **No** (see 2.5) |
| Device posture (`devicePosture`/`device:managed`) | **No** |
| IP sets (`ipSets`/`ipprotocol` in ACL/grant `dst`) | **No** — use per-address/CIDR rules instead |
| OIDC groups in ACL policy | **No** — use `autogroup:admin` / `autogroup:member` instead |

**Note on Serve vs Funnel — one source conflates them, others don't.** One source states
flatly "Tailscale Serve/Funnel: No" as a single combined row. Three or more independent, more
detailed sources — the client-join skill, the zero-trust bootstrap skill, and the deploy skill —
agree that `tailscale serve` itself **is** supported against Headscale and only `funnel` requires
the SaaS control plane, which is what the table above reflects. Weight the multi-source, more
granular claim over the single combined one.

Beyond the enumerated gaps, **expect reduced feature parity generally** when self-hosting — the
table above is not exhaustive. A production Headscale deployment should also self-host its **own
DERP relay** (see 1.5) rather than depending on Tailscale's hosted relay infrastructure; this
combination suits air-gapped or strict-data-residency deployments specifically.
(confidence: HIGH)

**It is not documented what Headscale actually DOES when a policy file
references one of the unsupported keys above** — reject with a parse error, or silently ignore the
key and keep going. **This gap is real and must not be smoothed over**: before deploying an
unsupported construct, validate the loaded policy against `headscale` itself (see 1.5) rather than
assuming either behavior. `(confidence: HIGH for the gaps themselves, HOW they fail is [unverified])`

Also worth flagging: ACL `users`/legacy fields are **not interchangeable** with Grant `src`/`dst`
syntax — don't mix the two policy grammars.

Beyond Headscale itself, other self-hosted/alternative overlay-mesh control planes are noted here
for context (not Tailscale-compatible, different trust models):
- **Nebula** (Defined Networking) — certificate-based, no central relay, NAT hole-punch via a
  lightweight "lighthouse". `nebula-cert ca -name "My Org"`, `nebula-cert sign -name "web1" -ip
  "10.42.0.10/24" -groups "web,prod"`. Config: `pki`, `static_host_map`, `lighthouse.hosts`,
  `listen.port` (default 4242), `firewall` rules **by group**, not IP.
- **ZeroTier** — simpler setup than Nebula but requires a controller (self-hosted `ztncui` or
  managed); `zerotier-cli join <network-id>`; custom root servers via planet/moon files.
(confidence: HIGH)

### 1.2 Bootstrap — install, config, first user, first client join

Consistent across 4+ independent sources (plus the workflow framing
below):

```bash
wget https://github.com/juanfont/headscale/releases/latest/download/headscale_linux_amd64
chmod +x headscale_linux_amd64 && sudo mv headscale_linux_amd64 /usr/local/bin/headscale
sudo mkdir -p /etc/headscale
sudo headscale generate config > /etc/headscale/config.yaml
# key settings: server_url, listen_addr: 0.0.0.0:8080, private_key_path,
#   db_type: sqlite3 (or postgresql for larger deployments),
#   db_path (e.g. /var/lib/headscale/db.sqlite)
sudo headscale serve
headscale users create myorg
headscale preauthkeys create --user myorg --reusable --expiration 24h   # see 1.3 — name vs numeric id
tailscale up --login-server https://headscale.example.com
```

**Full command reference for the join step** (confidence: HIGH): `sudo tailscale up
--login-server=https://headscale.example.com --authkey=tskey-auth-xxxxx` (an auth key skips the
interactive browser step). Pre-mint a tagged key and join advertising it:

```bash
headscale preauthkeys create --user myuser --tags tag:ci-runner,tag:monitoring
sudo tailscale up --login-server=https://headscale.example.com --authkey=tskey-auth-xxxxx --advertise-tags=tag:ci-runner
```

Feature-support matrix from the client's own point of view (corroborates 1.1's table and adds
detail): MagicDNS ✅ (needs `--accept-dns` on the client), Taildrop/Taildrive ✅, Tailscale SSH ✅
(`--ssh`), Serve ✅, **Funnel ❌** (unsupported — confirms 1.1), Exit Nodes ✅.

**Gotcha:** `tailscaled` must already be running **before** any `tailscale` CLI subcommand works —
`sudo systemctl start tailscaled` (Linux), open the macOS GUI app, or `sudo tailscaled` directly;
otherwise commands fail as if there is nothing to connect to.

Full ops-lifecycle framing `(confidence: MED)`: prepare infra (public IP + domain, TLS via Let's
Encrypt, Postgres-or-SQLite, firewall open for 443 + DERP relay ports) → install/configure (binary,
config, OIDC provider integration if used, DNS records, DERP relay config) → onboard users/devices
(create users, pre-auth keys, connect clients, ACLs via the Headscale policy file) → operate
(monitor health, rotate pre-auth keys, backup DB/config, update Headscale AND client versions
together, review/rotate DERP config).

(confidence: HIGH for the bootstrap commands, MED for the
ops-lifecycle framing)

### 1.3 Users, preauth keys, and node lifecycle

**`preauthkeys create --user` — name vs numeric ID (supersession, not conflict).** Older
Headscale accepted a **username string**: `headscale preauthkeys create --user myorg --reusable
--expiration 24h`. **Current builds parse `--user` as an unsigned integer** (the user's row ID) and
reject a name with `invalid argument "<name>" for "-u, --user" flag: strconv.ParseUint`. Get the
numeric ID first:

```bash
headscale users list      # columns: ID | Name | Username | Email | Created — use the leftmost ID
headscale preauthkeys create --user <numeric-id> --expiration 1h --reusable --ephemeral --tags tag:ci-runner,tag:monitoring
```

The name-based bootstrap examples above **predate this CLI change** — treat every
`--user <name>` example as version-dependent and verify against `headscale users list` first.
(confidence: HIGH — corroborated by 2 independent sources describing the exact same
strconv.ParseUint error)

**Node lifecycle:**
- Tagged nodes belong to the special auto-created `tagged-devices` Headscale user.
- Delete a node: `headscale nodes delete -i <node-id>` (or `DELETE /api/v1/node/<node-id>`).
- **Default auth-key expiration is 1 hour** if `--expiration` isn't given.
- **Ephemeral nodes vanish entirely (no record) on disconnect** — don't rely on them for audit trail.
(confidence: HIGH)

**REST API fallback pattern** (for automation without the `headscale` CLI installed): env vars
`HEADSCALE_URL`, `HEADSCALE_API_KEY`; scripts try the CLI first (`nodes list --output json`, `nodes
tag -i <id> --tag <tag>`, `nodes approve -i <id>`, `preauthkeys create --tag tag:<t>`), falling back
to `curl "${HEADSCALE_URL}/api/v1/..." -H "Authorization: Bearer $HEADSCALE_API_KEY"` when the
binary isn't present. (confidence: HIGH)

### 1.4 macOS client join walkthrough (deep-link fallback + verification)

Full `tailscale up` flag set against a self-hosted Headscale on macOS:

```bash
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale up \
  --login-server=https://<headscale-host> --auth-key=<preauth-key> \
  --accept-routes --ssh --hostname=<this-host>
```

- `--login-server` selects Headscale over the public control plane (host must serve valid,
  reachable TLS).
- `--auth-key` is **spent on first successful contact even if the invocation appears to hang** —
  mint a fresh key if a retry is rejected as expired/consumed.
- `--ssh` enables the Tailscale SSH **server** (without it the host can dial out but not accept
  inbound Tailscale SSH).
- `--accept-routes` installs routes from other subnet routers — safe on a leaf client.
- `--hostname` overrides the OS hostname for mesh identity.
(confidence: HIGH)

**Deep-link fallback when the CLI can't reach the daemon but the daemon IS actually up** (blocked
local IPC handshake, e.g. a pending OS permission grant):

```bash
open "tailscale://changelogin?server=https://<headscale-host>"
```

This makes Tailscale.app itself switch coordination server and surface a "Sign in" prompt in the
menu bar — click it, browser opens `https://<headscale-host>/register/nodekey:<long-hex>`, and on
the Headscale host: `headscale nodes register --user <numeric-user-id> --key nodekey:<long-hex>`.
Browser then shows "success" and the menu-bar icon transitions to connected.
(confidence: HIGH — 2 independent sources)

**Post-join verification, including an inbound-reach check** (not just outbound):

```bash
tailscale status                            # 1. host + peers
tailscale ip -4                              # 2. tailnet IP assigned
tailscale ping -c 2 <peer-hostname>          # 3. outbound reach
route -n get 100.64.0.1 | grep interface     # 4. expect utunN, NOT the physical NIC
# 5. from ANOTHER peer:
tailscale ssh <this-hostname> hostname       # expect <this-hostname> echoed back
```

If step 5 fails but step 3 succeeds, `--ssh` was likely omitted at join time — re-run `tailscale up`
adding `--ssh`, or flip it live without a full re-join: `tailscale set --ssh=true`.
(confidence: HIGH)

**Logout / clean re-registration:**

```bash
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale logout   # returns to logged-out state, no uninstall
# to also let the same hostname re-register cleanly, delete the node server-side:
headscale nodes list                          # find the node ID
headscale nodes delete --identifier <node-id>
```
(confidence: HIGH)

**Live custom-control-server detection — don't trust the persisted UI setting.** A node can be
authenticated against a self-hosted Headscale (via CLI login or restored state) while the app's
*persisted* `Config.Tailscale.ControlServer` setting stays empty/stale. Correct pattern: read
`Prefs.ControlURL` **live** from `/localapi/v0/prefs` and compare against the well-known Tailscale
default (`https://controlplane.tailscale.com`); use that boolean (`IsCustomControlServer()`) to
decide `--https` vs `--http` for `serve`, and whether to hide Funnel in the UI (Funnel needs the
SaaS control plane — see 1.1). If the live prefs lookup fails because the daemon is still starting,
fail safe to the persisted flag rather than erroring. This is the root cause behind "why does serve
pick the wrong scheme" on a Headscale-joined node. (confidence: HIGH)

### 1.5 DERP relay (embedded vs standalone)

Headscale's `config.yaml` embeds a DERP relay server, **enabled by default**:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "headscale"
    region_name: "Headscale Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: "/var/lib/headscale/derp_server_private.key"
  urls: []              # external DERP map URLs
  paths: []              # local DERP map JSON files
  auto_update: true      # fetches Tailscale's default map
```

Suitable for tailnets under **~50 nodes**; under heavy relay traffic on the embedded server,
control-plane performance degrades. Deploy a **standalone** DERP via the official
`tailscale/derper` Docker image once you exceed that:

```bash
docker run -d --name=derper --restart=always -p 3478:3478/udp -p 443:443 \
  -v /etc/letsencrypt:/certs -v /var/lib/derper:/var/lib/derper \
  tailscale/derper --hostname=derp.example.com
```

**Gotcha:** both port `3478/UDP` (STUN) and `443/TCP` (DERP relay, TLS) must be reachable from
clients. DERP map changes take **up to 5 minutes** to propagate to clients (cached) — force a
refresh with `tailscale netcheck`. (confidence: HIGH)

### 1.6 Backup, restore, migration

A **complete** Headscale backup needs FIVE things: the SQLite DB (node state, users, routes,
pre-auth keys, API keys), `config.yaml`, `policy.json`/`policy.hujson` (the ACL, if present), the
TLS cert + key + node private key (under `/var/lib/headscale/`), and any customized DERP map file.

Safe **live** DB backup (WAL-mode aware): `sqlite3 "$DB_PATH" ".backup '<dest>'"` (SQLite's online
backup API) — **never `cp` the SQLite file while Headscale is running**, WAL-mode writes will
produce a corrupt copy. (confidence: HIGH)

**Gotcha:** API keys are stored **hashed** in the DB — restoring a DB backup does NOT recover the
original key secret; regenerate with `headscale apikeys create`. Pre-auth keys restore fine but may
already be expired by the time you restore.

**Restore/migrate requires an exact Headscale version match** between source and target — a
mismatch can cause schema-migration failures or data corruption. Check `headscale version` on BOTH
sides first.

- **Restore flow:** stop service → extract tarball → validate it contains `db.sqlite` AND
  `config.yaml` (else abort as invalid) → restore config/DB/policy/certs/DERP map → start service →
  verify with `headscale nodes list`.
- **Migration flow:** backup on source (or reuse an existing one) → `rsync -avz --progress
  <tarball> <target>:<path>` → restore on target (inline restore over SSH) → update DNS to point at
  the new server → verify clients reconnect.
- **Automated daily backup cron**: `0 2 * * * /path/to/hs-backup.sh --auto --output-dir
  /backups/headscale/`
(confidence: HIGH)

### 1.7 Skill/bundle structure note (context, not operational)

One source documents an umbrella skill — headscale is described there as an "open-source
Tailscale-control-plane-compatible server" — bundling 7 Headscale sub-skills auto-loaded by keyword
(`headscale-deploy`, `tailnet-policy`, `tailscale-client`, `headscale-node-lifecycle`,
`headscale-routing`, `headscale-derp`, `headscale-backup`), with `headscale-deploy` required first
(server must exist) before the rest. Env vars driving the sub-skills: `HEADSCALE_URL`,
`HEADSCALE_API_KEY` (minted via `headscale apikeys create`), `TAILSCALE_AUTHKEY`. Shared scripts
named but not documented in detail here: `headscale-health-check.sh` (probe
version/node-count/DB integrity), `headscale-backup.sh` (sqlite+config+policy+certs),
`headscale-restore.sh`, `tailscale-status-json.sh`, `test-all.sh`. Templates:
`docker-compose-headscale.yaml` (Headscale + embedded DERP + Traefik TLS), `headscale-config.yaml`,
`policy-allow-all.json`, `policy-deny-all.json`, `policy-tagged-segmented.json`, `derp-map.json`.
Compatibility requirements: bash, Python 3.8+, jq, curl, and access to a Headscale server or the
`headscale` CLI; the Tailscale client (`tailscale`) must be installed on target machines.
(confidence: MED — describes the bundle's own architecture, not deep operational
detail; the actual sub-skill SKILL.md files were not available for review)

### 1.8 Reloading Headscale policy after an edit

Headscale config declares the policy file path:

```yaml
# headscale config.yaml
policy: {path: /etc/headscale/policy.hujson}
```

Trigger a reload with SIGHUP rather than a full restart:

```bash
kill -HUP $(pgrep headscale)   # trigger reload
```

A companion script `reload-headscale-policy.sh [--dry-run] [--json]` operationalizes this: locates
the headscale PID via `pgrep -x headscale` → PID-file fallback (`/var/run/headscale/headscale.pid`,
`/run/headscale.pid`) → `ps aux | grep -E '[h]eadscale'` as a last resort (the bracket trick avoids
the lookup matching its own grep process — the general `pgrep`/`ps` self-match footgun); sends
SIGHUP; then verifies the process is STILL ALIVE 0.5s and 1s later, so a reload that crashes the
daemon is caught rather than silently missed; best-effort greps `journalctl -u headscale` for
reload/ACL/grant log lines to confirm the new policy actually took.

**Gotcha:** SIGHUP-based reload gives **no error signal** on an invalid policy file — validate the
policy with a dedicated validator script BEFORE sending SIGHUP, or a bad edit silently fails to
apply while the daemon keeps running on the old (or no) policy. (confidence: HIGH)

---

## PART 2 — Security hardening

### 2.1 Bind-address strategy — sources disagree; both postures shown

**Posture A — bind-to-Tailscale-IP-or-loopback (prevention by construction).** Hard rule from one
source: *"every listening port must bind to the Tailscale IP or `127.0.0.1` — never `0.0.0.0`"*,
specifically to prevent accidental LAN/public exposure.

```bash
tailscale status; ss -tlnp; ip addr show tailscale0     # snapshot BEFORE any change
TSIP=$(tailscale ip -4)                                  # bind config files to this at write time
# after any change — verify immediately, roll back if disconnected:
tailscale status; ss -tlnp
```

```nft
chain input {
  type filter hook input priority 0; policy drop;
  iif lo accept
  iif tailscale0 accept          # CRITICAL — never remove this
  ct state established,related accept
}
```

For a service that literally can't bind to a specific address (only `0.0.0.0` or `127.0.0.1`
available): bind to `127.0.0.1` and put a reverse proxy or `tailscale serve`/Funnel in front only if
external access is genuinely needed. This source treats Tailscale as the **sole** reach path for the
server: *"There is no public IP access, no fallback SSH. Losing Tailscale connectivity means losing
the server entirely."* Never restart `tailscaled`, networking, or `sshd` without explicit approval;
always verify connectivity right after any network change; if Tailscale shows disconnected after a
change, **roll back immediately** — denying the `tailscale0` interface in the firewall locks you out
with no fallback. (confidence: HIGH)

**Posture B — bind `0.0.0.0`, rely on tailnet-only routing (enforcement, not prevention).** A
documented real deployment binds a server to `0.0.0.0` but treats it as "only reachable via
Tailscale (no public exposure)" — the security boundary is the surrounding network/firewall path,
not the socket's bind address.

**Which is safer, and why:** Posture A prevents exposure **by construction** —
even a misconfigured firewall, a second NIC, or a container port-mapping cannot leak the service,
because the socket itself never listens on a routable-from-outside address. Posture B is
**enforcement in software** — it works as long as every other layer (firewall, network topology,
container port maps) stays correctly configured, and a single misconfiguration anywhere in that
chain reopens the exposure the bind address alone would have closed. **Neither source
reconciles the two; pick Posture A unless the runtime genuinely cannot bind a specific address.**
(confidence: this risk-comparison judgment is an analytical synthesis, not asserted directly by
either source)

**A concrete example of Posture A applied to a "expose one thing publicly" scenario:** narrow-path
Funnel mount + server-side metadata scrub. A `doc-preview` server's control routes (`GET
/_ctl/status`, `POST /_ctl/publish`, `POST /_ctl/unpublish`) are reachable **only** over the tailnet
`tailscale serve` origin; Funnel mounts only the narrow public path (`/p/<id>/` → `/_pub/<id>/`),
never `/_ctl` — so a public internet visitor 404s on the control surface regardless of what they
try. The public-facing handler additionally strips a header block (session label, date, original
file path) from the HTML byte-for-byte before serving it publicly — "not even in view-source" — and
validates the doc-id format (`^[0-9]{8}-[0-9]{6}-[0-9]+$`) before any filesystem lookup. This pattern
is stronger than relying on ACLs alone, since Funnel **bypasses tailnet ACLs entirely** for the
mounted path. (confidence: HIGH)

### 2.2 Shields-up mode — outbound-only, blocks all incoming

```bash
tailscale set --shields-up
```

The device can still **initiate** outbound connections to tailnet peers but cannot **receive**
inbound ones — a one-flag way to make a node outbound-only without touching the OS firewall.

**Gotcha:** shields-up does **NOT** affect Tailscale SSH initiated **from** the device, Taildrop
**sends**, or Serve/Funnel — those are handled by the `tailscaled` daemon directly, not gated by the
OS-firewall-equivalent shields-up rule. A shielded node can still serve/funnel outbound-initiated
shares even though it refuses unsolicited inbound connections. (confidence: HIGH)

### 2.3 Firewall interaction with Tailscale

**Stateful filtering vs tailnet ACLs are separate layers.** `--stateful-filtering` (default: on)
lets return traffic for established connections flow without an explicit reverse ACL rule. Traffic
**entering** the tailnet via a subnet router is still gated by tailnet ACLs; traffic **leaving**
toward the LAN subnet is filtered only by the subnet router's own OS firewall — Tailscale does not
manage that side. For exit-node egress filtering, apply `iptables` on the exit node itself, e.g.
`iptables -I FORWARD -s 100.64.0.0/10 -d 192.0.2.0/24 -j DROP`. Tailnet ACLs alone are **not** a
substitute for OS-level egress restriction on subnet/exit nodes. (confidence: HIGH)

**nftables `iifname` vs `iif` — a boot-ordering footgun.** For a provider with **no** upstream cloud
firewall (bare VPS, OVH-style), the admin-access rule for the Tailscale interface in a host nftables
ruleset **MUST** use `iifname "tailscale0" accept` — **not** `iif "tailscale0"`. `iif` resolves the
interface **index** at ruleset-load time; nftables loads at boot **before** `tailscaled` has created
`tailscale0`, so `iif "tailscale0"` fails to load at all ("Interface does not exist") and — depending
on the ruleset's default policy — **the entire firewall silently fails to load**, leaving the box
either fully open or locked out. `iifname` matches the interface **name** at packet-arrival
(runtime), so it tolerates the interface not existing yet at boot:

```nft
table inet filter {
  chain input {
    type filter hook input priority 0; policy drop;
    iif "lo" accept
    ct state invalid drop
    ct state established,related accept
    iifname "tailscale0" accept    # NAME match — NOT `iif`, which fails at boot
    tcp dport { 80, 443 } accept   # the only public-facing ports
    ip protocol icmp accept
    ip6 nexthdr ipv6-icmp accept
  }
  chain forward { type filter hook forward priority 0; policy drop; }
  chain output  { type filter hook output  priority 0; policy accept; }
}
```

**Mandatory verification:** validate persistence with a REAL reboot (not just `nft -f`/reload), then
`systemctl is-active nftables` must report `active`; separately confirm from OUTSIDE the box that
port 22 **times out** (`nc -zvw3 <public-ip> 22`).

**Compounding gotcha — Docker bypasses this entirely.** Docker inserts its own DNAT/FORWARD rules
evaluated **before** the host nftables/UFW `INPUT` chain, so a host firewall of any kind only
protects non-Docker-published ports. A `docker run -p 3000:3000 ...` can stay publicly reachable
even with the host firewall fully configured to deny incoming — it is **not** a substitute for
binding Docker-published services to `127.0.0.1`/the Tailscale IP instead of `0.0.0.0`.
(confidence: HIGH — corroborated by 2 independent sources on the same
Docker-bypass gotcha)

**UFW lockdown recipe — verify BEFORE enabling, never after.** Sequence: install Tailscale + join
tailnet → **verify SSH over the Tailscale IP works FIRST** (`ssh user@100.x.y.z`) → **then**:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw --force enable
sudo ufw status verbose   # expect: Anywhere on tailscale0  ALLOW IN  Anywhere
```

Confirm public-IP SSH now times out while Tailscale-IP/hostname SSH still succeeds. Outbound stays
fully open, so the box can still pull packages/upload/call APIs — only public-internet **incoming**
is blocked. Also check `/etc/default/ufw` has `IPV6=yes` — otherwise IPv6 traffic bypasses UFW
entirely. Confirming the Tailscale SSH path **before** locking down is critical; otherwise a lockout
is possible with no other access path. (confidence: HIGH)

**Containerized subnet router: iptables-vs-nftables backend mismatch.** Symptom: route advertised,
Tailscale overlay healthy, but LAN services still unreachable through the router. Root cause: the
container assumes iptables but the host kernel uses nftables (or vice versa). Fix: set container env
var `TS_DEBUG_FIREWALL_MODE=nftables` (or `iptables`, matching the host).
(confidence: HIGH — high-frequency root cause per source)

### 2.4 Least-privilege ACL / operational defaults

**Serve/Funnel discipline (dovetails with 2.1's Posture A).** One source's model for a
Tailscale-only-reachable service: bind the local server **only** to `127.0.0.1:<port>`, expose it
with `tailscale serve` — **never `tailscale funnel`, which is public**. Layer HTTP Basic auth on top
even though the service is tailnet-private; store any password only in the OS Keychain, never
printed/argv'd/committed. (confidence: HIGH)

**macOS Keychain pattern to avoid a password in argv/shell history:**

```bash
security add-generic-password -U -a "<account>" -s "<service>" -w   # -w LAST → prompts interactively
security find-generic-password -a "<account>" -s "<service>"        # verify existence without reading it
```
(confidence: HIGH)

**Security checklist before running ANY `tailscale serve` command (agent-facing):**
1. Is the user asking for **public** access? Yes → explain Funnel's risk, require explicit
   confirmation. No → use `serve` (tailnet-only).
2. What is being exposed? A dashboard with personal data → `serve` only, never public. Static HTML →
   `serve` is fine. A service with write access → extra caution + require auth.
3. Does the port already have a listener? Verify with `curl http://localhost:<port>` first, else the
   served path returns 502.
"Never default to funnel. Always start with serve." (confidence: HIGH)

**Explicit invocation gate before ANY sharing action.** A skill that will run `tailscale
up`/`serve`/`funnel` on a user's behalf gates itself: proceed only when the user explicitly asked for
remote-access sharing, OR asked for a shareable link/preview **and** a signal check
(`remotehost-gate.sh --requested-share`) exits 0. Only HIGH-confidence remote-session env-var
signals (`SSH_CONNECTION`/`SSH_CLIENT`/`SSH_TTY`, `CODESPACES=true`,
`GITPOD_WORKSPACE_ID`, `CODER_WORKSPACE_NAME`, `GOOGLE_CLOUD_WORKSTATIONS`, `CLOUD_SHELL`, etc.)
count as "strong". A bare container marker (`/.dockerenv`, a docker/kubepods/containerd/podman
cgroup) alone is classified **weak** and must NOT auto-proceed (exit code 10: "ask the user before
spinning up remotehost"). On gate failure: don't install Tailscale, don't run `up`/`serve`/`funnel` —
offer the normal local URL or ask one clarifying question instead. **Why:** the gate script cannot
read user intent or verify which physical device someone is holding; a weak signal alone must never
silently trigger exposing a local service. (confidence: HIGH)

**Default every ad-hoc Serve share to a 1-hour TTL with scheduled auto-cleanup.** `--ttl 1h` is the
default (`--ttl 30m`/`--ttl 2h` override; `--no-expire` is reserved for an explicit persistent-share
request). Expiry is enforced by a **separate scheduled process** (a detached `nohup sh -c "sleep
'$seconds'; ...serve --https=443 off...; funnel reset...; kill <pid>"`), not by Tailscale itself —
so if the parent process/session dies, the cleanup job still fires. A manual `off` subcommand
performs the same teardown immediately. (confidence: HIGH)

**Do-not-do defaults for a tailnet ops assistant/agent:**
- Don't modify sudo policy just to avoid a password prompt.
- Don't promote a user to admin/sudoers without explicit approval.
- Don't wipe/replace remote `~/.ssh` to "fix" a login issue.
- Don't change firewall/network settings before confirming the actual failure mode.
- Don't operate on an ambiguously matched device name — confirm which device when multiple labels
  match.
(confidence: HIGH)

**Read-only-by-default agent safety rules:**
- Read-only by default: `tailscale status`, `tailscale ping`, `tailscale netcheck`.
- **Forbidden without explicit request:** `tailscale down`, `tailscale logout`, ACL policy changes.
- Never expose auth keys (they grant network access outright).
- Exit-node changes route **all** traffic through that node — confirm intent first.
- Subnet-route advertisement affects routing for **all** peers, not just the advertiser.
(confidence: HIGH)

**SSH ACL `accept` vs `check` — context, not a contradiction.** `check` (re-auth + session
recording) is the safer **default** for interactive production access. `accept` suits a narrowly
scoped rule on an unattended CI/agent host. Disabling Tailscale SSH's check mode removes periodic
browser re-authentication; it does **not** remove tailnet identity or encryption — only use an
`accept` rule when source identity, destination device, AND destination user are all narrowly
restricted (one trusted identity/device → one worker → one non-root account, check mode off). Never
broaden the default `autogroup:member → autogroup:self → root` rule into `accept` just for
convenience. (confidence: HIGH)

**`tailscaled` restart — required vs last resort, same source, two situations.** Restarting
`tailscaled` is **required** when standing up a brand-new Service; it is **discouraged** as a
reflexive troubleshooting move against an already-working one. Ship the branching condition, not one
blanket rule.

### 2.5 Tailnet Lock (Network Lock)

Core commands: `tailscale lock init` (initializes the tailnet with signing keys) and `tailscale lock
add nodekey:xxxxx` (adds a trusted signing key). Once initialized, all new nodes require signing by
a trusted key before they can join the tailnet — this is the mechanism that prevents an unauthorized
node from joining even with a valid auth key. (confidence: HIGH)

**Not supported by Headscale** (per 1.1's feature-parity table) — Tailnet Lock is a
hosted-Tailscale-only feature.

**GA-date contradiction — flagged, not resolved.** One source dates Tailnet Lock's general
availability to June 2025 ("Tailnet Lock (GA, Jun 2025)"); another source's otherwise-detailed
security-features reference presents Tailnet Lock with no GA date at all, framing it as a
long-standing/mature feature, and its own recommendation table carries no version gate. Both could
be true simultaneously (Tailnet Lock may have existed in beta long before its June 2025 GA), so this
is not a hard conflict — but no source resolves it, so treat any
Tailnet-Lock-availability claim as `[unverified]` until checked against the current Tailscale
changelog. (confidence: LOW — dating claim unverifiable from the available sources)

### 2.6 Hardening playbooks (multi-phase / whole-VPS)

**6-phase VPS hardening order** (Tailscale positioned as the step that "closes the public SSH port"):
1. OS hardening + UFW baseline
2. SSH keys
3. Tailscale — `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`;
   `sudo ufw allow in on tailscale0`; **test the Tailscale SSH path BEFORE** running `sudo ufw delete
   allow ssh`
4. Docker/Traefik/Watchtower
5. Crowdsec
6. Backups — bind backup UIs (e.g. Duplicati) to `127.0.0.1` or the Tailscale IP, never a public
   port ("Docker bypasses UFW, so mapping `8200:8200` is dangerous" — see 2.3)

Explicit safety net: verify the VPS provider's web console/KVM access **before** removing the public
SSH allow rule, in case the Tailscale path itself fails. (confidence: HIGH)

**7-step VPS hardening stack** (near-identical, independently sourced): (1) SSH keys, disable
password auth, dedicated user + sudo; (2) Tailscale — install, ACLs, subnet routing; (3) firewall —
UFW deny-all + allow-needed + SSH rate-limit; (4) Fail2ban jails (SSH, HTTP, custom filters); (5)
unattended security-only updates with reboot management; (6) monitoring (node exporter + Grafana +
alerting); (7) backups (restic/borg, 3-2-1, off-site, **tested** restores). Explicit gotchas
(verbatim from the source, French original preserved alongside the English sense): a too-open
firewall widens the attack surface (*"Firewall trop ouvert → surface d'attaque élargie"*);
unattended updates **without** reboot leave patches unapplied (*"Mises à jour automatiques sans
reboot → failles non patchées"*); monitoring **without** alerting misses incidents (*"Monitoring
sans alertes → problèmes non détectés"*); an untested backup is no backup until the crash proves it.
(confidence: MED — prescriptive persona doc, internally consistent but not sourced from
official docs)

**Enterprise/org rollout sequence** (order matters): 1) IdP/SSO (Okta/Entra/Google Workspace) 2)
SCIM provisioning 3) device approval (admin review required for new devices) 4) tags+groups modeling
(groups = humans, tags = machines/services) 5) device posture baselines via `srcPosture` 6) MDM push
with pre-approved + tagged auth keys for silent enrollment 7) session recording for SSH audit 8)
Tailnet Lock for cryptographic node-addition signing. (confidence: MED — recommended
sequence, not a hard requirement)

**Deployment/rollout checklist template (5-step, corroborated MED confidence):** plan network
architecture (inventory, topology, subnet-route + exit-node placement) → configure IdP (SSO, MFA
enforcement, IdP-group↔Tailscale-group mapping, key expiry — recommended **90 days**) → deploy nodes
(critical infra first, then endpoints, subnet routers, exit nodes, MagicDNS) → configure ACLs
(deny-all baseline, groups matching org structure, tag-based policies, test in **audit mode** before
enforcement, document business justification) → validate and monitor (test connectivity, verify ACL
enforcement actually blocks, enable audit logging, configure alerts). A companion planning template
adds structured tables for: user groups (`group:engineering`/`sre`/`security`/`management`),
infrastructure tags (`tag:production`/`staging`/`development`/`database`/`monitoring`), subnet
routes, exit nodes, and a 10-item security checklist (IdP+MFA, 90-day key expiry, deny-all ACL
default, Network Lock, SSH re-auth for privileged users, audit logging, subnet-route approval
restriction, exit-node approval restriction, untagged-node policy, ephemeral keys for CI/CD).
(confidence: MED)

**Key-expiry recommendation vs platform default — flagged, not silently resolved.** The platform
admin-console default is **180 days**, stated with no explicit call to change it in one section of
the source; a companion workflow doc from the SAME source explicitly recommends tightening to
**90 days**, and the planning template repeats "recommended: 90 days". These are not strictly
contradictory — 180 is the platform default, 90 is this source's own hardening recommendation — but
a reader skimming only the top-level doc would miss that the source's own best practice halves the
platform default. Ship both numbers with that framing. (confidence: MED)

### 2.7 Detection, monitoring, and audit posture

**macOS security-audit VPN/tunnel-detection checklist** (part of a broader mac security-audit skill):

```bash
if [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  /Applications/Tailscale.app/Contents/MacOS/Tailscale status 2>/dev/null | head -15
elif have tailscale; then tailscale status 2>/dev/null | head -15
else echo "  (not installed)"; fi
pgrep -lf -i "openvpn|wireguard|wg-|autossh|ngrok|cloudflared|frpc|sshuttle|proton|surfshark|outline" | grep -v pgrep
ifconfig | awk '/^(utun|tun|tap|wg|ppp)[0-9]/{iface=$1} /inet /{if(iface){print iface, $2; iface=""}}'
pgrep -lf "ssh.*-R "     # detect reverse SSH tunnels (exfil/backdoor vector)
```

Checks the macOS `.app` bundle path directly (not just PATH `tailscale`, since Tailscale for Mac
ships as an app bundle), then separately scans for OTHER VPN/tunnel tools and any active
`utun`/`tun`/`tap`/`wg`/`ppp` interface with an assigned IP. (confidence: HIGH)

**`check_tailscale.sh` audit pattern — parse `tailscale status --json` for offline/missing
configured peers.** A JSON-emitting audit check runs `tailscale status --json` locally, or over SSH
for a remote target: `ssh -o BatchMode=yes -o ConnectTimeout=8 -p <port> user@host 'bash -lc
"tailscale status --json"'`. It parses the `.Peer` map, matching each expected `host` against a
peer's `HostName` OR a `DNSName` that starts with `<host>.`. Peers not found at all →
`findings: "Configured peers not found..."` (severity `medium`); found but `Online:false` →
`"Tailscale peers offline..."` (severity `high` — offline is worse than merely unlisted). A
non-zero exit from `tailscale status --json` itself (meaning `tailscaled` isn't
running/authenticated) → `status: error, severity: high`. Standard per-check JSON schema used
across this audit tool: `{"check": "tailscale", "status": "pass|warn|error", "severity":
"critical|high|medium|low|info", "findings": [...], "evidence": [...], "suggested_fixes": [...],
"meta": {"target": "local|remote"}}`. (confidence: HIGH)

**Security-audit role separation.** One multi-agent convention: a `security` role only **assesses**
posture (port exposure, Tailscale perimeter, UFW rules, DNS security — "Port 53 Tailscale-only
enforcement") and explicitly does **not** implement firewall rule changes — that's a separate
`infra` role's job. (confidence: MED — project-specific convention, generalizable as a
pattern)

**Generic WireGuard-transport C2 as a distinct detection signal — do not conflate with Tailscale
traffic.** Red-team/adversary-simulation material (Sliver C2 framework) uses WireGuard as one of
several generic C2 transports, typically on UDP port **51820** (Sliver's default — distinct from
Tailscale's default **41641**). "WireGuard UDP traffic on port 51820" and "tunneling utilities
(plink, socat, WireGuard)" appear as forensic/network-flow detection signals for covert C2. **None
of the source material mentions Tailscale by name.** Relevant only as a reminder: a defender's
"flag anomalous WireGuard/tunnel traffic" heuristic must be tuned to not false-positive on
legitimate Tailscale traffic (different default port, different handshake cadence) — the source
material itself draws no such distinction. (confidence: LOW — no Tailscale-specific content in the
source at all; connection to Tailscale hardening is inferential)

### 2.8 Compliance / standards framing (for audit narratives, not enforcement)

Tailscale's design maps to: **NIST SP 800-207 §3.2.2** (identity-aware proxying — section citation
unverified independently, treat as `[unverified]`); **NIST SP 800-77** (WireGuard framed as a
lower-complexity IPsec alternative; automated key distribution + NAT traversal; mesh topology
removes a single point of failure); **SOC 2** (encryption-in-transit + ACL-based authZ + audit
logging **for all connection events** + **key management via the coordination server**); **GDPR**
(data minimization — Tailscale routes traffic, does not inspect payload; E2E encryption; Headscale
as a data-sovereignty/self-hosting option; **configurable log retention per org policy**).
Specifically for the NIST mapping: identity-aware proxying satisfies the proxying model itself;
end-to-end encryption satisfies data-in-transit requirements; ACL-based access control implements
least-privilege access; and per-device WireGuard-key identity maps to device trust — four distinct
NIST 800-207 touchpoints bundled under the single §3.2.2 citation above.

Three-layer security mental model for audits: **identity** layer (OIDC/SSO via Okta/Azure
AD/Google Workspace/GitHub, MFA via IdP policy, key expiry forcing periodic re-auth), **network**
layer (default-deny ACL, per-connection authZ by identity+tags, no implicit trust by network
location, all traffic WireGuard-encrypted), **device** layer (unique WireGuard keypair per device,
device authorization required before network access, Tailnet Lock preventing unauthorized node
addition, ephemeral nodes for temporary workloads). Crypto primitives underneath: **ChaCha20**
(symmetric encryption), **Curve25519** (Diffie-Hellman key exchange), **Poly1305** (MAC),
**BLAKE2s** (hashing) — all inside the **Noise Protocol Framework**.
(confidence: HIGH for the crypto primitives — standard, publicly
documented; MED/LOW for the compliance-mapping talking points and the specific NIST section
citation, since these are the skill authors' own interpretation, not certified attestations)

**Border0 by Tailscale — next-gen PAM (beta), positioning vs `tsrecorder` (D5-style, not a
contradiction).** `tsrecorder` is the **current, generally-available** method for Tailscale SSH +
kubectl session recording. Border0 (beta) is a broader Privileged Access Management layer on top of
the same Tailscale identity + WireGuard stack: application-aware policy ("can this identity run this
SSH command / query this DB / use this K8s resource" — scoped to the application, not the whole
host), no shared/static credentials (Border0 holds upstream creds, users authenticate via Tailscale
identity re-checked per connection), JIT time-bound access, session auditing/recording covering
RDP/VNC/databases (beyond `tsrecorder`'s SSH/kubectl scope), and a no-install browser-or-client
access mode. Core concepts: **Connector** (a registered device that auto-joins the tailnet and
brokers access) and **Socket** (an app-aware proxy for one resource — the unit you grant/secure).
Enable per-tailnet via **Settings > Feature previews > Border0 by Tailscale (Beta)** (requires
Owner/Admin/IT-admin role); a separate portal (`portal.border0.com`) creates connectors/sockets.
Guidance: for SSH/kubectl recording **today**, use `tsrecorder`; for a **new** deployment needing
more than that, or PAM features (JIT, approvals, credential elimination), use Border0. They are
complementary, not one superseding the other. (confidence: MED — explicitly beta, setup
flow may change)

### 2.9 Reusable technique — opsec redaction filter for shareable diagnostic output

A `redact_filter()` perl one-liner masks private/CGNAT/link-local IPv4 (`10.x`, `172.16-31.x`,
`192.168.x`, the Tailscale CGNAT range `100.64-127.x` **except** the magic anchor `100.100.100.100`),
MAC addresses (both `:`/`-` separators), and `*.ts.net` tailnet hostnames (→ `REDACTED.ts.net`) —
while explicitly preserving `100.100.100.100` and public "diagnostic landmark" IPs (`1.1.1.1`,
`8.8.8.8`) as **not** secrets. **Gotcha:** regex order matters — `100.100.100.100` is first swapped
to a placeholder token (`__TS_MAGIC__`) **before** the general CGNAT mask runs (since
`100.100.100.100` itself falls inside `100.64.0.0/10`), then restored at the end. Lets a diagnostic
script's output be safely pasted into a support ticket or an LLM chat without leaking the caller's
actual tailnet name, MAC addresses, or internal LAN topology, while keeping the information that's
actually load-bearing for diagnosis (which nameserver, which CGNAT range) intact.
(confidence: HIGH)

### 2.10 Reusable technique — never exclude the Tailscale CGNAT range from TUN routing

Universal fix for stacking Tailscale under ANY separate TUN-based proxy tool (Shadowrocket,
Clash/ClashX, Surge — corroborated identically across all three): add both
`IP-CIDR,100.64.0.0/10,DIRECT` and `IP-CIDR,fd7a:115c:a1e0::/48,DIRECT` to the tool's rule set, and
add `100.64.0.0/10` to its `skip-proxy` list (bypasses only the HTTP-proxy layer — traffic still
flows through the TUN correctly). **Never** add `100.64.0.0/10` to a `tun-excluded-routes`-style
setting — that removes the CIDR from TUN routing entirely and creates a competing system route on
the physical interface that overrides Tailscale's own routing. (confidence: HIGH)

For the deeper case of Tailscale running **under** a full-tunnel WireGuard client (not just a
TUN proxy tool), see the fwmark/ip-rule stacking fix in `## GAPS` below — it is high-value but
belongs structurally with routing internals, not this hardening file; cross-reference it if writing
the networking-internals reference.

### 2.11 Remote-access architecture decision table (where Tailscale fits among alternatives)

Governing heuristic: pick the **lightest** tool whose blast radius you can tolerate — push auth into
an IdP, reachability into a mesh; reserve heavy access-management planes for genuine audit/compliance
needs.

| Situation | Recommended stack |
|---|---|
| Solo dev, 1-3 machines | Keyed OpenSSH (ed25519) + Tailscale as transport |
| Personal box, strongest credential wanted | + FIDO2 `ed25519-sk` |
| Roaming/flaky links | Tailscale + keyed SSH + mosh + tmux |
| Small team, all Linux/macOS, no compliance burden | Tailscale SSH (keyless, ACL-driven) |
| Self-managed fleet, keep stock OpenSSH, kill key sprawl | SSH certificates via step-ca/Vault |
| Mid/large, regulated, needs audit + session replay | Teleport (or Cloudflare Access if already on Cloudflare) |
| AWS-only fleet | AWS SSM Session Manager (no SSH content-logging on tunneled sessions) |
| Editor-driven remote dev (VS Code/JetBrains) | Stock OpenSSH over a mesh (IDEs are tested against real OpenSSH) |
| Must expose public `sshd` at all | `PasswordAuthentication no` + `AuthenticationMethods publickey` + patch religiously + `PerSourcePenalties` |

(confidence: HIGH)

**Hardened keyed-OpenSSH drop-in** (complements, doesn't replace, Tailscale's own identity layer):

```
# /etc/ssh/sshd_config.d/10-hardening.conf
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
PubkeyAuthentication yes
PermitRootLogin no
X11Forwarding no
AllowAgentForwarding no
LoginGraceTime 20
MaxAuthTries 3
MaxSessions 4
```

Apply with `sudo sshd -t && sudo systemctl reload ssh` — **validate before reload**, and keep a
second session open in case of lockout. Rationale: subtract weak algorithms rather than paste a
giant allow-list; modern OpenSSH crypto defaults are already good, and pubkey-only auth collapses the
brute-force economy. **Gotcha:** the real hardening lever is **patching** — no `sshd_config` setting
stops a pre-auth vulnerability (e.g. regreSSHion); automate `unattended-upgrades` even behind a mesh.
(confidence: HIGH)

### 2.12 What NOT to expose, even via a tunnel (Tailscale or otherwise)

A tunnel (Tailscale Funnel, Cloudflare Tunnel, ngrok, etc.) makes a service **reachable**, not
**secure** — weak credentials, missing MFA, or unpatched software remain exploitable regardless of
the tunnel. Categories flagged as unsuitable for exposure via any public tunnel, recommending a real
VPN/mesh (Tailscale/WireGuard) instead: admin panels (router/hypervisor/NAS UIs), password managers
(Vaultwarden and similar), LAN-only tools assuming a trusted network (IoT hubs, printer dashboards),
sensitive-data portals (private document/database systems). (confidence: HIGH — corroborated
independently in a general, non-Tailscale-specific reverse-proxy skill; the "not
secure" framing is a direct, load-bearing quote from two independent skill docs)

Cloudflare Tunnel (`cloudflared`) contrast case: creates **outbound-only** encrypted connections
from the origin to Cloudflare's edge — no inbound ports needed anywhere (`Internet → Cloudflare Edge
(CDN/WAF/DDoS/Access) → cloudflared → origin`). Gotchas specific to it: streaming media
(Jellyfin/Plex) through a CDN-fronted tunnel can violate the media platform's ToS if edge caching is
enabled (disable caching for media subdomains); non-HTTP protocols (SSH, databases) proxied through
it can behave unexpectedly — use a real VPN (Tailscale/WireGuard) for non-web protocols instead.
(confidence: MED — architecture description is standard/HIGH, the cited version pin is
single-source and unverifiable from the available sources)

---

## PART 3 — Taildrop and file-sharing exposure

### 3.1 Core CLI (send / receive)

```bash
tailscale file cp <file> [<file>...] <target>:      # colon after hostname REQUIRED
tailscale file cp document.pdf laptop:
tailscale file cp *.jpg phone:/photos
tailscale file get [--conflict=skip|overwrite|rename] [--loop] [--wait] <dest-dir>
tailscale file get .                                 # retrieve to cwd
tailscale file get ~/Downloads                        # retrieve to an explicit dir
```

No directory support in `file cp` — tar/zip first. Default conflict behavior renames with a numeric
suffix (`file (1).pdf`). `--loop` blocks and processes files continuously as they arrive (pair with
a process supervisor/`nohup`); `--wait` blocks until exactly one file arrives (single-shot). macOS/iOS
integrate with the system Share Sheet; Linux/Windows are CLI-only. **Gotcha:** `tailscale file get`
**moves** files out of the inbox — the inbox empties as files are retrieved, so a second `get` after
a successful one returns nothing. (confidence: HIGH)

Setup requirement (admin console): enable **Settings > General > Send Files**; macOS additionally
needs **System Settings > General > Login Items & Extensions > Sharing** (check Tailscale).
macOS/Windows: right-click a file → "Send with Tailscale". iOS/Android: native Share menu →
Tailscale. (confidence: HIGH)

**Scope limits (HIGH confidence):** Taildrop only sends between a single person's **own**
devices — you cannot send to another user's device even on the same tailnet; cannot use it with
TAGGED devices; both endpoints must be running Tailscale; transfer resume is **not** supported on
macOS/iOS as a receiver.

### 3.2 Linux operator requirement and non-auto-save behavior

Unlike macOS/Windows, **Linux Tailscale does not auto-save Taildrop files** — the inbox must be
drained manually or via `--loop`. A companion wrapper script operationalizes this pattern:

```bash
~/clawd/skills/taildrop/scripts/taildrop-get.sh                 # default: ~/Downloads, skip dup
~/clawd/skills/taildrop/scripts/taildrop-get.sh /path/to/dir     # explicit destination
~/clawd/skills/taildrop/scripts/taildrop-get.sh --overwrite      # overwrite on conflict
~/clawd/skills/taildrop/scripts/taildrop-get.sh --rename         # rename on conflict
```

Under the hood:

```bash
sudo tailscale set --operator=$USER    # run ONCE — else every retrieval needs sudo
tailscale file get --conflict=skip|overwrite|rename [--loop] "$TARGET_DIR"
```

**Gotcha:** without being set as the tailscale operator, `tailscale file get --help` still runs, but
the actual retrieval needs `sudo` on every single invocation. (confidence: HIGH)

### 3.3 Reliability failure modes (production-grade gotchas)

**Silent cron failure via stderr suppression, compounding a stale-port bug.** A launchd cron script
invoking `tailscale file cp ... 2>/dev/null` suppresses stderr entirely, so the failure is silent;
downstream consumers of the pushed file continue using the last successfully-pushed value for
hours/days, causing silent misattribution/staleness. Fix — surface stderr instead of discarding it:

```bash
err=$(echo "$result" | tailscale file cp - target-host: 2>&1 >/dev/null)
if [ $? -eq 0 ]; then log "Pushed"; else log "WARN: Failed to push: $err"; fi
```

**Gotcha:** `tailscale file cp` can **hang indefinitely** (rather than fail fast) when the LocalAPI
is unreachable in some versions — a cron firing every ~30s for hours can leave many stuck processes;
clean up with `pkill -f 'tailscale file cp'`. (confidence: HIGH)

**Receiver-side straggler/collision jam.** `tailscale file get` **refuses to overwrite** existing
files in the destination dir. If a receiver doesn't fully drain `RECV_DIR` on every invocation,
stragglers pile up (`stdin (1).txt`, `stdin (2).txt`, …) and eventually collide with new arrivals.
Downstream effect chain: the pusher's `tailscale file cp` starts returning `500 Internal Server
Error: too many retries trying to rename ".../stdin.txt.<random>.partial" to "stdin.txt"`; the
receiver's `tailscale file get` returns **success** without actually delivering anything;
downstream consumers silently keep acting on **stale** data. **Compounded** by Tailscale 1.56+
renaming stdin pushes from `stdin` → `stdin.txt`, which breaks legacy `if [ -f stdin ]` receiver
checks. The whole pipeline fails silently — no LaunchAgent/systemd failure, exit code 0; only
downstream staleness eventually reveals it. (confidence: HIGH — reproduced with logs)

**Fix pattern — drain to newest, both before AND after `get`:**

```bash
process_queue() {
  shopt -s nullglob
  local files=("${RECV_DIR}"/*)
  shopt -u nullglob
  [ "${#files[@]}" -gt 0 ] || return 1
  local newest="" f
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest="$f"; fi
  done
  [ -n "$newest" ] || return 1
  mv -f "$newest" "${STATE_DIR}/<canonical-name>.json"
  for f in "${files[@]}"; do [ -f "$f" ] && rm -f "$f"; done
}
process_queue || true   # recover a prior crash's leftover file, BEFORE the next get
if ! output=$(tailscale file get --wait "$RECV_DIR/" 2>&1); then
  sleep 30; exit 1
fi
process_queue || log "WARN: tailscale file get returned but queue is empty"
```

Run the drain function BOTH before `tailscale file get --wait` (recovers a prior crash's leftover
file) AND after (handles the new arrival); unconditionally delete every non-newest straggler.
**Gotcha:** capture CLI stdout/stderr and add a retry delay — piping raw output straight into a
plist-managed log can turn one collision into a tight KeepAlive restart loop generating tens of MB of
duplicate log lines. (confidence: HIGH)

**This failure shape generalizes** beyond Taildrop to any producer that can't overwrite-on-rename:
SCP with conflict-on-rename, S3 `PUT`-if-not-exists — same fix applies (drain to newest, discard the
rest). (confidence: MED)

`tailscale file get --wait ~/Downloads` blocks until a file arrives (added in the Tailscale 1.56
release, per the source's own citation — release-note citation not independently re-verified here,
but consistent across 2 sources). (confidence: MED)

### 3.4 Tailscale Drive / Taildrive — persistent WebDAV/SMB share, NO per-share ACL

`tailscale drive share <name> <path>`, `list`, `rename <old> <new>`, `unshare <name>`. Client access:
`smb://<hostname>.<tailnet>.ts.net/<share-name>` — macOS Finder "Connect to Server", Windows "Map
Network Drive" (`\\<hostname>...\<share>`), Linux via `cifs` mount or an SMB-aware file manager.
Alpha since v1.64.0+, WebDAV under the hood; Linux mounts the WebDAV share at
`100.100.100.100:8080`. Shared path is globally unique: `/<tailnet>/<machine>/<share>` (e.g.
`/example.com/nas-device/docs`). **Gotcha — no per-share access control**: every tailnet member who
can reach the sharing device (per tailnet ACL) can access **all** Drive shares on that device.
Restrict access at the **ACL level** (who can reach the device at all), not per-share — there is no
finer-grained knob. Server component (the sharing side) is available on Linux/macOS/Windows/Synology
only — iOS/Android are **access-only**, they cannot host shares. Cannot be used with
shared/cross-tailnet devices. (confidence: HIGH)

Policy-file gating (needed to enable Drive at all):

```json
{"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["drive:share", "drive:access"]}]}
```

Grant permissions:

```json
{"grants": [{"src": ["group:engineering"], "dst": ["tag:nas"],
  "app": {"tailscale.com/cap/drive": [{"shares": ["*"], "access": "rw"}]}}]}
```

`access` is `"rw"` or `"ro"`; can restrict to specific share names instead of `"*"`.
(confidence: HIGH)

---

## PART 4 — Miscellaneous relevant context

Included only where it bears on network/security posture or self-hosting; low-value / purely
descriptive marketing copy is excluded here and listed in `## GAPS`.

**Reverse-proxy selection alongside Tailscale (Caddy/Nginx/Traefik/HAProxy).** Caddy: auto-HTTPS via
ACME, simplest config, experimental L4; can integrate with Tailscale's own certificate module
directly for internal services needing browser-valid certs. Nginx: highest static-file/traffic
throughput, manual/certbot TLS, `stream` module for L4. Traefik: Docker/K8s-native dynamic backends,
auto-ACME, native TCP/UDP. HAProxy: pure L4/L7 load balancing, manual TLS. WebSocket proxying: Caddy
handles the `Upgrade` header transparently via `reverse_proxy`; Nginx needs explicit
`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
proxy_read_timeout 86400;` (long read-timeout to keep the socket alive). (confidence: HIGH)

**Remote desktop over the tailnet (RDP/VNC/RustDesk) — no port-forwarding, no public exposure.**
Point the client at the target's MagicDNS hostname or `100.x` IP; it's a plain TCP connection over
the tailnet. RDP (Windows) needs Pro/Enterprise/Education/Server edition with RDP enabled; clients:
built-in Remote Desktop Connection, the cross-platform Windows App, Remmina/GNOME Connections
(Linux); port 3389 is never publicly exposed since it rides the encrypted tailnet; disable key
expiry on always-on RDP targets. RustDesk normally needs a relay/ID server — unnecessary over
Tailscale (direct P2P); enable "Direct IP access" under Security, set a permanent password for
headless targets, connect to the target's Tailscale IP/MagicDNS name. VNC follows the same pattern.
Restrict via tailnet policy (e.g. allow only specific users/groups to reach `tcp:3389` on the target
tag). (confidence: HIGH)

**Aperture — Tailscale's own AI-gateway product (beta).** A centralized proxy between LLM clients
(coding agents, apps, scripts) and upstream model providers, using Tailscale identity per connection
instead of separate API keys — relevant here only as a "does this project need its own secrets
broker" data point, not core Tailscale networking. Deny-by-default; grant shapes for
`tailscale.com/cap/aperture` differ subtly between Aperture's own config (no `dst` needed) and the
tailnet policy file (`dst` REQUIRED) — not interchangeable as written, a documented common config
error. Spend-limiting via a token-bucket quota (`{"daily:<user>": {"capacity": "$10.00", "rate":
"$5.00/day", "on_exceed": "reject"}}`, HTTP 429 on exceed). (confidence: MED — explicitly
beta, docs drift fast)

---

## GAPS

Excluded from the body above (out of scope for this file, or too low-value to include as body
content), listed here rather than invented into the text:

- **It is not documented what Headscale actually does when its `policy.hujson` contains
  an unsupported SaaS-only key** (parse error vs silent ignore) — see 1.1. This is the single
  most consequential open question for anyone porting a Tailscale-SaaS ACL to Headscale; verify
  against a live Headscale instance before relying on either assumption.
- **Basic/marketing-level Tailscale concept summaries** (tailnet/WireGuard/MagicDNS/CGNAT
  vocabulary, generic ACL/DNS/exit-node restatements, a "networking category index" skill listing
  `tailscale-vpn` as one of 20 leaf skills, a near-content-free `tailscaled` CLI stub whose
  `<resource> <action>` syntax does not match the real daemon) add no operational value beyond
  what's already covered elsewhere in this skill's reference set — omitted here to keep this file
  dense.
- **`tailscale up`/`down`/`login`/`logout`/`set`/`switch` semantics** belong in the CLI-fundamentals
  reference of this skill, not this hardening/Headscale file — not duplicated here.
- **The fwmark/ip-rule stacking fix for Tailscale running under a full-tunnel WireGuard client**
  (two independent leak modes, exact `ip rule` priorities, `wg0.conf` `PostUp`/`PreDown` fixes, and
  a tcpdump-negative-proof verification recipe) is extremely high-value but is a **routing
  internals** topic, not hardening or Headscale — it belongs in a networking/routing reference file
  if one exists in this skill; only cross-referenced here (2.10) rather than duplicated in full.
- **Deployment-planning templates and enterprise rollout checklists** are summarized in 2.6 but
  their full fill-in-the-blank table structure (group/tag/route/exit-node tables) is not reproduced
  verbatim — reference the original sources if a literal template is needed.
- **A self-hosted Headscale intro from a marketing-flavored skill** (`tailscale
  up --login-server=https://headscale.yourdomain.com` plus generic framing) adds nothing beyond
  what 1.2/1.8's fuller bootstrap coverage already documents — treated as a duplicate rather than
  given its own body text; see `## COVERAGE`.
- **The WireGuard crypto-primitives list from one source is byte-identical in substance to
  another's**, already folded into 2.8 — not given separate body text.
