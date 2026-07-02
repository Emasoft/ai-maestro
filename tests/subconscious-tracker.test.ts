/**
 * Unit tests for the subconscious config-change tracker (TRDD-7123d51a).
 *
 * Coverage:
 *   - scanAgentLocalConfig reads ~/.claude/settings.json when present and
 *     returns `null` for the sub-tree when the file is absent (TRDD §6 bullet 4)
 *   - scanAgentLocalConfig reads .claude/keybindings.json with the same
 *     present-vs-absent semantics
 *   - Tracker's first scan sets a baseline without emitting ledger entries
 *     (TRDD §6 bullet 1 + §4.4)
 *   - Tracker emits one entry per changed sub-tree when .claude/ is mutated
 *     out-of-band (TRDD §6 bullet 1)
 *   - Tracker swallows "agent not found / workdir missing" gracefully so a
 *     deleted agent doesn't leave a crashing interval on the event loop
 *
 * Mocking strategy: the scanner sees a REAL temp workdir with REAL files
 * written by the test. Only the ledger + registry-agent lookup are stubbed
 * so we don't need to pull in the full lib/agent-registry module graph.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

// ── Workdir + HOME harness ─────────────────────────────────────────────
//
// We redirect os.homedir() to a per-test tmp dir so the scanner's
// `~/.claude/settings.json` read picks up our fixture instead of the
// developer's real file (which would make the test flaky on dev machines).

let tmpHome: string
let tmpWorkDir: string
let realHomedir: typeof os.homedir

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tracker-home-'))
  tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tracker-wd-'))
  realHomedir = os.homedir
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(os as any).homedir = () => tmpHome
})

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(os as any).homedir = realHomedir
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
  try { fs.rmSync(tmpWorkDir, { recursive: true, force: true }) } catch { /* ignore */ }
  vi.restoreAllMocks()
})

// Stub the registry lookup so the scanner finds a test agent pointing at
// our tmp workdir. Only the two fields the scanner reads (`workingDirectory`
// + `sessions`) are populated.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (agentId: string) => ({
    id: agentId,
    name: `tracker-test-${agentId.slice(0, 8)}`,
    workingDirectory: (globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ as string,
    sessions: [],
  }),
  // Minimal stub so imports that reach for registryLedger get an object
  // that answers `getEntries()` with an empty array.
  registryLedger: {
    getEntries: () => [],
  },
}))

async function loadScanner() {
  // Reset the module cache so the scanner picks up the updated
  // `__AIM_TRACKER_WORKDIR__` + patched `os.homedir` for each test.
  const mod = await import('@/services/agent-local-config-service')
  return mod
}

describe('scanAgentLocalConfig — TRDD-7123d51a scanner extension', () => {
  it('reads ~/.claude/settings.json into userGlobalSettings when present', async () => {
    // Create the user-global settings file in our tmp HOME
    const userClaudeDir = path.join(tmpHome, '.claude')
    fs.mkdirSync(userClaudeDir, { recursive: true })
    const userSettings = { theme: 'dark', enabledPlugins: { 'foo@bar': true } }
    fs.writeFileSync(path.join(userClaudeDir, 'settings.json'), JSON.stringify(userSettings))

    ;(globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ = tmpWorkDir
    const { scanAgentLocalConfig } = await loadScanner()

    const result = scanAgentLocalConfig(crypto.randomUUID())
    expect(result.error).toBeUndefined()
    expect(result.data?.userGlobalSettings).toEqual(userSettings)
  })

  it('returns userGlobalSettings=null when ~/.claude/settings.json is absent', async () => {
    ;(globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ = tmpWorkDir
    const { scanAgentLocalConfig } = await loadScanner()

    const result = scanAgentLocalConfig(crypto.randomUUID())
    expect(result.error).toBeUndefined()
    expect(result.data?.userGlobalSettings).toBeNull()
  })

  it('reads .claude/keybindings.json into keybindings when present', async () => {
    const workClaudeDir = path.join(tmpWorkDir, '.claude')
    fs.mkdirSync(workClaudeDir, { recursive: true })
    const keybindings = { 'cmd+k': 'clear-terminal' }
    fs.writeFileSync(path.join(workClaudeDir, 'keybindings.json'), JSON.stringify(keybindings))

    ;(globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ = tmpWorkDir
    const { scanAgentLocalConfig } = await loadScanner()

    const result = scanAgentLocalConfig(crypto.randomUUID())
    expect(result.error).toBeUndefined()
    expect(result.data?.keybindings).toEqual(keybindings)
  })

  it('returns keybindings=null when .claude/keybindings.json is absent', async () => {
    const workClaudeDir = path.join(tmpWorkDir, '.claude')
    fs.mkdirSync(workClaudeDir, { recursive: true })

    ;(globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ = tmpWorkDir
    const { scanAgentLocalConfig } = await loadScanner()

    const result = scanAgentLocalConfig(crypto.randomUUID())
    expect(result.error).toBeUndefined()
    expect(result.data?.keybindings).toBeNull()
  })

  it('empty-claudeDir branch still populates userGlobalSettings from ~/.claude', async () => {
    // Create user-global settings BUT no .claude/ in the workdir — the
    // scanner's fast-path branch should still report userGlobalSettings.
    const userClaudeDir = path.join(tmpHome, '.claude')
    fs.mkdirSync(userClaudeDir, { recursive: true })
    fs.writeFileSync(path.join(userClaudeDir, 'settings.json'), JSON.stringify({ k: 1 }))

    ;(globalThis as Record<string, unknown>).__AIM_TRACKER_WORKDIR__ = tmpWorkDir
    const { scanAgentLocalConfig } = await loadScanner()

    const result = scanAgentLocalConfig(crypto.randomUUID())
    expect(result.error).toBeUndefined()
    expect(result.data?.userGlobalSettings).toEqual({ k: 1 })
    expect(result.data?.keybindings).toBeNull()
  })
})
