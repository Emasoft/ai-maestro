import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dueForDelivery, deliveryText, BACKOFF_LADDER_S, deliverAlerts, type AlertRecord } from '@/lib/oauth-rotator/alert-delivery'
import { runOneSupervisorBeat } from '@/lib/oauth-rotator/server-supervisor'
import { ownsSupervisorAlert } from '@/lib/oauth-rotator/supervisor'
import { ownsTickAlert } from '@/lib/oauth-rotator/server-tick'

const rec = (over: Partial<AlertRecord> = {}): AlertRecord =>
  ({ firstSeenAt: 1000, lastDeliveredAt: 1000, message: 'm', seen: 1, ...over })

/** Deps for a beat of the SUPERVISOR producer. Every pre-existing test in this file drives that
 *  producer (its findings are all `pinning-env`), so passing its real ownership predicate keeps
 *  their semantics identical to before `owns` existed — they still exercise the single-producer
 *  resolve path, which must keep working. See TRDD-W6PHZFC9. */
const supDeps = (nowS: number) => ({ nowS: () => nowS, log: () => {}, owns: ownsSupervisorAlert })

/** Deps for a beat of the 60s TICK producer — the second writer of the same file. */
const tickDeps = (nowS: number) => ({ nowS: () => nowS, log: () => {}, owns: ownsTickAlert })

// ── Isolation for the tests that call the REAL deliverAlerts (file I/O) ────────────────────────
// CLAUDE_PLUGIN_DATA must CONTAIN the janitor's data dirname or canonicalRotatorRoot() ignores it
// (the codex-clobber guard). And the temp root must hold a state.json, because rotatorRoot() falls
// back to the LEGACY ~/.claude/account-rotator when the canonical root has none — which on a real
// machine is a live directory. Without that file this suite would write to the developer's actual
// rotator state.
const JANITOR_DIRNAME = 'ai-maestro-janitor-ai-maestro-plugins'
const REAL_LOG = path.join(os.homedir(), '.claude', 'plugins', 'data', JANITOR_DIRNAME, 'oauth-rotator', 'rotator.log')
const realFp = (): string => {
  try { const s = fs.statSync(REAL_LOG); return `${s.size}:${s.mtimeMs}` } catch { return 'absent' }
}
let realBefore = ''
let tmpRoot = ''
let savedPluginData: string | undefined

beforeAll(() => { realBefore = realFp() })
afterAll(() => {
  // Containment is by construction (env-redirected root); this PROVES it, because "contained" and
  // "never ran" are indistinguishable in a green suite.
  expect(realFp(), `the real rotator.log at ${REAL_LOG} CHANGED — a test escaped its temp root`).toBe(realBefore)
})

function isolateRotatorRoot(): string {
  savedPluginData = process.env.CLAUDE_PLUGIN_DATA
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-alerts-'))
  const data = path.join(base, JANITOR_DIRNAME)
  const root = path.join(data, 'oauth-rotator')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'state.json'), '{"slots":{}}')
  process.env.CLAUDE_PLUGIN_DATA = data
  return root
}
function restoreRotatorRoot(): void {
  if (savedPluginData === undefined) delete process.env.CLAUDE_PLUGIN_DATA
  else process.env.CLAUDE_PLUGIN_DATA = savedPluginData
}

const logLines = (root: string): string[] => {
  try { return fs.readFileSync(path.join(root, 'rotator.log'), 'utf8').split('\n').filter(Boolean) }
  catch { return [] }
}

