/**
 * Shared SSRF guard.
 *
 * Centralizes the private/internal-IP rejection used by `agents/health`
 * and `webhooks` so future SSRF-style endpoints can reuse a single audit
 * surface. Round-2 audit (API2-MAJ-13) flagged that webhook URLs were
 * accepted unfiltered and the worker would reach internal services with
 * an authenticated agent's authority.
 *
 * USAGE:
 *   const err = validateSsrfUrl(url, { allowHttp: false, blockTailscale: true })
 *   if (err) return NextResponse.json({ error: err }, { status: 400 })
 *
 * Returns null on accept; a short reason string on reject.
 */

export interface SsrfGuardOptions {
  /** Allow plain http (default false — only https). */
  allowHttp?: boolean
  /** Reject Tailscale CGNAT (100.64.0.0/10). For webhooks we block; for
   * mesh probes we allow. */
  blockTailscale?: boolean
}

const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  '::1',
])

function isTailscaleCgnat(hostname: string): boolean {
  // 100.64.0.0/10 = 100.64.0.0 .. 100.127.255.255
  if (!hostname.startsWith('100.')) return false
  const parts = hostname.split('.')
  if (parts.length !== 4) return false
  const second = Number(parts[1])
  return Number.isInteger(second) && second >= 64 && second <= 127
}

/**
 * Validate a user-supplied URL is safe to dispatch outbound. Returns
 * null on accept, or a short reason on reject.
 */
export function validateSsrfUrl(
  url: string,
  options: SsrfGuardOptions = {},
): string | null {
  const { allowHttp = false, blockTailscale = false } = options

  if (typeof url !== 'string' || !url) {
    return 'url must be a non-empty string'
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }

  const allowed = allowHttp ? ['http:', 'https:'] : ['https:']
  if (!allowed.includes(parsed.protocol)) {
    return `URL scheme must be ${allowed.map(s => s.replace(':', '')).join(' or ')}`
  }

  const hostname = parsed.hostname.toLowerCase()

  if (PRIVATE_HOSTNAMES.has(hostname)) {
    return 'URL must not target localhost or loopback addresses'
  }

  // RFC-1918 + link-local + reserved IPv4 ranges.
  if (
    hostname.startsWith('127.') ||
    hostname.startsWith('0.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    return 'URL must not target private IPv4 addresses'
  }

  // IPv6 ULA (fc00::/7) + link-local (fe80::/10).
  if (
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80:')
  ) {
    return 'URL must not target private or link-local IPv6 addresses'
  }

  // .local / .internal hostnames — mDNS / private DNS.
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return 'URL must not target .local or .internal hostnames'
  }

  // AWS metadata service — same probe vector.
  if (hostname === '169.254.169.254') {
    return 'URL must not target metadata service'
  }

  if (blockTailscale && isTailscaleCgnat(hostname)) {
    return 'URL must not target Tailscale CGNAT addresses'
  }

  return null
}
