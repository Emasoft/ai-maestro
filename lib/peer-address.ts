/**
 * The caller's TRUE network address, and the one question we ask of it.
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
 */

/** The header `server.mjs` stamps and this module reads. Never client-supplied. */
export const PEER_ADDR_HEADER = 'x-aim-peer'

/**
 * Is the caller physically on this machine?
 *
 * This is a PRESENCE signal, not an authorization one. It gates exactly two
 * operations (MAESTRO login, MAESTRO password change) and nothing else — every
 * other route must remain usable from any device on the Tailscale VPN, because
 * remote work from a phone or another machine is a feature, not a leak.
 * Applying this anywhere else breaks that, so don't.
 */
export function isConsolePeer(peer: string | null | undefined): boolean {
  if (!peer) return false // Unknown ⇒ not the console. Fail closed.
  // Node reports IPv4-mapped IPv6 as ::ffff:127.0.0.1 on a dual-stack listener.
  const addr = peer.startsWith('::ffff:') ? peer.slice('::ffff:'.length) : peer
  return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.')
}

/** Read the trusted peer address off a request. */
export function peerAddress(req: { headers: { get(name: string): string | null } }): string | null {
  return req.headers.get(PEER_ADDR_HEADER)
}

/** Convenience: the console check, straight from a request. */
export function isFromConsole(req: { headers: { get(name: string): string | null } }): boolean {
  return isConsolePeer(peerAddress(req))
}
