/**
 * preflightPaneKeychain — never launch a client that cannot authenticate.
 *
 * The bug this locks down (TRDD-CNF1X3J7, found in the 2026-07-12 fleet outage):
 * every agent pane is forked by ONE long-lived tmux server and inherits its
 * macOS security session. When that session is keychain-blind, `claude` in the
 * pane cannot read its OAuth item and prints "Not logged in" / "API Usage
 * Billing" — yet the registry says `active` and the dashboard shows a green dot.
 * A dead agent that LOOKS alive is worse than one that never started, because
 * nobody investigates until work silently fails to happen.
 *
 * waitForShellReady (shell-ready.test.ts) already proves the shell will ACCEPT
 * input; it does not prove the pane can READ the keychain. A pane can sit at a
 * clean prompt and still be blind. This preflight closes that gap: it runs the
 * probe IN THE PANE and REFUSES the launch — fail-fast — if the pane cannot
 * prove it can authenticate.
 */
import { describe, it, expect } from 'vitest'
import { preflightPaneKeychain } from '@/lib/agent-runtime'
import type { AgentRuntime } from '@/lib/agent-runtime'

/**
 * A fake pane whose capturePane returns a scripted sequence of frames (the
 * probe's sentinel appears once the pane has "run" it). sendKeys is recorded so
 * we can assert the probe was — or was NOT — sent.
 */
function fakeRuntime(frames: string[]): AgentRuntime & { sent: string[] } {
  let i = 0
  const sent: string[] = []
  return {
    type: 'tmux',
    sent,
    capturePane: async () => frames[Math.min(i++, frames.length - 1)],
    sendKeys: async (_n: string, keys: string) => { sent.push(keys) },
  } as unknown as AgentRuntime & { sent: string[] }
}

const OPTS = { probePath: '/x/probe.sh', timeoutMs: 800, pollMs: 50 }

describe('preflightPaneKeychain', () => {
  it('rc=0 (pane prints READY) → ok, and the probe WAS sent to the pane', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])
    const r = await preflightPaneKeychain(runtime, 's', { ...OPTS, platform: 'darwin' })
    expect(r.status).toBe('ok')
    // The probe must actually run in the PANE (the failing context), not in node.
    expect(runtime.sent.some(k => k.includes('/x/probe.sh'))).toBe(true)
  })

  it('rc!=0 (pane prints BLIND) → REFUSE with keychain_unreadable', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    const r = await preflightPaneKeychain(runtime, 's', { ...OPTS, platform: 'darwin' })
    expect(r.status).toBe('refuse')
    expect(r.reason).toBe('keychain_unreadable')
  })

  it('no sentinel before the deadline → REFUSE (fail-fast; a timeout is NOT an allow)', async () => {
    // This is the load-bearing contract: "cannot prove it works" must REFUSE,
    // never "allow on uncertainty". A future bypass here must break this test.
    const runtime = fakeRuntime([''])
    const r = await preflightPaneKeychain(runtime, 's', { ...OPTS, platform: 'darwin' })
    expect(r.status).toBe('refuse')
    expect(r.reason).toBe('keychain_probe_timeout')
  })

  it('non-macOS → skip, and NO probe is sent (never a false refusal off-mac)', async () => {
    const runtime = fakeRuntime(['irrelevant'])
    const r = await preflightPaneKeychain(runtime, 's', { ...OPTS, platform: 'linux' })
    expect(r.status).toBe('skip')
    expect(runtime.sent).toHaveLength(0)
  })
})
