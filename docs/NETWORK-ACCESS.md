# Network Access Guide

Complete guide for accessing AI Maestro from different locations and networks.

## Quick Reference

| Location | Method | URL | Setup Required |
|----------|--------|-----|----------------|
| **Same Mac** | localhost | `http://localhost:23000` | None |
| **Local network** | Bonjour/mDNS | `http://mac-mini.local:23000` | None |
| **Local network** | IP address | `http://10.0.0.18:23000` | None |
| **Tailscale** | Direct IP | `http://100.80.12.6:23000` | Tailscale running |
| **Local network** | Custom domain | `http://mac-mini.aimaestro:23000` | Router DNS or /etc/hosts |
| **Tailscale** | Custom domain | `http://aimaestro.yourdomain.com:23000` | DNS configuration |

---

## Current Configuration

**Server Details:**
- **Port:** 23000
- **Binding:** `::` (dual-stack) when Tailscale is detected, else `127.0.0.1` only. A TCP-level filter (`server.mjs::isAllowedSource()`) drops every connection except loopback and Tailscale before any HTTP is processed — so despite the `::` bind, **LAN and public IPs cannot connect**. See [Security Considerations](#security-considerations).
- **Local IP:** 10.0.0.18
- **Tailscale IP:** 100.80.12.6
- **Hostname:** mac-mini

> **Note:** several "Local Network Access" methods below (Bonjour/`.local`, direct
> LAN IP, custom LAN domains) describe *DNS convenience* only. They resolve a name
> to the Mac's LAN IP, but the server **drops the connection at the TCP level** for
> any non-Tailscale, non-loopback source. LAN access does not work by design;
> remote access is Tailscale-only. This is the security model, not a misconfiguration.

---

## Access Methods

### 1. Local Access (Same Mac)

**URL:** `http://localhost:23000`

Use this when accessing AI Maestro directly on the Mac it's running on.

---

### 2. Local Network Access

#### Option A: Bonjour/mDNS (Recommended - Works Immediately)

**URL:** `http://mac-mini.local:23000`

**Advantages:**
- Works automatically, no configuration needed
- Survives DHCP IP changes
- Works on Mac, Linux, iOS, Android
- Human-readable hostname

**How it works:**
macOS broadcasts its hostname via Bonjour/mDNS. Any device on the same network can resolve `<hostname>.local` automatically.

**Requirements:**
- Devices must be on the same local network
- mDNS must be enabled (enabled by default on most devices)

**Windows users:** Install [Bonjour Print Services](https://support.apple.com/kb/DL999) for `.local` domain support.

---

#### Option B: Direct IP Address

**URL:** `http://10.0.0.18:23000`

**Advantages:**
- Works on all devices without additional software
- No DNS required

**Disadvantages:**
- IP address may change if using DHCP
- Not human-readable

**Solution for changing IPs:**
1. Log into your router
2. Reserve/assign a static IP for your Mac (usually under DHCP settings)
3. Use MAC address: Find it with `ifconfig en0 | grep ether`

---

### 3. Custom Local Domain (mac-mini.aimaestro)

Create a memorable custom domain for your local network.

#### Option A: Router DNS Configuration (Recommended)

**Setup:**
1. Log into your router's admin panel (usually `http://192.168.1.1` or `http://10.0.0.1`)
2. Navigate to DNS settings (varies by router):
   - **Ubiquiti/UniFi:** Network → DNS → Custom DNS Entry
   - **Asus:** LAN → DNS Director → Add
   - **Netgear:** Advanced → DNS Service → Add Host Name
   - **TP-Link:** Advanced → Network → DHCP Server → Address Reservation
   - **pfSense/OPNsense:** Services → DNS Resolver → Host Overrides
   - **DD-WRT:** Services → DNSMasq → Additional Options
   - **OpenWrt:** Network → Hostnames → Add

3. Add DNS entry:
   - **Hostname:** `mac-mini.aimaestro`
   - **IP Address:** `10.0.0.18`

4. Save and restart DNS service if required

5. Test from any device on your network:
   ```bash
   ping mac-mini.aimaestro
   curl http://mac-mini.aimaestro:23000
   ```

**Advantages:**
- Works for all devices on your network automatically
- Survives reboots
- No per-device configuration

**Disadvantages:**
- Requires router access
- Configuration varies by router model

---

#### Option B: /etc/hosts File (Per-Device)

**Setup on each device:**

**macOS/Linux:**
```bash
sudo nano /etc/hosts

# Add this line:
10.0.0.18  mac-mini.aimaestro

# Save and exit (Ctrl+X, Y, Enter)
```

**Windows (as Administrator):**
```bash
notepad C:\Windows\System32\drivers\etc\hosts

# Add this line:
10.0.0.18  mac-mini.aimaestro

# Save
```

**iOS/Android:**
Requires jailbreak/root access or use a custom DNS app.

**Advantages:**
- Works without router access
- Immediate effect

**Disadvantages:**
- Must configure each device individually
- Must update manually if IP changes

---

### 4. Tailscale Access

Access AI Maestro securely from anywhere using Tailscale VPN.

#### Option A: Direct Tailscale IP

**URL:** `http://100.80.12.6:23000`

**Setup:**
1. Ensure Tailscale is running on your Mac
2. Ensure Tailscale is running on the device you're connecting from
3. Access via the Tailscale IP

**Advantages:**
- Works from anywhere (coffee shop, travel, etc.)
- Encrypted VPN connection
- No port forwarding needed
- No configuration required

**Disadvantages:**
- IP is not human-readable
- Tailscale must be running on both devices

---

#### Option B: Tailscale MagicDNS

**URL:** `http://mac-mini.tail<hash>.ts.net:23000`

**Setup:**
1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/dns)
2. Enable MagicDNS
3. Your Mac automatically gets a DNS name based on its hostname

**Find your Tailscale hostname:**
```bash
tailscale status
```

Look for your Mac's entry - it will show the MagicDNS hostname.

**Advantages:**
- Human-readable hostname
- Automatic DNS management
- Works from any Tailscale-connected device

---

#### Option C: Custom Domain with Tailscale

**URL:** `http://aimaestro.yourdomain.com:23000`

**Requirements:**
- Your own domain name
- Access to DNS management

**Setup:**
1. Log into your DNS provider (Cloudflare, Namecheap, Google Domains, etc.)
2. Add an A record:
   - **Name:** `aimaestro` (or subdomain of your choice)
   - **Type:** A
   - **Value:** `100.80.12.6` (your Tailscale IP)
   - **TTL:** 300 (5 minutes)

3. Save and wait for DNS propagation (usually 5-15 minutes)

4. Test from a Tailscale-connected device:
   ```bash
   ping aimaestro.yourdomain.com
   curl http://aimaestro.yourdomain.com:23000
   ```

**Important Notes:**
- This domain will ONLY work from devices connected to your Tailscale network
- The Tailscale IP (100.80.12.6) is only routable within your Tailnet
- This provides security - only your Tailscale devices can access it

**Advantages:**
- Use your own domain name
- Easy to remember
- Professional appearance

**Disadvantages:**
- Requires domain ownership
- Only accessible via Tailscale

---

#### Option D: Tailscale Funnel (Public HTTPS Access)

**URL:** `https://mac-mini.<tailnet>.ts.net` (HTTPS, no port needed)

Make AI Maestro publicly accessible over HTTPS without Tailscale client.

**Setup:**
```bash
# Enable Tailscale Funnel
tailscale funnel 23000
```

**Advantages:**
- Public HTTPS URL (no VPN needed)
- Automatic SSL certificate
- No port forwarding or firewall configuration

**Disadvantages:**
- **SECURITY WARNING:** Exposes AI Maestro to the public internet
- Anyone with the URL can access it
- Not recommended unless you add authentication

**When to use:**
- Sharing with collaborators temporarily
- Demo purposes
- Only if you're comfortable with public access

**To disable:**
```bash
tailscale funnel --disable 23000
```

---

## Security Considerations

### Current Security Model

AI Maestro is **security-first** and enforces two independent layers.

**1. Network perimeter — Tailscale only.** The server binds `::` when Tailscale is
present, but `server.mjs::isAllowedSource()` is a TCP-level filter that drops every
connection except:

| Source | Reaches the server? |
|--------|--------------------|
| `127.0.0.1`, `::1` (the host itself) | ✅ yes |
| `100.64.0.0/10` (Tailscale CGNAT) | ✅ yes |
| `fd7a:115c:a1e0::/48` (Tailscale ULA) | ✅ yes |
| `192.168.*` / `10.*` (LAN / WiFi) | ❌ **dropped at TCP level** |
| Any public IP | ❌ **dropped at TCP level** |

Without Tailscale the server falls back to `127.0.0.1`-only. **A device on your
WiFi cannot reach the app** — that "connection refused" is the design working.

**2. Authorization — identity, not network position.** Passing the perimeter grants
*nothing*. Inside the Tailscale VPN every device (phone, iPad, remote machine, a
script) is a first-class caller, and every route still demands its own proof:

- a **session cookie** for a logged-in human (governance password login; first-run
  setup dispatches a confirmation code to the host's desktop);
- an **AID proof-of-possession** (Ed25519) for a registered agent;
- a fresh **sudo token** for destructive/"strict" routes (re-enter the password).

Two operations additionally require the caller to be **physically at the console**
(loopback): MAESTRO login and MAESTRO password change. The server determines "at
the console" from the real TCP peer, never from a client header — so a remote
device on the VPN cannot spoof it.

**Rotating / revoking the governance password.** Settings → **Revoke** (or
`aimaestro-governance.sh invalidate-password`) revokes the password using the
password plus a one-shot code delivered to *this machine's desktop*. The old
credential is destroyed and the next login asks for a new one. Because it needs the
desktop code, it can only be completed from the machine itself — a remote holder of
the password cannot do it.

### Risks When Exposing to Network

**Local Network (WiFi):** not exposed — LAN connections are dropped at TCP level.

**Tailscale:**
- ✅ Encrypted VPN; only your Tailnet devices pass the perimeter
- ✅ Every app action still requires cookie / AID / sudo authentication
- ⚠️ No CORS/CSRF middleware yet — same-origin by design; a reverse-proxy or
  cross-origin deployment needs to add it
- ⚠️ No TLS on the direct bind — traffic is encrypted by Tailscale's WireGuard, not
  by the app

**Public Exposure (Tailscale Funnel):**
- ❌ **NOT RECOMMENDED** — Funnel bypasses the Tailscale-only perimeter and puts the
  app on the public internet. The identity layer still applies, but you lose the
  network layer entirely. Avoid unless you fully understand the trade-off.

### Recommendations

**For Tailscale access:**
1. Use Tailscale's built-in ACLs (Access Control Lists) to limit which devices reach the Mac
2. Enable key expiry
3. Keep the governance password strong, and revoke it (above) if it may have leaked

---

## Troubleshooting

### Cannot Access from Local Network

**1. Check if AI Maestro is running:**
```bash
pm2 status
# Should show: ai-maestro | online
```

**2. Check if port 23000 is listening:**
```bash
lsof -i :23000
# Should show: node ... LISTEN
```

**3. Check firewall settings:**
```bash
# macOS - check if Application Firewall is blocking connections
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# Allow incoming connections for Node.js if blocked:
# System Preferences → Security & Privacy → Firewall → Firewall Options
# Add node or allow incoming connections
```

**4. Test local IP connectivity:**
```bash
# From another device on your network
ping 10.0.0.18
# Should get responses
```

**5. Verify server is bound to all interfaces:**
```bash
lsof -i :23000 | grep LISTEN
# Should show: TCP *:23000 (not 127.0.0.1:23000)
```

---

### Cannot Access via Tailscale

**1. Check Tailscale status:**
```bash
tailscale status
# Should show: connected
```

**2. Verify Tailscale IP:**
```bash
ifconfig | grep -A 2 utun | grep "inet "
# Should show: 100.80.12.6
```

**3. Check Tailscale ACLs:**
- Go to [Tailscale Admin Console](https://login.tailscale.com/admin/acls)
- Ensure your devices can communicate

**4. Test connectivity:**
```bash
# From another Tailscale device
ping 100.80.12.6
# Should get responses
```

---

### .local Domain Not Working

**macOS/Linux/iOS/Android:**
- Usually works automatically via mDNS/Bonjour

**Windows:**
- Install [Bonjour Print Services](https://support.apple.com/kb/DL999)
- Alternatively, use IP address directly

**Verify mDNS resolution:**
```bash
# macOS/Linux
dns-sd -G v4 mac-mini.local

# Windows (with Bonjour)
ping mac-mini.local
```

---

### Custom Domain Not Resolving

**Router DNS:**
- Restart DNS service on router
- Clear DNS cache on client device:
  ```bash
  # macOS
  sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

  # Windows
  ipconfig /flushdns

  # Linux
  sudo systemd-resolve --flush-caches
  ```

**/etc/hosts:**
- Verify no typos in the file
- Ensure no duplicate entries
- Test with ping first:
  ```bash
  ping mac-mini.aimaestro
  ```

**DNS A Record (Tailscale custom domain):**
- Wait 5-15 minutes for DNS propagation
- Check DNS resolution:
  ```bash
  nslookup aimaestro.yourdomain.com
  dig aimaestro.yourdomain.com
  ```
- Remember: Only works from Tailscale-connected devices

---

## Performance Tips

### Local Network Performance

**Use Bonjour/mDNS when possible:**
- `http://mac-mini.local:23000` is fastest
- No DNS lookup delay
- Survives IP changes

**Prefer local IP over Tailscale when home:**
- `http://10.0.0.18:23000` has lower latency than `http://100.80.12.6:23000`
- No VPN routing overhead
- Direct network connection

### Tailscale Performance

**Use Direct Connections:**
- Tailscale prefers direct P2P connections when possible
- Check connection type:
  ```bash
  tailscale status
  ```
- Look for "direct" vs "relay"

**Enable subnet routing (advanced):**
- Expose your entire local network via Tailscale
- Allows accessing local IPs from remote Tailscale devices

---

## Summary

**Easiest options:**
- **Local network:** `http://mac-mini.local:23000` (works immediately)
- **Tailscale:** `http://100.80.12.6:23000` (works immediately)

**Best user experience:**
- **Local network:** Set up router DNS for `http://mac-mini.aimaestro:23000`
- **Tailscale:** Enable MagicDNS for `http://mac-mini.<tailnet>.ts.net:23000`

**Most flexible:**
- Own domain with DNS A record: `http://aimaestro.yourdomain.com:23000`

**Choose based on your needs:**
- **Just you, at home:** Use `.local` domain
- **Family/team, at home:** Set up router DNS
- **Remote access:** Use Tailscale
- **Professional setup:** Use custom domain + Tailscale

---

## Related Documentation

- [Operations Guide](./OPERATIONS-GUIDE.md) - Session management and troubleshooting
- [Requirements](./REQUIREMENTS.md) - Installation prerequisites
- [Troubleshooting](./TROUBLESHOOTING.md) - General troubleshooting guide

---

**Last Updated:** 2026-07-13
**AI Maestro Version:** 0.28.0+