describe('dueForDelivery — the backoff ladder (TRDD-RFQFCCU4)', () => {
  it('the ONSET always delivers — a never-seen code goes out at once', () => {
    // The moment of onset is the most actionable moment there will ever be.
    expect(dueForDelivery(undefined, 5_000)).toBe(true)
  })

  it('does NOT re-deliver on the next beat — this is the 4506-lines defect', () => {
    // A beat is 60s. Same code, one beat later, must stay silent: an alert that repeats every
    // minute forever is how `a human must re-login` became furniture over four days.
    expect(dueForDelivery(rec({ lastDeliveredAt: 1000 }), 1060)).toBe(false)
  })

  it('re-delivers once the rung elapses, and the rung WIDENS as it stays outstanding', () => {
    // Rung 1 is 15 min after the onset delivery.
    expect(dueForDelivery(rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 }), 1000 + 899)).toBe(false)
    expect(dueForDelivery(rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 }), 1000 + 900)).toBe(true)

    // Having been outstanding for 15 min at the last delivery, the NEXT gap is the wider rung —
    // so 15 min later is NOT yet due.
    const later = rec({ firstSeenAt: 1000, lastDeliveredAt: 1000 + 900 })
    expect(dueForDelivery(later, 1000 + 900 + 900)).toBe(false)
    expect(dueForDelivery(later, 1000 + 900 + 3600)).toBe(true)
  })

  it('NEVER goes permanently silent — the widest rung still fires', () => {
    // An outstanding credential problem that has gone quiet is indistinguishable from one that was
    // fixed, and that ambiguity is what let the incident run for four days.
    const old = rec({ firstSeenAt: 0, lastDeliveredAt: 100_000 })
    const widest = BACKOFF_LADDER_S[BACKOFF_LADDER_S.length - 1]
    expect(dueForDelivery(old, 100_000 + widest)).toBe(true)
  })
})

describe('the shared rotator.log records TRANSITIONS, not the steady state', () => {
  beforeEach(() => { tmpRoot = isolateRotatorRoot() })
  afterEach(() => { restoreRotatorRoot() })

  const F = [{ code: 'pinning-env', message: '$ANTHROPIC_API_KEY is set' }]

  it('writes ONSET when an alert first appears', async () => {
    await deliverAlerts(F, supDeps(1000))
    const l = logLines(tmpRoot)
    expect(l).toHaveLength(1)
    expect(l[0]).toContain('aim-server/alert: ONSET pinning-env')
  })

  it('does NOT append again while the SAME alert stays outstanding — the 4506-lines defect', () => {
    // THE load-bearing assertion. The supervisor beats every 10 min; appending per beat would put
    // ~144 identical lines a day into a file the janitor trims at 256 KB, so a persistent alert
    // would EVICT the rotation history this log exists to preserve. The alert is still fully
    // readable in active-alerts.json — a log records a CHANGE of state, the state file holds the
    // state.
    return (async () => {
      await deliverAlerts(F, supDeps(1000))
      await deliverAlerts(F, supDeps(1600))
      await deliverAlerts(F, supDeps(2200))
      const onsets = logLines(tmpRoot).filter((x) => x.includes('ONSET pinning-env'))
      expect(onsets).toHaveLength(1)
    })()
  })

  it('writes CLEARED when the alert resolves', async () => {
    await deliverAlerts(F, supDeps(1000))
    await deliverAlerts([], supDeps(1600))
    const l = logLines(tmpRoot)
    expect(l.filter((x) => x.includes('ONSET pinning-env'))).toHaveLength(1)
    expect(l.filter((x) => x.includes('CLEARED pinning-env'))).toHaveLength(1)
  })

  it('a re-onset after a clear is a NEW transition, not a duplicate suppressed forever', async () => {
    // Suppression keyed on "have we ever seen this code" would go permanently silent after the
    // first occurrence — the same class of bug as an alert that never clears, seen from the
    // other side.
    await deliverAlerts(F, supDeps(1000))
    await deliverAlerts([], supDeps(1600))
    await deliverAlerts(F, supDeps(2200))
    expect(logLines(tmpRoot).filter((x) => x.includes('ONSET pinning-env'))).toHaveLength(2)
  })
})

