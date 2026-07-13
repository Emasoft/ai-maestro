/**
 * The tmux-server-level keychain watchdog (TRDD-78J4I4QS, EHT of TRDD-CNF1X3J7).
 *
 * TRDD-CNF1X3J7 makes agent LAUNCH refuse when a pane cannot read the login
 * keychain — correct, but per-agent. This watchdog runs the SAME probe, once
 * per sweep, in a throwaway pane on the fleet's tmux server, so a keychain-blind
 * server produces ONE fleet-level alarm instead of N silent per-agent refusals
 * with no signal tying them together (the actual 2026-07-12 outage shape).
 *
 * `preflightPaneKeychain` itself is kept REAL in every test here — only its
 * inputs (a fake runtime whose capturePane/sendKeys are scripted, and the
 * probe-installer/sentinel module it depends on) are mocked. That way the tests
 * exercise the real probe-parsing logic, not a re-description of it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentRuntime } from '@/lib/agent-runtime'

// The probe installer would otherwise write a REAL file under
// ~/.aimaestro/agent-keychain-probe.sh on every test run. Stub it out, but keep
// the sentinel constants preflightPaneKeychain (unmocked, real) imports from
// this same module — the fake runtime's scripted capturePane frames below must
// match these exactly.
vi.mock('@/lib/agent-keychain-probe', () => ({
  ensureKeychainProbeInstalled: vi.fn(async () => {}),
  KEYCHAIN_PROBE_INSTALL_PATH: '/mock/agent-keychain-probe.sh',
  KEYCHAIN_PROBE_READY: 'AIM_KC_READY',
  KEYCHAIN_PROBE_BLIND: 'AIM_KC_BLIND',
}))

// The canary shells out to `tmux list-panes` directly via child_process.execFile
// (not through the AgentRuntime abstraction, since it inspects the WHOLE server,
// not one session). Mock it so tests never touch a real tmux binary.
const execFileMock = vi.fn(
  (_cmd: string, _args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    cb(null, '', '')
  },
)
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => (execFileMock as any)(...args) }))

import {
  checkTmuxServerKeychainOnce,
  sweepTmuxServerKeychain,
  getTmuxServerKeychainAlarm,
  resetTmuxServerKeychainAlarmForTests,
  TMUX_KEYCHAIN_WATCHDOG_SESSION,
} from '@/lib/tmux-server-keychain-watchdog'

/** Same fake-runtime shape as agent-launch-preflight.test.ts: a scripted
 * capturePane frame sequence, with createSession/killSession recorded so the
 * detect-not-repair invariant can be asserted. */
function fakeRuntime(frames: string[]): AgentRuntime & {
  sent: string[]
  created: Array<{ name: string; cwd: string }>
  killed: string[]
} {
  let i = 0
  const sent: string[] = []
  const created: Array<{ name: string; cwd: string }> = []
  const killed: string[] = []
  return {
    type: 'tmux',
    sent,
    created,
    killed,
    createSession: async (name: string, cwd: string) => { created.push({ name, cwd }) },
    killSession: async (name: string) => { killed.push(name) },
    capturePane: async () => frames[Math.min(i++, frames.length - 1)],
    sendKeys: async (_n: string, keys: string) => { sent.push(keys) },
  } as unknown as AgentRuntime & { sent: string[]; created: Array<{ name: string; cwd: string }>; killed: string[] }
}

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

const originalPlatform = process.platform
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setPlatform('darwin')
  execFileMock.mockClear()
  execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, '', ''))
  resetTmuxServerKeychainAlarmForTests()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setPlatform(originalPlatform)
  consoleErrorSpy.mockRestore()
})

describe('checkTmuxServerKeychainOnce', () => {
  it('probe prints READY → ok', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])
    const r = await checkTmuxServerKeychainOnce(runtime)
    expect(r.status).toBe('ok')
  })

  it('probe prints BLIND → blind, with a reason', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    const r = await checkTmuxServerKeychainOnce(runtime)
    expect(r.status).toBe('blind')
    expect(r.reason).toBeTruthy()
  })

  it('non-darwin → skip, without ever calling createSession/killSession', async () => {
    setPlatform('linux')
    const runtime = fakeRuntime(['AIM_KC_READY'])
    const r = await checkTmuxServerKeychainOnce(runtime)
    expect(r.status).toBe('skip')
    expect(runtime.created).toHaveLength(0)
    expect(runtime.killed).toHaveLength(0)
  })

  it('always kills its own throwaway session in a finally, even when the probe itself errors', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])
    runtime.createSession = vi.fn(async () => { throw new Error('tmux not running') })
    const r = await checkTmuxServerKeychainOnce(runtime)
    // "cannot prove it works" must resolve to blind, never ok — the same
    // fail-fast contract preflightPaneKeychain enforces per-launch.
    expect(r.status).toBe('blind')
    expect(runtime.killed).toEqual([TMUX_KEYCHAIN_WATCHDOG_SESSION])
  })
})

