import { NextResponse } from 'next/server'
import { proxyHealthCheck } from '@/services/agents-core-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/agents/health
 * Proxy health check to a remote agent (avoids CORS).
 */
export async function POST(request: Request) {
  try {
    let body: { url?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { url } = body
    // Validate url is present and is a string before proxying
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required and must be a string' }, { status: 400 })
    }
    // Validate URL scheme and hostname to prevent SSRF
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'Only http/https URLs are allowed' }, { status: 400 })
      }
      // SF-013 fix: Block private/internal IPs to prevent SSRF probing
      const hostname = parsed.hostname.toLowerCase()
      // SEC: Block all private, loopback, link-local, and reserved IP ranges.
      // Covers 127.0.0.0/8, 0.0.0.0/8, 10.0.0.0/8, 172.16-31.x.x, 192.168.x.x,
      // 169.254.x.x, fc00::/7 (fc + fd prefixes), fe80::/10, ::1, and
      // special hostnames (.local, .internal, localhost).
      const isPrivateHost =
        hostname === 'localhost' ||
        hostname === '[::1]' ||
        hostname === '::1' ||
        hostname.startsWith('127.') ||
        hostname.startsWith('0.') ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        hostname.startsWith('fc') ||
        hostname.startsWith('fd') ||
        hostname.startsWith('fe80:') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
      if (isPrivateHost) {
        return NextResponse.json({ error: 'Requests to private/internal addresses are not allowed' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }
    const result = await proxyHealthCheck(url)

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MIN-01: log full error server-side, return generic 500.
    console.error('[agents/health]', error)
    return NextResponse.json({ error: 'internal_error', code: 'agents-health' }, { status: 500 })
  }
}
