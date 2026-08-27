import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { switchLiveTo } from '@/lib/oauth-rotator/rotate'
import { loadState, fingerprint, canonicalRotatorRoot, legacyRotatorRoot } from '@/lib/oauth-rotator/slots'
import { readLiveBlob } from '@/lib/oauth-rotator/live'

// 0-IMPACT / R16 SAFETY: switchLiveTo calls writeLiveBlob. Forced-off backend + HOME→temp (with a
// hard guard) route the live write to the temp-dir credentials file — the real Claude Code-credentials
// item is never touched, and `security` is never spawned.

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA',
  // the order-guard block deletes this to force the refusal; save/restore it so a developer who
  // legitimately has it set does not lose it for the rest of the run.
  'AIM_ROTATOR_ALLOW_LEGACY_ROOT'] as const
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

/**
 * THE ORDER GUARD (TRDD-N83OXS8G; the four-fix sequence closed by 348e2115).
 *
 * `switchLiveTo` refuses an unresolved rotator root BEFORE `writeLiveBlob`, not in front of the
 * bookkeeping. That distinction is the whole bug: three earlier fixes guarded the RECORDING of the
 * switch (`saveState`), and a throw there fires AFTER the credential has already moved — producing
 * keychain = B while state.json still says A, deterministically, which is worse than the silent
 * return it replaced. A guard on the recording of an act is not a guard on the act.
 *
 * The claim is therefore about ORDER, and order is invisible to any assertion on the thrown error.
 * What pins it is "NOTHING WAS WRITTEN": move the check back below `writeLiveBlob` and the live
 * credentials file exists, so this test reds while an error-message assertion would still pass.
 *
 * SAFETY: this inherits the file's harness — CLAUDE_SAFE_STORAGE_BACKEND=none forces the file
 * backend (the keychain is never reached, `security` is never spawned) and HOME is a temp dir with
 * the escape guard in beforeEach. Both roots are HOME-derived, so seeding the legacy one cannot
 * touch anything real.
 */
describe('switchLiveTo — refuses an unresolved root BEFORE the credential write', () => {
  /** Canonical state.json ABSENT + legacy state.json PRESENT + no opt-in ⇒ rotatorRoot refuses. */
  function seedUnresolvableRoot(): void {
    const legacy = legacyRotatorRoot()
    fs.mkdirSync(legacy, { recursive: true })
    fs.writeFileSync(path.join(legacy, 'state.json'), JSON.stringify({ live_email: 'legacy@example.com' }))
    delete process.env.AIM_ROTATOR_ALLOW_LEGACY_ROOT
  }

  it('is genuinely refusing (control: canonical absent, legacy present)', () => {
    seedUnresolvableRoot()
    expect(fs.existsSync(path.join(canonicalRotatorRoot(), 'state.json'))).toBe(false)
    expect(fs.existsSync(path.join(legacyRotatorRoot(), 'state.json'))).toBe(true)
  })

  it('throws, and writes NEITHER the credential NOR the state NOR the beacon', () => {
    seedUnresolvableRoot()

    expect(() => switchLiveTo('b@example.com', slot('must-not-land'), 'refused')).toThrow(
      /rotator-switch-refused \(nothing was written\)/,
    )

    // The load-bearing assertion. credFile is the temp-dir credentials path the harness pinned;
    // if the guard ran after writeLiveBlob this file would exist.
    expect(fs.existsSync(credFile)).toBe(false)
    expect(fs.existsSync(path.join(canonicalRotatorRoot(), 'state.json'))).toBe(false)
    expect(fs.existsSync(path.join(canonicalRotatorRoot(), 'live-identity.json'))).toBe(false)

    // The legacy state the refusal protected is untouched — a refusal must not mutate it either.
    const legacyState = JSON.parse(fs.readFileSync(path.join(legacyRotatorRoot(), 'state.json'), 'utf8'))
    expect(legacyState.live_email).toBe('legacy@example.com')
  })

  it('proceeds normally once the canonical root is vouched (the refusal is not permanent)', () => {
    seedUnresolvableRoot()
    const canonical = canonicalRotatorRoot()
    fs.mkdirSync(canonical, { recursive: true })
    fs.writeFileSync(path.join(canonical, 'state.json'), JSON.stringify({}))

    switchLiveTo('c@example.com', slot('lands'), 'vouched')

    expect(fs.existsSync(credFile)).toBe(true)
    expect(loadState().live_email).toBe('c@example.com')
  })
})
