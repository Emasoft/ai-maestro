# SSH and agent access over a tailnet

Covers SSH access, agent integration, troubleshooting, MagicDNS, device management, security
hardening, firewall configuration, and systemd integration for SSH over a tailnet. Related material
on general remote access lives in the troubleshooting reference. Contradictions are resolved by
CONTEXT, never silently, and shown side by side — see §2 for the flagship example (`accept` vs
`check`), and §9 for the inventory-freshness nuance.

`[unverified]` marks a single-source or low-confidence claim. Version-gated behaviour names
the version.

## 1. What Tailscale SSH is, and how it differs from OpenSSH-over-tailnet

Two distinct access modes exist on the same tailnet; know which one a given fix applies to.

- **Tailscale SSH** (`tailscale up --ssh` / `tailscale set --ssh`): the daemon intercepts port 22
  ABOVE the kernel network stack, authenticates via tailnet identity (no SSH keys to distribute),
  tunnels the session inside WireGuard. Client: `tailscale ssh [user@]<hostname>` (syntactic sugar)
  or plain `ssh user@machine-name`/`ssh user@100.x.x.x` once MagicDNS/ACL resolve it — both work
  identically once `--ssh` is enabled. `/etc/ssh/sshd_config` and `authorized_keys` are
  left UNTOUCHED; regular non-Tailscale SSH continues to work side-by-side. Private SSH host keys stay local; public host keys distribute via the
  control plane; node keys handle auth/encryption. Revocation is an ACL policy edit — takes effect
  within seconds and terminates existing sessions, no manual key purge (contrast: traditional
  `authorized_keys` management). If a host key is suspected compromised, uninstall+reinstall
  Tailscale to rotate.
- **Platform support (HIGH, consistent across sources):** SSH **server** = Linux + macOS
  **open-source/Standalone** build ONLY (v1.24+). Windows is client-only (cannot run the
  SSH server); iOS/Android are client-only. macOS SSH server support requires the
  open-source CLI variant specifically — the App Store/GUI build does not support it. The **macOS App Store / TestFlight build lacks `tailscale ssh`
  entirely** (sandboxing) — must uninstall it and install the Standalone build from
  `pkgs.tailscale.com/stable/#macos`; the CLI binary then lives inside the app bundle and needs a
  shell alias.
- **Userspace port 2222 (since Tailscale 1.32+):** `tailscale set --ssh=true` runs its SSH server
  in USERSPACE on port **2222** on Linux, separate from the system `sshd` on port 22. Relevant for
  CI (GitHub Actions OIDC ephemeral identity): use 2222 so the OIDC-derived identity authorizes the
  session. A systemd socket override is needed to bind 2222 to the Tailscale IP
  specifically:
  ```
  [Socket]
  ListenStream=
  ListenStream=0.0.0.0:22
  ListenStream=[::]:22
  ListenStream=$TAILSCALE_IP:2222
  FreeBind=yes
  ```
  `authorized_keys` entries can carry `command=` restrictions for deploy-only least-privilege
  (`command="cd /opt/{project} && docker compose pull && ...",no-agent-forwarding,no-port-forwarding,no-user-rc,no-X11-forwarding ssh-ed25519 ...`)
  vs. a key with no `command=` prefix for a real interactive shell.
- **Reference architecture — SSH-only, zero public :22 (production, most complete end-to-end
  example)**: lock the VPS to NO public port
  22 ever — SSH reachable only via `tailscale up --ssh` (outbound WireGuard, invisible to inbound
  firewalls).
  ```jsonc
  {"tagOwners": {"tag:ci": ["autogroup:admin"], "tag:prod": ["autogroup:admin"]},
   "acls": [{"action":"accept","src":["autogroup:admin"],"dst":["*:*"]},
            {"action":"accept","src":["tag:ci"],"dst":["tag:prod:22"]}],
   "ssh": [{"action":"accept","src":["autogroup:admin","tag:ci"],"dst":["tag:prod"],"users":["deploy"]}]}
  ```
  **Named footgun:** omitting the `autogroup:admin` SSH rule means ONLY `tag:ci` can reach the VPS —
  the human operator's own `ssh deploy@<host>` gets refused, because `autogroup:admin` is what
  grants the human's interactive access alongside CI's tag-scoped access. On the VPS:
  `tailscale up --ssh --hostname=<name> --auth-key=<TS_AUTH_KEY, reusable=false ephemeral=false tags=tag:prod>`.
  A DB migration step can tunnel THROUGH the same Tailscale-SSH session rather than exposing
  Postgres — Postgres bound to `127.0.0.1:5432` on the VPS, reachable for migration only via the
  SSH session, never on the tailnet or public internet at all.

### NixOS: declarative Tailscale config + interface-trust firewall model

Non-English source (Korean), single-host personal dotfiles config, confidence MED.

```nix
services.tailscale = {
  enable = true;
  useRoutingFeatures = "server";  # subnet router only
};
networking.firewall = {
  enable = true;
  trustedInterfaces = [ "tailscale0" ];
  allowedUDPPorts = [ config.services.tailscale.port ];
};
```

The macOS side of the same fleet is **NOT** declaratively managed by this repo's Nix config — just
`tailscale status` / `tailscale ip -4` via the app/CLI to confirm login. `mosh` sessions are routed
exclusively over the Tailscale IP (never LAN), e.g.
`mosh greenhead@<minipc Tailscale IP> -- tmux attach -t main` (cross-reference §6's mosh
characteristics). **Gotcha, explicitly called out in the source:** "per-interface `allowedTCPPorts`
rules are NOT used" — the firewall model here is **interface-trust** (trust the whole `tailscale0`
interface), not a port-allowlist, for Tailscale traffic. Contrast with §8's UFW recipe, which is
also interface-trust but imperative rather than declarative.

### Bidirectional SSH host aliases pinned to Tailscale IPs, plus mosh for unstable networks

Pattern for bidirectional SSH across a small fleet of machines that are only reachable via
their Tailscale IPs: define SSH config `Host` aliases whose `HostName` is the machine's
Tailscale IP (kept as a single-source-of-truth constant elsewhere in the config, rather than
hardcoded per host block), so day-to-day usage is just the alias:

```bash
# machine A -> machine B
ssh minipc
# or, spelling it out
ssh greenhead@<minipc-tailscale-ip>

# machine B -> machine A
ssh mac
# or
ssh greenhead@<macbook-tailscale-ip>

# over an unstable network, use mosh (which tolerates roaming/drops far better than raw SSH,
# see §6) instead of a bare shell, mosh straight into a persistent tmux session
mosh greenhead@<minipc-tailscale-ip> -- tmux attach -t main
```

