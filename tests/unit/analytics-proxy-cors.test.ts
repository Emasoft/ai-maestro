import { describe, it, expect } from 'vitest'
import { corsHeadersFor } from '../../lib/analytics-proxy.mjs'

// The Analytics health probe (AnalyticsSection.tsx) runs on ai-maestro's main port and fetches
// the proxy on main+1 to tell "running" from "not running". That fetch is cross-ORIGIN (the port
// differs), so without an echoed Access-Control-Allow-Origin the browser discards even a 200 and
// the panel falsely reads "AgentlensPro isn't running". corsHeadersFor echoes the ai-maestro
// origin — and ONLY it — so the probe can read the real status. (TRDD-YY6M8Z16 / #58 follow-up.)

const MAIN_PORT = 23000

describe('corsHeadersFor — Analytics probe CORS allowance', () => {
  it('echoes the exact ai-maestro http origin (same host, main port) with credentials', () => {
    // Probe fetches the proxy on :23001, so Host is the proxy host; Origin is the :23000 page.
    const h = corsHeadersFor('http://localhost:23000', 'localhost:23001', MAIN_PORT)
    expect(h).toEqual({
      'Access-Control-Allow-Origin': 'http://localhost:23000',
      'Access-Control-Allow-Credentials': 'true',
    })
  })

  it('echoes the https variant too (Tailscale HTTPS deployments)', () => {
    const h = corsHeadersFor('https://100.101.102.103:23000', '100.101.102.103:23001', MAIN_PORT)
    expect(h['Access-Control-Allow-Origin']).toBe('https://100.101.102.103:23000')
    expect(h['Access-Control-Allow-Credentials']).toBe('true')
  })

  it('never echoes `*` — the allowed origin is always the concrete ai-maestro origin', () => {
    const h = corsHeadersFor('http://localhost:23000', 'localhost:23001', MAIN_PORT)
    expect(h['Access-Control-Allow-Origin']).not.toBe('*')
  })

  it('refuses a foreign origin (right host, WRONG port) — no CORS headers', () => {
    // A page on some other port of the same host is not the ai-maestro UI; deny it.
    expect(corsHeadersFor('http://localhost:9999', 'localhost:23001', MAIN_PORT)).toEqual({})
  })

  it('refuses a foreign HOST entirely — no CORS headers', () => {
    expect(corsHeadersFor('http://evil.example:23000', 'localhost:23001', MAIN_PORT)).toEqual({})
  })

  it('refuses a scheme mismatch (https origin, only http+https of the host are allowed but port must match) ', () => {
    // http://host:9999 is neither the http nor https main-port origin.
    expect(corsHeadersFor('http://localhost:24000', 'localhost:23001', MAIN_PORT)).toEqual({})
  })

  it('returns {} when the request carries no Origin (a plain iframe navigation, not a probe)', () => {
    // The iframe itself needs no CORS (it is CSP/frame-ancestors gated, not CORS gated); it sends
    // no matching Origin, so it simply gets no CORS headers and still renders.
    expect(corsHeadersFor(undefined, 'localhost:23001', MAIN_PORT)).toEqual({})
    expect(corsHeadersFor('', 'localhost:23001', MAIN_PORT)).toEqual({})
  })

  it('returns {} when the Host header is missing (cannot derive the trusted origin → deny)', () => {
    expect(corsHeadersFor('http://localhost:23000', undefined, MAIN_PORT)).toEqual({})
    expect(corsHeadersFor('http://localhost:23000', '', MAIN_PORT)).toEqual({})
  })
})
