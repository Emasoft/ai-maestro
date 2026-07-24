/**
 * Tests for the boot-persistence self-check (TRDD-NIU5RQ1S).
 *
 * The property that matters is the FAIL-SAFE DIRECTION: every uncertain input must resolve to
 * "will NOT survive a reboot". A wrong "you are fine" is the only answer with a real cost — the
 * operator stops looking, and learns the truth after an outage has already lost the fleet's work.
 *
 * 0-IMPACT: `evaluateBootPersistence` is pure, so every case is a plain object. No host state.
 */
import { describe, it, expect } from 'vitest'
import {
  evaluateBootPersistence,
  looksLikePm2Unit,
  namedInDump,
  dumpPolicyCarriesBackoff,
  unitSearchDirs,
  detectBootPersistence,
  type BootPersistenceFacts,
} from '@/lib/boot-persistence'

const healthy: BootPersistenceFacts = {
  platform: 'darwin',
  unitFileNames: ['com.apple.something.plist', 'pm2.emanuele.plist'],
  dumpExists: true,
  dumpContainsApp: true,
  unitLoaded: true,
  dumpHasBackoff: true,
}

describe('boot-persistence — the healthy case', () => {
  it('reports OK only when the unit AND a dump naming the app are both present', () => {
    const v = evaluateBootPersistence(healthy)
    expect(v.status).toBe('ok')
    expect(v.willSurviveReboot).toBe(true)
  })
})

describe('boot-persistence — every failure mode says it will NOT survive', () => {
  it('no pm2 unit — the total-failure point, and the loudest message', () => {
    const v = evaluateBootPersistence({ ...healthy, unitFileNames: ['com.apple.something.plist'] })
    expect(v.status).toBe('missing-unit')
    expect(v.willSurviveReboot).toBe(false)
    // The message must name the consequence, not just the fact: an operator reading it at 3am
    // needs to know the whole restore chain is dead, not merely that a plist is absent.
    expect(v.message).toMatch(/NO agent is restored|never comes up/)
    expect(v.message).toContain('install-boot-persistence.sh')
  })

  it('unit present but NO saved list — boot resurrects nothing', () => {
    const v = evaluateBootPersistence({ ...healthy, dumpExists: false, dumpContainsApp: null })
    expect(v.status).toBe('missing-dump')
    expect(v.willSurviveReboot).toBe(false)
    expect(v.message).toContain('pm2 save')
  })

  it('STALE list that does not name this app — the trap that looks configured', () => {
    // This is the case a human eyeballing `ls ~/.pm2/dump.pm2` would call healthy.
    const v = evaluateBootPersistence({ ...healthy, dumpContainsApp: false })
    expect(v.status).toBe('stale-dump')
    expect(v.willSurviveReboot).toBe(false)
  })

  it('dump present but UNREADABLE — never claims OK on an unknown', () => {
    const v = evaluateBootPersistence({ ...healthy, dumpContainsApp: null })
    expect(v.willSurviveReboot).toBe(false)
  })

  it('an unrecognised platform is UNVERIFIED, not OK', () => {
    const v = evaluateBootPersistence({ ...healthy, platform: 'win32' })
    expect(v.status).toBe('unknown-platform')
    expect(v.willSurviveReboot).toBe(false)
  })
})

describe('boot-persistence — present on disk but NOT loaded', () => {
  // The real host that motivated this branch: pm2.<user>.plist present and enabled, yet no job
  // bootstrapped in the running domain. Reporting that as a reboot failure would be a false alarm.
  it('still survives a reboot (login re-loads LaunchAgents) — so the flag stays true', () => {
    const v = evaluateBootPersistence({ ...healthy, unitLoaded: false })
    expect(v.status).toBe('unit-not-loaded')
    expect(v.willSurviveReboot).toBe(true)
  })

  it('but names the live gap: a pm2-daemon death today is NOT recovered', () => {
    const v = evaluateBootPersistence({ ...healthy, unitLoaded: false })
    expect(v.message).toMatch(/not currently loaded/)
    expect(v.message).toContain('launchctl bootstrap')
  })

  it('an UNKNOWN load state is not treated as unloaded — no nagging on a healthy host', () => {
    expect(evaluateBootPersistence({ ...healthy, unitLoaded: null }).status).toBe('ok')
    expect(evaluateBootPersistence({ ...healthy, unitLoaded: undefined }).status).toBe('ok')
  })

  it('a missing unit still outranks it — the real failure is reported first', () => {
    const v = evaluateBootPersistence({ ...healthy, unitFileNames: [], unitLoaded: false })
    expect(v.status).toBe('missing-unit')
    expect(v.willSurviveReboot).toBe(false)
  })
})

