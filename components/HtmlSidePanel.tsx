/**
 * TRDD-229CJGYH — HTML side panel: renders plugin-pushed HTML (or a live URL)
 * in a sandboxed iframe, and bounces user interactions back out as
 * panel:feedback events.
 *
 * SECURITY — the two sandbox modes are deliberately different:
 *  - srcdoc (pushed HTML): `allow-scripts allow-forms` WITHOUT
 *    allow-same-origin. A srcdoc document inherits the parent origin, so
 *    granting same-origin to plugin-pushed markup would hand its scripts the
 *    dashboard's DOM/cookies. Without it the content runs in an opaque origin —
 *    scripts work, postMessage works, the parent is unreachable.
 *  - src=url (live-site preview, the dev-browser use case): `allow-scripts
 *    allow-same-origin allow-forms`. The URL is a genuinely different origin,
 *    so allow-same-origin only lets THAT SITE be itself (many apps break
 *    without it); it grants nothing on the dashboard origin.
 *
 * NO-NESTED-SCROLLBARS: the iframe fills the tab content area 1:1 (flex-1,
 * h-full, no max-height, no overflow:auto wrapper) — the only scrollbar is the
 * framed document's own, which is that document's outer scrollbar, not a nested
 * inner one.
 *
 * FEEDBACK: a small script is appended to pushed HTML that forwards clicks
 * (tag/id/class/text/data-*) to the parent via postMessage; the parent relays
 * them out over the WS as panel:feedback. URL iframes cannot be instrumented
 * (cross-origin) — feedback applies to pushed HTML only.
 */
import { useEffect, useRef } from 'react'
import { PanelRight } from 'lucide-react'
import type { PanelContentState } from '@/hooks/usePanelWebSocket'

// Injected into pushed HTML. Runs inside the opaque-origin sandbox; the ONLY
// capability it needs is postMessage to the parent. Elements can opt out with
// data-ve-nofeedback; anchors/buttons/[data-*] carry their dataset through.
const FEEDBACK_SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('a,button,[data-ve-id],[role="button"],input,select,label,area,summary') : ev.target
    if (!el || (el.closest && el.closest('[data-ve-nofeedback]'))) return
    var payload = {
      kind: 'click',
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      classes: el.className && typeof el.className === 'string' ? el.className : null,
      text: (el.textContent || '').trim().slice(0, 200),
      href: el.getAttribute ? el.getAttribute('href') : null,
      dataset: el.dataset ? Object.assign({}, el.dataset) : {},
    }
    try { window.parent.postMessage({ type: 'panel:feedback', payload: payload }, '*') } catch (e) {}
  }, true)
})()
</script>`

interface HtmlSidePanelProps {
  agentId: string
  panel: PanelContentState
  sendFeedback: (payload: unknown) => void
}

export default function HtmlSidePanel({ agentId, panel, sendFeedback }: HtmlSidePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Relay postMessage feedback from the sandboxed iframe out over the WS.
  // Filter on the SOURCE window (not origin — the opaque-origin sandbox posts
  // with origin 'null') so a message from any other frame is ignored.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const data = event.data
      if (data && typeof data === 'object' && data.type === 'panel:feedback') {
        sendFeedback(data.payload)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendFeedback])

  if (!panel.html && !panel.url) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
            <PanelRight className="w-10 h-10 text-gray-500" />
          </div>
          <p className="text-xl mb-2 text-gray-300">HTML Panel</p>
          <p className="text-sm text-gray-500">
            No content yet. A visualizer plugin can push HTML or a live URL here via{' '}
            <code className="text-gray-400">POST /api/agents/{agentId}/panel</code>.
          </p>
          <p className="text-xs mt-2 text-gray-600">
            {panel.connected ? 'Panel channel connected' : 'Connecting panel channel…'}
          </p>
        </div>
      </div>
    )
  }

  // key={nonce} forces a full iframe remount on panel:refresh and on every
  // content change — the reliable way to re-run srcdoc scripts / reload a URL.
  return (
    <div className="flex-1 flex min-w-0 bg-white dark:bg-gray-950">
      {panel.url ? (
        <iframe
          key={`url-${panel.nonce}`}
          ref={iframeRef}
          src={panel.url}
          title="Agent panel (live URL)"
          className="flex-1 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      ) : (
        <iframe
          key={`html-${panel.nonce}`}
          ref={iframeRef}
          srcDoc={`${panel.html}${FEEDBACK_SCRIPT}`}
          title="Agent panel (pushed HTML)"
          className="flex-1 w-full h-full border-0"
          sandbox="allow-scripts allow-forms"
        />
      )}
    </div>
  )
}