describe('two producers share this file and must NOT evict each other (TRDD-W6PHZFC9)', () => {
  beforeEach(() => { tmpRoot = isolateRotatorRoot() })
  afterEach(() => { restoreRotatorRoot() })

  // `findings` is ONE producer's outstanding set, never the file's. Before scoping, each beat
  // reaped every code absent from its own findings, so the supervisor beat deleted the tick
  // beat's alerts and vice versa — measured live 2026-08-23 as 118 ONSET / 117 CLEARED of
  // `rotator-stuck:all-maxed` in antiphase with `cookie-leg-stuck`, the file never holding more
  // than ONE code, and `firstSeenAt` resetting every ~5 beats so the backoff never escalated.
  const SUP = [{ code: 'cookie-leg-stuck', message: 'no usable cookie' }]
  const TICK = [{ code: 'rotator-stuck:all-maxed', message: 'every account maxed' }]

  const alertsOf = (root: string): Record<string, AlertRecord> => {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'active-alerts.json'), 'utf8'))
    return (raw.alerts ?? {}) as Record<string, AlertRecord>
  }

  it('BOTH producers stay outstanding when each reports only its own finding', async () => {
    await deliverAlerts(TICK, tickDeps(1000))
    await deliverAlerts(SUP, supDeps(1060))

    // The whole defect in one assertion: pre-scoping this read 1, because the supervisor beat's
    // clear-loop deleted the tick's code as "not live".
    const a = alertsOf(tmpRoot)
    expect(Object.keys(a).sort()).toEqual(['cookie-leg-stuck', 'rotator-stuck:all-maxed'])
  })

  it('neither producer logs a CLEARED for the other one\'s code', async () => {
    await deliverAlerts(TICK, tickDeps(1000))
    await deliverAlerts(SUP, supDeps(1060))
    await deliverAlerts(TICK, tickDeps(1120))
    await deliverAlerts(SUP, supDeps(1180))

    // A CLEARED line for a code this producer never observed is not noise, it is a FALSE
    // statement in the shared timeline a human reconstructs the incident from.
    const cleared = logLines(tmpRoot).filter((x) => x.includes('CLEARED'))
    expect(cleared).toEqual([])
  })

  it('does not reset the other producer\'s backoff clock — the escalation survives', async () => {
    // firstSeenAt is what `deliveryText` quotes as the age and what the ladder measures from.
    // Eviction destroyed the record, so the next ONSET restarted the clock at now and a
    // PERSISTENT alert re-delivered forever as if brand new — the 4506-lines defect, resurrected
    // one level up by a second writer.
    await deliverAlerts(TICK, tickDeps(1000))
    for (const t of [1060, 1120, 1180, 1240]) await deliverAlerts(SUP, supDeps(t))
    await deliverAlerts(TICK, tickDeps(1300))

    expect(alertsOf(tmpRoot)['rotator-stuck:all-maxed'].firstSeenAt).toBe(1000)
  })

  it('a producer STILL reaps its OWN resolved code — scoping did not disable resolution', async () => {
    // The complement, and the one a too-broad `owns` would break: if scoping also stopped a
    // producer clearing its own code, the file would go back to "what has ever been wrong" and
    // this fix would have traded one silent failure for another.
    await deliverAlerts(TICK, tickDeps(1000))
    await deliverAlerts(SUP, supDeps(1060))
    await deliverAlerts([], tickDeps(1120)) // the tick's condition resolved

    expect(Object.keys(alertsOf(tmpRoot))).toEqual(['cookie-leg-stuck'])
    expect(logLines(tmpRoot).filter((x) => x.includes('CLEARED rotator-stuck:all-maxed'))).toHaveLength(1)
  })

  it('reaps an ORPHAN — a code no live producer claims cannot leak forever', async () => {
    // Scoping INTRODUCES this leak: pre-scoping the over-broad clear reaped orphans as a side
    // effect. A code whose producer stopped emitting it (a rename, a removed check) is owned by
    // nobody, so without a bound it would sit in the file asserting a dead condition forever.
    await deliverAlerts([{ code: 'retired-code', message: 'from a producer that no longer exists' }],
      { nowS: () => 1000, log: () => {}, owns: (c) => c === 'retired-code' })
    expect(Object.keys(alertsOf(tmpRoot))).toContain('retired-code')

    // A LIVE alert can never reach the bound: its producer re-stamps lastSeenAt every beat.
    const EIGHT_DAYS = 8 * 24 * 3600
    await deliverAlerts(SUP, supDeps(1000 + EIGHT_DAYS))
    expect(Object.keys(alertsOf(tmpRoot))).toEqual(['cookie-leg-stuck'])
  })

  it('a live alert is NOT reaped by the orphan bound, however long it stays outstanding', async () => {
    // The positive control for the test above: without this, an orphan bound that silently ate
    // real long-running alerts would pass it just as happily.
    const EIGHT_DAYS = 8 * 24 * 3600
    await deliverAlerts(TICK, tickDeps(1000))
    for (let t = 1060; t <= 1000 + EIGHT_DAYS; t += 24 * 3600) await deliverAlerts(TICK, tickDeps(t))
    await deliverAlerts(SUP, supDeps(1000 + EIGHT_DAYS + 60))

    expect(Object.keys(alertsOf(tmpRoot)).sort()).toEqual(['cookie-leg-stuck', 'rotator-stuck:all-maxed'])
  })
})

