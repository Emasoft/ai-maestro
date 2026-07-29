# Tailscale REST API and fleet operations

Covers: the v2 REST API (auth, endpoints, rate limits), device lifecycle at scale, webhooks,
SCIM, Terraform/tsnet/SDKs, CI/CD ephemeral provisioning, audit/compliance scripting, fleet
health/discovery, Headscale (self-hosted control plane) backup/restore, Tailnet Lock, and
reusable script techniques including a full `ts_call.sh`/`ts_catalog.sh` operation-driven CLI
toolkit. SSH-specific access control and session recording live in
`references/ssh-and-agent-access.md` — cross-referenced below, not duplicated. `tailscale serve`
CLI verbs and the Serve-vs-Funnel access model are decided in the arbiter (`DECISIONS.md`
D1–D3) and covered fully in the serve/funnel reference; this file only cites API/scripting
touchpoints (Tailscale Services bring-up, `--json` scripting) where they intersect fleet
automation.

`[unverified]` = single-source or flagged LOW confidence. Version-gated behavior names
the version explicitly.

## 1. The API surface: two auth models, one base URL, no pagination

- **Two complementary automation surfaces, not one** — the Tailscale Admin (control-plane) API
  (`api.tailscale.com/api/v2`) is for TAILNET-WIDE operations reachable from anywhere with a
  token (list/delete/retag devices, manage auth keys, read ACL, audit); it explicitly
  complements, never replaces, the LOCAL-NODE CLI (`tailscale up/down/status/serve/funnel/ssh/
  file`), which requires running on the machine with `tailscaled`. **Safety rule for
  any agent driving this API: if `TAILSCALE_API_TOKEN` (or equivalent) is missing, STOP and ask
  the human — never invent or guess a token.**
- **Base URL:** `https://api.tailscale.com/api/v2` for essentially every documented call.
  One source gives the bare host `https://api.tailscale.com`
  with paths already carrying `/api/v2/...` — same endpoint, different way of writing it.
- **Tailnet addressing:** every tailnet-scoped path takes `{tailnet}`; use the literal `-` to
  mean "the tailnet this credential belongs to". Override
  with the literal org name or the account's email domain for multi-tailnet tokens/keys.
- **Two independently-valid auth schemes — NOT a bug, ship both:**
  - **Bearer token:** `-H "Authorization: Bearer $TS_API_KEY"` — used by the majority of
    sources.
  - **HTTP Basic, key as username, empty password:** `curl -u "$TOKEN:" ...` — the trailing
    colon is the empty-password marker. **Contradiction, resolved as
    dual-valid:** one source
    documents Bearer in its reference doc while its OWN shipped script uses Basic auth — this
    is a real dual-auth-scheme API, not an authoring error, but an implementer who reads only
    the doc would not expect the script's form. A second independent pair (one wrapper's
    `ts-api.sh` using Basic vs another's `tailscale_api.py` using Bearer) corroborates the
    same split. **Pick one scheme and use it consistently**
    within a given tool; don't assume the doc's example is the only valid form. `[unverified
    against a live call]`
  - **OAuth client credentials (`tskey-client-...`):** machine-scoped, tag- and
    scope-restricted (e.g. `devices:read`/`devices:write`/`dns:read`), exchanged for a
    short-lived (~1h) Bearer access token via `POST /oauth/token` with
    `client_id`/`client_secret`/`grant_type=client_credentials`.
    Recommended for CI/CD and any long-lived automation (zero long-lived secret checked in).
    OAuth creds can ALSO be used directly as HTTP Basic auth username/password for
    every call, not just the token exchange — e.g. `curl -u "$TS_CLIENT_ID:$TS_CLIENT_SECRET"
    "https://api.tailscale.com/api/v2/tailnet/$TS_TAILNET/devices"`, and to mint an
    auth key directly without a separate token-exchange step: `curl -X POST -u
    "$TS_CLIENT_ID:$TS_CLIENT_SECRET" ... /tailnet/$TS_TAILNET/keys -d
    '{"capabilities":{"devices":{"create":{"reusable":true,"ephemeral":false,
    "preauthorized":true,"tags":["tag:server"]}}},"expirySeconds":86400}'`.
  - **Legacy API access token (`tskey-api-...`):** user-scoped, expires 1–90 days.
    Some sources call this the "legacy" form next to OAuth client creds.
  - **Trust credentials** — delegated, fine-grained attribute-based auth, named alongside the
    two schemes above but not detailed further here.
- **Content types:** JSON for most endpoints; **HuJSON** (JSON + comments + trailing commas)
  for the ACL/policy-file endpoint — request it explicitly with `Accept: application/hujson`,
  or `Accept: application/json` for plain JSON back.
- **No pagination anywhere documented.** List endpoints (devices, keys, ACL) return the full
  payload in one response. Don't write pagination-handling code against
  these endpoints — there is nothing to paginate.
- **Rate limits — CONTRADICTED across sources, no arbiter available (not resolved in
  DECISIONS.md — record all four claims):**
  - One source: "**no published rate limits**; back off on 429s."
  - A second source: "**100 req/min per API key, burst to 200**"; headers
    `X-RateLimit-Limit`/`-Remaining`/`-Reset`; 429 body `{"message":"rate limit exceeded"}`.
  - A third source: "**120 req/min per API key**; exponential backoff recommended."
  - A fourth source: "rate limit **≈60 req/min/token**"; a batch/loop MUST surface 429s
    immediately rather than auto-retrying blind.
  These cannot all be literally true as stated (differ by more than plan-tier variance would
  plausibly explain, and no source cites a plan tier). Most plausible reconciliation: the
  published limit may differ by endpoint, account tier, or have changed over time, and no
  source's authoring date is available to arbitrate. **Practical guidance that survives every
  version of this claim:** never hardcode a specific number into retry logic — read
  `X-RateLimit-*` response headers when present, treat 429 as authoritative over any
  assumed budget, and back off exponentially rather than immediately retrying.
  `[unverified — genuine unresolved conflict]`
- **No official OpenAPI spec is published**, per one source; the authoritative fallback is
  `https://tailscale.com/api`. Contrast: another source's tooling derives its local
  operation catalog from a bundled (NOT shipped here — you supply it) `references/tailscale-api.json` OpenAPI-shaped spec (7208
  lines, 85 operations, 13 tag groups: `Contacts`, `DNS`, `DeviceInvites`, `DevicePosture`,
  `Devices`, `Keys`, `Logging`, `PolicyFile`, `Services`, `TailnetSettings`, `UserInvites`,
  `Users`, `Webhooks`). Both can be true if the spec is unofficial/community-derived
  rather than something Tailscale itself publishes at a stable URL — the regeneration script
  that's supposed to (re)fetch it points at a documentation page, not raw JSON, and is flagged
  LOW-confidence for that reason.
- **Credential-loading convention seen across multiple independent wrapper scripts:** a config
  file at `~/.clawdbot/credentials/tailscale/config.json` → `{"apiKey": "tskey-api-<redacted>",
  "tailnet": "-"}` (`tailnet: "-"` auto-detects from the API key; override with org name or
  email domain), with env-var alternatives `TS_API_KEY`/`TS_TAILNET`. A
  second, independent convention: `TS_API_KEY` (or fallback `TAILSCALE_API_KEY`) plus an
  overridable `TS_API_BASE` (default `https://api.tailscale.com/api/v2`) resolved once in a
  shared `ts_common.sh` so every script in the toolkit has one source of truth for auth/base
  URL.

## 2. Devices: the CRUD surface and field reference

**Endpoints** (verbatim, merged across sources — same operations, sometimes different verb
casing docs used the same real path):

| Method | Path | Notes |
|---|---|---|
| GET | `/tailnet/{tailnet}/devices` (`?fields=all` for full record) | list; omit `fields=all` for a leaner subset |
| GET | `/device/{deviceId}` | single device |
| DELETE | `/device/{deviceId}` | **permanent** removal — device cannot rejoin without a new auth key |
| POST | `/device/{deviceId}/authorized` `{"authorized": true}` | manual approval |
| POST | `/device/{deviceId}/expire` | force re-auth / kick offline immediately, **keeps the record** — use instead of delete to preserve history or force a compromise-response disconnect without losing audit trail |
| POST | `/device/{deviceId}/tags` `{"tags": [...]}` | **replaces the WHOLE tags array** — see gotcha below |
| GET/POST | `/device/{deviceId}/routes` | subnet-route approval |
| POST | `/device/{deviceId}` | general settings incl. `keyExpiryDisabled` |

**Verb-casing variance, one source only:** an endpoint table in one batch lists ACL update as
`PUT /tailnet/{tailnet}/acl`, while three independent sources (§4 below) show `POST`
for the same operation. The same source also uses the bare-host URL form
already flagged in §1 (no `/api/v2` in its "Base URL" line, carried in the path instead), which
suggests it may not be precise about HTTP-method casing either. **Treat `POST` as the primary
documented form (3 independent sources); the `PUT` form is `[unverified]`, single-source.**