Bidirectional summary:

| Direction | Command | Declarative config owning it |
|---|---|---|
| A -> B | `ssh minipc` | e.g. a Darwin/macOS SSH client module |
| B -> A | `ssh mac` | e.g. a NixOS SSH client module |

Design point: because the `HostName` in each `Host` block resolves to a Tailscale IP, none of
these aliases work off the Tailscale network — this is an implicit way of scoping SSH access to
tailnet members only, without any additional per-host firewall rule, PROVIDED the SSH daemon
itself is not also listening on a publicly-reachable interface.

### Talos Linux: Tailscale as an OS-level system extension, not a user-space daemon

Talos has no shell and no SSH, so Tailscale cannot be `tailscale up`'d manually. It
runs via the `siderolabs/tailscale` extension, built through Talos Factory (`factory.talos.dev`),
and is configured entirely via `ExtensionServiceConfig` environment variables — no interactive CLI
invocation exists on this platform at all.

## 2. SSH ACL rules — the `accept` vs `check` decision

**Not a disagreement — resolved by CONTEXT.** Ship BOTH postures with the condition that selects each:

```hujson
{"ssh": [
  {"action":"check","src":["group:ops"],"dst":["tag:prod"],"users":["root","*"],"checkPeriod":"12h"},
  {"action":"accept","src":["group:dev"],"dst":["tag:staging"],"users":["autogroup:nonroot"]},
  {"action":"deny","src":["*"],"dst":["*"],"users":["*"]}
]}
```

The same structure, minimally, also appears independently as:

```json
"ssh": [
  {"action": "check", "src": ["group:ops"], "dst": ["tag:server"], "users": ["root"]},
  {"action": "accept", "src": ["autogroup:member"], "dst": ["autogroup:self"], "users": ["autogroup:nonroot"]}
]
```
Three actions exist: `accept`, `check` (require re-auth, gated by `checkPeriod`,
**default 12h**), and `deny`.

- **`action: "accept"`** — immediate, no re-auth. Correct for: an **unattended CI/agent host** with
  a **narrowly-scoped** rule (one trusted identity/device → one worker → one non-root account);
  non-interactive automation (breaks entirely under `check`, which forces a browser re-auth on
  every connection). Do NOT broaden an `autogroup:member → autogroup:self → root` rule to
  `accept` — keep the narrow scoping that makes `accept` safe.
- **`action: "check"`** — forces SSO re-auth (default `checkPeriod` 12h, e.g. `"8h"` for tighter
  windows), the safer default for **interactive production access** needing re-auth and session
  recording. Treats `accept` as a risk: "grants a shell with no re-auth or session recording."
  The equivalent CLI-level trigger is `tailscale up --ssh --check-mode`, which forces IdP
  re-authentication before connecting and then grants a further ~12h window before re-auth is
  required again. An ACL gate on the accept side commonly looks like:
  ```json
  {"acls":[{"action":"accept","src":["group:developers"],"dst":["group:production:22"]}]}
  ```
- Also expressible via **Grants**' `app` field: `"tailscale.com/cap/ssh": [{"action":"accept","users":["*"]}]`
  — some examples show BOTH the `ssh:` top-level block AND a matching grant being needed together;
  verify against current admin-console UI before assuming one alone suffices `[unverified]`.
- **Session recording:** add `"recorder": ["tag:recorder"], "enforceRecorder": true` to an `ssh:`
  rule — `enforceRecorder: true` DENIES the session outright if the recorder node is unreachable
  (fail-closed); **the platform DEFAULT is fail-open** (session proceeds unrecorded if the recorder
  is unreachable, unless `enforceRecorder` is explicitly set). Multiple recorders sharing one tag
  auto-failover (lowest tailnet IP first).

## 3. Session recording — `tsrecorder`

Records Tailscale SSH sessions (stdout/stderr) and Kubernetes `kubectl exec`/`attach`/`debug`/`run`
sessions (+ optionally all K8s API requests) to a `tsrecorder` node. Output format: asciinema
`.cast` (newline-delimited JSON, grep-able/replayable). **stdin/keystrokes are NOT captured**
(typed passwords are not recorded); output IS captured.

- `tsrecorder` joins the tailnet like any device (Docker container or K8s `Recorder` CR). The SSH
  server / K8s operator STREAM session data over WireGuard to it. Writes to local disk or an
  S3-compatible store (S3, MinIO, GCS, Wasabi, R2).
- Wired by POLICY, not per-host config: SSH → `recorder` field on an `ssh` access rule; K8s →
  `tailscale.com/cap/kubernetes` grant pointing at the recorder tag.
- Deploy (Docker, S3 backend):
  ```bash
  docker run --name tsrecorder --rm -it \
    -e TS_AUTHKEY=$TS_AUTHKEY -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
    -v $HOME/tsrecorder:/data tailscale/tsrecorder:stable \
    /tsrecorder --dst='s3://s3.us-east-2.amazonaws.com' --bucket=$S3_BUCKET_NAME --statedir=/data/state --ui
  ```
  Drop the AWS vars + use `--dst=/data/recordings` for local storage; `--ui` = web viewer (needs
  HTTPS on tailnet); on EC2 with an IAM role attached, omit access/secret keys.
