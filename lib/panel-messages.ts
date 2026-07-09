/**
 * TRDD-229CJGYH — HTML side-panel message shapes (pure, testable).
 *
 * The panel subsystem speaks one wire vocabulary in both directions:
 *   server → panel : panel:set-html | panel:open | panel:close | panel:refresh
 *   panel → server : panel:feedback  (click/interaction payload from pushed HTML)
 *
 * This module maps the REST API's `{action}` verbs onto the WS message shape and
 * validates the inputs, so the route stays thin and the mapping is unit-testable.
 */

export const PANEL_ACTIONS = ['open', 'close', 'refresh', 'set'] as const
export type PanelAction = (typeof PANEL_ACTIONS)[number]

export interface PanelWsMessage {
  type: 'panel:set-html' | 'panel:open' | 'panel:close' | 'panel:refresh'
  html?: string
  url?: string
  timestamp: string
}

export interface PanelFeedbackEvent {
  agentId: string
  payload: unknown
  receivedAt: string
}

// Pushed HTML is embedded in a srcdoc iframe in the dashboard — cap it so a
// runaway plugin can't push tens of MB through the WS fan-out per broadcast.
export const PANEL_HTML_MAX_BYTES = 2 * 1024 * 1024

export function isPanelAction(v: unknown): v is PanelAction {
  return typeof v === 'string' && (PANEL_ACTIONS as readonly string[]).includes(v)
}

/** Only http(s) URLs may be rendered in the live-preview iframe (no javascript:, file:, …). */
export function isSafePanelUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export type PanelMessageResult =
  | { ok: true; message: PanelWsMessage }
  | { ok: false; error: string }

/**
 * Map an API `{action, html?, url?}` onto the WS message the panel understands.
 *   set     → panel:set-html (content only; requires html or url)
 *   open    → panel:open     (show the panel; html/url optional — may open what's already set)
 *   close   → panel:close
 *   refresh → panel:refresh  (re-render current content / reload the url iframe)
 */
export function buildPanelMessage(
  action: PanelAction,
  html?: unknown,
  url?: unknown,
): PanelMessageResult {
  const hasHtml = typeof html === 'string' && html.length > 0
  const hasUrl = typeof url === 'string' && url.length > 0

  if (html !== undefined && typeof html !== 'string') {
    return { ok: false, error: 'html must be a string' }
  }
  if (hasHtml && Buffer.byteLength(html as string, 'utf-8') > PANEL_HTML_MAX_BYTES) {
    return { ok: false, error: `html exceeds ${PANEL_HTML_MAX_BYTES} bytes` }
  }
  if (url !== undefined && typeof url !== 'string') {
    return { ok: false, error: 'url must be a string' }
  }
  if (hasUrl && !isSafePanelUrl(url as string)) {
    return { ok: false, error: 'url must be http(s)' }
  }
  if (hasHtml && hasUrl) {
    return { ok: false, error: 'Provide html OR url, not both' }
  }
  if (action === 'set' && !hasHtml && !hasUrl) {
    return { ok: false, error: 'set requires html or url' }
  }

  const timestamp = new Date().toISOString()
  const content = {
    ...(hasHtml && { html: html as string }),
    ...(hasUrl && { url: url as string }),
  }
  switch (action) {
    case 'set':
      return { ok: true, message: { type: 'panel:set-html', ...content, timestamp } }
    case 'open':
      return { ok: true, message: { type: 'panel:open', ...content, timestamp } }
    case 'close':
      return { ok: true, message: { type: 'panel:close', timestamp } }
    case 'refresh':
      return { ok: true, message: { type: 'panel:refresh', timestamp } }
  }
}