**Device object fields** (union across sources): `id` (use
this in API paths — **not** the internal `nodeId`), `name`, `hostname`, `addresses` (Tailscale
IPs), `tags`, `os`, `clientVersion`, `lastSeen` (ISO timestamp, for staleness filtering),
`expires`, `authorized`, `user`, `keyExpiryDisabled`, `updateAvailable`,
`blocksIncomingConnections` ("shields up"), `online` (also derivable client-side from
`lastSeen` freshness < 300 s if the field itself isn't returned).

**Three critical entity-model footguns:**
1. A `tag:foo` **must already exist** in the ACL policy's `tagOwners` block before it can be
   applied to any device or auth key — applying an undeclared tag returns
   `400 {"message": "tagOwners block missing tag:foo"}`.
2. An auth-key secret (`tskey-auth-...`) is returned **only once**, in the
   `POST /tailnet/{tailnet}/keys` creation response body. After that, only metadata (id,
   capabilities, expiry) is retrievable — if lost, the only recovery is delete + recreate.
   Treat generated keys as secrets: write to a secrets store, never to tracked markdown.
3. `POST /device/{deviceId}/tags` **replaces the entire tags array** — sending one tag
   silently drops all others. Callers must always **read current tags first, splice locally,
   then POST the full desired set**.

Also: devices created from `ephemeral: true` auth keys **auto-delete from the tailnet when
they go offline** — a "lost device" may just be a stopped ephemeral instance, not a bug.

**Filtering/query recipes** (jq over `GET /tailnet/-/devices?fields=all`):
```bash
# stale (last seen > N days)
CUTOFF=$(date -u -v-30d +%s 2>/dev/null || date -u -d '30 days ago' +%s)   # macOS vs Linux date flags differ
jq --argjson cutoff "$CUTOFF" '.devices[] | select((.lastSeen|fromdateiso8601) < $cutoff)'
# untagged
jq 'select((.tags // []) | length == 0)'
# by tag
jq 'select(.tags // [] | index("tag:sidecar"))'
# by hostname regex
jq 'select(.hostname | test("dokploy-sidecar"))'
```
**Gotcha:** the `date` stale-cutoff one-liner differs macOS (`-v-30d`) vs Linux
(`-d '30 days ago'`) — a script targeting both platforms must branch or fall back.

**Curl+jq one-liner for a quick device listing/filter** (independent, terser variant):
```bash
curl -s -H "Authorization: Bearer $TS_API_KEY" \
  "https://api.tailscale.com/api/v2/tailnet/-/devices" | jq '.devices[] | {name, addresses, os, lastSeen}'
# regex filter:
jq '.devices[] | select(.name | test("agl|fgsrv"))'
```
API key comes from Admin Console → Settings → Keys.

**Live-status discovery is more trustworthy than a cached inventory.** A manager-cached
Tailscale-IP list can go stale; discover topology via **live** `tailscale status --json`,
matching hostname/DNS name and reading the node's *current* IP. MagicDNS may be disabled in
some environments — use `TailscaleIPs[0]` directly rather than relying on a `.local`/short
hostname. A running node can learn its own tailnet identity at startup (for dynamic
CORS-origin registration or self-registration with a coordinator) via the same command:
```python
status = json.loads(subprocess.check_output(["tailscale","status","--json"], text=True))
dns_name = status.get("Self", {}).get("DNSName", "").rstrip(".")
```
also exposing `.Self.HostName` and `.TailscaleIPs[0]`. The **same pattern** is used by
remote workers to `POST /api/workers/register` their `hostname`/`tailscale_ip`/`dns_name`/
`capabilities` to a coordinator backend reached at `BACKEND_URL` (set to
`http://localhost:PORT` on the same host, or `https://mac-mini.tailnet.ts.net` for a remote
worker) — i.e. this identity-discovery snippet doubles as a fleet-registration primitive, not
just a CORS-origin helper.

**Device-name → ID resolution pattern** (reusable technique, seen independently in 2 wrapper
scripts): accept a raw numeric ID, a `nodekey:`-prefixed string, or a hostname — in the
hostname case, search the device list to resolve it, so every subcommand (authorize/delete/
tags/routes) accepts a human-friendly name instead of forcing the caller to already know the
numeric ID. Both implementations deliberately **fail open to the server**: if
hostname lookup fails they return the raw input unchanged and let the API itself error on an
invalid id, rather than validating client-side.

## 3. Auth keys

**Creation** — `POST /tailnet/{tailnet}/keys`:
```bash
curl -X POST -u "$TOKEN:" -H "Content-Type: application/json" -d '{
  "capabilities": {"devices": {"create": {"reusable": true, "ephemeral": true, "preauthorized": true, "tags": ["tag:ci"]}}},
  "expirySeconds": 86400, "description": "CI runner key"}' https://api.tailscale.com/api/v2/tailnet/-/keys
```

**OAuth-credential variant of the same call** (Basic auth with client id/secret instead of a
bearer token, no separate `/oauth/token` exchange needed for this one call):
```bash
curl -X POST -u "$TS_CLIENT_ID:$TS_CLIENT_SECRET" -H "Content-Type: application/json" \
  "https://api.tailscale.com/api/v2/tailnet/$TS_TAILNET/keys" \
  -d '{"capabilities":{"devices":{"create":{"reusable":true,"ephemeral":false,"preauthorized":true,"tags":["tag:server"]}}},"expirySeconds":86400}'
```

**Curl variant with PascalCase JSON keys** (a third-party wrapper's own doc; verify against
the official lowerCamelCase schema above before copying verbatim — this may be a documentation
simplification rather than an alternate accepted schema):
```bash
curl -X POST "https://api.tailscale.com/api/v2/tailnet/-/keys" \
  -H "Authorization: Bearer $TS_API_KEY" \
  -d '{"Reusable": true, "Ephemeral": false, "Tags": ["tag:agl-server"], "ExpirySeconds": 86400}'
```
`[unverified — field-name casing not cross-checked against another source]`

Four independent flags combine: `reusable` × `ephemeral` × `preauthorized` × `tagged`.
**Default expiry 90 days, max 90**. Decision table for which combination to use:

| Situation | Key type |
|---|---|
| Fleet deployment | reusable |
| Single device | single-use |
| Containers / CI | ephemeral |
| Automated / unattended setup | preauthorized |

Ephemeral device default expiry in one source's onboarding flow: **1 day**, vs 90 for
standing devices — this is a policy/skill recommendation layered on top of the
platform's own 90-day default, not a platform-enforced value; ship both numbers
with their different scope. Warn the operator: **"auth key value is shown only once — save it
immediately"**.

**Key-management wrapper workflow (create/list/revoke)** — a richer, independently-documented
CLI/abstraction layer over the same endpoints:
```bash
./scripts/ts-api.sh create-key --reusable --tags tag:server
./scripts/ts-api.sh create-key --ephemeral
./scripts/ts-api.sh create-key --reusable --tags tag:server --expiry 7d
./scripts/ts-api.sh keys
# or via a cloud-exec-style abstraction:
cloud_exec('tailscale', 'key create --ephemeral --reusable --tags tag:server')
cloud_exec('tailscale', 'key list')
cloud_exec('tailscale', 'key delete <KEY_ID>')
tailscale up --authkey=<key>            # install command for the created key
```
Full field set gathered from the operator when creating a key: Reusable (default false),
Ephemeral (device auto-removes when offline, default false), Preauthorized (skip manual device
auth, default false), Tags, Expiry (default 90 days = 7776000 seconds), Description.
**Revocation gotcha:** revoked keys **cannot be un-revoked** — require explicit confirmation
before revoking. Long-lived reusable + non-ephemeral keys are flagged as a security concern;
recommend rotation — create the replacement key BEFORE revoking the old one.

**Deletion:** `DELETE /tailnet/{tailnet}/keys/{keyId}`.

## 4. ACL / policy-file API

```bash
curl -u "$TOKEN:" https://api.tailscale.com/api/v2/tailnet/-/acl        # GET — HuJSON + ETag
curl -X POST -u "$TOKEN:" -H "Content-Type: application/json" \
  -H "If-Match: \"$ETAG\"" -d @policy.json https://api.tailscale.com/api/v2/tailnet/-/acl
curl -X POST -u "$TOKEN:" -H "Content-Type: application/json" \
  -d '{"src":"alice@example.com","dst":"tag:server"}' https://api.tailscale.com/api/v2/tailnet/-/acl/preview
```
`POST` to the ACL endpoint **replaces the entire policy** — there is no partial
patch. (One source's endpoint table instead shows `PUT` for this call —
`[unverified]`, see the verb-casing note in §2; three independent sources agree on `POST`.)

- **Concurrency control:** the trailing `:` in `-u "$TOKEN:"` means empty HTTP Basic password
  (the key IS the username). Without `If-Match`/ETag, a concurrent policy edit
  **silently overwrites yours** — always read the current ETag first and send it back.
- **Format is header-selected:** `Accept: application/hujson` preserves comments (round-trips
  a human-edited file); `Accept: application/json` returns plain JSON.
- **Validation before write:** `POST /tailnet/{tailnet}/acl/validate` (dry-validate) and the
  `/acl/preview` endpoint (dry-run a specific `src`/`dst` pair against the policy). **These two
  endpoints ARE the pre-commit lint** — there is no local CLI linter:
  the widely-cited `tailscale debug policy lint acl.json` does **not exist on 1.98.5**
  (`tailscale debug: unknown subcommand: policy`), so a CI/pre-commit hook must call
  `/acl/validate` with a token, not shell out to the CLI.
- **Status codes documented for this endpoint**: `200` ok, `400` malformed
  HuJSON/invalid policy, `401` auth failed, `403` insufficient perms, `412` ETag mismatch
  (concurrent edit — this is the collision the `If-Match` header exists to catch), `422`
  validation error (policy tests failed / semantic error), `429` rate limited, `500` server
  error.
- **GitOps pattern** — push-triggered ACL apply from a git-tracked policy file, with a
  pre-commit lint gate:
  ```yaml
  on: {push: {paths: ['tailscale-acl.json'], branches: [main]}}
  jobs:
    update-acls:
      steps:
        - uses: actions/checkout@v3
        - env: {TAILSCALE_API_KEY: ${{ secrets.TAILSCALE_API_KEY }}, TAILSCALE_TAILNET: ${{ secrets.TAILSCALE_TAILNET }}}
          run: |
            curl -X POST "https://api.tailscale.com/api/v2/tailnet/${TAILSCALE_TAILNET}/acl" \
              -u "${TAILSCALE_API_KEY}:" -H "Content-Type: application/json" --data @tailscale-acl.json
  ```
  This example omits the `If-Match` ETag check that this section says is needed
  to avoid clobbering a concurrent admin-console edit — add it before adopting verbatim.
- **Grants `ip` field syntax — bare port numbers vs `proto:port` prefix, unresolved.** One
  source's grants example uses bare port numbers with no protocol prefix (`"ip": ["22",
  "443"]`), implying both TCP+UDP, while every other grants example here
  uses an explicit `proto:port` form (`"ip": ["tcp:443"]`). No source
  states outright that the bare-port form is accepted syntax. **Verify against current
  official Tailscale grants docs before treating the bare-port form as authoritative**
  `[unverified — LOW confidence]`. Full grants/policy-language syntax lives in the ACL-and-
  policy reference; this note is recorded here only because it surfaces through the same
  `POST .../acl` payload documented above.

## 5. DNS, webhooks, SCIM

- **DNS endpoints:** `GET/POST /tailnet/{tailnet}/dns/nameservers`,
  `GET/POST /tailnet/{tailnet}/dns/preferences` (MagicDNS on/off). CLI-level
  wrapper equivalents: `./scripts/ts-api.sh dns` (show config), `./scripts/ts-api.sh
  dns-nameservers` (list nameservers), `./scripts/ts-api.sh magic-dns on|off` (toggle) —
  mirrored as MCP-style tool pairs `tailscale_dns_splitdns_get/set`,
  `tailscale_dns_nameservers_get/set`, `tailscale_dns_searchpaths_get/set`,
  `tailscale_dns_preferences_get/set`.
  - **Split-DNS PATCH gotcha (load-bearing, differs from the ACL endpoint's full-replace
    semantics):** the split-DNS `_set` call uses **PATCH** semantics — it **merges** with the
    existing per-domain routes, it does **NOT replace the whole set**. To REMOVE a route you
    must explicitly set that domain's nameserver list to an empty array (`{"domain": []}`),
    not simply omit it from the payload. Split-DNS changes affect **ALL** tailnet devices —
    always warn before applying.
  - **Split-DNS conceptual model:** a "restricted nameserver" applies only to queries matching
    a specific domain (e.g. `example.com → 10.0.0.1`) — only `*.example.com` queries use that
    internal DNS server, everything else falls to global nameservers. Recommend ≥2 global
    nameservers for redundancy; common choices: Cloudflare `1.1.1.1`/`1.0.0.1`, Google
    `8.8.8.8`/`8.8.4.4`, Quad9 `9.9.9.9`/`149.112.112.112`. Public global nameservers get
    DNS-over-HTTPS (DoH) automatically — "no additional configuration needed".
  - **MagicDNS hostname-based access — best practice, use everywhere:** every machine gets
    `hostname.tailnet-name.ts.net`; e.g. `ssh home-server.tailnet.ts.net`, `psql -h
    db-server.tailnet.ts.net -U postgres`, `curl http://api-server.tailnet.ts.net:3000/health`.
    IPs change, DNS names don't.
  - **`100.100.100.100` is the well-known MagicDNS resolver anchor** (IPv4) — and
    `fd7a:115c:a1e0::53` is its IPv6 equivalent, seen as an NRPT-protection pattern in Windows
    scripts. **Any general-purpose VPN/DNS-residue cleanup tool MUST protect this
    anchor** before touching resolver config, because Tailscale's own DNS config resembles the
    exact catch-all/per-domain-override pattern such cleanup tools are designed to remove —
    naive cleanup breaks Tailscale. The macOS/Linux scripts covered here protect
    only the IPv4 anchor by default; **extend the protect-list to include the IPv6 anchor on
    Unix cleanup scripts too** — only the Windows NRPT scripts do so today. The
    generalizable safe-repair pattern any such cleanup tool should follow: (1) default to
    dry-run, require an explicit `--apply`/`-Apply` flag to mutate; (2) filter targets against
    a protect-pattern regex defaulting to the MagicDNS anchor(s), configurable via
    `--protect=REGEX`; (3) print BEFORE state, then the TARGETS list, then (if applying)
    remove/revert only the unprotected entries; (4) flush the DNS cache
    (`dscacheutil -flushcache && killall -HUP mDNSResponder` on macOS /
    `resolvectl flush-caches && systemctl restart systemd-resolved` on Linux /
    `Clear-DnsClientCache; ipconfig /flushdns` on Windows); (5) re-run a resolution + HTTPS
    test and print PASS/FAIL; (6) print AFTER state. Test suites covered here
    explicitly assert BOTH halves of the redaction behavior for such tools: that `--redact`
    masks `*.ts.net` tailnet names, AND that it leaves the `100.100.100.100` anchor
    unmodified — i.e. redaction and anchor-protection are two independently test-covered
    guarantees, not one.
  - **Browser-level DNS-over-HTTPS silently bypasses the OS resolver entirely** — a real
    "Chrome works but curl/Safari doesn't" root cause that OS-resolver-level Tailscale
    diagnosis alone will never explain. Chrome/Brave/Edge store DoH mode under
    `dns_over_https.mode` (`off`/`automatic`/`secure`) + `.templates` in their `Preferences`
    JSON; Firefox stores `network.trr.mode` (0=off/system DNS, 2=enabled-with-fallback,
    3=enabled-no-fallback, 5=disabled-by-policy) + `network.trr.uri` in per-profile
    `prefs.js`. Diagnostic scripts parse both without a JSON-parser dependency (targeted
    regex/`awk -F'"'`).
