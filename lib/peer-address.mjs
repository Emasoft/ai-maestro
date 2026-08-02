/**
 * The caller's TRUE network address, and the one question we ask of it.
 *
 * Enforces R48 (MAESTRO console-presence: registration and password change are
 * local-only) — `isConsolePeer()` is that rule's guard. The rule id is written
 * here deliberately: the R51.9 coverage scan (docs/GOVERNANCE-ENFORCEMENT-MAP.md
 * Part II) reads rule citations out of enforcement code, so a guard that never
 * names its rule is reported as unenforced even when it works.
 *
 * TRDD-P7XKV3N9. A route handler receives a `Request`, never a socket, so the
 * only way it can learn who is calling is from a header — and every header a
 * client can set, a client can forge. `x-forwarded-for` and `x-real-ip` are
 * ATTACKER-CONTROLLED: a phone on the VPN can send `X-Forwarded-For: 127.0.0.1`
 * and walk straight through a naive loopback check.
 *
 * `server.mjs` therefore DELETES any inbound copy of `x-aim-peer` and stamps it
 * from `req.socket.remoteAddress` — the one place in the process that can see
 * the real peer. This module is the only sanctioned reader.
 *
 * We sit behind no proxy (the bind is localhost + Tailscale direct), so the
 * socket address IS the client address. If a reverse proxy is ever introduced,
 * this file is the single place that has to learn about it — and until it does,
 * it must keep refusing to trust x-forwarded-for.
 *
 * WHY .mjs AND NOT .ts: `server.mjs` must import this, and it cannot import
 * named exports from a `.ts` module — as a `.ts` it crashed the server at boot
 * with "does not provide an export named 'PEER_ADDR_HEADER'". That is precisely
 * why every other server-shared module in lib/ is `.mjs` (hosts-config-server.mjs,
 * ecosystem-state-paths.mjs), and TS files import those happily (see
 * lib/messageQueue.ts). Do not "modernize" this to .ts — the server will not boot.
 */

/** The header `server.mjs` stamps and this module reads. Never client-supplied. */
export const PEER_ADDR_HEADER = 'x-aim-peer'

/**
 * Is the caller physically on this machine?
 *
 * A PRESENCE signal, not an authorization one. Every route NOT on the list below
 * must remain usable from any device on the Tailscale VPN, because remote work
 * from a phone or another machine is a feature, not a leak. The value of the list
 * is that it is SHORT and every entry had to argue for itself — do not add a
 * sixth without the same deliberate ruling.
 *
 * The callers, measured 2026-08-02 (`grep -rn isConsolePeer app/ lib/ services/`),
 * in TWO categories that are worth keeping apart:
 *
 *   PRESENCE AS A SECOND FACTOR — physical presence proves the PERSON, on top of
 *   a credential. These are the R48 operations:
 *     · app/api/governance/password/invalidate  (revoke the master credential)
 *     · app/api/governance/password/reset       (forgot-password, no old password)
 *     · lib/oauth-rotator/reauth-guard          (capture a Claude login credential)
 *     · app/api/settings/edit                   (rewrite any agent's settings.json)
 *   (MAESTRO login is named by R48 and is NOT yet gated here — see CLAUDE.md.)
 *
 *   ORIGIN CHECK ON A LOCAL-ONLY FACT — not borrowed authority; the natural
 *   boundary of the thing being reported:
 *     · app/api/statusline/ingest  (TRDD-D8OYFG35) — a statusline payload
 *       describes a Claude Code process running ON THIS MACHINE, so a remote
 *       caller has, by construction, nothing truthful to say. It confers no
 *       capability and returns no secret.
 *
 * This docstring previously read "it gates exactly two operations … and nothing
 * else", which had been false since the third caller landed. A comment that
 * miscounts its own callers is worse than none: the next author reads it, believes
 * the surface is smaller than it is, and reasons about a system that no longer
 * exists.
 *
 * @param {string | null | undefined} peer
 * @returns {boolean}
 */
export function isConsolePeer(peer) {
  if (!peer) return false // Unknown ⇒ not the console. Fail closed.
  // Node reports an IPv4 client as ::ffff:127.0.0.1 on a DUAL-STACK listener,
  // which is exactly what the Tailscale `::` bind produces. Miss this branch and
  // the owner is denied at their own keyboard.
  const addr = peer.startsWith('::ffff:') ? peer.slice('::ffff:'.length) : peer
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.')
}

/**
 * Read the trusted peer address off a request.
 *
 * @param {{ headers: { get(name: string): string | null } }} req
 * @returns {string | null}
 */
export function peerAddress(req) {
  return req.headers.get(PEER_ADDR_HEADER)
}

/**
 * Convenience: the console check, straight from a request.
 *
 * @param {{ headers: { get(name: string): string | null } }} req
 * @returns {boolean}
 */
export function isFromConsole(req) {
  return isConsolePeer(peerAddress(req))
}
