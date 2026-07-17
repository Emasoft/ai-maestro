import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  enforceClaudeSettings,
  startClaudeSettingsEnforcerWatchdog,
  stopClaudeSettingsEnforcerWatchdog,
  REQUIRED_ENV,
  REQUIRED_TOP_LEVEL,
} from '@/lib/claude-settings-enforcer'

// 0-IMPACT: every test passes an explicit `target` under a temp dir, so the
// real ~/.claude/settings.json is never read or written. The watchdog test uses
// a 1-hour interval and stops immediately, so its (default-path) sweep can never
// fire during the test.

let tmpDir: string
let file: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-settings-enforcer-'))
  file = path.join(tmpDir, '.claude', 'settings.json')
})

afterEach(() => {
  stopClaudeSettingsEnforcerWatchdog()
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
})

const read = () => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>

describe('enforceClaudeSettings', () => {
  it('creates a fresh settings.json (and its dir) with the full allowlist', () => {
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(true)
    // every env key + every top-level key was applied
    expect(r.applied).toContain('env.ENABLE_BACKGROUND_TASKS')
    expect(r.applied).toContain('askUserQuestionTimeout')
    const obj = read()
    expect(obj.env).toEqual({ ...REQUIRED_ENV })
    expect(obj.askUserQuestionTimeout).toBe(REQUIRED_TOP_LEVEL.askUserQuestionTimeout)
    // values are the literal STRINGS, not coerced booleans/numbers
    expect((obj.env as Record<string, unknown>).ENABLE_TOOL_SEARCH).toBe('false')
    expect((obj.env as Record<string, unknown>).CLAUDE_AFK_TIMEOUT_MS).toBe('300000')
  })

  it('adds missing keys while PRESERVING unrelated env keys and unrelated top-level keys', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: 'dark', env: { MY_OWN: 'keep', ENABLE_BACKGROUND_TASKS: '1' } }),
    )
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(true)
    const obj = read()
    expect(obj.theme).toBe('dark') // unrelated top-level preserved
    const env = obj.env as Record<string, unknown>
    expect(env.MY_OWN).toBe('keep') // unrelated env key preserved
    expect(env.ENABLE_BACKGROUND_TASKS).toBe('1') // already-correct key not re-flagged
    expect(r.applied).not.toContain('env.ENABLE_BACKGROUND_TASKS')
    expect(env.ENABLE_TOOL_SEARCH).toBe('false') // missing key added
  })

  it('corrects a drifted value (update-if-different)', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Start fully-enforced except one flipped env value, so ONLY that key differs.
    fs.writeFileSync(
      file,
      JSON.stringify({ ...REQUIRED_TOP_LEVEL, env: { ...REQUIRED_ENV, ENABLE_TOOL_SEARCH: 'true' } }),
    )
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(true)
    expect(r.applied).toEqual(['env.ENABLE_TOOL_SEARCH']) // ONLY the wrong key
    expect((read().env as Record<string, unknown>).ENABLE_TOOL_SEARCH).toBe('false')
  })

  it('is idempotent — a second run makes no change and leaves the bytes identical', () => {
    enforceClaudeSettings(file)
    const first = fs.readFileSync(file, 'utf8')
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(false)
    expect(r.applied).toEqual([])
    expect(fs.readFileSync(file, 'utf8')).toBe(first)
  })

  it('restores a value after external drift (the watchdog contract, applied directly)', () => {
    enforceClaudeSettings(file)
    // Someone edits the file and flips a value.
    const obj = read()
    ;(obj.env as Record<string, unknown>).CLAUDE_CODE_RETRY_WATCHDOG = '0'
    fs.writeFileSync(file, JSON.stringify(obj))
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(true)
    expect(r.applied).toEqual(['env.CLAUDE_CODE_RETRY_WATCHDOG'])
    expect((read().env as Record<string, unknown>).CLAUDE_CODE_RETRY_WATCHDOG).toBe('1')
  })

  it('writes a rolling .aim-bak backup of the pre-change content', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const before = JSON.stringify({ theme: 'light' })
    fs.writeFileSync(file, before)
    enforceClaudeSettings(file)
    expect(fs.readFileSync(`${file}.aim-bak`, 'utf8')).toBe(before)
  })

  it('FAIL-CLOSED on corrupt JSON — refuses to write and leaves the file untouched', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const corrupt = '{ this is not valid json'
    fs.writeFileSync(file, corrupt)
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(false)
    expect(r.error).toMatch(/not valid JSON/)
    expect(fs.readFileSync(file, 'utf8')).toBe(corrupt) // NOT clobbered
    expect(fs.existsSync(`${file}.aim-bak`)).toBe(false) // no backup on refusal
  })

  it('FAIL-CLOSED when settings.json is a JSON array/scalar, not an object', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '[1,2,3]')
    const r = enforceClaudeSettings(file)
    expect(r.changed).toBe(false)
    expect(r.error).toMatch(/not a JSON object/)
    expect(fs.readFileSync(file, 'utf8')).toBe('[1,2,3]')
  })
})

describe('startClaudeSettingsEnforcerWatchdog', () => {
  it('is disabled at interval <= 0 and idempotent when already running', () => {
    expect(startClaudeSettingsEnforcerWatchdog(0)).toBe(false) // disabled
    // A 1-hour interval cannot fire before afterEach stops it → 0-impact.
    expect(startClaudeSettingsEnforcerWatchdog(3_600_000)).toBe(true)
    expect(startClaudeSettingsEnforcerWatchdog(3_600_000)).toBe(false) // no second loop
    stopClaudeSettingsEnforcerWatchdog()
    expect(startClaudeSettingsEnforcerWatchdog(3_600_000)).toBe(true) // restartable after stop
  })
})