- **Border0 by Tailscale (PAM, beta) — positioning, not a conflict:** `tsrecorder` is "the current,
  generally-available method" for SSH + kubectl recording. Border0 additionally records
  RDP/VNC/databases with command/query-level visibility as part of a broader PAM platform (JIT
  access, no shared/static creds, application-aware policy scoped to "can this person run this SSH
  command", browser-or-client no-install access). Guidance: SSH/kubectl recording TODAY →
  `tsrecorder`; a new deployment needing more than SSH/kubectl or PAM features (JIT, approvals,
  credential elimination) → Border0. Enable per-tailnet via Settings > Feature previews (Beta,
  requires Owner/Admin/IT-admin role); gated availability (waitlist/Sales at time of authoring).

## 4. Platform gotchas — install variant and OS-specific failure modes

### macOS: App Store vs Standalone build

The **App Store / TestFlight** macOS build lacks `tailscale ssh` entirely (sandboxing restriction)
— confirmed independently by 3+ sources. Fix: uninstall the App Store version,
install the **Standalone** build from `pkgs.tailscale.com/stable/#macos`. The CLI binary then lives
inside the app bundle and needs a shell alias to be reachable from a terminal.

### WSL: THREE distinct root causes for superficially similar SSH failures — do not conflate them

1. **ACL `"action":"check"` blocking non-interactive SSH** — connects but returns
   `operation not permitted`; the rule forces per-connection browser re-auth. Fix: `"action":"accept"`
   for automation use-cases (see §2).
2. **snap-installed Tailscale sandbox failure** — SSH connects, ACL passes, but fails with
   `be-child ssh` exit code 1. Diagnose: `sudo journalctl -u snap.tailscale.tailscaled -n 30
   --no-pager` (snap) or `sudo journalctl -u tailscaled -n 30 --no-pager` (apt) — look for
   `access granted ... starting non-pty command: [/snap/tailscale/.../tailscaled be-child ssh ...]
   Wait: code=1`. **Root cause: the snap package's sandbox forbids the SSH shell-exec.** Fix:
   `sudo snap remove tailscale; curl -fsSL https://tailscale.com/install.sh | sh; sudo tailscale up
   --ssh`. The new install MAY assign a **different** Tailscale IP — verify with
   `tailscale status --self`.
3. **Tailscale's own SSH proxy silently swallows the connection ABOVE the kernel** (distinct from
   #2 — happens even with apt-installed Tailscale, not a sandbox issue):
   `nc -z -w5 <ip> 22` succeeds (port reachable) but `ssh` fails immediately with
   `kex_exchange_identification: Connection closed by remote host` — no SSH banner ever sent.
   Confirm: `sudo tcpdump -i any port 22 -c5` on the remote — **0 packets captured** during the
   attempt proves Tailscale intercepts at the APPLICATION layer, above the kernel network stack,
   and its SSH proxy is malfunctioning (the kernel `sshd` never even sees the connection). Fix:
   `sudo tailscale up --ssh=false`, verify `sudo service ssh status`/`start` (plain `sshd` then
   works normally — the ACL `"action":"accept"` SSH rule becomes irrelevant once `--ssh` is
   disabled; auth reverts to normal `sshd` key/password auth).
   - WSL2 general guidance: run Tailscale on the **Windows host**, not inside the WSL2 VM (shared
     network stack causes conflicting WireGuard tunnels); access via `tailscale.exe` from inside
     WSL2, requiring `appendWindowsPath = true` under `[interop]` in `/etc/wsl.conf`.

### Ubuntu 23.10+/24.04: `ssh.socket` silently overrides a custom sshd `Port`

HIGH confidence, stated identically in two files of the same unit (`playbooks.md §1`
and `wsl2-mac.md Setup 2`). Ubuntu's package enables `ssh.socket` (socket activation on port 22),
which overrides any custom `Port` set in `sshd_config`. Fix:
`sudo systemctl disable --now ssh.socket && sudo systemctl enable --now ssh.service`. Confirm with
`sudo ss -tlnp | grep <port>`. **Gotcha:** this is a silent failure mode — the drop-in config is
accepted without error, the daemon just keeps listening on 22 anyway.

### Post-join verification checklist (headscale on macOS)

A five-step reachability + SSH-enablement check:

```
Tailscale status                      # 1. host + peers
Tailscale ip -4                       # 2. tailnet IP assigned
Tailscale ping -c 2 <peer-hostname>   # 3. outbound reach
route -n get 100.64.0.1 | grep interface   # 4. expect utunN, not physical NIC
# 5. from another peer: tailscale ssh <this-hostname> hostname  → expect <this-hostname>
```

If step (5) fails but step (3) succeeds, `--ssh` was likely never enabled on the target; re-run
`tailscale up` adding `--ssh`, or use `tailscale set --ssh=true` to flip it on without a full
re-join.

### Fast-path failure classification (any platform)

`tailscale ping 100.x.y.z` (fastest reachability check) → if it fails, fix Tailscale first; if it
works but SSH fails, fix SSH auth/sshd/Tailscale-SSH. Then:
`ssh -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 user@100.x.y.z` → verify `'hostname; whoami; uname -a'`.

| Symptom | Cause | Check/fix |
|---|---|---|
| `Host key verification failed` | stale `known_hosts` | `ssh-keygen -R 100.x.y.z` |
| `Permission denied (publickey)` | key/auth problem | force key: `-o IdentitiesOnly=yes -i ~/.ssh/id_ed25519` |
| `Operation timed out` / `No route to host` | device offline / Tailscale broken / ACL / firewall / wrong IP | `tailscale ping <ip>` |
| `Connection refused` | sshd not listening / Tailscale SSH not enabled / firewall / wrong port | `nc -vz 100.x.y.z 22` |
| unexpected password prompt | key missing / wrong user | `cat ~/.ssh/id_ed25519.pub` |

Public-key install when password-prompt-instead-of-key:
`mkdir -p ~/.ssh && chmod 700 ~/.ssh; echo 'PUBKEY' >> ~/.ssh/authorized_keys; chmod 600
~/.ssh/authorized_keys` (then `chown -R "$USER":$(id -gn) ~/.ssh` on macOS/Linux). Decision rule:
prefer Tailscale SSH when already allowed by policy rather than spending time fixing legacy sshd;
fall back to standard sshd+`authorized_keys` if policy doesn't allow it or can't change quickly.

### Tailscale-responds-but-SSH-doesn't decision tree

The general triage sequence: `tailscale status; tailscale ping <worker>; ssh -o
ConnectTimeout=10 <user>@<worker>`.

- `Connection refused` = no SSH service accepting.
- Timeout while ping succeeds = inspect SSH policy / worker reachability / Tailscale SSH state.
- An **"additional-check URL"** appearing in the failure = the matching SSH rule uses `check` mode
  (§2) — the connection is not broken, it is waiting on step-up re-auth.
- A local-user lookup failure = you supplied the tailnet/GitHub identity instead of an **existing
  Linux username** on the target — use the account that actually exists on that box.
- **MagicDNS can fail transiently** while the raw Tailscale IP still works. Do **not** casually
  bypass host-key verification just because you switched between a hostname and an IP address —
  verify the fingerprint through a trusted channel instead of blanket-disabling
  `StrictHostKeyChecking`.

### China ISP DNS hijack (`114.114.114.114` → fake `198.18.x.x` IPs)

Distinct root cause from the TUN-based DNS hijack in §7; do not conflate the two.
Symptom: `ssh user@hostname` connects briefly then closes, no SSH banner ever appears, `ping
hostname` succeeds but SSH fails; `nslookup hostname` resolves into the `198.18.x.x` range. Root
cause: the China ISP DNS resolver `114.114.114.114` does not return `NXDOMAIN` for unknown domains
— it returns fake IPs inside `198.18.0.0/15` (originally meant for ad-redirect pages), so
`ssh user@hostname` connects to the fake IP instead of the real `100.x.x.x` Tailscale IP.
**Gotcha:** `198.18.x.x` coincidentally overlaps OrbStack's internal address range, so this LOOKS
like an OrbStack networking conflict but is actually DNS hijacking. Verify by querying a domain
that cannot possibly exist: `nslookup non-existent-domain-xyz123.com 114.114.114.114` — getting
back ANY IP instead of `NXDOMAIN` confirms hijacking is in play.

### Relay / transitive-hop caveat — SECURITY-RELEVANT

Tailscale SSH authorizes the **source NODE**, not the human identity that first logged into it. If
`rahul@debian` SSH access is permitted, and `debian` is separately permitted to SSH to
`shaurya@asuna`, the hop `rahul → debian → asuna` is viable purely from Tailscale's authorization
perspective — Tailscale SSH does **not** track the original human identity through a relay hop.
Changing the destination username alone does NOT prevent the second hop. Mitigation: remove the
relay permission entirely, or isolate the relay node so `rahul` cannot reach it. Least-privilege SSH
policy design must account for transitive hops through intermediate nodes.

## 5. `tailscale ssh` subcommand vs plain OpenSSH client

`tailscale ssh user@hostname` is Tailscale's own SSH client subcommand (uses MagicDNS) — an
alternative to plain `ssh user@100.x.x.x` / `ssh machine-name`; enabling the SERVER side is always
`tailscale up --ssh` regardless of which client form is used. **Requires BOTH** a
network-access grant/`ip` rule AND an `ssh` policy rule for the given src/dst/user triple — missing
either breaks it silently. Additional command forms:

```bash
tailscale ssh user@hostname            # MagicDNS-based, Tailscale-native SSH
tailscale up --ssh                     # enable the Tailscale SSH server on this node
ssh <target>                           # regular SSH, resolve target via config/MagicDNS
ssh <target> -- <command>
ssh -tt <target> -- <command>          # force TTY only when the remote op needs one
```

Any tool built on plain OpenSSH (sshsync, Ansible, rsync, scp, VS Code Remote-SSH) needs the
**hostname/IP-based `~/.ssh/config`** form (`HostName machine.tailnet-name.ts.net` or
`HostName 100.x.x.x`), not the `tailscale ssh` subcommand's own protocol wrapper — most SSH-based
tooling does not speak that wrapper. `tailscale ssh` (or plain `ssh` once `--ssh` is enabled) is
best for interactive/ad-hoc access using Tailscale's own identity-based auth instead of managing
keys.

**VS Code Remote-SSH over Tailscale SSH**:
```
Host my-server
    HostName my-server.tailnet-name.ts.net
    User ubuntu
    ProxyCommand tailscale ssh --nc %h %p
```
Then "Remote-SSH: Connect to Host" → select `my-server`. Auth is entirely via tailnet identity — no
SSH-key files to distribute; ACL policy governs who reaches which machines. **Historical
disqualifier:** embedded Tailscale SSH servers have lagged stock OpenSSH on IDE-remoting edges —
Tailscale issue #5295 broke VS Code Remote-SSH for a long time (CLOSED, fixed 2026-04-07 via
PR #19006, embedded SSH fork replaced) — worth re-verifying against the specific build
in use.

## 6. OpenSSH hardening that pairs with a tailnet

### The four-generations model (frames WHAT problem a given tool solves)

Each generation exists to fix the SPECIFIC limit of the prior one; naming which
generation a tool belongs to tells you what problem it actually solves.

- **Gen1** password + host-trust (telnet/SSH-1) — solved cleartext creds, killed by weak integrity
  (CRC-32 insertion).
- **Gen2** pubkey + `authorized_keys` (today's default) — solved shared-secret-on-wire, limited by
  PERMANENCE (keys never expire, TOFU click-through, public port exposure —
  regreSSHion CVE-2024-6387).
- **Gen3** short-lived certificates + hardware-bound (FIDO2) keys — solved standing secrets, limited
  by CA-as-crown-jewel + coarse KRL revocation + still running a port.
- **Gen4** zero-trust identity mesh (Tailscale SSH, Teleport, Cloudflare Access) — SSH becomes just
  the byte-carrier; auth/transport/authz/audit move to a control plane.

**Tailscale SSH is "most modern" but has real disqualifiers** (§4/§1 platform support:
Linux + macOS open-source only, never Windows server-side, never iOS/Android; port 22 over the
tailnet only) — name the generation a tool belongs to in order to know what problem it actually
solves and what it doesn't.

### Decision table — which remote-access architecture for which situation

Governing heuristic: pick the lightest tool whose blast radius you can tolerate —
push auth into an IdP, reachability into a mesh; reserve heavy access planes for genuine
audit/compliance needs.

| Situation | Recommended architecture |
|---|---|
| Solo dev, 1-3 machines | keyed OpenSSH (ed25519) + Tailscale as transport |
| Personal box wanting the strongest credential | + FIDO2 `ed25519-sk` |
| Roaming/flaky links | Tailscale + keyed SSH + mosh + tmux |
| Small team, all Linux/macOS, no compliance burden | Tailscale SSH (keyless, ACL-driven) |
| Self-managed fleet wanting to keep stock OpenSSH + kill key sprawl | SSH certificates via step-ca/Vault |
| Mid/large regulated, needs audit + session replay | Teleport (or Cloudflare Access if already on Cloudflare) |
| AWS-only fleet | AWS SSM Session Manager (no SSH content-logging on tunneled sessions though) |
| Editor-driven remote dev (VS Code/JetBrains) | stock OpenSSH over a mesh (IDE remoting is tested against real OpenSSH) |
| Must expose public sshd | `PasswordAuthentication no` + `AuthenticationMethods publickey` + patch religiously + `PerSourcePenalties` |

### OpenSSH version-gated feature floors — a commonly misattributed one, corrected

`ed25519-sk`, default touch-to-sign, `-O resident` →
OpenSSH **8.2** (2020-02-14). **`-O verify-required` (per-use PIN) → OpenSSH 8.4, NOT 8.2** — a
commonly repeated error in the wild; this reference explicitly flags and corrects it.
`ssh-rsa`/SHA-1 off by default since 8.8. DSA removed in 10.0 (2025-04), which also defaults to
post-quantum hybrid KEX `mlkem768x25519-sha256`. `PerSourcePenalties` (in-daemon rate-limiting,
makes fail2ban largely optional) arrived in 9.8. As of mid-2026 the OpenSSH series is 10.3.

### FIDO2 hardware-bound keys

```bash
ssh-keygen -t ed25519-sk -O resident -O verify-required -C "you-yubikey"
```
Needs OpenSSH ≥8.2 on both ends (≥8.4 for `-O verify-required`) + a FIDO2 authenticator; YubiKey
firmware ≥5.2.3 for `ed25519-sk` (older keys fall back to `ecdsa-sk`). `-O resident` = credential
stored on the token, retrievable via `ssh-keygen -K`; `-O verify-required` = PIN required every use.
Stealing the on-disk key file gets an attacker nothing without the physical token + touch (+PIN).
Platform agent caps: Apple Secure Enclave via Secretive is P-256 ECDSA only, non-backupable;
1Password SSH agent is Ed25519/RSA only, no ECDSA. **Gotcha:** agent forwarding lets root on the
remote USE your identity onward for that session (cannot exfiltrate the key bytes though) — prefer
`ProxyJump` over `ForwardAgent`.

### Certificate authority (revocation-by-expiry, kills key sprawl + TOFU at fleet scale)

```bash
ssh-keygen -t ed25519 -f user_ca      # and host_ca — protect like a crown jewel, ideally HSM/offline
ssh-keygen -s user_ca -I you@mac -n you -V +8h id_ed25519.pub     # -V +8h = self-expiring = the revocation strategy
ssh-keygen -s host_ca -I devbox -h -n devbox.example.com -V +52w id_ed25519.pub
```
Server: `TrustedUserCAKeys /etc/ssh/user_ca.pub`, `HostCertificate ...-cert.pub`. Client
`known_hosts`: `@cert-authority *.example.com <host_ca.pub contents>` kills TOFU. `RevokedKeys`
(KRL) is a per-server file with **no native distribution** — if unreadable, ALL pubkey auth is
refused. Issuance is gateable behind SSO (step-ca, Vault). **Gotchas:** `TrustedUserCAKeys` does
NOT disable `authorized_keys` — both coexist unless `AuthorizedKeysFile none` is also set;
"principal == login name" is default-config behavior only (changeable via
`AuthorizedPrincipalsFile`/`Command`); forgetting `-V` produces a non-expiring cert.

### Connection multiplexing

```
Host * { AddKeysToAgent yes; UseKeychain yes; ServerAliveInterval 30; ServerAliveCountMax 3;
         ControlMaster auto; ControlPath ~/.ssh/cm-%r@%h:%p; ControlPersist 15m }
```
Reuses one TCP/auth connection for many sessions — critical for VS Code/scp/git speed; a FIDO2
hardware key is touched only once per persistent master rather than per connection.

### mosh — no scrollback, UDP-only, and cannot serve VS Code Remote-SSH

```bash
mosh you@devbox.<tailnet>.ts.net -- tmux new -A -s main
```
Syncs ONLY the visible screen (no scrollback — pair with tmux); needs UDP 60000-61000 reachable;
maintenance-only (last release 1.4.0, Oct 2022); VS Code Remote-SSH cannot use it at all — mosh is
a terminal-only complement, editors always use the OpenSSH path. (See §1's NixOS section for a
concrete real-world example routing mosh exclusively over a Tailscale IP.)

## 7. SSH-over-tailnet failure modes (transport-layer, not Tailscale-daemon-layer)

### ProxyCommand double-tunnel breaks large git transfers

Symptom: `ssh -T git@github.com` works, but `git
push`/`pull` fails intermittently with `FATAL: failed to begin relaying via HTTP` (or `Connection
closed by UNKNOWN port 65535`). Cause: a proxy TUN (Shadowrocket/Clash/Surge) already routes all
TCP; if `~/.ssh/config` ALSO uses `ProxyCommand connect -H 127.0.0.1:<port>`, traffic goes through
two proxy layers and the landing proxy drops long-lived/large HTTP CONNECT connections during
large transfers. Fix: remove `ProxyCommand`, use GitHub SSH over 443 instead:
```
Host github.com
    HostName ssh.github.com
    Port 443
    User git
    ServerAliveInterval 60
    ServerAliveCountMax 3
    IdentityFile ~/.ssh/id_ed25519
```
Verify: `ssh -v -T git@github.com 2>&1 | grep 'Connecting to'` should show `ssh.github.com [...]
port 443`. Verify bypass with `GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push`. **Why 443:**
proxies give it longer connection timeouts and larger buffers than port 22 (treated as opaque TLS,
no deep packet inspection); also avoids double-tunneling. **Gotcha:** connection setup is ~6s vs
~2s slower (more hops through TUN routing) but actual transfer throughput is unaffected.

### TUN DNS hijack breaks SSH-over-443 to GitHub

HIGH confidence, author verified via direct reproduction. Symptom:
`git clone/fetch/push` fails with `Connection closed by 198.18.0.x port 443`; DNS resolves
`ssh.github.com` to a `198.18.0.0/15` virtual IP instead of the real IP (a proxy-tool TUN DNS hijack
for protocol-aware proxying — works for HTTPS, mishandles SSH-over-443). Root cause in detail: the
TUN tool (e.g. Shadowrocket) hijacks DNS, returns fake virtual IPs, then routes to them through the
TUN for protocol-aware proxying — this works for HTTP/HTTPS (the landing proxy understands the
protocol) but mishandles SSH-over-443 (the TUN expects HTTPS on 443 and drops the SSH handshake).
Fix: hardcode the real IP in `~/.ssh/config`: `HostName 140.82.112.35` (or `.36`), `Port 443`.
Diagnose direct-IP bypass: `ssh -o HostName=140.82.112.35 -o Port=443 git@github.com`. Alternative,
if proxy config is accessible: add GitHub's SSH IP ranges to a DIRECT rule
(`IP-CIDR,140.82.112.0/24,DIRECT`) so the TUN passes them through without protocol inspection.
**Gotcha:** hardcoded IPs break if GitHub rotates them — monitor with a weekly cron
`dig +short ssh.github.com @8.8.8.8`. `[unverified — IPs are point-in-time]`.

### `kex_exchange_identification` — see §4 WSL failure mode #3 above (Tailscale's own SSH proxy, not
a TUN/proxy issue in that case).

### Non-login shells don't load rc files — PATH and proxy env silently missing

HIGH confidence, consistent across three independent sources.
`ssh user@host "node --version"` → `command not found`, even though it works interactively, because
SSH non-login shells don't source `~/.zshrc` (macOS) or `~/.bashrc` (Linux/WSL) — so
nvm/Homebrew/uv/cargo-installed tools and any `http_proxy` set there are unavailable. Affects
CI/CD pipelines, cron-triggered SSH, and Makefile remote targets identically. Fix: prefix every
remote command with `source ~/.zshrc 2>/dev/null;` (or `source ~/.bashrc 2>/dev/null;`).
**`bash -lc` loads `.bash_profile` but NOT `.zshrc`** on macOS's default zsh shell — always
explicitly source `~/.zshrc` or use `zsh -ic`.

### Local SSH port-forward for remote dev servers with an auth-redirect-to-localhost bug

Symptom: dev server on a remote Tailscale machine browsed via `http://<ts-ip>:3010`;
login works but the auth library (Better-Auth/NextAuth-style) redirects to
`http://localhost:3010/` (its configured `APP_URL`), which fails because nothing listens on the
LOCAL machine's `localhost:3010`. **WRONG fix:** change `APP_URL` to the Tailscale IP (reintroduces
proxy conflicts, breaks local dev on the remote machine itself). **RIGHT fix:**
```bash
ssh -NL 3010:localhost:3010 <tailscale-ip>
# auto-reconnect on long sessions:
autossh -M 0 -f -N -L 3010:localhost:3010 -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" -o "ExitOnForwardFailure=yes" <tailscale-ip>
```
Then browse `http://localhost:3010` normally; keep `.env` unchanged everywhere. `autossh -M 0`
disables autossh's OWN monitoring port (relies on `ServerAliveInterval` instead — more reliable
through NAT); `ExitOnForwardFailure=yes` fails FAST if the local port is already bound rather than
silently running unforwarded. Multi-port: stack `-L` flags
(`-L 3010:localhost:3010 -L 9000:localhost:9000`) — if ANY port is already bound, the whole tunnel
aborts. Kill: `pkill -f 'autossh.*<tailscale-ip>'` (precise pattern so it doesn't kill unrelated SSH
sessions). **Why this pattern:** matches VS Code Remote-SSH / GitHub Codespaces —
`APP_URL=http://localhost:PORT` stays correct for both local and remote dev with zero code/env
changes, and `localhost` is in every proxy tool's default skip-proxy bypass list.

