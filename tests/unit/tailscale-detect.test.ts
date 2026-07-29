import { describe, it, expect } from 'vitest'
import {
  isAllowedSource,
  isTailscaleIPv4,
  detectTailscaleIPv4,
  diagnoseTailscale,
} from '@/lib/tailscale-detect.mjs'

// A fake `exec`: returns canned stdout per command, or throws a canned error.
const execWith = (table: Record<string, string | Error>) => (cmd: string) => {
  const v = table[cmd]
  if (v === undefined) throw new Error(`command not found: ${cmd}`)
  if (v instanceof Error) throw v
  return v
}

describe('isAllowedSource — the whole localhost+Tailscale network model', () => {
  it('accepts loopback in every shape the runtime produces', () => {
    expect(isAllowedSource('127.0.0.1')).toBe(true)
    expect(isAllowedSource('::1')).toBe(true)
    // On the dual-stack (`::`) bind an IPv4 peer arrives IPv4-mapped. Without
    // this the owner is locked out at their own keyboard.
    expect(isAllowedSource('::ffff:127.0.0.1')).toBe(true)
  })

  it('accepts Tailscale peers over v4 and v6', () => {
    expect(isAllowedSource('100.99.233.43')).toBe(true)
    expect(isAllowedSource('::ffff:100.68.40.29')).toBe(true)
    expect(isAllowedSource('fd7a:115c:a1e0::8137:e92b')).toBe(true)
  })

  // These four are the entire security value of the filter. 100.64.0.0/10 spans
  // 100.64.x - 100.127.x; one step outside on either side must be REJECTED, or
  // the range silently widens onto public CGNAT space.
  it('holds both edges of the CGNAT range', () => {
    expect(isAllowedSource('100.64.0.0')).toBe(true)
    expect(isAllowedSource('100.127.255.255')).toBe(true)
    expect(isAllowedSource('100.63.255.255')).toBe(false) // one below
    expect(isAllowedSource('100.128.0.0')).toBe(false) // one above
  })

  it('rejects the LAN — the case this filter exists for', () => {
    expect(isAllowedSource('192.168.1.10')).toBe(false)
    expect(isAllowedSource('10.0.0.5')).toBe(false)
    expect(isAllowedSource('172.16.0.9')).toBe(false)
    expect(isAllowedSource('8.8.8.8')).toBe(false)
  })

  it('rejects an absent address rather than defaulting open', () => {
    expect(isAllowedSource(undefined)).toBe(false)
    expect(isAllowedSource(null)).toBe(false)
    expect(isAllowedSource('')).toBe(false)
  })

  it('does not accept a near-miss of the Tailscale v6 prefix', () => {
    expect(isAllowedSource('fd7a:115c:a1e1::1')).toBe(false)
    expect(isAllowedSource('fd00::1')).toBe(false)
  })
})

describe('isTailscaleIPv4', () => {
  it('matches only the CGNAT band', () => {
    expect(isTailscaleIPv4('100.64.1.1')).toBe(true)
    expect(isTailscaleIPv4('100.63.1.1')).toBe(false)
    expect(isTailscaleIPv4('192.168.1.1')).toBe(false)
    expect(isTailscaleIPv4(undefined as unknown as string)).toBe(false)
  })
})

describe('detectTailscaleIPv4', () => {
  it('returns the address on the happy path', () => {
    const r = detectTailscaleIPv4(execWith({ 'tailscale ip -4': '100.99.233.43\n' }))
    expect(r).toEqual({ ip: '100.99.233.43', state: 'ok', message: null })
  })

  it('takes only the first line, so no newline can reach a printed URL', () => {
    const r = detectTailscaleIPv4(
      execWith({ 'tailscale ip -4': '100.99.233.43\n100.99.233.44\n' })
    )
    expect(r.ip).toBe('100.99.233.43')
    expect(r.ip).not.toContain('\n')
  })

  it('reports a missing CLI as not-installed, without running status', () => {
    const err = new Error('spawnSync tailscale ENOENT')
    const r = detectTailscaleIPv4(execWith({ 'tailscale ip -4': err }))
    expect(r.ip).toBeNull()
    expect(r.state).toBe('not-installed')
    expect(r.message).toContain('not found')
  })

  // The improvement this module exists for: installed-but-logged-out used to
  // surface as a truncated error string, which tells an operator nothing.
  it('turns installed-but-logged-out into an instruction', () => {
    const r = detectTailscaleIPv4(
      execWith({
        'tailscale ip -4': new Error('no current profile'),
        'tailscale status --json': JSON.stringify({ BackendState: 'NeedsLogin' }),
      })
    )
    expect(r.ip).toBeNull()
    expect(r.state).toBe('NeedsLogin')
    expect(r.message).toContain('tailscale up')
  })

  it('distinguishes stopped from logged-out', () => {
    const r = detectTailscaleIPv4(
      execWith({
        'tailscale ip -4': new Error('boom'),
        'tailscale status --json': JSON.stringify({ BackendState: 'Stopped' }),
      })
    )
    expect(r.state).toBe('Stopped')
    expect(r.message).toContain('stopped')
  })

  // A non-Tailscale address must never be adopted as the bind address, however
  // the CLI came to print it.
  it('refuses an address outside the CGNAT band', () => {
    const r = detectTailscaleIPv4(
      execWith({
        'tailscale ip -4': '192.168.1.50\n',
        'tailscale status --json': JSON.stringify({ BackendState: 'Running' }),
      })
    )
    expect(r.ip).toBeNull()
    expect(r.state).toBe('Running')
  })
})

describe('diagnoseTailscale', () => {
  it('reports unusable when status itself fails', () => {
    const r = diagnoseTailscale(execWith({}))
    expect(r.state).toBe('unavailable')
    expect(r.message).toContain('install')
  })

  it('reports unparseable rather than crashing on non-JSON', () => {
    const r = diagnoseTailscale(execWith({ 'tailscale status --json': 'not json at all' }))
    expect(r.state).toBe('unparseable')
  })

  it('names an unrecognised backend state instead of guessing', () => {
    const r = diagnoseTailscale(
      execWith({ 'tailscale status --json': JSON.stringify({ BackendState: 'Frobnicating' }) })
    )
    expect(r.state).toBe('Frobnicating')
    expect(r.message).toContain('Frobnicating')
  })
})