describe('boot-persistence — the SAVED restart policy can be stale', () => {
  // The trap: `pm2 resurrect` replays the dump, NOT ecosystem.config.js. Editing the config and
  // believing the boot path changed is the natural mistake — it cost a falsely-ticked acceptance
  // box on this very TRDD before anything reported it.
  it('warns when the saved entry predates the never-give-up policy', () => {
    const v = evaluateBootPersistence({ ...healthy, dumpHasBackoff: false })
    expect(v.status).toBe('stale-policy')
    expect(v.message).toContain('pm2 save')
    expect(v.message).toMatch(/replays the dump/)
  })

  it('is a DEGRADED recovery, not a failed one — an ordinary reboot still comes back', () => {
    expect(evaluateBootPersistence({ ...healthy, dumpHasBackoff: false }).willSurviveReboot).toBe(true)
  })

  it('an unknown policy is not treated as stale', () => {
    expect(evaluateBootPersistence({ ...healthy, dumpHasBackoff: null }).status).toBe('ok')
    expect(evaluateBootPersistence({ ...healthy, dumpHasBackoff: undefined }).status).toBe('ok')
  })

  it('BOTH warnings surface together — fixing one must not hide the other', () => {
    // The real host was in exactly this state: unit present but not loaded, AND a dump saved
    // before the backoff policy existed.
    const v = evaluateBootPersistence({ ...healthy, unitLoaded: false, dumpHasBackoff: false })
    expect(v.message).toContain('launchctl bootstrap')
    expect(v.message).toContain('pm2 save')
  })

  it('reads the backoff off the app\'s own entry, not any entry', () => {
    const dump = JSON.stringify([
      { name: 'other-app', exp_backoff_restart_delay: 1000 },
      { name: 'ai-maestro', max_restarts: 10 },
    ])
    expect(dumpPolicyCarriesBackoff(dump, 'ai-maestro')).toBe(false)
    expect(dumpPolicyCarriesBackoff(dump, 'other-app')).toBe(true)
  })

  it('returns null for an absent app — stale-dump already reports that, once', () => {
    const dump = JSON.stringify([{ name: 'other-app', exp_backoff_restart_delay: 1000 }])
    expect(dumpPolicyCarriesBackoff(dump, 'ai-maestro')).toBeNull()
    expect(dumpPolicyCarriesBackoff('not json', 'ai-maestro')).toBeNull()
  })

  it('a zero delay is not backoff', () => {
    expect(dumpPolicyCarriesBackoff(JSON.stringify([{ name: 'a', exp_backoff_restart_delay: 0 }]), 'a')).toBe(false)
  })
})

describe('boot-persistence — dump content is matched on the entry NAME', () => {
  const dump = JSON.stringify([{ name: 'ai-maestro', script: '/Users/x/ai-maestro/scripts/start.sh' }])

  it('finds an entry named exactly this app', () => {
    expect(namedInDump(dump, 'ai-maestro')).toBe(true)
  })

  it('rejects a dump that merely MENTIONS the app in a path — the false-OK this closes', () => {
    // `other-app` is what would be resurrected; a substring scan for "ai-maestro" would still hit
    // the cwd path and wrongly report the server as covered.
    const otherOnly = JSON.stringify([{ name: 'other-app', cwd: '/Users/x/ai-maestro' }])
    expect(namedInDump(otherOnly, 'ai-maestro')).toBe(false)
    expect(otherOnly.includes('ai-maestro')).toBe(true) // the substring fallback's blind spot
  })

  it('returns null (not false) on an unparseable dump so the caller can fall back', () => {
    expect(namedInDump('not json at all', 'ai-maestro')).toBeNull()
    expect(namedInDump('{"processes":[]}', 'ai-maestro')).toBeNull() // shape changed across versions
  })
})

describe('boot-persistence — unit detection', () => {
  it('matches pm2 unit filenames loosely, in both platforms\' conventions', () => {
    expect(looksLikePm2Unit('pm2.emanuele.plist')).toBe(true)
    expect(looksLikePm2Unit('pm2-emanuele.service')).toBe(true)
    expect(looksLikePm2Unit('PM2.someone.plist')).toBe(true) // case-insensitive
    expect(looksLikePm2Unit('com.apple.something.plist')).toBe(false)
    expect(looksLikePm2Unit('com.ai-maestro-janitor.daemon.plist')).toBe(false)
  })

  it('searches the launchd dirs on macOS and the systemd dirs on Linux', () => {
    expect(unitSearchDirs('darwin', '/Users/x')).toContain('/Users/x/Library/LaunchAgents')
    expect(unitSearchDirs('linux', '/home/x')).toContain('/etc/systemd/system')
    expect(unitSearchDirs('win32', '/c')).toEqual([])
  })
})

describe('boot-persistence — the live check never throws', () => {
  it('returns a verdict even for a nonexistent home (a crashing self-check is worse than the hole)', () => {
    const v = detectBootPersistence('ai-maestro', '/nonexistent-home-for-test', 'darwin')
    expect(v.willSurviveReboot).toBe(false)
    expect(typeof v.message).toBe('string')
  })
})
