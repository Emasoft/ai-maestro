/**
 * installPluginLocally — network retry policy (TRDD-IXUV1XHD follow-up).
 *
 * A marketplace install CLONES the plugin's repo from GitHub. It was attempted exactly
 * ONCE, and a single failure was enough to mark the agent permanently role-less. Once
 * CreateAgent started hard-rejecting that state (R9.13), a one-shot network call meant a
 * transient DNS blip DESTROYED the agent instead of costing it a few seconds — which is
 * strictly worse than the bug it replaced.
 *
 * So: retry the failures that go away on their own, and only those. A wrong plugin name
 * is not going to fix itself, and retrying it burns the whole backoff before failing with
 * the identical message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

// execFile is promisified at module load, so the mock must be callback-shaped.
vi.mock('child_process', () => ({
  execFile: mockExecFile,
  execFileSync: vi.fn(() => ''),
  exec: vi.fn(),
  execSync: vi.fn(() => ''),
}))

/** Queue one outcome per attempt: null = success, string = failure message. */
function programAttempts(outcomes: Array<string | null>) {
  let i = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
    const outcome = outcomes[Math.min(i, outcomes.length - 1)]
    i++
    if (outcome === null) cb(null, 'installed', '')
    else cb(new Error(outcome), '', '')
  })
  return () => i
}

beforeEach(() => {
  vi.resetModules()
  mockExecFile.mockReset()
  // Keep the suite fast: the backoff shape is exercised, not slept through.
  process.env.AIM_PLUGIN_INSTALL_BASE_DELAY_MS = '1'
  process.env.AIM_PLUGIN_INSTALL_ATTEMPTS = '4'
})

describe('installPluginLocally — transient failures are retried', () => {
  it('succeeds when a DNS failure clears on a later attempt', async () => {
    const attempts = programAttempts([
      'Command failed: … fatal: unable to access …: Could not resolve host: github.com',
      'Command failed: … Could not resolve host: github.com',
      null, // third attempt works
    ])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await expect(
      installPluginLocally('ai-maestro-autonomous-agent', '/tmp/agent-dir', 'ai-maestro-plugins')
    ).resolves.toBeUndefined()

    expect(attempts()).toBe(3)
  })

  it('gives up after the configured attempts and reports the last error', async () => {
    const attempts = programAttempts(['Could not resolve host: github.com'])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await expect(
      installPluginLocally('ai-maestro-autonomous-agent', '/tmp/agent-dir', 'ai-maestro-plugins')
    ).rejects.toThrow(/after 4 attempt\(s\).*Could not resolve host/s)

    expect(attempts()).toBe(4)
  })

  it('retries a clone that dies mid-transfer', async () => {
    const attempts = programAttempts(['fatal: early EOF / the remote end hung up unexpectedly', null])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await installPluginLocally('p', '/tmp/agent-dir', 'ai-maestro-plugins')
    expect(attempts()).toBe(2)
  })
})

describe('installPluginLocally — permanent failures fail fast', () => {
  it('does NOT retry an unknown plugin', async () => {
    const attempts = programAttempts(['Plugin "nope" not found in marketplace'])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await expect(installPluginLocally('nope', '/tmp/agent-dir', 'ai-maestro-plugins')).rejects.toThrow(/not found in/)
    // One attempt only — waiting 26s to be told the same thing is not resilience.
    expect(attempts()).toBe(1)
  })

  it('does NOT retry an auth failure', async () => {
    const attempts = programAttempts(['remote: Authentication failed for repo'])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await expect(installPluginLocally('p', '/tmp/agent-dir', 'ai-maestro-plugins')).rejects.toThrow(/Authentication failed/)
    expect(attempts()).toBe(1)
  })
})

describe('installPluginLocally — the retry is opt-out', () => {
  it('honours AIM_PLUGIN_INSTALL_ATTEMPTS=1 (offline host: fail immediately)', async () => {
    process.env.AIM_PLUGIN_INSTALL_ATTEMPTS = '1'
    const attempts = programAttempts(['Could not resolve host: github.com'])
    const { installPluginLocally } = await import('@/services/element-management-service')

    await expect(installPluginLocally('p', '/tmp/agent-dir', 'ai-maestro-plugins')).rejects.toThrow(/after 1 attempt/)
    expect(attempts()).toBe(1)
  })
})
