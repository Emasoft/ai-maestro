/**
 * waitForShellReady / prepareShellForLaunch — never type into a shell that is
 * not listening.
 *
 * The bug these lock down (found by SCEN-015, 2026-07-11): both launch paths
 * slept a blind 300ms and then typed `claude` into the agent's pane. When the
 * login shell was still running its startup files — and especially when one of
 * them READ FROM THE TTY (a keychain unlock prompting for a password) — the
 * command was swallowed as that prompt's answer. Every agent on the host ended
 * up at a bare shell with no client running, while the registry said `active`
 * and the dashboard showed a green "Online" dot.
 *
 * The three cases below are exactly the three states the pane can be in, and
 * each one used to be indistinguishable from "ready".
 */
import { describe, it, expect, vi } from 'vitest'
import { waitForShellReady, prepareShellForLaunch } from '@/lib/agent-runtime'
import type { AgentRuntime } from '@/lib/agent-runtime'

/** A fake pane that reports a scripted sequence of (foreground, pane) states. */
function fakeRuntime(frames: Array<{ fg: string; pane: string }>): AgentRuntime & { sent: string[] } {
  let i = 0
  const frameAt = () => frames[Math.min(i++, frames.length - 1)]
  let current = frames[0]
  const sent: string[] = []
  return {
    type: 'tmux',
    sent,
    getForegroundCommand: async () => { current = frameAt(); return current.fg },
    capturePane: async () => current.pane,
    sendKeys: async (_n: string, keys: string) => { sent.push(keys) },
  } as unknown as AgentRuntime & { sent: string[] }
}

const PROMPT = '@host agents/alice %'

describe('waitForShellReady', () => {
  it('does NOT mistake a brand-new, still-blank pane for an idle prompt', async () => {
    // A blank pane trivially "stops changing" — the trap the first fix fell into.
    const runtime = fakeRuntime([{ fg: 'zsh', pane: '' }])
    const ready = await waitForShellReady(runtime, 's', 1500)
    expect(ready).toBe(false)
  })

  it('does NOT report ready while a startup child holds the TTY', async () => {
    // `security` is in the foreground asking for a keychain password. The pane
    // is perfectly STABLE — stability alone would have said "go ahead and type".
    const runtime = fakeRuntime([
      { fg: 'security', pane: 'password to unlock keychain-db:' },
    ])
    const ready = await waitForShellReady(runtime, 's', 1500)
    expect(ready).toBe(false)
  })

  it('reports ready once the shell is in front with a stable prompt', async () => {
    const runtime = fakeRuntime([
      { fg: 'security', pane: 'password to unlock keychain-db:' },
      { fg: 'zsh', pane: 'Loading .zshrc' },
      { fg: 'zsh', pane: `Loading .zshrc\n${PROMPT}` },
      { fg: 'zsh', pane: `Loading .zshrc\n${PROMPT}` },
    ])
    const ready = await waitForShellReady(runtime, 's', 5000)
    expect(ready).toBe(true)
  })
})

describe('prepareShellForLaunch', () => {
  it('interrupts a shell whose startup file is stuck on the TTY, and says so', async () => {
    // The pane never yields on its own — a blocked password prompt waits forever.
    const runtime = fakeRuntime([{ fg: 'security', pane: 'password:' }])
    const r = await prepareShellForLaunch(runtime, 's', 1200, 1200)
    expect(r.interrupted).toBe(true)   // Ctrl-C was sent, as a human would
    expect(runtime.sent).toContain('C-c')
  })

  it('does not interrupt a shell that is already at a prompt', async () => {
    const runtime = fakeRuntime([{ fg: 'zsh', pane: PROMPT }])
    const r = await prepareShellForLaunch(runtime, 's', 3000, 1200)
    expect(r).toEqual({ ready: true, interrupted: false })
    expect(runtime.sent).toHaveLength(0)
  })
})