- **Webhooks:** `GET /tailnet/{tailnet}/webhooks` to list; create with:
  ```bash
  curl -X POST -u "$TS_CLIENT_ID:$TS_CLIENT_SECRET" -H "Content-Type: application/json" \
    "https://api.tailscale.com/api/v2/webhooks" \
    -d '{"endpointUrl":"https://your-server.com/webhook","providerType":"slack","subscriptions":["nodeCreated","nodeDeleted"]}'
  ```
  Verify signatures with HMAC-SHA256 over the raw body against a shared webhook secret:
  ```python
  expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
  if signature != expected: return 'Invalid signature', 401
  ```
  **Event types documented:** `nodeCreated`, `nodeDeleted`, `nodeApprovalChanged`,
  `nodeKeyExpiringInOneDay`, `nodeKeyExpired`, `userCreated`, `userDeleted`, `userSuspended`,
  `userRestored`, `policyUpdate`, `exitNodeSuggestionChanged`. `nodeNeedsApproval` is
  used elsewhere for the automated-approval flow below — treat the full event vocabulary as a
  union of these two lists.
- **Automated device approval via webhook + API** — on `nodeNeedsApproval`, check an external
  trust source (asset registry / EDR posture), then:
  ```bash
  curl "https://api.tailscale.com/api/v2/device/$DEVICE_ID/authorized" -u "tskey-api-xxxxx:" \
    --data-binary '{"authorized": true}'
  ```
  For non-webhook automation, **pre-approved auth keys** (Settings → Keys → Pre-approved)
  bypass manual approval entirely — appropriate when an MDM is the trust anchor instead of a
  webhook-driven check.
