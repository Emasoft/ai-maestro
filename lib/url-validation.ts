/**
 * URL validation utilities to prevent SSRF attacks.
 *
 * Rejects URLs with non-HTTPS schemes, localhost, loopback addresses,
 * and private/reserved IP ranges.
 */

// Private/reserved IPv4 ranges that must be blocked
const PRIVATE_IPV4_PREFIXES = [
  '10.',        // 10.0.0.0/8
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',  // 172.16.0.0/12
  '192.168.',   // 192.168.0.0/16
  '169.254.',   // Link-local
  '0.',         // 0.0.0.0/8
]

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
])

/**
 * Validate that a URL is a safe external HTTPS URL (not targeting internal services).
 *
 * Returns null if the URL is safe, or an error string describing why it was rejected.
 * This is a fail-fast check: any ambiguity results in rejection.
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

  // Block private IPv4 ranges
  for (const prefix of PRIVATE_IPV4_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return 'URL must not target private IP addresses'
    }
  }

  // Block IPv6 private/reserved addresses (brackets stripped by URL parser)
  // Covers: fe80:: (link-local), fc00::/fd00:: (ULA), ::1 (loopback)
  if (hostname.startsWith('fe80:') || hostname.startsWith('fc00:') ||
      hostname.startsWith('fd00:') || hostname === '::1') {
    return 'URL must not target private or link-local IPv6 addresses'
  }

  return null
}
