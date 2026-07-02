/**
 * URL validation utilities to prevent SSRF attacks.
 *
 * Rejects URLs with non-HTTPS schemes, localhost, loopback addresses,
 * private/reserved IP ranges, multicast, broadcast, IPv4-mapped IPv6,
 * Tailscale CGNAT, and the full IPv6 ULA range (fc00::/7).
 *
 * LIB2-MAJ-08: Tightened from a partial block-list to a comprehensive one,
 * plus an exported helper for callers that need DNS-rebinding-safe fetches:
 * resolve the hostname to an IP, validate the IP, then fetch by IP with the
 * `Host:` header pinned to the original hostname so the certificate validates.
 */

import dns from 'dns/promises'

// Private/reserved IPv4 ranges that must be blocked.
// LIB2-MAJ-08: Added Tailscale CGNAT (100.64.0.0/10), IPv4-mapped IPv6 prefix
// strings, multicast (224.0.0.0/4), and reserved (240.0.0.0/4 + broadcast).
const PRIVATE_IPV4_PREFIXES = [
  '10.',        // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',  // 172.16.0.0/12
  '192.168.',   // 192.168.0.0/16
  '169.254.',   // Link-local
  '0.',         // 0.0.0.0/8
  '127.',       // 127.0.0.0/8 loopback
]

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '255.255.255.255', // limited broadcast
])

/**
 * LIB2-MAJ-08: comprehensive IPv4 blocklist check. Covers private, loopback,
 * link-local, CGNAT (Tailscale 100.64.0.0/10), multicast, reserved/broadcast.
 */
function isBlockedIPv4(ip: string): boolean {
  // Match prefixes from the existing list (10., 172.16-31., 192.168., 169.254., 0., 127.)
  for (const prefix of PRIVATE_IPV4_PREFIXES) {
    if (ip.startsWith(prefix)) return true
  }
  // Tailscale CGNAT 100.64.0.0/10 = 100.64.0.0 .. 100.127.255.255
  const m = ip.match(/^(\d+)\.(\d+)\./)
  if (m) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a === 100 && b >= 64 && b <= 127) return true
    // Multicast 224.0.0.0/4 (224..239.x.x.x)
    if (a >= 224 && a <= 239) return true
    // Reserved 240.0.0.0/4 (240..255.x.x.x) and limited broadcast 255.255.255.255
    if (a >= 240) return true
  }
  if (BLOCKED_HOSTNAMES.has(ip)) return true
  return false
}

/**
 * LIB2-MAJ-08: comprehensive IPv6 blocklist. Handles the full ULA fc00::/7 range
 * (fc00:..fdff:), link-local fe80::/10, loopback ::1, IPv4-mapped IPv6
 * (::ffff:127.0.0.1 etc), and multicast ff00::/8.
 */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  // ULA fc00::/7 — first byte 0xfc or 0xfd, so the address starts with
  // any of fc00:..fdff:. We match the leading two hex chars.
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true
  // Link-local fe80::/10 — addresses fe80: through febf:
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true
  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(lower)) return true
  // IPv4-mapped IPv6 — ::ffff:1.2.3.4 — extract the embedded v4 and re-check
  const mapped = lower.match(/^::ffff:([\d.]+)$/)
  if (mapped) {
    return isBlockedIPv4(mapped[1])
  }
  // Embedded v4 in lower 32 bits e.g. ::1.2.3.4
  const embedded = lower.match(/^::([\d.]+)$/)
  if (embedded) {
    return isBlockedIPv4(embedded[1])
  }
  return false
}

/**
 * Validate that a URL is a safe external HTTPS URL (not targeting internal services).
 *
 * Returns null if the URL is safe, or an error string describing why it was rejected.
 * This is a fail-fast check: any ambiguity results in rejection.
 *
 * LIB2-MAJ-08 caveat: this function CANNOT defend against DNS rebinding on its
 * own, because it inspects only the literal hostname, not the resolved IP.
 * Callers that fetch the URL must ALSO call `resolveAndValidateUrl` and use
 * the returned IP-pinned URL — see that function's docstring.
 */
export function validateExternalUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }

  // Only HTTPS is allowed for external URLs
  if (parsed.protocol !== 'https:') {
    return `URL scheme must be https, got ${parsed.protocol.replace(':', '')}`
  }

  const hostname = parsed.hostname.toLowerCase()

  // Block well-known local hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return 'URL must not target localhost or loopback addresses'
  }

  // Tail-detect numeric IPs and run the full block-check; if the host is a
  // domain name, the literal-host check is best-effort (DNS rebinding can
  // still bypass it — callers that fetch must use resolveAndValidateUrl).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIPv4(hostname)) {
      return 'URL must not target private, loopback, CGNAT, or reserved IPv4 ranges'
    }
  }

  // IPv6 literal hostnames (URL parser strips brackets so "[::1]" → "::1")
  if (hostname.includes(':')) {
    if (isBlockedIPv6(hostname)) {
      return 'URL must not target private, loopback, link-local, or multicast IPv6 ranges'
    }
  }

  return null
}

/**
 * LIB2-MAJ-08: Resolve the hostname to an IP, validate the IP against the
 * full blocklist, and return a fetchable form that pins to the resolved IP
 * with the original Host header. This closes the DNS rebinding hole that the
 * literal-hostname check above cannot.
 *
 * Usage:
 *   const safe = await resolveAndValidateUrl(url)
 *   if (typeof safe === 'string') return // safe is an error string
 *   await fetch(safe.fetchUrl, { headers: { Host: safe.hostHeader } })
 *
 * Returns a string error on rejection, or { fetchUrl, hostHeader } on success.
 */
export async function resolveAndValidateUrl(
  url: string,
): Promise<string | { fetchUrl: string; hostHeader: string }> {
  const literalCheck = validateExternalUrl(url)
  if (literalCheck) return literalCheck
  const parsed = new URL(url)
  let resolved: { address: string; family: number }
  try {
    resolved = await dns.lookup(parsed.hostname)
  } catch (err) {
    return `DNS resolution failed for ${parsed.hostname}: ${(err as Error).message}`
  }
  if (resolved.family === 4 && isBlockedIPv4(resolved.address)) {
    return `Hostname ${parsed.hostname} resolves to blocked IPv4 ${resolved.address} (DNS rebinding?)`
  }
  if (resolved.family === 6 && isBlockedIPv6(resolved.address)) {
    return `Hostname ${parsed.hostname} resolves to blocked IPv6 ${resolved.address} (DNS rebinding?)`
  }
  const isV6 = resolved.family === 6
  const ipForUrl = isV6 ? `[${resolved.address}]` : resolved.address
  // Replace the hostname with the resolved IP. Preserve port + path + query.
  const portSuffix = parsed.port ? `:${parsed.port}` : ''
  const fetchUrl = `${parsed.protocol}//${ipForUrl}${portSuffix}${parsed.pathname}${parsed.search}${parsed.hash}`
  const hostHeader = parsed.host
  return { fetchUrl, hostHeader }
}
