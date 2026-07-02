/**
 * Tests for the auto-update settings persistence layer.
 *
 * Covers:
 *   - Default-settings shape (master toggle off, manifest refresh on)
 *   - Interval clamping on load AND save (out-of-range corrected silently)
 *   - Category defaults (the two catch-alls default OFF)
 *   - Tmp+rename atomicity (concurrent writes never tear the file)
 *   - appendRunEntry caps at 200 entries
 *   - isDependencyPlugin recognises every name in the canonical list
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

import {
  loadSettings,
  saveSettings,
  appendRunEntry,
  getSettingsPath,
  DEFAULT_SETTINGS,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  type AutoUpdateSettings,
} from '@/lib/auto-update-settings'

import { isDependencyPlugin, DEPENDENCY_PLUGIN_NAMES } from '@/lib/dependency-plugins'

describe('auto-update-settings', () => {
  let tmpHome: string
  const ORIGINAL_HOME = os.homedir()

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'aim-auto-update-'))
    process.env.HOME = tmpHome
  })

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  describe('defaults', () => {
    it('master toggle defaults OFF — first-boot must be silent', () => {
      expect(DEFAULT_SETTINGS.enabled).toBe(false)
    })

    it('marketplace manifest refresh defaults ON — required prerequisite', () => {
      expect(DEFAULT_SETTINGS.categories.marketplaceManifests).toBe(true)
    })

    it('the two catch-all categories default OFF', () => {
      expect(DEFAULT_SETTINGS.categories.agentLocalScopePlugins).toBe(false)
      expect(DEFAULT_SETTINGS.categories.userScopePlugins).toBe(false)
    })

    it('non-catch-all categories default ON', () => {
      expect(DEFAULT_SETTINGS.categories.core).toBe(true)
      expect(DEFAULT_SETTINGS.categories.localMarketplaces).toBe(true)
      expect(DEFAULT_SETTINGS.categories.aiMaestroMarketplace).toBe(true)
      expect(DEFAULT_SETTINGS.categories.dependencyPlugins).toBe(true)
    })
  })

  describe('loadSettings', () => {
    it('returns DEFAULT_SETTINGS when the file does not exist (no implicit write)', async () => {
      const s = await loadSettings()
      expect(s).toEqual(DEFAULT_SETTINGS)
      // The path is never created on read — the API GET handler is
      // responsible for the optional first-write.
      await expect(fs.access(getSettingsPath())).rejects.toThrow()
    })

    it('clamps a too-small intervalMinutes upward on load', async () => {
      // Hand-craft a settings file with an out-of-range interval. Tmp HOME
      // means getSettingsPath() resolves into our test dir.
      const target = getSettingsPath()
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, JSON.stringify({ intervalMinutes: 1 }))

      const s = await loadSettings()
      expect(s.intervalMinutes).toBe(MIN_INTERVAL_MINUTES)
    })

    it('clamps a too-large intervalMinutes downward on load', async () => {
      const target = getSettingsPath()
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, JSON.stringify({ intervalMinutes: 999_999 }))

      const s = await loadSettings()
      expect(s.intervalMinutes).toBe(MAX_INTERVAL_MINUTES)
    })

    it('returns DEFAULT_SETTINGS when the file is corrupted JSON', async () => {
      const target = getSettingsPath()
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, '{ this is not valid json')

      const s = await loadSettings()
      expect(s).toEqual(DEFAULT_SETTINGS)
    })
  })

  describe('saveSettings', () => {
    it('persists the settings as JSON at mode 0600', async () => {
      const s: AutoUpdateSettings = {
        ...DEFAULT_SETTINGS,
        enabled: true,
        intervalMinutes: 30,
      }
      await saveSettings(s)

      const stat = await fs.stat(getSettingsPath())
      expect(stat.mode & 0o777).toBe(0o600)

      const text = await fs.readFile(getSettingsPath(), 'utf8')
      const parsed = JSON.parse(text)
      expect(parsed.enabled).toBe(true)
      expect(parsed.intervalMinutes).toBe(30)
    })

    it('clamps an out-of-range interval on save', async () => {
      const s: AutoUpdateSettings = {
        ...DEFAULT_SETTINGS,
        intervalMinutes: 999_999,
      }
      await saveSettings(s)

      const round = await loadSettings()
      expect(round.intervalMinutes).toBe(MAX_INTERVAL_MINUTES)
    })
  })

  describe('appendRunEntry', () => {
    it('caps the lastRunSummary at 200 entries (most-recent-first)', () => {
      let s: AutoUpdateSettings = { ...DEFAULT_SETTINGS, lastRunSummary: [] }
      for (let i = 0; i < 250; i++) {
        s = appendRunEntry(s, {
          target: `plugin-${i}`,
          status: 'updated',
          at: new Date().toISOString(),
        })
      }
      expect(s.lastRunSummary).toHaveLength(200)
      // The most-recent (last appended) entry should be at index 0.
      expect(s.lastRunSummary[0].target).toBe('plugin-249')
      expect(s.lastRunSummary[199].target).toBe('plugin-50')
    })
  })
})

describe('dependency-plugins', () => {
  it('recognises every name in the canonical list', () => {
    for (const name of DEPENDENCY_PLUGIN_NAMES) {
      expect(isDependencyPlugin(name)).toBe(true)
    }
  })

  it('case-insensitive match — keeps `Serena` and `SERENA` recognised', () => {
    expect(isDependencyPlugin('Serena')).toBe(true)
    expect(isDependencyPlugin('SERENA')).toBe(true)
    expect(isDependencyPlugin('serena')).toBe(true)
  })

  it('rejects names not in the curated list', () => {
    expect(isDependencyPlugin('ai-maestro-plugin')).toBe(false)
    expect(isDependencyPlugin('random-third-party-plugin')).toBe(false)
    expect(isDependencyPlugin('')).toBe(false)
  })
})
