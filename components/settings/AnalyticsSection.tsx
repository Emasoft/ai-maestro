'use client'

import { useEffect, useState } from 'react'
import { BarChart3, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react'
import { AGENTLENS_NPM_PKG, AGENTLENS_REPO, type AgentlensEmbedTab } from '@/lib/ecosystem-constants'

// Settings → Analytics: the AgentlensPro dashboard, embedded.
//
// The iframe points at ai-maestro's OWN reverse proxy (lib/analytics-proxy.mjs), never at
// http://localhost:3000 directly. A direct loopback src works only when the browser IS the
// host: on a phone over Tailscale, `localhost:3000` is the PHONE's port 3000, and AgentlensPro's
// `frame-ancestors` (loopback-only, by their design) refuses a remote parent anyway. The proxy
// lives on the same host the browser already reached, so both problems disappear and the panel
// works identically from the console and from a remote device.
//
// The src is same-HOST + main-port + 1, derived from window.location at render time — so it
// follows the operator wherever they browsed from (localhost, a Tailscale IP, MagicDNS) with
// nothing to configure and no origin baked into the bundle.

// `analytics` is one of their locked `?tab=` ids and matches this section's name. An unknown id
// falls back to `sessions` on their side, so the deep link can never blank the panel.
const INITIAL_TAB: AgentlensEmbedTab = 'analytics'

type Probe = 'checking' | 'up' | 'down' | 'unauthorized'

export default function AnalyticsSection() {
  const [src, setSrc] = useState<string | null>(null)
  const [probe, setProbe] = useState<Probe>('checking')
  // Bumping this remounts the iframe — a real reload, since we cannot reach into a
  // cross-origin frame's history to refresh it.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const { protocol, hostname, port } = window.location
    const mainPort = Number(port || (protocol === 'https:' ? 443 : 80))
    // The iframe loads the dashboard through the reverse proxy on the NEXT port. Cross-origin is
    // fine for an iframe — it is CSP/frame-ancestors gated, not CORS gated — so it renders even
    // when a cross-origin *fetch* would be blocked.
    setSrc(`${protocol}//${hostname}:${mainPort + 1}/?embed=1&tab=${INITIAL_TAB}`)

    // Probe before framing. Without this, a stopped AgentlensPro renders as an unexplained blank
    // rectangle — a silent failure, and the operator has no way to know the fix is `agentlenspro`.
    //
    // The probe is SAME-ORIGIN (`/api/analytics/status` on the main port), never the cross-port
    // proxy. A cross-origin fetch is subject to CORS, Safari's tracking-prevention, and ad/privacy
    // extensions — any of which makes it REJECT and the panel falsely read "isn't running" while
    // AgentlensPro is up. server.mjs answers this by checking loopback :3000 directly. (TRDD-YY6M8Z16)
    let cancelled = false
    setProbe('checking')
    fetch('/api/analytics/status', { credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (r.status === 401) { setProbe('unauthorized'); return }
        if (!r.ok) { setProbe('down'); return }
        const data = await r.json().catch(() => ({ up: false }))
        setProbe(data?.up ? 'up' : 'down')
      })
      .catch(() => {
        // Same-origin request failed at the network layer — treat as down.
        if (!cancelled) setProbe('down')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <div>
            <h1 className="text-lg font-semibold text-white">Analytics</h1>
            <p className="text-xs text-gray-400">
              AgentlensPro — sessions, context growth, cache health, cost
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload
          </button>
          {src && (
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open full
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {probe === 'checking' && (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Connecting to AgentlensPro…
          </div>
        )}

        {probe === 'unauthorized' && (
          <div className="flex items-center justify-center h-full p-6">
            <div className="max-w-md text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <h2 className="text-white font-medium mb-2">Session not recognized</h2>
              <p className="text-sm text-gray-400">
                The Analytics proxy rejected this session. Sign in again, then reload.
              </p>
            </div>
          </div>
        )}

        {probe === 'down' && (
          <div className="flex items-center justify-center h-full p-6">
            <div className="max-w-lg text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <h2 className="text-white font-medium mb-2">AgentlensPro isn&apos;t running</h2>
              <p className="text-sm text-gray-400 mb-4">
                The dashboard is served by AgentlensPro on this host. Start it, then reload this
                panel:
              </p>
              <code className="inline-block px-3 py-2 bg-gray-900 border border-gray-800 rounded text-xs text-blue-300 mb-4">
                {AGENTLENS_NPM_PKG}
              </code>
              <p className="text-xs text-gray-500">
                Not installed?{' '}
                <a
                  href={AGENTLENS_REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  AgentlensPro on GitHub
                </a>
              </p>
            </div>
          </div>
        )}

        {probe === 'up' && src && (
          <iframe
            key={reloadKey}
            src={src}
            title="AgentlensPro dashboard"
            className="w-full h-full border-0"
          />
        )}
      </div>
    </div>
  )
}