- **SCIM provisioning:** enable under admin console user management → generate a SCIM API key
  (case-sensitive) → paste into the IdP's SCIM config (Okta / Entra / Google Workspace). Synced
  group names typically land in policy files as `group:<name>@<domain>`:
  ```json
  "tagOwners": {"tag:logging": ["group:security-team@example.com"]},
  "grants": [{"src": ["group:security-team@example.com"], "dst": ["tag:logging"], "ip": ["*"]}]
  ```
  Role changes in the IdP propagate to access automatically. **Gotcha: DEACTIVATE users in the
  IdP, not suspend** — a merely-suspended user retains tailnet access until their device keys
  expire.

## 6. Terraform, tsnet, and SDKs

**Terraform provider** — full pattern, merged from two sources with matching shape:
```hcl
terraform {
  required_providers { tailscale = { source = "tailscale/tailscale", version = "~> 0.13" } }
}
provider "tailscale" {
  oauth_client_id     = var.oauth_client_id
  oauth_client_secret  = var.oauth_client_secret
  tailnet              = var.tailnet
}
resource "tailscale_tailnet_key" "server_key" {
  reusable = true; ephemeral = false; preauthorized = true; tags = ["tag:server"]
}
resource "tailscale_key" "ci_key" {   # ephemeral CI variant
  reusable = true; ephemeral = true; preauthorized = true; tags = ["tag:ci"]; expiry = 3600
}
resource "tailscale_acl" "main" {
  acl = jsonencode({ groups = {...}, tagOwners = {...}, grants = [
    {src = ["tag:ci"], dst = ["tag:staging"], ip = ["*:*"]}
  ] })
}
resource "tailscale_dns_nameservers" "main" { nameservers = ["1.1.1.1", "8.8.8.8"] }
resource "tailscale_dns_search_paths" "main" { search_paths = [var.domain] }
output "server_auth_key" { value = tailscale_tailnet_key.server_key.key; sensitive = true }
```
Mark generated key outputs `sensitive = true`.

**`tsnet` (Go only)** — embeds a Tailscale node directly in a binary, no separately-managed
`tailscaled` daemon: useful for a service that should carry its own tailnet identity.
```go
srv := &tsnet.Server{Hostname: "my-service", AuthKey: os.Getenv("TS_AUTHKEY")}
ln, _ := srv.Listen("tcp", ":443")
```
State must be deliberately chosen — ephemeral for throwaway services, durable state for a
stable service identity. **There is no Python equivalent** — Python workloads must install
Tailscale on the host and use `tailscale serve` to expose local services, or drive the REST
API directly.

**Python SDK / client options — three named, not fully consistent on which is "the" one:**
- `frenck/python-tailscale` (`pip install tailscale`, Python ≥3.11) — **async** client:
  ```python
  async with Tailscale(tailnet="...", api_key="tskey-api-...") as ts:
      devices = await ts.devices()
  ```
  A separate source shows the same package's example in a **sync-looking**
  form — `pip install tailscale; from tailscale import Tailscale; ts =
  Tailscale(api_key="tskey-api-...", tailnet="example.com"); devices = ts.devices()` — with
  helper methods `ts.device_by_name(...)`, `ts.delete_device(...)`,
  `ts.create_auth_key(reusable=..., ephemeral=..., preauthorized=..., tags=[...])` used
  WITHOUT `await`.
  `[unverified]` whether this sync-looking example is a documentation simplification of the
  same async package, or the package genuinely offers a sync-compatible surface — flag before
  trusting a sync call against this client without testing.
- `tailscale-api` (`pip install tailscale-api`) — **sync** client, supports both API-key and
  OAuth: `tsc.set_token(...)` or `tsc.set_oauth_client_info(...)` +
  `tsc.set_token(tsc.get_oauth_token())`.
- A raw `requests`-based client is also commonly hand-rolled directly against the REST API
  (see §7 below) rather than using either package.

## 7. CI/CD, ephemeral nodes, and fleet provisioning

**Tailscale vs ngrok/Cloudflare Tunnel/bore/SSH for agent fleets** — a decision matrix from an
opinionated (non-vendor) skill, useful framing for choosing exposure tooling specifically for
multi-machine AI-agent meshes: "Agent fleet (multiple machines), need selective public
exposure → Tailscale mesh + Funnel for specific services"; "all-private team access →
Tailscale serve (no public exposure)". Bandwidth/auth comparison: Tailscale fleet mesh =
SSO+ACL-based auth, unlimited bandwidth, ~2 min/machine setup — positioned specifically
against single-tunnel tools for the multi-machine case. `[MED confidence —
opinionated skill, not vendor doc]`

### Positioning Tailscale as the "advanced / self-hosted" alternative to a product's own remote-relay feature

A support-triage pattern for a desktop application that ships its own built-in official
remote-access relay: distinguish the DEFAULT user path (log into the same cloud account on two
devices, use the vendor's own device list / relay) from an ADVANCED, self-hosted path (LAN
access, Tailscale, or a self-built VPN/reverse proxy directly to the host-side web-UI runtime),
and route the user to the right one based on their actual goal rather than defaulting everyone
to the advanced path.

Routing rules used:

1. **Default remote use across your own devices** ("open my own machine from my phone/tablet")
   → point at the vendor's own official remote/relay feature first. Do not lead with Tailscale
   for this case.
2. **"I want to use my own browser / LAN / Tailscale / reverse proxy"** → this is the host-side,
   self-managed web-UI runtime path. Tailscale is offered here as one of several options
   (alongside plain LAN access and a self-built reverse proxy/VPN), specifically for users who
   do NOT want to route through the vendor's own relay.
3. **Long-running / server deployment** (headless, systemd-managed) → a separate deployment
   guide, independent of which remote-access transport (official relay vs. Tailscale vs. LAN) is
   used to actually reach it once running.
4. IM/bot channel configuration (Telegram, Lark, DingTalk, Slack tokens) is a SEPARATE settings
   area from any of the above remote-access transports — do not conflate "how do I reach the web
   UI remotely" with "how do I configure a chat-bot channel".

Explicit anti-pattern flagged: don't point users at a legacy settings page/route the product has
since removed — if a user references an old entry point, explain that it's a legacy route
(possibly redirected for compatibility) and that both the vendor's official remote-relay AND the
self-hosted paths (LAN, Tailscale, reverse proxy) documented in the current deployment guide
remain fully supported, just reached from different UI entry points than before.

Framing to use when a user explicitly asks "does browser/WebUI access still work at all": answer
yes, but clarify it is now a HOST-RUNTIME/DEPLOYMENT capability (configured on the machine
acting as host) rather than something toggled from a per-device desktop settings page —
Tailscale is one of the transports used to reach that host runtime from elsewhere.

**Ephemeral nodes** auto-remove after ~30–60 min idle; created via ephemeral auth keys or
OAuth clients with `?ephemeral=true` appended to the client secret. Recommended auth
for CI is **workload identity federation** (zero long-lived secrets) where the platform
supports it.

**GitHub Actions:**
```yaml
permissions:
  id-token: write   # required for workload identity federation
steps:
  - uses: tailscale/github-action@v4
    with:
      oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
      oauth-secret: ${{ secrets.TS_OAUTH_SECRET }}
      tags: tag:ci
```
Node auto-removes at workflow end; the OAuth client must be scoped to the same tag to mint
keys for it.

**Bash fleet-provisioning (parallel SSH install + join):**
```bash
SERVERS=("10.0.1.10" "10.0.1.11" ...); TAGS="tag:prod,tag:api"
AUTH_KEY=$(curl -s -X POST "https://api.tailscale.com/api/v2/tailnet/$TAILNET/keys" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "{\"capabilities\":{\"devices\":{\"create\":{\"reusable\":true,\"tags\":[\"$TAGS\"]}}}}" | jq -r '.key')
for server in "${SERVERS[@]}"; do
  ssh "$server" "sudo apt-get update && sudo apt-get install -y tailscale && \
    sudo tailscale up --authkey=$AUTH_KEY --hostname=api-\$(hostname -s)" &
done
wait
```
One reusable auth key, parallel `&`/`wait` fan-out, per-host hostname suffix.

**Python fleet-provisioning helper functions** (device list / tag / auth-key / route-approve),
merged shape from THREE independent scripts converging on the same design:
```python
API = "https://api.tailscale.com/api/v2"; TAILNET = "example.com"
headers = {"Authorization": f"Bearer {API_KEY}"}
def list_devices(): return requests.get(f"{API}/tailnet/{TAILNET}/devices", headers=headers).json()["devices"]
def set_device_tags(device_id, tags): requests.post(f"{API}/device/{device_id}/tags", json={"tags": tags}, headers=headers)
def create_auth_key(reusable=False, ephemeral=False, tags=None):
    body = {"capabilities":{"devices":{"create":{"reusable":reusable,"ephemeral":ephemeral,"tags":tags or []}}}}
    return requests.post(f"{API}/tailnet/{TAILNET}/keys", json=body, headers=headers).json()["key"]
def approve_routes(device_id, routes): return requests.post(f"{API}/device/{device_id}/routes", json={"routes": routes}, headers=headers)
```
**Gotcha (corroborated across the same family of scripts):** this Python shape uses
`Authorization: Bearer`, while the sibling shell wrapper (`ts-api.sh`, §1/§2) instead uses
Basic auth with the key as username — both are valid Tailscale API auth methods; don't assume
one script's choice generalizes to the whole toolkit.