### Cross-platform remote script execution over plain SSH (heterogeneous fleets)

PowerShell-over-SSH has escaping issues — always pass scripts via `-EncodedCommand`
(UTF-16LE base64):
```bash
B64=$(printf '%s' "$PS_SCRIPT" | iconv -t UTF-16LE | base64)
ssh <target> "powershell -NoProfile -EncodedCommand $B64"
```
Unix targets take a script via heredoc/stdin cleanly: `ssh <target> 'bash -s' < script.sh`. A
bootstrap script (`ssh-bootstrap.sh`, 124 lines in the source) can auto-detect target OS via a
chained probe (`'uname -s 2>/dev/null || cmd /c ver 2>nul || ver'`) and print the right follow-up
form per OS, plus persistent-access hints (`ssh-copy-id`, Windows
`administrators_authorized_keys`/`authorized_keys` paths). Password-auth bootstrap uses `sshpass`
with the password piped via **stdin, never argv/history**
(`brew install hudochenkov/sshpass/sshpass` on macOS, `apt`/`dnf install sshpass` on Linux) —
intended to be superseded by key-based access (`ssh-copy-id`) for repeat use. **Footgun:** a script
that `export SSHPASS=<plaintext>` for its duration can leak the var into a shared shell environment
if it crashes mid-run.

