import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { switchLiveTo } from '@/lib/oauth-rotator/rotate'
import { loadState, fingerprint } from '@/lib/oauth-rotator/slots'
import { readLiveBlob } from '@/lib/oauth-rotator/live'

// 0-IMPACT / R16 SAFETY: switchLiveTo calls writeLiveBlob. Forced-off backend + HOME→temp (with a
// hard guard) route the live write to the temp-dir credentials file — the real Claude Code-credentials
// item is never touched, and `security` is never spawned.

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA'] as const
let saved: Record<string, string | undefined>
let tmpDir: string
let credFile: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-rotate-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  delete process.env.CLAUDE_PLUGIN_DATA
  credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) {
    throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

const slot = (accessToken: string) => ({ claudeAiOauth: { accessToken, refreshToken: 'r' } })

describe('switchLiveTo', () => {
  it('writes the merged live credential and records the switch in state + beacon', () => {
    const s = slot('slot-tok')
    switchLiveTo('a@example.com', s, 'test-reason')

    // The live credential is now the slot's claudeAiOauth (no prior live → nothing to preserve).
    expect(readLiveBlob()).toEqual({ claudeAiOauth: { accessToken: 'slot-tok', refreshToken: 'r' } })

    const st = loadState()
    expect(st.live_email).toBe('a@example.com')
    expect(st.live_fp).toBe(fingerprint(s))
    expect(st.last_switch_reason).toBe('test-reason')
    expect(st.live_429_streak).toBe(0)
    expect(typeof st.last_switch_at).toBe('number')

    // Identity beacon stamped under the rotator root.
    const beacon = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins', 'oauth-rotator', 'live-identity.json'), 'utf8'))
    expect(beacon.fp).toBe(fingerprint(s))
    expect(beacon.email).toBe('a@example.com')
    expect(typeof beacon.ts).toBe('number')
  })

  it('PRESERVES the live mcpOAuth (and other live keys) across a rotation', () => {
    // Seed a current live credential with an mcpOAuth section a rotation must not wipe.
    fs.mkdirSync(path.dirname(credFile), { recursive: true })
    fs.writeFileSync(
      credFile,
      JSON.stringify({ claudeAiOauth: { accessToken: 'old' }, mcpOAuth: { srv: { token: 'keep-me' } } }),
    )
    switchLiveTo('b@example.com', slot('new-tok'), 'rotate')
    const live = readLiveBlob() as Record<string, unknown>
    expect(live.mcpOAuth).toEqual({ srv: { token: 'keep-me' } }) // preserved
    expect((live.claudeAiOauth as Record<string, unknown>).accessToken).toBe('new-tok') // replaced
  })
})