**Kubernetes fleet gotcha (Talos):** bind kubelet and etcd to the **physical LAN subnet**, NOT
the Tailscale IP:
```yaml
machine:
  kubelet:
    nodeIP:
      validSubnets: ["192.168.1.0/24"]
  cluster:
    etcd:
      advertisedSubnets: ["192.168.1.0/24"]
```
Without this, kubelet binds to the Tailscale IP (`100.x.y.z`) and etcd peers over the tailnet,
**breaking the cluster on node reboot** — easy to miss, high-severity.

**Agent-fleet worktree isolation (multi-agent hosts sharing one Tailscale-connected worker):**
```bash
git fetch origin --prune; git pull --ff-only origin main
git worktree add -b feature/issue-123 ../worktrees/project-issue-123 origin/main
```
Give each agent explicit ownership, acceptance criteria, validation requirements, and delivery
boundaries (commit/push/PR/publish/merge permissions) — **never infer approvals**.

**CI/K8s workload state note:** for a workload node that must survive pod stop/start with the
SAME tailnet identity, persist `tailscaled --state=` to a mounted volume rather than
re-registering on every start (userspace-networking mode used where kernel TUN mode is
unreliable in the target sandbox):
```bash
TAILSCALE_SOCKET=/tmp/tailscaled.sock
tailscaled --state=/workspace/tailscale.state --socket="${TAILSCALE_SOCKET}" \
  --tun=userspace-networking >/tmp/tailscaled.log 2>&1 &
sleep 8
tailscale --socket="${TAILSCALE_SOCKET}" up --authkey=<redacted> --accept-routes=false --hostname=airco-gpu
```
**Gotcha:** if the persisted state file references a node already removed from the admin
console, `tailscale up` fails — fix by deleting the state file and re-running `up` with a
fresh auth key. `[MED confidence — single environment-specific source, concrete and
reproduced]`

**Scoped userspace `tailscaled` for a per-task ephemeral instance (a distinct, more elaborate
pattern than the persisted-state case above)** — a "remotehost" tool starts/stops a userspace
`tailscaled` scoped under `/private/tmp/`, runs `tailscale serve`/`funnel`, and schedules
background cleanup via a detached `nohup` job so the teardown outlives the invoking session.
Three reusable techniques inside it:
1. **Mode auto-detection** (`choose_mode`) probes `tailscale status` ONCE and falls through 3
   states — system-mode-connected / system-mode-logged-out / needs-userspace-fallback — rather
   than requiring the caller to specify a mode.
2. **`archive_state` renames (never deletes)** stale state directories with a timestamp suffix
   before starting fresh, so a `--fresh` rotation is non-destructively recoverable.
3. **`schedule_cleanup`** converts a human duration string (`1h`/`30m`/`2h`/`1d`) to raw
   seconds and backgrounds the teardown via `nohup sh -c "sleep '$seconds'; ..."` — the cleanup
   survives the invoking process/session ending, rather than depending on a parent staying
   alive. Explicitly **NOT idempotent-safe** to call twice without checking prior PID files —
   the script does check and kill a prior tracked `pid_path` before starting a new userspace
   daemon.

**Cloning a VM/container requires an explicit identity reset**, or the clone conflicts
with/duplicates the source's tailnet identity:
```bash
ssh root@<ip> "tailscale down && tailscale up --hostname=<new-name> --authkey=<new-key>"
```