## 8. Firewall lockdown & VPS hardening pairing with Tailscale SSH

### UFW deny-incoming-except-tailscale0, verify BEFORE enabling

HIGH confidence. Sequence: install Tailscale + join tailnet → **verify SSH over the
Tailscale IP works FIRST** (`ssh user@100.x.y.z`) → THEN:
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw --force enable
```
→ verify `sudo ufw status verbose` shows `Anywhere on tailscale0  ALLOW IN  Anywhere` → confirm
public-IP SSH now times out while the Tailscale-IP/hostname SSH still succeeds. Outbound stays
fully open (`default allow outgoing`), so the box can still pull packages, upload to object
storage, call APIs — only INCOMING from the public internet is blocked. **Why:** confirming
Tailscale SSH access before locking down is critical — otherwise a lockout is possible with no
other access path.

### secure-vps-setup — Tailscale as the "close the public SSH port" step in a 6-phase hardening guide

HIGH confidence. Phase order: OS hardening/UFW → SSH keys → Tailscale
(`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`;
`sudo ufw allow in on tailscale0`; TEST the Tailscale SSH path BEFORE running
`sudo ufw delete allow ssh`) → Docker/Traefik/Watchtower → Crowdsec → backups (Duplicati bound to
`127.0.0.1` or the Tailscale IP, never a public port — "Docker bypasses UFW, so mapping 8200:8200
is dangerous"). **Gotcha:** explicit safety-net warning — verify the VPS provider's web
console/KVM access BEFORE removing the public SSH allow rule, in case Tailscale access fails.

## 9. Device inventory and fleet operations over a tailnet

### Record-back device inventory pattern for a tailnet ops assistant

MED confidence. Treat a shared documented tailnet inventory (device aliases,
Tailscale IPs, SSH usernames, known-good SSH commands, platform notes) as source of truth; check it
first before improvising usernames/addresses. When new durable facts are discovered (confirmed IP,
username, working command, whether passwordless key auth works, whether Tailscale SSH usable,
whether sudo needs password, platform caveats), write them back to the device record — but **never**
write back uncertain guesses.

### Live discovery via `tailscale status --json` — reconciling with the inventory-record pattern above

MED confidence. Start discovery with LIVE `tailscale status --json`; match
hostname/DNS name and use the node's CURRENT IP — a manager-cached Tailscale IP list can be stale.
MagicDNS may be disabled in some environments; use the current `TailscaleIPs[0]` directly rather
than relying on a `.local`/short hostname. If Tailscale is down or SSH times out in a
LAN-reachable environment, fall back to `dns-sd -B _ssh._tcp local` / `arp -a` / `HOST.local` mDNS
names — but only on the same LAN. **Reconciliation, not a contradiction:** consult the documented
device record first for aliases, usernames, and known caveats, but always re-verify the
CURRENT IP address via a LIVE status query before connecting rather than trusting a cached IP list
— then write the confirmed (never guessed) facts back to the record once the live check succeeds.

### `sshsync` + Tailscale SSH — distributed multi-host fleet orchestration

HIGH confidence. `sshsync` (Python CLI, `pip install sshsync`) manages groups
of SSH hosts defined in `~/.ssh/config` (connection details) + `~/.config/sshsync/config.yaml`
(group membership). **Config is entirely SSH-config-driven — no separate inventory system**, so it
composes directly with any Tailscale-hostname-based SSH setup. Two integration modes: (A)
Tailscale's own built-in SSH (`sudo tailscale up --ssh` on the target, then
`tailscale ssh user@machine`) — no SSH server config needed, uses Tailscale's own auth/key
management; (B) standard OpenSSH pointed at Tailscale hostnames/IPs via `~/.ssh/config`
(`HostName machine.tailnet-name.ts.net` or `HostName 100.x.x.x`) — **recommended for `sshsync`
specifically**, because `sshsync` (and most SSH-based tooling: Ansible, rsync, scp) works with
standard SSH but NOT with `tailscale ssh`'s own protocol wrapper (§5). Key commands: `sshsync ls
[--with-status]`; `sshsync all "<cmd>" [--timeout N] [--dry-run]`; `sshsync group <name> "<cmd>"
[--timeout N] [--regex "<pattern>"]`; `sshsync push [--host H|--group G|--all] [--recurse]
[--dry-run] <local> <remote>`; `sshsync pull [--host H|--group G] [--recurse] <remote> <local>`;
`sshsync gadd <group>` / `sshsync hadd` (interactive add); `sshsync sync` (assign ungrouped hosts to
groups). **Gotcha:** `sshsync` uses the SSH config **Host alias**, not the actual `HostName` —
aliases must be distinct/meaningful; pulling from a GROUP creates one subdirectory per host (a
single-host pull does not). Combined with `tailscale status`/`tailscale ping <peer>` for
connectivity/health, enables load-balanced task distribution (`score = cpu_pct*0.4 + mem_pct*0.3 +
disk_pct*0.3`, lower is better), parallel file sync, multi-stage (staging→test→production)
deployment across a mesh.
- **Timeout tiering convention** for remote command execution: quick checks (`hostname`, `df -h`)
  5-10s; moderate ops (`npm install`) 30-60s; long-running (`docker build .`) 300s+. Set the
  timeout ~20-30% longer than expected duration; use `--dry-run` first to estimate `[MED
  confidence — presented as guidance, not a measured rule]`.

### Establishing + verifying the path to a worker

`tailscale status`; `tailscale ping <worker-hostname>`; on the worker:
`sudo tailscale set --ssh`; connect: `ssh <user>@<worker-hostname>` using the worker's REAL local
username. A refused port usually means neither Tailscale SSH nor a regular sshd is accepting;
"failed to look up local user" means the requested Linux account doesn't exist.

### Core operating rules for a private Linux agent-host over Tailscale SSH

Treat Tailscale as the private network path — a service must still be explicitly
configured to accept SSH/desktop/HTTP traffic. Prefer Tailscale SSH and narrowly-scoped access
rules over public SSH or router port forwarding. Keep privileged ops/OAuth approval user-driven;
never request passwords or expose tokens in logs. Verify unattended boot explicitly — networking,
Tailscale, sleep policy, and encrypted-disk prompts are SEPARATE concerns; don't assume one implies
another. Bind dev servers to localhost and expose with `tailscale serve` when possible.

### `tailscale_ssh(hostname, command, user)` execution abstraction requires the agent's own SSH key added to targets

MED confidence (the naming is agent-abstraction-specific, but the underlying
constraint is real). E.g. `tailscale_ssh('web-prod', 'docker ps', 'admin')`. Setup: the agent's
SSH public key must be added to target devices manually (Settings → Tailscale → SSH Setup); targets
need an SSH server running (Linux: `sshd`, macOS: Remote Login). **Gotcha:** a `Permission denied`
error means the agent's key was never added to that device — remind the user rather than retrying
blindly.

## 10. Coding agents and remote dev over a tailnet

- **Claude Code honors `ProxyCommand`, not `ProxyJump`** — needs an equivalent SSH config entry
  (`anthropics/claude-code#44838`). If `~/.ssh/config`'s `Host wsl` block uses
  `ProxyJump win` (correct for OpenSSH and VS Code), Claude Code will NOT traverse the jump. Give it
  an equivalent entry using `ProxyCommand ssh win -W %h:%p` instead. **Direct, load-bearing gotcha
  for any AI-coding-agent Tailscale/SSH integration.**
