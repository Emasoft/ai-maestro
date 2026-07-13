import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { isConsolePeer, peerAddress, PEER_ADDR_HEADER } from '@/lib/peer-address'

const req = (headers: Record<string, string>) => ({
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
})

describe('the trusted peer address (TRDD-P7XKV3N9)', () => {
  describe('isConsolePeer', () => {
    it('accepts every shape of loopback the runtime actually produces', () => {
      expect(isConsolePeer('127.0.0.1')).toBe(true)
      expect(isConsolePeer('::1')).toBe(true)
      // The one that bites: on a DUAL-STACK listener (the Tailscale bind is `::`),
      // Node reports an IPv4 client as ::ffff:127.0.0.1. Without this branch the
      // owner is denied at their own keyboard and the feature looks broken.
      expect(isConsolePeer('::ffff:127.0.0.1')).toBe(true)
      expect(isConsolePeer('127.0.0.53')).toBe(true)
    })

    it('rejects every device on the VPN — that is the point', () => {
      expect(isConsolePeer('100.64.1.2')).toBe(false) // Tailscale CGNAT (a phone)
      expect(isConsolePeer('fd7a:115c:a1e0::1')).toBe(false) // Tailscale ULA
      expect(isConsolePeer('192.168.1.10')).toBe(false)
    })

    it('fails CLOSED on an unknown peer', () => {
      // An absent socket address must never read as "the console".
      expect(isConsolePeer('')).toBe(false)
      expect(isConsolePeer(null)).toBe(false)
      expect(isConsolePeer(undefined)).toBe(false)
    })
  })

  describe('the header cannot be forged', () => {
    it('reads ONLY the server-stamped header, never x-forwarded-for', () => {
      // THE ATTACK: a phone on the VPN sends `X-Forwarded-For: 127.0.0.1` to pose
      // as the console. If peerAddress() ever consulted that header, the entire
      // presence factor would be defeated by one curl flag.
      const spoofed = req({
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        [PEER_ADDR_HEADER]: '100.64.1.2', // what the socket actually said
      })
      expect(peerAddress(spoofed)).toBe('100.64.1.2')
      expect(isConsolePeer(peerAddress(spoofed))).toBe(false)
    })

    it('server.mjs deletes any inbound copy before stamping the socket address', () => {
      // The guarantee above only holds because the server refuses to let a client
      // supply the header at all. If this delete is ever dropped, the test above
      // still passes while the system is wide open — so assert the delete itself.
      const src = readFileSync('server.mjs', 'utf8')
      expect(src).toMatch(/delete\s+req\.headers\[PEER_ADDR_HEADER\]/)
      expect(src).toMatch(/req\.headers\[PEER_ADDR_HEADER\]\s*=\s*req\.socket\?\.remoteAddress/)
    })
  })
})