describe('sweepTmuxServerKeychain — TDD case 1: probe refuses ⇒ ONE fleet-level alarm', () => {
  it('raises the alarm exactly once per sweep (not once per agent) with the remediation text', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    await sweepTmuxServerKeychain(runtime)

    expect(getTmuxServerKeychainAlarm().active).toBe(true)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const logged = consoleErrorSpy.mock.calls[0].join(' ')
    expect(logged).toContain('the tmux server is keychain-blind')
    expect(logged).toContain('every agent forked from it will fail to authenticate')
    expect(logged).toContain('Recreate the server from a shell verified with the same probe')
    expect(logged).toContain('restarting individual agents will NOT help')
  })

  it('records a since-timestamp on first activation and preserves it across repeat sweeps', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    await sweepTmuxServerKeychain(runtime)
    const first = getTmuxServerKeychainAlarm()
    expect(first.since).toBeTruthy()

    await sweepTmuxServerKeychain(fakeRuntime(['', 'AIM_KC_BLIND']))
    const second = getTmuxServerKeychainAlarm()
    expect(second.since).toBe(first.since)
  })
})

describe('sweepTmuxServerKeychain — TDD case 2: probe ok ⇒ SILENT', () => {
  it('does not log and clears the alarm — a watchdog that cries wolf gets muted', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])
    await sweepTmuxServerKeychain(runtime)

    expect(getTmuxServerKeychainAlarm().active).toBe(false)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('clears a previously-active alarm once the server recovers', async () => {
    await sweepTmuxServerKeychain(fakeRuntime(['', 'AIM_KC_BLIND']))
    expect(getTmuxServerKeychainAlarm().active).toBe(true)

    consoleErrorSpy.mockClear()
    await sweepTmuxServerKeychain(fakeRuntime(['', 'AIM_KC_READY']))
    expect(getTmuxServerKeychainAlarm().active).toBe(false)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

describe('sweepTmuxServerKeychain — TDD case 3: detect, never repair', () => {
  it('never kills or creates any session other than its own throwaway aim-kc-watchdog', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    await sweepTmuxServerKeychain(runtime)

    expect(runtime.created.every((c) => c.name === TMUX_KEYCHAIN_WATCHDOG_SESSION)).toBe(true)
    expect(runtime.killed.every((n) => n === TMUX_KEYCHAIN_WATCHDOG_SESSION)).toBe(true)
    expect(runtime.killed.length).toBeGreaterThan(0)
  })

  it('never issues a tmux kill-server / recreate-server call via the canary\'s execFile channel', async () => {
    const runtime = fakeRuntime(['', 'AIM_KC_BLIND'])
    await sweepTmuxServerKeychain(runtime)

    for (const call of execFileMock.mock.calls) {
      const args = call[1] as string[]
      expect(args).not.toContain('kill-server')
      expect(args).not.toContain('kill-session')
    }
  })
})

describe('sweepTmuxServerKeychain — TDD case 4: non-macOS ⇒ skipped, no tmux calls at all', () => {
  it('touches neither the probe runtime nor the canary execFile channel off darwin', async () => {
    setPlatform('linux')
    const runtime = fakeRuntime(['AIM_KC_READY'])
    await sweepTmuxServerKeychain(runtime)

    expect(runtime.created).toHaveLength(0)
    expect(runtime.killed).toHaveLength(0)
    expect(execFileMock).not.toHaveBeenCalled()
    expect(getTmuxServerKeychainAlarm().active).toBe(false)
  })
})

describe('the secrets-CLI canary — "also surface the canary"', () => {
  it('raises the SAME fleet-level alarm when a known secrets CLI sits at its prompt, even if the throwaway probe itself reads ok', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null, 'zsh\ndotenclave\nnode\n', ''))
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])

    await sweepTmuxServerKeychain(runtime)

    expect(getTmuxServerKeychainAlarm().active).toBe(true)
    const logged = consoleErrorSpy.mock.calls[0].join(' ')
    expect(logged).toContain('the tmux server is keychain-blind')
    expect(logged).toContain('dotenclave')
  })

  it('tolerates the canary command failing (no tmux server, tmux missing) without raising an alarm', async () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(new Error('no server running')))
    const runtime = fakeRuntime(['', 'AIM_KC_READY'])

    await sweepTmuxServerKeychain(runtime)

    expect(getTmuxServerKeychainAlarm().active).toBe(false)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
