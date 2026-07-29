/**
 * GET /api/settings/host-tools — the route that tells the dashboard whether each
 * host tool is installed. 368 lines, and it had NO test.
 *
 * Driven through the exported GET, not through the internal diagnose helpers: a
 * status is only real if it survives the path the dashboard actually calls.
 *
 * The cases that matter are the ones where "not installed" would be a LIE:
 *   - messaging with SOME scripts present is `partial`, never `missing`
 *   - tailscale with no serve routes is `partial` — no-serve-config is the HEALTHY
 *     steady state of this project's direct-bind architecture, and reporting it as
 *     `missing` is what once printed "Not installed" three lines under the working
 *     tailnet URL the user had just connected over
 *   - a malformed address like 100.64.abc.def must NOT read as a tailnet address
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const FAKE_HOME = '/fake-home-host-tools'

// Paths that "exist" for this test. Reset per test.
let existing = new Set<string>()
// execFileSync behaviour keyed by the joined argv. A value that is an Error throws.
let execTable: Record<string, string | Error> = {}

vi.mock('os', () => ({
  default: { homedir: () => FAKE_HOME },
  homedir: () => FAKE_HOME,
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => existing.has(p),
  readFileSync: (p: string) => {
    if (existing.has(p)) return ''
    throw new Error(`ENOENT: ${p}`)
  },
}))

vi.mock('child_process', () => ({
  execFileSync: (cmd: string, args: string[] = []) => {
    const key = [cmd, ...args].join(' ')
    const v = execTable[key]
    if (v === undefined) throw new Error(`not stubbed: ${key}`)
    if (v instanceof Error) throw v
    return v
  },
}))

vi.mock('@/lib/route-auth', () => ({
  enforceSystemOwner: async () => null,
}))

const bin = (n: string) => `${FAKE_HOME}/.local/bin/${n}`
const AMP = ['amp-send.sh', 'amp-inbox.sh', 'amp-read.sh', 'amp-init.sh']

/** Tailscale present and healthy — the prerequisite both tailscale tools share. */
const tailscaleUp = () => {
  execTable['which tailscale'] = '/usr/bin/tailscale\n'
  execTable['tailscale status'] = 'ok\n'
}

async function statuses(): Promise<Record<string, string>> {
  const { GET } = await import('@/app/api/settings/host-tools/route')
  const res = await GET()
  const body = (await res.json()) as { tools: Array<{ id: string; status: string }> }
  return Object.fromEntries(body.tools.map(t => [t.id, t.status]))
}

describe('GET /api/settings/host-tools', () => {
  beforeEach(() => {
    existing = new Set()
    execTable = {}
    vi.resetModules()
  })

  // The owed test: partial vs missing for the messaging scripts.
  describe('messaging — partial vs missing', () => {
    it('is missing when none of the scripts are installed', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = '{}'
      expect((await statuses()).messaging).toBe('missing')
    })

    it('is partial when only SOME are installed — not missing', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = '{}'
      existing.add(bin('amp-send.sh'))
      existing.add(bin('amp-inbox.sh'))
      expect((await statuses()).messaging).toBe('partial')
    })

    it('is partial at one-short, which is the boundary that separates it from installed', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = '{}'
      AMP.slice(0, 3).forEach(n => existing.add(bin(n)))
      expect((await statuses()).messaging).toBe('partial')
    })

    it('is installed only when ALL are present', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = '{}'
      AMP.forEach(n => existing.add(bin(n)))
      expect((await statuses()).messaging).toBe('installed')
    })
  })

  describe('tailscale-vpn', () => {
    it('is installed on a CGNAT address', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.99.233.43\n'
      execTable['tailscale serve status --json'] = '{}'
      expect((await statuses())['tailscale-vpn']).toBe('installed')
    })

    it('is partial when running but holding a non-tailnet address', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '192.168.1.5\n'
      execTable['tailscale serve status --json'] = '{}'
      expect((await statuses())['tailscale-vpn']).toBe('partial')
    })

    // The NaN guard: checking only the first two octets would accept this,
    // because NaN silently fails every comparison in the unchecked positions.
    it('rejects a malformed address whose first two octets look right', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.abc.def\n'
      execTable['tailscale serve status --json'] = '{}'
      expect((await statuses())['tailscale-vpn']).toBe('partial')
    })

    it('holds both edges of the CGNAT range', async () => {
      tailscaleUp()
      execTable['tailscale serve status --json'] = '{}'
      execTable['tailscale ip -4'] = '100.64.0.0\n'
      expect((await statuses())['tailscale-vpn']).toBe('installed')

      vi.resetModules()
      execTable['tailscale ip -4'] = '100.127.255.255\n'
      expect((await statuses())['tailscale-vpn']).toBe('installed')

      vi.resetModules()
      execTable['tailscale ip -4'] = '100.128.0.1\n'
      expect((await statuses())['tailscale-vpn']).toBe('partial')
    })

    it('is missing when the binary is absent', async () => {
      execTable['which tailscale'] = new Error('not found')
      expect((await statuses())['tailscale-vpn']).toBe('missing')
    })

    // Installed but the daemon is down / logged out is an ERROR, not an absence:
    // the fix is `tailscale up`, not an install.
    it('is error when installed but status fails', async () => {
      execTable['which tailscale'] = '/usr/bin/tailscale\n'
      execTable['tailscale status'] = new Error('failed to connect to local tailscaled')
      expect((await statuses())['tailscale-vpn']).toBe('error')
    })
  })

  describe('tailscale-serve', () => {
    // The regression this distinction exists to prevent.
    it('reports no configured routes as partial, never missing', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = '{}'
      const s = await statuses()
      expect(s['tailscale-serve']).toBe('partial')
      expect(s['tailscale-serve']).not.toBe('missing')
    })

    it('is installed when a Web route is configured', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = JSON.stringify({ Web: { 'x:443': {} } })
      expect((await statuses())['tailscale-serve']).toBe('installed')
    })

    it('is outdated in TCP mode', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = JSON.stringify({ TCP: { '443': {} } })
      expect((await statuses())['tailscale-serve']).toBe('outdated')
    })

    // We already proved tailscale is installed AND running, so a failure here is an
    // inability to DETERMINE the state — never evidence of absence.
    it('is error when the serve probe itself fails', async () => {
      tailscaleUp()
      execTable['tailscale ip -4'] = '100.64.1.1\n'
      execTable['tailscale serve status --json'] = new Error('unknown flag --json')
      expect((await statuses())['tailscale-serve']).toBe('error')
    })
  })

  it('returns every tool, so a thrown diagnose cannot silently drop a row', async () => {
    // Nothing stubbed at all: every probe throws. The route must still answer with
    // the full set rather than a short list.
    const s = await statuses()
    expect(Object.keys(s).sort()).toEqual(
      ['agent-cli', 'messaging', 'statusline', 'tailscale-serve', 'tailscale-vpn', 'tmux'].sort()
    )
  })
})