describe('deliveryText — the age is the part a log line cannot carry', () => {
  it('states how long the alert has been OUTSTANDING once it is not brand new', () => {
    // "stuck" and "stuck since Tuesday" are different emergencies.
    expect(deliveryText('cookie-leg-stuck', 'x@y needs a login', 4 * 3600)).toMatch(/OUTSTANDING 4\.0h/)
  })
  it('omits the age at onset, where it would read as a stale alert', () => {
    expect(deliveryText('cookie-leg-stuck', 'x@y needs a login', 5)).toBe('[cookie-leg-stuck] x@y needs a login')
  })
})

describe('the beat DELIVERS, and delivery can never take the beat down', () => {
  const facts = { optIn: true, onMacos: true, pinningEnv: [], daemonAlive: true, tickCompletedAgeS: 1, slots: [] }

  it('a finding reaches the DELIVERY channel, not only the log', () => {
    // The whole defect: findings were perfect and reached only console.warn.
    const delivered: Array<ReadonlyArray<{ code: string }>> = []
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => ({ ...facts, pinningEnv: ['ANTHROPIC_API_KEY'] }) as never,
      log: () => {},
      deliver: f => { delivered.push(f) },
    })
    expect(codes).toContain('pinning-env')
    expect(delivered).toHaveLength(1)
    expect(delivered[0].map(f => f.code)).toContain('pinning-env')
  })

  it('a THROWING delivery leaves the beat’s verdict intact — a guardian must not remove itself', () => {
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => ({ ...facts, pinningEnv: ['ANTHROPIC_API_KEY'] }) as never,
      log: () => {},
      deliver: () => { throw new Error('notifier exploded') },
    })
    // POSITIVE CONTROL is the assertion itself: an empty array here would mean the beat was taken
    // down by its own notifier, which is the failure this test exists to forbid.
    expect(codes).toContain('pinning-env')
  })

  it('NO findings ⇒ the all-clear still RECONCILES, but stays silent to the human', () => {
    // This used to assert `deliver` was NOT called at all, which conflated two different things
    // that deliverAlerts does: NOTIFYING a human (must stay silent when nothing is wrong) and
    // RECONCILING active-alerts.json (must still run, or resolved codes are never dropped). With
    // the call suppressed, the LAST alert to clear stayed in the file forever — asserting a
    // problem that no longer existed, indistinguishable from a real one, with nothing else to
    // prune it. So the beat now always delivers, and the silence is preserved where it actually
    // matters: deliverAlerts([]) notifies nobody and logs nothing (pinned by the CLEARED tests
    // above, which drive the real implementation).
    const deliver = vi.fn()
    const log = vi.fn()
    const codes = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: () => facts as never,
      log,
      deliver,
    })
    expect(codes).toEqual([])
    expect(deliver).toHaveBeenCalledWith([])
    // The intent the old assertion was reaching for: nothing was announced.
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/DELIVER/)
  })
})
