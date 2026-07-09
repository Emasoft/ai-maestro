import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildPanelMessage,
  isPanelAction,
  isSafePanelUrl,
  PANEL_HTML_MAX_BYTES,
} from '@/lib/panel-messages'
import {
  panelClients,
  panelFeedback,
  broadcastPanelMessage,
  pushPanelFeedback,
  drainPanelFeedback,
} from '@/services/shared-state'
import type WebSocket from 'ws'

const AGENT = 'panel-agent-1'

// Minimal fake WS: readyState 1 = OPEN; sent frames recorded.
function fakeWs(readyState = 1): { ws: WebSocket; sent: string[] } {
  const sent: string[] = []
  const ws = {
    readyState,
    send: (m: string) => {
      sent.push(m)
    },
  } as unknown as WebSocket
  return { ws, sent }
}

beforeEach(() => {
  panelClients.clear()
  panelFeedback.clear()
})

describe('panel-messages (action → WS message mapping)', () => {
  it('maps every action and stamps a timestamp', () => {
    const set = buildPanelMessage('set', '<h1>hi</h1>')
    expect(set.ok).toBe(true)
    if (set.ok) {
      expect(set.message.type).toBe('panel:set-html')
      expect(set.message.html).toBe('<h1>hi</h1>')
      expect(set.message.timestamp).toBeTruthy()
    }
    const open = buildPanelMessage('open', undefined, 'https://example.com')
    expect(open.ok && open.message.type === 'panel:open' && open.message.url === 'https://example.com').toBe(true)
    const close = buildPanelMessage('close')
    expect(close.ok && close.message.type === 'panel:close').toBe(true)
    const refresh = buildPanelMessage('refresh')
    expect(refresh.ok && refresh.message.type === 'panel:refresh').toBe(true)
  })

  it('rejects bad shapes: set without content, html+url together, oversized html, unsafe url', () => {
    expect(buildPanelMessage('set').ok).toBe(false)
    expect(buildPanelMessage('set', '<p>x</p>', 'https://example.com').ok).toBe(false)
    expect(buildPanelMessage('set', 'x'.repeat(PANEL_HTML_MAX_BYTES + 1)).ok).toBe(false)
    expect(buildPanelMessage('open', undefined, 'javascript:alert(1)').ok).toBe(false)
    expect(buildPanelMessage('open', undefined, 'file:///etc/passwd').ok).toBe(false)
  })

  it('validates action names and url safety helpers', () => {
    expect(isPanelAction('open')).toBe(true)
    expect(isPanelAction('destroy')).toBe(false)
    expect(isSafePanelUrl('http://localhost:3000')).toBe(true)
    expect(isSafePanelUrl('not a url')).toBe(false)
  })
})

describe('shared-state panel fan-out + feedback queue', () => {
  it('broadcasts to every OPEN client and prunes dead ones', () => {
    const a = fakeWs(1)
    const b = fakeWs(1)
    const dead = fakeWs(3) // CLOSED
    panelClients.set(AGENT, new Set([a.ws, b.ws, dead.ws]))

    const delivered = broadcastPanelMessage(AGENT, { type: 'panel:refresh' })
    expect(delivered).toBe(2)
    expect(a.sent).toHaveLength(1)
    expect(JSON.parse(a.sent[0]).type).toBe('panel:refresh')
    expect(b.sent).toHaveLength(1)
    // the CLOSED socket was pruned from the registry
    expect(panelClients.get(AGENT)!.size).toBe(2)
  })

  it('returns 0 when no dashboard has the panel channel open', () => {
    expect(broadcastPanelMessage('nobody-here', { type: 'panel:close' })).toBe(0)
  })

  it('feedback queue is FIFO, drain clears it, and it is bounded (drop-oldest)', () => {
    pushPanelFeedback(AGENT, { n: 1 })
    pushPanelFeedback(AGENT, { n: 2 })
    const drained = drainPanelFeedback(AGENT)
    expect(drained.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2])
    expect(drained[0].receivedAt).toBeTruthy()
    // drained → empty on second read
    expect(drainPanelFeedback(AGENT)).toEqual([])

    // bounded at 200: pushing 205 keeps the NEWEST 200
    for (let i = 0; i < 205; i++) pushPanelFeedback(AGENT, { n: i })
    const bounded = drainPanelFeedback(AGENT)
    expect(bounded).toHaveLength(200)
    expect((bounded[0].payload as { n: number }).n).toBe(5)
    expect((bounded[199].payload as { n: number }).n).toBe(204)
  })
})