**Exit-node fleet bring-up** (CLI-only, no API call — included here because it mirrors the
subnet-router bring-up script's fleet-provisioning shape): `sudo tailscale up
--advertise-exit-node` locally, then admin-console approval ("Use as exit node"); a
`setup_exit_node.sh [auth_key]` script mirrors the subnet-router bring-up (install, enable IP
forwarding, verify, `tailscale up --advertise-exit-node [--auth-key=... --advertise-tags=
tag:exit-node]`), printing next-step instructions including `tailscale set
--exit-node=$(tailscale status --json | jq -r '.Self.HostName')` for selecting it from a peer.
Full exit-node CLI semantics (LAN-access flags, stateful filtering, ACL restriction)
belong in the core-networking reference; this entry exists here only as a fleet-bring-up
script pattern.

## 8. Device-lifecycle operations at fleet scale — the three destructive verbs

Restated with the risk framing every source insists on surfacing to a human/operator before
firing:

| Operation | Effect | When to prefer it |
|---|---|---|
| `DELETE /device/{id}` | Permanently removes the device; it cannot rejoin without a fresh auth key | Decommissioning for good |
| `POST /device/{id}/expire` | Kicks offline immediately, **keeps the record** — device must re-authenticate to reconnect | Preserve history, or force a compromise-response disconnect without losing the audit trail |
| `POST /device/{id}/tags` | **Wholesale replaces** the tags array | Any tag change — always read-diff-write |

Both route-approval changes and tag changes affect live access/topology — **surface a
warning to the human/operator before applying**, and if the device is currently online, warn
that deleting it disconnects it immediately. **Always re-verify with a
read-op after any mutation**.

**Live-test protocol for a Tailscale-driving tool (test-suite technique):** for every
tool/endpoint, call it and verify the response shape; for WRITE tools, verify the entry was
created, then **clean up and verify removal**. One test-suite deliberately SKIPS destructive
ops entirely (`device_delete`, `device_authorize`, `device_routes_set`, `device_tags_set`,
`device_posture_set`, every `dns_*_set`, `acl_set`, `acl_preview`, `tailnet_contacts_set`,
`log_stream_set`), running a full write-then-cleanup cycle **only** for auth-key
create → get → delete → list-confirm-gone, using
`capabilities.devices.create.reusable=false`, `.ephemeral=true`, `expirySeconds=3600`,
`description="mcp-live-test"`. Reusable pattern for testing any API-driving tool
against a **live** tailnet without risking real device/ACL/DNS state.

**Device-record source-of-truth discipline:** treat a shared, documented tailnet inventory
(aliases, tailnet IPs, SSH usernames, known-good commands, platform notes) as source of
truth — check it before improvising. Write back new **confirmed** facts (a verified IP, a
working command, whether passwordless key auth works); **never write back uncertain
guesses**.

### Tailnet Lock — cryptographic device-signing gate on the whole fleet

```bash
tailscale lock status
sudo tailscale lock init
sudo tailscale lock add <key>
sudo tailscale lock remove <key>
```
Cryptographically prevents an unauthorized or compromised control-plane device from silently
joining the tailnet — a fleet-wide trust gate layered above ordinary device authorization.

### Remote-exec fleet safety patterns (agent-driven, not SSH-ACL-specific)

A dedicated "run this command on one/many tailnet devices" wrapper resolves the target against
`tailscale status --json`, preferring config-file aliases first, then exact HostName/DNSName
match, then prefix match, then raw `TailscaleIPs`, else falls through to the literal input
(letting ssh/curl error naturally). It carries a hardcoded `DANGEROUS_TOKENS` blocklist
(`rm -rf`, `mkfs`, `dd if=`, `:(){`, `shutdown`, `reboot`, `halt`, `poweroff`, `diskutil
erase`, `sudo rm`) that **refuses `--all`-node execution** of anything matching, and requires
explicit `--yes` even for a single-target dangerous command. This is a distinct
safety layer from the general SSH ACL/session-recording controls in
`references/ssh-and-agent-access.md` — it operates at the wrapper-script level, before any
command reaches the transport.

**Composite load-score for "run this on my least-loaded machine" fleet workflows:**
```
score = (cpu_pct * 0.4) + (mem_pct * 0.3) + (disk_pct * 0.3)
```
Lower score = better candidate. Metrics gathered per host over SSH via standard Unix tools —
`uptime`/`top` (CPU), `free`/`vm_stat` (memory), `df` (disk) — no dedicated scheduler needed to
pick an execution target across a Tailscale-connected fleet. `[MED confidence — the
0.4/0.3/0.3 weighting is asserted by the source project without external justification]`

**Timeout tiering convention for remote command execution, by expected duration:** quick
checks (`hostname`, `df -h`) 5–10 s; moderate operations (`npm install`) 30–60 s; long-running
tasks (`docker build .`) 300 s+. Best practice: set the timeout ~20–30% longer than the
expected duration, and use `--dry-run` first to estimate timing before committing to a value.
`[MED confidence — presented as guidance, not a measured rule]`

## 9. Audit logging and compliance scripting

**Composite tailnet audit in 3 API calls** (well under any of §1's rate-limit figures):
`GET /tailnet/-/devices?fields=all`, `GET /tailnet/-/keys`, `GET /tailnet/-/acl`
(`Accept: application/json`, never `?details=1`). From these three responses, compute:
- device total / stale / untagged / by-tag counts;
- key total / expired / reusable (flag for review) / description-less (flag as
  audit-blind) counts;
- the "killer correlation": `tagOwners` keys **declared** vs the union of every device's
  `.tags[]` **in use** — `defined − used` surfaces ACL cleanup candidates via a jq set
  difference.

Recommended cadence: monthly, or before any cleanup project to establish a baseline.

**Automated finding-generation scripts** — TWO independently-authored scripts converge on
almost the same rule set, merged here as one canonical checklist:

`audit_devices()` flags:
- `keyExpiryDisabled: true` → **HIGH** ("device never requires re-authentication")
- `updateAvailable: true` → **MEDIUM** ("Tailscale update available but not installed")
- `blocksIncomingConnections: true` → **INFO** ("shields up" mode, informational only)

`audit_acl()` flags:
- a legacy ACL rule with `"*"` in `src` **and** any `dst` matching `"*:*"` → **CRITICAL**
  ("allow-all rule — no zero trust segmentation")
- an `ssh` rule with `action == "accept"` **and** `"*"` in `src` → **HIGH**
  ("SSH access allowed from all users")

Client shape both scripts share: a thin wrapper (`TailscaleClient`) around
`list_devices`/`get_acl`/`list_dns`/`list_webhooks` (one variant adds
`get_key_expiry_disabled`), `Authorization: Bearer <api-key>`, CLI flags
`--api-key` (required), `--tailnet` (default `"-"`), `--output` (optional JSON dump path).
**Gotcha (security):** `--api-key` as a plain argv string leaks the key into
shell history and the process list — prefer an env var or a file, never argv, for a
credential-bearing flag.

**A weaker, "static-claim" compliance report generator exists as a cautionary example, not a
model to copy** — it emits 5 named `zero_trust_checks`, but one of them
(`encryption: always PASS — "All connections use WireGuard end-to-end encryption"`) verifies
nothing at runtime; it is a fixed string, not a live check. The other four are real (if
partial) checks: `identity_based_access` (PASS iff every node has non-empty `tags`),
`least_privilege` (always `REVIEW` — flagged for manual ACL review, never automated),
`continuous_verification` (PASS iff no node has empty `key_expiry`, else WARNING),
`device_trust` (always `REVIEW` — verify device authorization + Network Lock manually).
**Lesson for any audit tool this skill helps build: never label a static/unchecked
claim as "PASS" alongside genuinely-computed checks** — it misleads a reader of the report
into treating an assertion as evidence.

**Compliance talking points (SOC 2 / GDPR)** — narrative points for a Tailscale-deployment
compliance conversation, not automatable checks: SOC 2 — end-to-end WireGuard encryption in
transit, ACL-based authorization, audit logging for connection events, key management via the
coordination server. GDPR — data minimization (Tailscale routes traffic, does not inspect
payload), end-to-end encryption, a self-hosted Headscale option for data-sovereignty
requirements, configurable log retention per org policy. `[MED confidence — marketing
/ compliance-narrative framing, not verified against an actual audit engagement]`

**Session recording (`tsrecorder`) as a fleet-ops / audit concern:** full mechanism, deploy
recipes (Docker + S3/K8s CRD), policy wiring, and the `enforceRecorder` fail-open gotcha are
merged in `references/ssh-and-agent-access.md` §3 — this file only flags it belongs in an
audit-logging inventory: `tsrecorder` output (asciinema `.cast`, newline-delimited JSON) is
the durable per-session audit artifact for SSH and `kubectl exec`/`attach`/`debug`/`run`, and
its ALPHA extension (v1.90+) additionally records full Kubernetes API-server requests when
`enableEvents: true` **plus** `TS_EXPERIMENTAL_KUBE_API_EVENTS=true` on the API-server proxy
**plus** an ACL rule allowing `tag:k8s-operator:443` — all three, not just the `enableEvents`
flag (see ssh-and-agent-access.md for the full grants/policy JSON).

**Positioning note (not a contradiction, a deliberate split the sources themselves state):**
Border0-by-Tailscale (beta) additionally covers RDP/VNC/database sessions with
command/query-level visibility as part of a broader PAM platform (JIT access, approvals,
credential elimination); `tsrecorder` remains "the current, generally-available method" for
SSH/kubectl specifically. For a new deployment needing only SSH/kubectl recording today, use
`tsrecorder`; for PAM features beyond that, evaluate Border0.

**Fleet health-monitoring dashboard workflow** — fire ALL of these API/CLI calls
CONCURRENTLY, not sequentially: `tailscale_api_verify`, `tailscale_status`,
`tailscale_device_list`, `tailscale_dns_splitdns_get`, `tailscale_dns_nameservers_get`,
`tailscale_dns_preferences_get`, `tailscale_key_list`, `tailscale_tailnet_lock_status`,
`tailscale_derp_map`. Severity thresholds:
- 🟢 **HEALTHY** only if API key valid AND all expected devices online AND no expired keys AND
  split DNS configured AND MagicDNS enabled AND lock status known.
- 🟡 **WARNING** if any device offline >24h, or keys expiring within 7 days, or MagicDNS
  disabled, or no split-DNS routes.
- 🔴 **CRITICAL** if API key invalid/expired, or all devices offline, or no DNS config at
  all, or multiple expired keys still active.

Routing: HEALTHY → one channel only; WARNING → + alerts channel; CRITICAL → + alerts + direct
message to on-call. This is explicitly a **read-only** monitoring skill — forbidden from
taking remediation actions itself.

**Detection-tuning caution (adjacent, not Tailscale-specific):** a defender's "flag anomalous
WireGuard/tunnel traffic" heuristic must be tuned to NOT false-positive on legitimate Tailscale
traffic. Generic red-team/C2 tooling (e.g. the Sliver framework) also transports over
WireGuard, but on a **different default port (UDP 51820)** than Tailscale's (`41641`) — a
network-flow monitor built around "WireGuard handshake patterns" or a general "tunneling
utility" Amcache-artifact flag should key on port + handshake cadence, not protocol alone, to
avoid alerting on ordinary Tailscale connectivity. `[LOW confidence — inferential
connection, source contains no Tailscale-specific content]`

## 10. Fleet-wide health checks and node discovery

**Full local CLI surface for first-line diagnostics** (peer state, NAT/DERP type, this node's
tailnet IP, reverse-lookup an IP, direct-vs-relayed connectivity) — corroborated across many
independent sources:
```bash
tailscale status
tailscale status --json | jq '.Peer | to_entries[] | {name: .value.HostName, ip: .value.TailscaleIPs[0], online: .value.Online}'
tailscale netcheck
tailscale netcheck --format=json
tailscale ip -4
tailscale whois 100.x.x.x
tailscale ping <hostname-or-ip>
```

**More `jq` recipes over `tailscale status --json`** (self+peer merge into one hostname→ip
map; select a specific peer's IP by hostname):
```bash
tailscale status --json | jq -r '.Peer[] | select(.HostName == "myserver") | .TailscaleIPs[0]'
tailscale status --json | jq -r '[.Self] + [.Peer[]] | sort_by(.DNSName) | map({(.DNSName | split(".")[0]): (.TailscaleIPs[0])}) | add'
tailscale status --json | jq '.Peer | to_entries[] | {name: .value.HostName, ip: .value.TailscaleIPs[0], online: .value.Online}'
```
Audit logs are additionally available in the Tailscale admin console, with
SIEM integration via webhook or API.

**`netmap.py` — combined interfaces + ARP LAN-neighbor + Tailscale-peer table script.**
Standalone `python3` script (stdlib only): (1) parses `ifconfig` for interfaces/IPs, tagging
`127.0.0.1` → "loopback" and any `100.*` → "tailscale"; (2) parses `arp -a`, groups by
/24-ish subnet, tags entries matching this machine's own IPs as "self" and `.1`-ending IPs as
"gateway?", skips broadcast/multicast (`.255`, `224.*`, `239.*`); (3) runs `tailscale status`
(falling back to the macOS app-bundle path `/Applications/Tailscale.app/Contents/MacOS/
Tailscale status` if the bare CLI isn't on PATH) and renders the peer IP/name/OS/status table
in markdown. **Gotcha:** all output parsing is regex against BSD/macOS `ifconfig`/
`arp -a` text format — not portable to Linux `ip addr`/`ip neigh` without adaptation.

**Host readiness probe (multi-agent-host preflight, read-only):** checks hostname/kernel/
uptime/memory/disk, tool presence for `tailscale`/`git`/`gh`/`tmux`/`docker`/`node`/`pnpm`,
systemd unit states for `tailscaled`/NetworkManager/docker (`systemctl is-enabled`/`is-active`
as two separate checks — tool-presence vs tool-running are NOT the same question), sleep-
target states, `tailscale status --self`, `nmcli` active connections, `docker`/`gh auth`
reachability. Explicitly non-destructive; the script's own closing line: "Read-only check
complete. Inspect Wi-Fi secret flags separately; never print PSKs or tokens."

**Correlate multiple independent health signals into one report** (reusable pattern): a
`status.sh` checks a LaunchAgent's state, a local `/health` HTTP endpoint, and `tailscale
serve status` together, returning ONE JSON blob rather than three separate checks a caller
must reconcile.

**Graceful command-availability degradation (reusable pattern):** chain fallbacks across
Tailscale commands rather than failing outright — e.g. `tailscale status 2>/dev/null ||
tailscale ip -4 2>/dev/null || echo "tailscale unavailable"` — and separately probe both
`127.0.0.1:<port>` and the machine's own `tailscale ip -4` to distinguish "service up locally"
from "service reachable over the tailnet".

## 11. Headscale (self-hosted control plane) fleet ops

**REST API + CLI/API fallback pattern.** Env vars: `HEADSCALE_URL`, `HEADSCALE_API_KEY`.
Scripts try the `headscale` CLI FIRST (`nodes list --output json`, `nodes tag -i <id> --tag
<tag>`, `nodes approve -i <id>`, `preauthkeys create --tag tag:<t>`), **falling back to
`curl`** against `${HEADSCALE_URL}/api/v1/...` with `Authorization: Bearer
$HEADSCALE_API_KEY` only when the CLI binary isn't present on the host — a reusable
"try-the-native-tool-first, degrade-to-HTTP" portability pattern for any automation that must
run in environments with and without the CLI installed.

**Backup, restore, and cross-version migration.** Restoring a Headscale SQLite DB to a
**DIFFERENT** headscale version can cause schema-migration failures or data corruption — check
`headscale version` on BOTH sides before migrating. Concrete flows:
- **Backup:** reads Headscale's own `config.yaml` to discover the ACTUAL DB/cert/policy paths
  (never hardcodes them, so the backup stays correct even after the admin customizes paths),
  uses `sqlite3 .backup` (safe against a live/open DB), tars everything with a checksum,
  supports `--dry-run`/`--json`/`--auto` (non-interactive, for cron). Non-destructive to the
  source install. Automated daily cron: `0 2 * * * /path/to/hs-backup.sh --auto --output-dir
  /backups/headscale/`.
- **Restore (destructive, requires privilege):** stop the headscale service → extract the
  tarball → **validate it contains `db.sqlite` AND `config.yaml`, abort otherwise** (a
  validate-before-mutate gate, not an afterthought) → restore config/DB/policy/certs/DERP map
  → restart the service → verify with `headscale nodes list`.
- **Migration (destructive on the TARGET host, network hop):** backup on the source (or reuse
  an existing one) → `rsync -avz --progress <tarball> <target>:<path>` → run the SAME
  validate-before-mutate restore INLINE over SSH on the target
  (`ssh "$TARGET_HOST" "bash -s" <<< "$INLINE_RESTORE"`) → update DNS to point at the new
  server → verify clients reconnect.

**Headscale-adjacent fleet scripts worth the same discipline elsewhere in this reference:**
a DERP-relay deploy script builds a DERP-map JSON (+ optional docker-compose.yml), validates
`--region-id` is numeric and that cert/`--acme` are mutually exclusive, supports `--dry-run`/
`--json`; live mode does `docker rm -f` an existing same-named container before recreating it
— a real side effect (container replacement) to flag in non-dry-run mode. A companion
DERP-latency test prefers the tool's own `--json` output and falls back to text-parsing only
when unavailable (a generalizable "prefer native `--json`, degrade to parsing" rule). A
DERP-health script layers connectivity checks from L4 (TCP connect timing) up through L7 (TLS
handshake + cert subject/issuer/SAN, then a hand-rolled RFC 5389 STUN binding request) so a
failure is attributable to the right layer. A generic server-audit script
supports a `target: local|remote` switch that transparently wraps every command in an SSH
invocation (`BatchMode=yes`, `ConnectTimeout=8`) for remote targets — one audit-check script
that works identically local or remote.

## 12. Reusable script techniques

**A full operationId-driven CLI toolkit** (the richest, most complete pattern covered here —
5 cooperating scripts against an 85-operation OpenAPI-derived catalog spanning 13 tag groups:
`Contacts`, `DNS`, `DeviceInvites`, `DevicePosture`, `Devices`, `Keys`, `Logging`,
`PolicyFile`, `Services`, `TailnetSettings`, `UserInvites`, `Users`, `Webhooks`):

- **`ts_common.sh`** — shared helpers sourced by every other script. `require_cmd`/
  `require_env` fail fast with a clear stderr message when a binary or env var is missing.
  `urlencode()` = `jq -nr --arg v "$raw" '$v|@uri'`. `build_query_string()` drops null values
  from a query-json object and URI-encodes both key and value before joining as
  `key=value&...`. `http_call()` always sends `Authorization: Bearer $TS_API_KEY` +
  `Accept: application/json`, adding `Content-Type: application/json` (override-able) and
  `--data-binary "@$body_file"` when a body is present. `TS_API_KEY` resolves from `TS_API_KEY`
  or fallback `TAILSCALE_API_KEY`; `TS_API_BASE` defaults to
  `https://api.tailscale.com/api/v2` and is overridable. Not destructive, no
  sudo. Generalizable to any curl+jq-based API wrapper, not just Tailscale's.
- **`ts_catalog.sh`** — read-only discovery over the local `operation_catalog.json` (85 ops):
  ```bash
  ./scripts/ts_catalog.sh --search device
  ./scripts/ts_catalog.sh --tag DNS --method GET
  ./scripts/ts_catalog.sh --json
  ```
  Filters by `--tag`, `--method`, `--search` (substring match on operationId + path + summary);
  `--json` for raw JSON else a TSV-style column table. Avoids memorizing 85 operationIds —
  a searchable local index instead of re-reading the OpenAPI spec each time.
- **`ts_call.sh`** — the generic, spec-driven request builder: ONE script handles every
  operation rather than one script per endpoint.
  ```bash
  ./scripts/ts_call.sh listTailnetDevices --params-json '{"tailnet":"acme.ts.net"}' --dry-run
  ./scripts/ts_call.sh listTailnetDevices --params-json '{"tailnet":"acme.ts.net"}' --jq '.devices[] | {id,name,hostname,authorized}'
  ./scripts/ts_call.sh deleteDevice --params-json '{"deviceId":"device-id"}' --dry-run
  ./scripts/ts_call.sh deleteDevice --params-json '{"deviceId":"device-id"}' --yes
  ```
  Argument surface: `--params-json` (path params), `--query-json`, `--body-json` XOR
  `--body-file`, `--jq`/`--raw`, `--dry-run`, `--yes`. Resolves `{param}` path-template
  placeholders from `--params-json`, URL-encodes each value via `urlencode()`, and errors
  BEFORE any network call on any missing required path/query param or an unknown
  `operationId` (with a hint to run `ts_catalog.sh --search`).
  **Two-step dry-run-then-`--yes` mutation gate — the single most important safety pattern in
  this reference for an agent driving the Tailscale API autonomously:** for any non-GET
  method, the script hard-refuses to execute unless `--yes` is explicitly passed; `--dry-run`
  is always allowed and shows what WOULD happen. Error text pattern: `error: $OP_ID uses
  $method and may mutate state; re-run with --yes after validating with --dry-run`.
  **Edge case to keep:** a call that is read-only *in effect* but `POST` *in HTTP method* (e.g.
  `validateAndTestPolicyFile`, an ACL/policy validate-only endpoint) is STILL treated as
  mutating by the gate, since the gate keys on HTTP method, not on actual side effects.
  `--body-json` and `--body-file` are mutually exclusive — passing both errors out;
  `requestBodyRequired=true` with neither supplied ALSO fails before any network call.
  **Can be genuinely destructive** (e.g. `deleteDevice`, `setPolicyFile`) when
  invoked with `--yes` against a mutating operationId — gated behind the mandatory
  `--dry-run`-first workflow above.
- **`ts_build_catalog.sh`** — regenerates `operation_catalog.json` + a flat `operations.tsv`
  index from an upstream OpenAPI spec:
  ```bash
  ./scripts/ts_build_catalog.sh /path/to/tailscale-api.json
  ```
  Walks `.paths` via `jq`, dereferences `$ref` parameters against `components.parameters`, and
  emits (operationId, method, path, summary, tags, pathParams, queryParams,
  requestBodyRequired, requestBodyContentTypes, successCodes) per operation. Idempotent — pure
  regeneration from an external spec file, overwrites the two output files; not destructive to
  any LIVE Tailscale state, only to the local reference files. **Keeps
  the local catalog in sync with upstream API changes** without hand-maintaining 85 operation
  defs by hand. **Caution:** the script's own comment names the spec source as
  `https://github.com/tailscale/tailscale/blob/main/api.md` — a documentation PAGE, not a raw
  JSON endpoint — an internally-inconsistent fetch command in the script itself. **Verify the
  spec-fetch URL in any such script actually returns machine-readable JSON before trusting the
  regeneration**, not a documentation HTML/markdown page. `[MED confidence overall —
  the transform mechanism is HIGH confidence, the doc-fetch instructions are LOW]`
- **`ts_smoke.sh`** — network-free smoke-test pattern, safe to run in ANY CI/sandbox with zero
  API key and zero network calls:
  ```bash
  "$SCRIPT_DIR/ts_catalog.sh" --search list --method GET >/dev/null
  "$SCRIPT_DIR/ts_call.sh" listTailnetDevices \
    --params-json '{"tailnet":"example.ts.net"}' \
    --dry-run >/dev/null
  echo "OK: tailscale scripts smoke checks passed"
  ```
  Verifies the toolkit's scripts are wired correctly (catalog lookup + dry-run request
  resolution) without ever touching the network.
- **Agent-integration front matter for exposing this toolkit to an agent runtime:**
  `agents/openai.yaml` supplies `interface.display_name: "Tailscale API"`, a
  `short_description`, and a `default_prompt` telling the agent to "Use the Tailscale skill
  scripts to perform safe, explicit Tailnet API actions with clear previews and jq-parsed
  output." The skill's own frontmatter `description:` states exactly when to invoke it: "Use
  when Codex needs to list/read/update/delete Tailnet resources (devices, users, keys, DNS,
  services, policy file, logging, webhooks, invites, contacts) from scripts or terminal
  automation." A reusable pattern: a lightweight, separate per-runtime (openai/codex)
  interface descriptor file alongside the main skill description.

**`ts-up.sh` — flag-normalizing wrapper around `tailscale up`, safer than string-eval.**
Exposes `--login-server`, `--authkey`, `--advertise-tags` (comma-split into repeated
`--advertise-tags=` flags), `--advertise-routes`, `--accept-routes`, `--accept-dns`,
`--exit-node`, `--ssh`, `--dry-run`, `--json`. Builds a `TAILSCALE_UP_FLAGS` bash **array**
then execs `sudo tailscale up "${TAILSCALE_UP_FLAGS[@]}"`; on failure captures combined
stdout/stderr and reports the exit code. Post-connect verifies via `tailscale status --json`
parsed with an inline `python3 -c`. **Reusable technique:** array-based flag building
avoids the `eval`/string-concat injection risk of `eval $UP_CMD` string interpolation seen in
sibling setup scripts elsewhere — if ANY variable (e.g. an auth key) contained
shell metacharacters, an `eval`-based wrapper could misbehave or be exploited; the array form
cannot. `[MED confidence — the safety comparison is the source author's own inference
from reading both scripts, not stated by either source]`

**Env-file credential loading with `set -a`/`set +a`.** Source an `.env` file wrapped in
`set -a; source "$env_file"; set +a` to auto-export every var it defines without individual
`export` lines; refuse to run if the script is executed directly rather than sourced
(`[[ "${BASH_SOURCE[0]}" == "${0}" ]]` guard). A companion `validate_env_vars "VAR1" "VAR2"`
checks each var is set AND non-empty and reports **all** missing vars at once, not just the
first. The API-key resolution order in the consuming script: `${CLAUDE_PLUGIN_ROOT}`
env var if set, else derive the plugin root relative to the script's own path; look for the
shared lib first at `$HOME/.claude-homelab/load-env.sh`, falling back to a copy alongside the
script.

**`--redact` self-reinvocation pattern composes with `--json` mode.** `maybe_redact_self()`
checks both `REDACT` and `JSON_MODE` env/flags; if `JSON_MODE` is set, it filters stdout to
only lines starting with `{` (via `grep '^{'`) BEFORE optionally piping through the redact
filter — so verbose informational chatter never pollutes NDJSON output. A guard variable
(`_NETOPS_POSTPROCESSED`) prevents infinite self-reinvocation recursion.
Generalizable technique for adding an opt-in output filter to a bash CLI without restructuring
the whole script around a filter-everything design.

**`--watch[=N]` continuous-monitor mode that only prints on state transitions** — a dispatcher
script detects the local OS (`uname -s`; Darwin/Linux/CYGWIN|MINGW|MSYS) and execs the matching
per-OS probe script with the same args; `--watch[=N]` (default 30 s interval) re-runs the
probe on a loop but only emits output when the JSON-summary result actually CHANGES between
iterations — avoiding a wall of repeated identical status lines in a long-running monitor.

**Spec-driven generic request builder, one script for all operations** (an independent,
earlier-generation version of the `ts_call.sh` pattern above, corroborating the same design
from a different source): resolve `{param}` path placeholders from a `--params-json` object,
URL-encode every value (`jq -nr --arg v "$raw" '$v|@uri'`), and fail BEFORE any network call
if a required path/query param is missing or if an unknown `operationId` is given.
`--body-json` and `--body-file` should be mutually exclusive flags, and `requestBodyRequired=
true` with neither supplied should also fail before any network call.

**Reusable shell primitives** (independent corroboration of the `ts_common.sh` shape from a
different source): `require_cmd`/`require_env` fail fast with a clear stderr message when
a binary or env var is missing; `urlencode()` = `jq -nr --arg v "$raw" '$v|@uri'`;
`build_query_string()` filters null values from a query-json object and URI-encodes both key
and value; a shared `http_call()` always sends `Authorization: Bearer $TS_API_KEY` +
`Accept: application/json`, adding `Content-Type: application/json` and
`--data-binary "@$body_file"` when a body is present. Generalizable to any
curl+jq-based API wrapper, not just Tailscale's.

**Interactive confirmation gate on a destructive reset verb** (the only script in one whole
batch to require an interactive Y/N before a destructive action): a `serve`-config wrapper
prompts `"DANGER: This will remove ALL serve configuration. Are you sure? [y/N]"` before
running `reset`. Its `serve_dir()` helper's free-port-scan loop —
`while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do ((port++)); done` — is a reusable
idempotent port-pick pattern usable well beyond this one script.

**Operation-catalog regeneration from an OpenAPI spec** (see `ts_build_catalog.sh` above for
the fuller write-up) — walk `.paths` with `jq`, dereference `$ref` parameters against
`components.parameters`, and emit a flat operation index (operationId, method, path, summary,
tags, pathParams, queryParams, requestBodyRequired, requestBodyContentTypes, successCodes) —
this is what makes a single generic caller script work across dozens of operations without
per-endpoint code.

**`--data-binary` vs `-d`/`--data` for API writes — a general curl trap, not Tailscale-
specific, but flagged here for an adjacent proxy-config API:** `-d @file` URL-encodes
the payload, corrupting characters like `#`, `=`, `&` and potentially destroying structured
config content; `--data-binary @file` sends the file byte-for-byte. Also check for local port
conflicts (`lsof -nP -iTCP:<port>`) before assuming an API call landed where you think it did.
`[Note: this technique's own source (a mobile proxy-app config API) is not Tailscale's own
API, but the technique generalizes directly to any of the curl-based Tailscale scripts above
that write structured (HuJSON/JSON) payloads.]`

**Fail-fast argument validation before any network call** is a recurring shape across every
wrapper script covered here: validate required params, validate mutual exclusivity
of body-source flags, validate the operation/command name is known — all BEFORE issuing the
HTTP request.

## GAPS

- No source documents pagination behavior for any endpoint that might grow large
  (e.g. `keys`, `webhooks`) beyond asserting "no pagination" for `devices`/`keys`/`acl` — not
  confirmed whether this holds for every endpoint or only those three.
- No source gives the authoritative, current, Tailscale-published rate limit; §1 records four
  disagreeing numbers with no way to arbitrate from this host (the arbiter binary has no
  bearing on a network rate limit).
- No source documents API versioning strategy (is `/api/v2` expected to gain a `/v3`? deprecation
  policy for endpoints?).
- DevicePosture, Contacts, and UserInvites endpoint tag groups are named in the operation
  catalog but nothing here documents their actual request/response shape —
  only that they exist as tag groups in the bundled catalog.
- No source states whether SCIM and the REST API's own user-management surface
  can be used together safely, or whether SCIM should be the sole write path once enabled.
- The ACL-update verb discrepancy (`POST` vs a single source's `PUT`, §2/§4) is not resolvable
  from what's covered here — the `PUT`-claiming source also shows an unusual bare-host base-URL form,
  which is circumstantial evidence but not proof it is imprecise about the verb too.
- The grants-policy `ip` field's bare-port-number syntax (§4) could not be confirmed
  or refuted against current official Tailscale documentation.
- Nothing here independently re-verifies `python-tailscale`'s sync-vs-async surface
  (§6) against the package's own source — the sync-looking example may be a
  documentation simplification of the async client, or a genuinely separate sync entry point.
