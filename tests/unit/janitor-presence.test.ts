/**
 * Tests for lib/janitor-presence.ts — "is the janitor installed AND armed on
 * this host?" (ai-maestro#102, TRDD-5X3P79Q6).
 *
 * 0-IMPACT: `$HOME` is repointed at a fresh temp dir per test, so every path
 * this module resolves (`~/.claude/settings.json`, the janitor DATA dir, the
 * legacy global-state dir) lands under the temp HOME. Nothing here can read
 * or write the developer's real `~/.claude/settings.json` or the real
 * janitor state — there is no fallback to the real home on any code path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isJanitorInstalled, isJanitorDisarmed, isJanitorInstalledAndArmed } from '@/lib/janitor-presence'

let tmpHome: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-janitor-presence-'))
  process.env.HOME = tmpHome
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

function writeClaudeSettings(enabledPlugins: Record<string, boolean>): void {
  const dir = path.join(tmpHome, '.claude')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ enabledPlugins }))
}

function touchDataKillSwitch(): void {
  const dir = path.join(tmpHome, '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins', 'global-state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'kill-switch.flag'), '')
}

function touchLegacyKillSwitch(): void {
  const dir = path.join(tmpHome, '.claude', 'janitor-global-state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'kill-switch.flag'), '')
}

describe('isJanitorInstalled', () => {
  it('false when ~/.claude/settings.json does not exist (fail-safe: no consent forged)', () => {
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'settings.json'))).toBe(false)
    expect(isJanitorInstalled()).toBe(false)
  })

  it('false when settings.json exists but has no janitor key', () => {
    writeClaudeSettings({ 'ai-maestro-plugin@ai-maestro-plugins': true })
    expect(isJanitorInstalled()).toBe(false)
  })

  it('false when the janitor key is present but disabled (false)', () => {
    writeClaudeSettings({ 'ai-maestro-janitor@ai-maestro-plugins': false })
    expect(isJanitorInstalled()).toBe(false)
  })

  it('true when ai-maestro-janitor@<marketplace> is enabled — the real host shape (ai-maestro#102)', () => {
    writeClaudeSettings({
      'ai-maestro-janitor@ai-maestro-plugins': true,
      'ai-maestro-plugin@ai-maestro-plugins': false,
    })
    expect(isJanitorInstalled()).toBe(true)
  })

  it('matches by NAME prefix, not exact key — any marketplace hosting the janitor counts', () => {
    writeClaudeSettings({ 'ai-maestro-janitor@some-other-marketplace': true })
    expect(isJanitorInstalled()).toBe(true)
  })

  it('false on corrupted JSON — a read error must never forge consent', () => {
    const dir = path.join(tmpHome, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not valid json')
    expect(isJanitorInstalled()).toBe(false)
  })

  it('does not match a DIFFERENT plugin whose name merely starts the same way', () => {
    // e.g. a hypothetical "ai-maestro-janitor-extra@mkt" must not false-positive via a loose
    // substring match — the check anchors on the "@" boundary via `${JANITOR_PLUGIN_NAME}@`.
    writeClaudeSettings({ 'ai-maestro-janitor-extra@ai-maestro-plugins': true })
    expect(isJanitorInstalled()).toBe(false)
  })
})

describe('isJanitorDisarmed', () => {
  it('false (armed) when neither kill-switch path exists', () => {
    expect(isJanitorDisarmed()).toBe(false)
  })

  it('true when the DATA-dir kill-switch.flag is present', () => {
    touchDataKillSwitch()
    expect(isJanitorDisarmed()).toBe(true)
  })

  it('true when only the LEGACY kill-switch.flag is present', () => {
    touchLegacyKillSwitch()
    expect(isJanitorDisarmed()).toBe(true)
  })

  it('true when BOTH are present (either one alone is sufficient)', () => {
    touchDataKillSwitch()
    touchLegacyKillSwitch()
    expect(isJanitorDisarmed()).toBe(true)
  })

  it('an EMPTY (but existing) global-state dir does not count as disarmed', () => {
    fs.mkdirSync(path.join(tmpHome, '.claude', 'plugins', 'data', 'ai-maestro-janitor-ai-maestro-plugins', 'global-state'), {
      recursive: true,
    })
    expect(isJanitorDisarmed()).toBe(false)
  })
})

describe('isJanitorInstalledAndArmed — the gate the absorbed-duty scheduler consults', () => {
  it('false when not installed, even if not disarmed', () => {
    expect(isJanitorInstalledAndArmed()).toBe(false)
  })

  it('false when installed but disarmed — a deliberate STOP overrides installed consent', () => {
    writeClaudeSettings({ 'ai-maestro-janitor@ai-maestro-plugins': true })
    touchDataKillSwitch()
    expect(isJanitorInstalledAndArmed()).toBe(false)
  })

  it('true only when installed AND armed', () => {
    writeClaudeSettings({ 'ai-maestro-janitor@ai-maestro-plugins': true })
    expect(isJanitorInstalledAndArmed()).toBe(true)
  })

  it('false when armed (no kill-switch) but never installed', () => {
    // Positive control for the "armed" half alone: absence of a kill-switch is not, by
    // itself, evidence of installation.
    expect(isJanitorDisarmed()).toBe(false)
    expect(isJanitorInstalledAndArmed()).toBe(false)
  })
})