- **Auto-attaching tmux on inbound SSH must exclude non-interactive command sessions.**
  If login shells auto-wrap into tmux so long jobs survive
  drops, the wrap must: (a) always yield a raw shell on the break-glass relay (e.g. `:2222`)
  recovery path; (b) **skip wrapping when `$SSH_ORIGINAL_COMMAND` is set** — editor / Claude Code
  bootstrap shells must NOT be wrapped; (c) bound the check with `timeout … || true` so a wedged
  tmux server can never hang the login.
- **tmux persistent sessions + read-only monitoring pattern for remote agents:**
  `tmux new -s issue-123`; detach `Ctrl-b` then `d`; `tmux ls`; `tmux attach -t issue-123`;
  `tmux kill-session -t issue-123`. Read-only monitoring does NOT interrupt an agent:
  `tmux capture-pane -p -t issue-123 -S -100`; `git -C <worktree> status --short --branch`. **Do
  not send keys/signals merely to check progress.**
- **git worktree isolation per mutating agent on a shared worker:**
  `git fetch origin --prune; git pull --ff-only origin main; git worktree add -b feature/issue-123
  ../worktrees/project-issue-123 origin/main`. Give each agent explicit ownership, acceptance
  criteria, validation requirements, delivery boundaries (commit/push/PR/publish/merge permissions)
  — never infer approvals.
