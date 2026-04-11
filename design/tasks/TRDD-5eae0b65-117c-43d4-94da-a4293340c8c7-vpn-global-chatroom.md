# TRDD-5eae0b65-117c-43d4-94da-a4293340c8c7 — VPN-wide Global Human Chatroom

**TRDD ID:** `5eae0b65-117c-43d4-94da-a4293340c8c7`
**Filename:** `design/tasks/TRDD-5eae0b65-117c-43d4-94da-a4293340c8c7-vpn-global-chatroom.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Status:** Not started
**Created:** 2026-04-11
**Requested by:** Emanuele
**Dependencies:**
- Human user card in sidebar (#84 — completed)
- Human chat panel with avatar + logout (#103 — completed)
- Humans-belong-to-groups-not-teams model (#104 — completed)
- Tailscale peer discovery (`~/.aimaestro/hosts.json`, mesh working)
- AMP federation layer (already operational for agent-to-agent and
  agent-to-user messaging)

---

## User request (verbatim)

> When I (the user logged in) select a human card instead of an agent card,
> I got the human chat mode, since there is no client or tmux. A simple
> chat with the other human, no matter where he is (even in different
> hosts... but still inside the Tailscale VPN... nothing will escape or
> enter from that, ever). Meetings are also organized for groups of humans,
> no matter what host they are. But this is obvious, and I think it is
> already partially implemented.
>
> What is less obvious is: **what if I select my own card?** The chat
> screen appears, but who am I talking to? Certainly not to myself! The
> answer is that the chat screen of my user (and of any user in the same
> Tailscale VPN) will connect to a **global shared chat room**, where
> everyone can write and read anything the other human users are writing.
> This is a chatroom working similarly to IRC or Telegram channels shared
> by multiple users. Everything I write is immediately printed in all
> chat screens, and I can shout or quote or ping other people.
>
> A sort of restricted chatroom where only people in the same Tailscale
> VPN can see each other online and speak to each others. This global
> chatroom is permanently online, and any human can write or answer at
> any time.
>
> The scrollback record is **infinite** (since it is saved on file in
> compressed format) so I can read the history of all messages from any
> other user sent since the beginning of the chat, when the first user
> printed the first word and there was still no one online.
>
> A column on the right should show the **names of the users in the VPN**,
> and their status (online/offline). You can **block and filter any user**
> if you don't want to listen to him, but this is reversible and the
> other user will never be aware of it.
>
> The message section is perfectly normal instead, messages can be sent
> and received like a normal email box, only every agent can also write
> messages to me, not only the humans like in the chat.

---

## 1. Two selection behaviors

The human user card has two distinct behaviors depending on whose card is
selected:

### 1.1 Someone ELSE's human card (different Tailscale peer)

- Opens a **1:1 private chat** with that specific human.
- Messaging path: AMP with recipient address `<their-userName>@<their-host>`.
- Existing `MessageCenter` infrastructure handles this today — it just
  needs the human card to render a dedicated 1:1 chat view instead of
  the generic inbox. Already partially done via `HumanUserPanel.tsx` +
  the existing AMP routing; only the recipient discovery is missing.
- Messages are per-pair (private), appear only in the two participants'
  windows, and go through AMP end-to-end with Ed25519 signatures.

### 1.2 MY OWN card

- Opens the **VPN-wide global chatroom** (not a private chat with self).
- Chatroom is visible to every logged-in human on every host in the
  Tailscale mesh.
- Messages are broadcast to every peer simultaneously.
- A right-column **user roster** shows every known human across the mesh
  with online/offline status.
- The chat is **always on** — no join/leave, no connect button. Selecting
  the own card IS joining the chatroom for the duration of the view.

---

## 2. Mesh membership + discovery

### 2.1 Humans directory

Each AI Maestro host MUST maintain a **humans directory** at
`~/.aimaestro/humans.json` keyed by `<userName>@<hostId>`. Entries record:

```json
{
  "version": 1,
  "humans": [
    {
      "id": "emanuele@macbook-pro",
      "userName": "emanuele",
      "hostId": "macbook-pro",
      "avatar": "/avatars/men_12.jpg",
      "lastSeenAt": "2026-04-11T18:32:17Z",
      "publicKey": "<ed25519 base64>",
      "createdAt": "2026-04-10T08:00:00Z"
    }
  ]
}
```

The local host writes its OWN entry on first login and updates
`lastSeenAt` every N seconds while the dashboard is open. Other hosts
learn about this user via the existing host-sync mesh protocol (the
same one that currently shares agent registries).

### 2.2 Mesh sync

`GET /api/v1/mesh/humans` — returns the local humans.json. Every host
on the Tailscale mesh polls every other known host every 30 seconds (or
on-demand via push) and merges the result into its local view. This is
already the pattern used by `hosts-service` for agent discovery; the
new endpoint reuses it.

**CRITICAL:** The mesh MUST respect Tailscale boundaries. The endpoint
is bound to the Tailscale-only TCP filter in `server.mjs::isAllowedSource`
so non-VPN peers cannot reach it. No federation outside the VPN,
ever — "nothing will escape or enter from that."

### 2.3 Online status

A human is **online** if:
- Their host is reachable on Tailscale (TCP connect succeeds to port 23000)
- AND their `lastSeenAt` is < 90 seconds ago
- AND their dashboard is currently open (heartbeat endpoint)

Otherwise **offline**. The right-column roster shows a green/gray dot
per human with their avatar + `<userName>@<hostId>`.

---

## 3. The chatroom itself

### 3.1 Storage model

- Single shared append-only log at `~/.aimaestro/vpn-chat/messages.jsonl.gz`
  (gzip-streamed so size stays manageable while scrollback is infinite).
- Each entry:
  ```json
  {
    "id": "<uuid>",
    "ts": "2026-04-11T18:32:17.123Z",
    "from": "emanuele@macbook-pro",
    "body": "hey everyone",
    "replyTo": "<previous message uuid, optional>",
    "mentions": ["alice@mac-mini"],
    "host": "macbook-pro"
  }
  ```
- The log is **per-host**: each host persists the messages IT sees (its
  own sends + everything it receives from peers). A new host joining
  the mesh pulls a compressed snapshot from any existing host on first
  sync.
- Scrollback is streamed lazily — the client fetches the last 100
  messages on open and pages backward on scroll-up.

### 3.2 Delivery protocol

- `POST /api/v1/mesh/chat` — broadcast a new message. The handler:
  1. Verifies the caller's session (system owner only — agents cannot
     post to the human chatroom).
  2. Writes the message to the local log.
  3. Fans out to every peer host via `POST <peer>/api/v1/mesh/chat/relay`
     with a mesh-level signature.
  4. Returns immediately (fire-and-forget on fan-out).
- `POST /api/v1/mesh/chat/relay` — accepts messages from peer hosts;
  verifies the mesh signature, appends to the local log, fans out to
  any local browsers via SSE or WebSocket.
- `GET /api/v1/mesh/chat/history?before=<ts>&limit=100` — paginated
  scrollback fetch. Returns from the local log; no federation needed
  because every host already has the full history.

### 3.3 Real-time push to the browser

The browser subscribes via WebSocket at `/ws/vpn-chat` (new handler in
`server.mjs`) or Server-Sent Events. On new message from the fan-out,
the server pushes to every connected browser. No polling.

### 3.4 Message features

- **Mention / ping**: typing `@<userName>` highlights the line in the
  target's view and optionally fires a system notification (macOS
  notification center).
- **Quote / reply-to**: clicking a message inserts it as a replyTo ID.
  Rendered as a threaded quote block above the new message.
- **Shout**: optional ALL-CAPS message that renders in a larger font
  and triggers a notification for every online user. Rate-limited.
- **No editing / no deletion** — the log is append-only. An edit is a
  new message with `replaceTo` metadata; the original stays visible
  with a strikethrough indicator so nobody can rewrite history.

### 3.5 Blocking / filtering

- Per-user blocklist at `~/.aimaestro/vpn-chat/blocklist.json`:
  ```json
  { "blocked": ["alice@mac-mini", "bob@laptop"] }
  ```
- **Client-side only**: blocked users' messages are filtered from the
  view AFTER they arrive. The log still stores them and the other
  user is never informed.
- Right-column roster gets a "block user" context menu entry.
- Block is reversible — unblock flushes the filter and the hidden
  messages become visible.

### 3.6 Right-column user roster

- Shows every known human from `humans.json`.
- Online dot color: green (active), amber (host reachable but dashboard
  closed > 90s), gray (host unreachable).
- Click a user → open a 1:1 private chat in a side pane (same pattern
  as §1.1).
- Right-click → block/unblock, view profile, copy address.
- Filter-as-you-type search input at the top of the roster (reuse the
  existing `FilterInput` from `components/agent-profile/shared.tsx`).

---

## 4. Messages tab (NOT the chatroom)

The **Messages** section in `HumanUserPanel.tsx` stays as it is: a
normal AMP inbox where the human user receives messages from:

- Other humans (1:1 private, §1.1)
- **Agents** — agents CAN send messages to the user (for reports,
  completion notifications, governance requests, etc.). This is
  asymmetric: agents can DM the user, but agents CANNOT post to the
  chatroom. The chatroom is human-only.

The tab bar in HumanUserPanel becomes:

| Tab | Contents |
|---|---|
| **Chatroom** | VPN-wide shared chat (visible only when viewing own card) |
| **Messages** | Standard AMP inbox + compose (humans AND agents can write to the user) |
| **Roster** | (optional, could be the right column instead of a tab) |

When viewing SOMEONE ELSE's card, only Messages is visible (1:1 chat).

---

## 5. Security + privacy constraints

1. **Tailscale-only**: every mesh endpoint for humans.json, chat
   broadcast, chat relay, chat history MUST be behind
   `server.mjs::isAllowedSource` with Tailscale CGNAT filtering. No
   fallback to LAN or public IPs.
2. **System-owner only**: only the currently logged-in web UI user can
   post to the chatroom. Agents with AID tokens are rejected with 403.
3. **End-to-end auth**: every chat message is signed with the sender's
   Ed25519 key (the same key used by AMP). Relays verify the signature
   before appending.
4. **No cross-VPN leakage**: the `PROVIDER` info endpoint
   (`/api/v1/info`) MUST NOT advertise chatroom capability to untrusted
   callers — only `/api/v1/mesh/*` paths expose it, and those paths are
   IP-filtered.
5. **Retention**: the log is local-only + mesh-replicated. No cloud
   storage, no external federation. Ever.
6. **Blocklist privacy**: blocklists are local-only and are never
   transmitted to peers. The blocked user never learns they are blocked.

---

## 6. UI structure changes

### 6.1 HumanUserPanel.tsx

- Becomes conditional based on which human is selected:
  - **Selected = self** → render `VpnChatroomView` (new component)
  - **Selected = other peer** → render the current `MessageCenter`-wrapped
    1:1 chat (existing)
- Add a tab bar at the top: Chatroom | Messages | Roster (self-view only)

### 6.2 VpnChatroomView.tsx (new)

- Top: chatroom header ("VPN Chatroom · <host>.ts.net · <N> online")
- Center: message stream (infinite scroll, lazy paginated)
- Bottom: compose input with @-mention autocomplete, reply quote, shout toggle
- Right: roster column (online humans first, offline below; filter input)

### 6.3 Sidebar

Existing `HumanUserCard` shows only the local user. For peer humans,
add a new section below "Humans" that lists every peer human from the
mesh-synced `humans.json`. Clicking one opens the 1:1 chat.

---

## 7. Implementation phases

### Phase A — Mesh humans directory (foundation)

- `types/human-directory.ts` — HumanDirectoryEntry, HumanDirectoryFile
- `lib/human-directory.ts` — read/write `~/.aimaestro/humans.json` with
  locking (reuse `withLock` pattern from lib/governance.ts)
- `services/humans-sync-service.ts` — periodic sync with peer hosts on
  the Tailscale mesh; reuses existing `hosts-service` client
- `GET /api/v1/mesh/humans` — returns local directory (Tailscale-only)
- Integrates into the existing mesh sync loop on the hosts-service
- Update `HumanUserCard` to record lastSeenAt heartbeat every 60s

### Phase B — VPN chatroom backend

- `types/vpn-chat.ts` — VpnChatMessage, VpnChatHistoryResponse
- `lib/vpn-chat-log.ts` — append-only jsonl.gz writer/reader
- `services/vpn-chat-service.ts` — message creation, fan-out,
  signature verification, blocklist filtering
- `POST /api/v1/mesh/chat` — local broadcast endpoint
- `POST /api/v1/mesh/chat/relay` — peer-to-peer relay
- `GET /api/v1/mesh/chat/history` — paginated scrollback
- WebSocket handler in `server.mjs` for real-time push to browsers
- `POST /api/vpn-chat/block` + `DELETE /api/vpn-chat/block` — blocklist
  management (client-visible, NOT mesh-replicated)

### Phase C — UI

- `components/VpnChatroomView.tsx` — the main chatroom component
- `components/vpn-chat/MessageList.tsx` — infinite-scroll message list
  with quote rendering and mention highlighting
- `components/vpn-chat/ComposeBar.tsx` — input with @-mention autocomplete
- `components/vpn-chat/RosterColumn.tsx` — online user list with
  block/unblock context menu
- Update `HumanUserPanel.tsx` — route self-card to chatroom, peer-card to
  1:1 chat; add tab bar
- Update `AgentList.tsx` — add peer humans section below the local user
  card, populated from the humans directory

### Phase D — Scenario tests

- `SCEN-023_vpn-chatroom-single-host.scen.md` — one host, self-card →
  chatroom view, post a message, verify it appears in the log file
- `SCEN-024_vpn-chatroom-mesh.scen.md` — two hosts on Tailscale, verify
  messages posted on one host appear on the other within 5 seconds, and
  that the roster shows both users as online
- `SCEN-025_vpn-chatroom-peer-1to1.scen.md` — selecting someone else's
  card opens a 1:1 chat, messages stay private to the two participants
- `SCEN-026_vpn-chatroom-blocklist.scen.md` — block a user from the
  roster, verify their messages disappear from the view, unblock,
  verify they return

### Phase E — Governance rules update

Add a new R21 section "Human Messaging" to `docs/GOVERNANCE-RULES.md`:

- R21.1 Selecting own card → chatroom; selecting other card → 1:1
- R21.2 Chatroom is VPN-wide, mesh-replicated, append-only, infinite
  scrollback
- R21.3 Agents cannot post to the chatroom — only humans. Agents CAN
  send 1:1 messages to humans via the Messages tab (asymmetric)
- R21.4 Mesh humans directory at ~/.aimaestro/humans.json
- R21.5 Chat log storage at ~/.aimaestro/vpn-chat/messages.jsonl.gz
- R21.6 Blocklist is local-only, reversible, invisible to the blocked
  user
- R21.7 All chatroom endpoints are behind the Tailscale IP filter

---

## 8. Open questions

1. **New host joins mid-history**: how much scrollback does it fetch?
   Proposal: last 1000 messages on first join, full history on demand
   via a dedicated `GET /api/v1/mesh/chat/snapshot` endpoint that
   streams the gzipped log.
2. **Rate limiting**: should shouts/pings have a floor (e.g., max 1
   per 10s) to prevent spam? Probably yes — reuse the `checkRateLimit`
   helper from `lib/rate-limit.ts`.
3. **Mentions for offline users**: do they get queued as AMP messages
   in their Messages inbox so they see them when they come back?
   Probably yes — the chatroom-to-inbox bridge is a nice UX win.
4. **Moderation**: should there be any admin controls (e.g., host
   owner can clear spam)? Proposal: no — the log is append-only by
   design and the blocklist is the only mitigation. Moderation is
   explicitly off-limits to preserve the IRC-like "it happened, live
   with it" semantics.
5. **Compression**: should we use gzip append-mode (jsonl.gz with
   periodic rotation) or a simple rotating logfile with per-day
   compression? Proposal: per-day rotation — each day's file is
   gzipped the next day by a background job.
6. **Message IDs**: UUID v4? Or a mesh-time-ordered ID (ULID)? Proposal:
   ULID so messages sort chronologically even when clocks drift across
   hosts.

---

## 9. Estimate

- Phase A: 1–2 days (mesh humans directory + sync)
- Phase B: 3–5 days (chatroom backend + WebSocket push + block logic)
- Phase C: 3–4 days (three new components + HumanUserPanel rework)
- Phase D: 2 days (4 scenarios + fixture hosts)
- Phase E: 0.5 day (R21 governance rules)

Total: **10–14 days of focused work**. Not a current-session item —
this TRDD is the spec, implementation starts when the open tasks in
the current backlog are cleared.

---

## 10. Cross-references

- Depends on: #84, #103, #104 (all completed)
- Related: TRDD-a58a02c4 (MAINTAINER) — same host-level agent identity
  model, different namespace (agents vs humans)
- Referenced by: future tasks SCEN-023..026 will be created once
  implementation begins
