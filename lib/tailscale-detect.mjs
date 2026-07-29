// Tailscale detection + the remote-source filter, extracted from server.mjs.
//
// WHY THIS FILE EXISTS: `isAllowedSource()` is the gate that decides whether a
// TCP connection from off-box is allowed to reach the server at all — it is the
// whole of the "localhost + Tailscale only, never the LAN" network model. It
// lived inline in server.mjs, which binds sockets on import, so nothing could
// import it and NO TEST COVERED IT. A security filter with no test is one
// refactor away from silently accepting the LAN. Same precedent as
// lib/session-validate-server.mjs and lib/peer-address.mjs.
//
// server.mjs runs as plain `node server.mjs`, so this must be .mjs, not .ts.
//
// The filter's behaviour is deliberately unchanged by the extraction: same
// ranges, same order, same string handling. Only its testability changed.

/**
 * The Tailscale CGNAT range, 100.64.0.0/10 (RFC 6598) = 100.64.x.x - 100.127.x.x.
 * The alternation covers 64-69, 70-99, 100-119, 120-127. It is written out rather
 * than computed because a filter you cannot read by eye is a filter nobody audits:
 * 100.63.x and 100.128.x must BOTH fall outside it, and those two boundaries are
 * the only way an off-by-one here becomes LAN exposure.
 */
const TAILSCALE_CGNAT_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./

/** Tailscale's IPv6 ULA prefix, fd7a:115c:a1e0::/48 — shared by every node on every tailnet. */
const TAILSCALE_ULA_V6 = /^fd7a:115c:a1e0:/i

/**
 * True when a TCP peer address may talk to this server.
 *
 * Accepts ONLY loopback and Tailscale. A LAN address (192.168.x, 10.x, 172.16-31.x)
 * and any public address are rejected — remote access is via the VPN or not at all.
 *
 * @param {string|undefined|null} remoteAddress net.Socket#remoteAddress
 * @returns {boolean}
 */
export function isAllowedSource(remoteAddress) {
  if (!remoteAddress) return false
  // Strip the IPv4-mapped IPv6 prefix: on a dual-stack (`::`) bind, an IPv4 peer
  // presents as ::ffff:127.0.0.1. Case-insensitive because the mapping is written
  // ::FFFF: in some stacks even though Node normalises to lowercase.
  const ip = String(remoteAddress).replace(/^::ffff:/i, '')
  if (ip === '127.0.0.1' || ip === '::1') return true
  if (TAILSCALE_CGNAT_V4.test(ip)) return true
  if (TAILSCALE_ULA_V6.test(ip)) return true
  return false
}

/** True when `ip` is a syntactically valid Tailscale IPv4 for this node. */
export function isTailscaleIPv4(ip) {
  return typeof ip === 'string' && TAILSCALE_CGNAT_V4.test(ip)
}

/**
 * Classify why Tailscale is unavailable, so an operator gets an action instead of
 * a truncated stack trace. "Not installed" and "installed but logged out" need
 * completely different fixes, and the old code reported both as one opaque string.
 *
 * @param {(cmd: string) => string} exec runs a command, returns stdout, throws on failure
 * @returns {{state: string, message: string}}
 */
export function diagnoseTailscale(exec) {
  let raw
  try {
    raw = exec('tailscale status --json')
  } catch {
    // status failed too — the CLI is missing, or tailscaled is not reachable.
    return {
      state: 'unavailable',
      message: 'Tailscale CLI not usable — install it, or start the tailscaled service, to enable remote access',
    }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: 'unparseable', message: 'Tailscale status was not valid JSON — check the tailscale version' }
  }

  // BackendState is the field that actually distinguishes the failure modes.
  switch (parsed?.BackendState) {
    case 'NeedsLogin':
      return { state: 'NeedsLogin', message: 'Tailscale is installed but logged out — run `tailscale up` to enable remote access' }
    case 'Stopped':
      return { state: 'Stopped', message: 'Tailscale is installed but stopped — run `tailscale up` to enable remote access' }
    case 'NoState':
      return { state: 'NoState', message: 'Tailscale has no saved state — run `tailscale up` to log in' }
    case 'Running':
      // Running yet we could not get a CGNAT IPv4: unusual, so say so plainly
      // rather than implying the user forgot to log in.
      return { state: 'Running', message: 'Tailscale is running but reported no 100.x address — check `tailscale status`' }
    default:
      return {
        state: String(parsed?.BackendState || 'unknown'),
        message: `Tailscale is in an unrecognised state (${parsed?.BackendState || 'unknown'}) — check \`tailscale status\``,
      }
  }
}

/**
 * Detect this node's Tailscale IPv4, with an actionable diagnosis when there isn't one.
 *
 * `tailscale ip -4` stays the primary probe: it is one line, one value, and it is
 * what the working path has always used. The richer `status --json` call is made
 * ONLY when that fails, so the happy path — the security-critical one — keeps its
 * existing behaviour and cost exactly.
 *
 * @param {(cmd: string) => string} exec runs a command, returns stdout, throws on failure
 * @returns {{ip: string|null, state: string, message: string|null}}
 */
export function detectTailscaleIPv4(exec) {
  let out
  try {
    out = exec('tailscale ip -4')
  } catch (err) {
    const msg = err?.message || String(err)
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return { ip: null, state: 'not-installed', message: 'Tailscale CLI not found — binding to localhost only' }
    }
    const d = diagnoseTailscale(exec)
    return { ip: null, state: d.state, message: `${d.message} — binding to localhost only` }
  }

  // Take the FIRST line: `-4` yields a single address today, but reading line 1
  // explicitly means a future multi-address response can never leave an embedded
  // newline in a value that gets printed into a URL.
  const ip = String(out).split('\n')[0].trim()

  if (!isTailscaleIPv4(ip)) {
    const d = diagnoseTailscale(exec)
    return { ip: null, state: d.state, message: `${d.message} — binding to localhost only` }
  }

  return { ip, state: 'ok', message: null }
}