- **`tsnet` — embedding a Tailscale node directly inside a Go process (no system daemon):**
  ```go
  import "tailscale.com/tsnet"
  srv := &tsnet.Server{Hostname: "my-tool", AuthKey: os.Getenv("TS_AUTHKEY"), Dir: "/var/lib/my-tool/tailscale"}
  defer srv.Close()
  ln, err := srv.Listen("tcp", ":8080")
  http.Serve(ln, myHandler())
  ```
  `srv.Listen` returns a `net.Listener` bound directly to the tailnet IP — the process joins the
  tailnet as a FIRST-CLASS device with NO external `tailscaled` daemon or system install required.
  | Aspect | tsnet | System Tailscale |
  |---|---|---|
  | Installation | library dependency only | package install required |
  | Isolation | per-process tailnet identity | shared system identity |
  | Subnet routing | NOT supported | supported |
  | State | app-managed directory | `/var/lib/tailscale` |
  Use for: internal CLI tools, custom proxies, edge devices, integration-test harnesses distributed
  as a single Go binary with zero user-side Tailscale setup.
- **`tailscale-remote` agent-exec safety pattern (target resolution + dangerous-command
  blocklist):** resolves a user-given target against
  `tailscale status --json`, preferring config-file aliases → exact HostName/DNSName match → prefix
  match → raw TailscaleIPs → else falls through to the literal input (letting ssh/curl error
  naturally). Hardcoded `DANGEROUS_TOKENS` blocklist (`rm -rf`, `mkfs`, `dd if=`, `:(){`, `shutdown`,
  `reboot`, `halt`, `poweroff`, `diskutil erase`, `sudo rm`) refuses `--all`-node execution of
  anything matching, and requires explicit `--yes` even for single-target dangerous commands.
  **Safety pattern worth reusing for any agent-driven remote-exec tool over a tailnet.**
