import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dueForDelivery, deliveryText, BACKOFF_LADDER_S, deliverAlerts, type AlertRecord } from '@/lib/oauth-rotator/alert-delivery'
import { runOneSupervisorBeat } from '@/lib/oauth-rotator/server-supervisor'

const rec = (over: Partial<AlertRecord> = {}): AlertRecord =>
  ({ firstSeenAt: 1000, lastDeliveredAt: 1000, message: 'm', seen: 1, ...over })

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
    await deliverAlerts(F, { nowS: () => 1000, log: () => {} })
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
      await deliverAlerts(F, { nowS: () => 1000, log: () => {} })
      await deliverAlerts(F, { nowS: () => 1600, log: () => {} })
      await deliverAlerts(F, { nowS: () => 2200, log: () => {} })
      const onsets = logLines(tmpRoot).filter((x) => x.includes('ONSET pinning-env'))
      expect(onsets).toHaveLength(1)
    })()
  })

  it('writes CLEARED when the alert resolves', async () => {
    await deliverAlerts(F, { nowS: () => 1000, log: () => {} })
    await deliverAlerts([], { nowS: () => 1600, log: () => {} })
    const l = logLines(tmpRoot)
    expect(l.filter((x) => x.includes('ONSET pinning-env'))).toHaveLength(1)
    expect(l.filter((x) => x.includes('CLEARED pinning-env'))).toHaveLength(1)
  })

  it('a re-onset after a clear is a NEW transition, not a duplicate suppressed forever', async () => {
    // Suppression keyed on "have we ever seen this code" would go permanently silent after the
    // first occurrence — the same class of bug as an alert that never clears, seen from the
    // other side.
    await deliverAlerts(F, { nowS: () => 1000, log: () => {} })
    await deliverAlerts([], { nowS: () => 1600, log: () => {} })
    await deliverAlerts(F, { nowS: () => 2200, log: () => {} })
    expect(logLines(tmpRoot).filter((x) => x.includes('ONSET pinning-env'))).toHaveLength(2)
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