- **`sc-sync` — Tailscale as the rsync transport for gitignored files between two machines, role
  by explicit env var, never `hostname`:**
  `SYNC_ROLE=vps|local` (explicit, never sniffed from `hostname` — "leaks a real, personally-
  identifying hostname into logs and breaks the moment either machine is renamed") crossed with a
  requested direction (`vps-local`/`local-vps`) via a pure `route()` function determines push vs
  pull. Requires SSH reachable over Tailscale on the non-invoking side. **Windows OpenSSH Server is
  NOT on by default** — must be enabled
  (`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`) before a sync targeting a
  Windows box will connect.
- **tunnels-for-agents decision matrix** — when Tailscale
  beats ngrok/Cloudflare Tunnel/bore/SSH for agent fleets: "agent fleet (multiple machines), need
  selective public exposure → Tailscale mesh + Funnel for specific services"; "all private team
  access → Tailscale serve (no public exposure)". Bandwidth/auth: Tailscale fleet mesh = SSO+ACLs
  auth, unlimited bandwidth, ~2min/machine setup. `[MED confidence — opinionated skill, not vendor
  doc]`.
- **CI/CD integration — `tailscale/github-action`, OAuth-over-auth-keys, ephemeral tagging:**
  ```yaml
  - uses: tailscale/github-action@v2   # a real production example pins @v4 (see §1 reference arch) — newer
    with: {oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}, oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}, tags: tag:ci-runner}
  ```
  Prefer OAuth clients over static auth keys for CI specifically — they support automatic key
  rotation and don't expire; the action tears the connection down automatically at job end. Tag CI
  runners with a dedicated tag and scope ACL rules to exactly the hosts/ports the pipeline needs.
  GitLab CI pattern: install in `before_script`, `tailscale logout` in `after_script`, pass
  `--hostname=gitlab-runner-$CI_JOB_ID` to disambiguate concurrent runners.
- **Service-mesh integration pattern** — each service gets
  its own Tailscale identity (sidecar); ACLs enforce service-to-service access, e.g.
  `tag:api -> tag:database:5432`. Zero-trust service mesh without a separate mesh product
  (Istio/Linkerd). `[MED confidence]`.
- **`chrome-devtools-mcp` remote over Tailscale-issued/self-signed HTTPS:** remote daemon + Chrome run on a REMOTE host reachable at
  e.g. `https://macbook13-pro.tail3ce7a.ts.net/mcp`.
  ```bash
  export CHROME_DEVTOOLS_MCP_REMOTE_URL="https://macbook13-pro.tail3ce7a.ts.net/mcp"
  chrome-devtools status --remote="$CHROME_DEVTOOLS_MCP_REMOTE_URL"   # healthy = status=ok http=200
  ```
  Self-signed cert (common on tailnets without Tailscale-issued certs): pass `--insecure` on every
  call, or `export CHROME_DEVTOOLS_MCP_REMOTE_INSECURE=1`. Bearer-token gateway:
  `--header "Authorization: Bearer $TOKEN"` (repeatable, NOT cached — must be on every invocation).
  `status` returning `Failed to reach remote` → run `tailscale status` locally; the box is offline or
  the URL has the wrong hostname. **No external CDP endpoint exists in this architecture** — the
  daemon owns Chrome's lifecycle end-to-end; don't invent `--remote-debugging-port`/`--browserUrl`
  flags, they don't apply here.
- **Tailscale as a chat-bot slash-command skill** (serve/funnel/peers/file transfer):
  wraps `tailscale.serve({port, protocol, path,
  hostname})`, `.serveStop(port)`, `.serveStatus()`, `.funnel({port, protocol, hostname})`,
  `.funnelStop(port)`, `.funnelStatus()`, `.status()`, `.peers()`, `.ping(hostname)`,
  `.sendFile({file, peer})`, `.receiveFile({savePath, timeout})`, `.getIP()` behind
  `/tailscale serve|funnel|status|ip|peers|ping|send|receive`. Requires `TAILSCALE_AUTHKEY` env
  gate. **Reusable pattern:** check `client.isInstalled()` and `client.isRunning()` BEFORE calling
  status, returning distinct user-facing messages for "not installed" vs "installed but not
  running" vs live status — never assume the daemon is up just because the binary exists.
- **Exposing a skill to an agent runtime with an explicit trigger + interface descriptor:**
  a lightweight per-runtime interface file (e.g.
  `agents/openai.yaml`) supplies `interface.display_name`, `short_description`, and a
  `default_prompt` telling the agent how to use the skill's scripts safely (explicit previews,
  jq-parsed output). The skill's own frontmatter `description:` states exactly when to invoke it
  (which resources, which actions). Pattern: keep the trigger description in the main skill file,
  and a separate small per-runtime descriptor for runtime-specific wiring.

## GAPS

- **Tailscale SSH env-var forwarding allow-listing** is documented only partially in this
  reference — one source references the feature (SSH policy rules can allow-list specific env vars
  to forward through a session) but could only partially capture the exact field name
  (LOW confidence — flagged for follow-up read against the live docs before shipping).
- Not covered here: Tailscale SSH's interaction with `ssh-agent` forwarding specifically (as
  distinct from the FIDO2/`ForwardAgent` gotcha in §6, which is generic OpenSSH, not
  Tailscale-SSH-specific).
- Not covered here: a Windows Tailscale-SSH **server** configuration in any detail, beyond the flat
  statement that the SSH server never runs on Windows (§1/§4) — client-side Windows access via
  plain `ssh`/PuTTY/VS Code is implied but not documented.
- Several subsections (the §1 reference architecture, §2's session-recording paragraph and
  Grants-app-field caveat, all of §3 (`tsrecorder`), §6's OpenSSH version-gated floors and
  Certificate Authority subsection, §7's ProxyCommand-double-tunnel item, and most of §10's
  agent-integration bullets — `tsnet`, `sc-sync`, the tunnels-for-agents decision matrix, CI/CD
  `tailscale/github-action` detail, service-mesh integration, `chrome-devtools-mcp` remote, the
  chat-bot skill, and the skill-exposure pattern) read as accurate and internally consistent with
  the rest of this reference, but have not been independently re-verified in this revision.
