import { describe, it, expect, vi } from 'vitest'
import {
  readAgentlensWindowRows,
  agentlensObservations,
  type AgentlensWindowRow,
} from '@/lib/oauth-rotator/agentlens-usage'

// ── fixtures: the two-cohort shape MEASURED live 2026-08-08 (two accounts side by side) ─────────

/** The live account's cohort: 5h window resets at epoch 1786176000 (10:00 local). */
const LIVE_COHORT = 1_786_176_000
/** The OTHER account observed in the same listing (resets 00:00). */
const FOREIGN_COHORT = 1_786_140_000

const LIVE_ROW: AgentlensWindowRow = {
  session_id: 'aaaa', ts: 1_786_168_000_000, pct_5h: 60, pct_7d: 51, resets_5h: LIVE_COHORT,
}
const FOREIGN_ROW: AgentlensWindowRow = {
  session_id: 'ffff', ts: 1_786_168_000_000, pct_5h: 23, pct_7d: 4, resets_5h: FOREIGN_COHORT,
}

const ATTR = { liveFp: 'fp-live', lastSwitchAtS: 1_786_100_000, liveResets5hSec: LIVE_COHORT }

describe('agentlensObservations — the attribution ladder', () => {
  it('attributes a cohort-matching, post-switch row to the live account, fully shaped', () => {
    const obs = agentlensObservations([LIVE_ROW], ATTR)
    expect(obs).toEqual([
      {
        liveFp: 'fp-live',
        capturedAt: 1_786_168_000_000,
        rateLimits: {
          fiveHour: { usedPercentage: 60, resetsAtMs: LIVE_COHORT * 1000, source: 'agentlens' },
          sevenDay: { usedPercentage: 51, resetsAtMs: null, source: 'agentlens' },
        },
      },
    ])
  })

  it('DROPS the foreign-cohort row — another account\'s numbers must never reach the rotator', () => {
    // THE account-burning guard: both rows are fresh and post-switch; only the cohort separates
    // them. A timestamp-only mapper admits both and hands the rotator 23% for an account at 60%.
    const obs = agentlensObservations([LIVE_ROW, FOREIGN_ROW], ATTR)
    expect(obs).toHaveLength(1)
    expect(obs[0].rateLimits.fiveHour?.usedPercentage).toBe(60)
  })

  it('with NO known live cohort it emits NOTHING — unknown identity is never guessed', () => {
    expect(agentlensObservations([LIVE_ROW], { ...ATTR, liveResets5hSec: null })).toEqual([])
  })

  it('drops a PRE-SWITCH row and keeps a post-switch one (fixture straddles the instant)', () => {
    // ⚠ the s-vs-ms trap, in the direction that admits everything: last_switch_at is epoch
    // SECONDS, ts is epoch MILLISECONDS. A mapper that forgot the ×1000 compares ms ≥ s — always
    // true — and the pre-switch row (the OLD exhausted account's reading) sails through. The
    // straddle means asserting only the reject case cannot pass against a reject-everything bug.
    const switchS = 1_786_168_500 // between the two rows' instants
    const before: AgentlensWindowRow = { ...LIVE_ROW, ts: 1_786_168_000_000 }
    const after: AgentlensWindowRow = { ...LIVE_ROW, ts: 1_786_169_000_000 }
    const obs = agentlensObservations([before, after], { ...ATTR, lastSwitchAtS: switchS })
    expect(obs).toHaveLength(1)
    expect(obs[0].capturedAt).toBe(1_786_169_000_000)
  })

  it('a null lastSwitchAtS applies no age constraint (admission re-checks downstream)', () => {
    const obs = agentlensObservations([LIVE_ROW], { ...ATTR, lastSwitchAtS: null })
    expect(obs).toHaveLength(1)
  })

  it('a row with unusable pct_7d still yields the 5h reading, with sevenDay null — never 0', () => {
    const obs = agentlensObservations([{ ...LIVE_ROW, pct_7d: NaN }], ATTR)
    expect(obs[0].rateLimits.sevenDay).toBeNull()
    expect(obs[0].rateLimits.fiveHour?.usedPercentage).toBe(60)
  })
})

describe('readAgentlensWindowRows — fail-soft reader', () => {
  const execWith = (err: Error | null, stdout: string) =>
    vi.fn((_c: string, _a: string[], _o: { timeout: number }, cb: (e: Error | null, s: string) => void) =>
      cb(err, stdout),
    )

  it('an absent CLI (ENOENT) yields [] — agentlenspro is optional host tooling, not a fault', async () => {
    const rows = await readAgentlensWindowRows({ execFileImpl: execWith(new Error('spawn agentlenspro ENOENT'), '') })
    expect(rows).toEqual([])
  })

  it('garbage stdout yields []', async () => {
    const rows = await readAgentlensWindowRows({ execFileImpl: execWith(null, 'not json at all') })
    expect(rows).toEqual([])
  })

  it('parses the measured JSON shape and drops malformed rows rather than defaulting them', async () => {
    const payload = JSON.stringify({
      view: 'windows',
      rows: [
        { session_id: 's1', ts: 1_786_168_000_000, pct_5h: 60, pct_7d: 51, resets_5h: LIVE_COHORT },
        { session_id: 's2', ts: 'not-a-number', pct_5h: 60, pct_7d: 51, resets_5h: LIVE_COHORT },
        { session_id: 's3', ts: 1_786_168_000_000, pct_7d: 51, resets_5h: LIVE_COHORT }, // no pct_5h
      ],
    })
    const rows = await readAgentlensWindowRows({ execFileImpl: execWith(null, payload) })
    expect(rows).toHaveLength(1)
    expect(rows[0].session_id).toBe('s1')
  })

  it('a throwing exec implementation still yields [] (never propagates into a rotator beat)', async () => {
    const rows = await readAgentlensWindowRows({
      execFileImpl: () => {
        throw new Error('sync explosion')
      },
    })
    expect(rows).toEqual([])
  })
})

/*
 * NEUTER RUN (2026-08-08 — feature committed as b0a842c8 FIRST, mutations reverted to the
 * committed blob):
 *
 *   1. cohort guard `row.resets_5h !== cohort` → `false && …`
 *   2. s→ms conversion `opts.lastSwitchAtS * 1000` → `opts.lastSwitchAtS`
 *
 *   Combined run → EXACTLY 2 red / 8 green, each attributable to one mutation by fixture
 *   construction: "DROPS the foreign-cohort row" can only red under 1 (the straddle rows are all
 *   live-cohort), and the straddle test can only red under 2 (the foreign row is excluded by the
 *   still-armed age check's fixture instants). These are THE two account-attribution guards —
 *   the account-burning-loop defense.
 *
 * Named unpinned residue, so green is not read as more than it is: the statuslineNear wiring's
 * outer try/catch is defense-in-depth over callees that do not throw by construction
 * (readAgentlensWindowRows resolves [] on every failure path — pinned above; readTickWindows
 * catches its own JSON.parse; the mapper is pure). Per the "defense-in-depth abort is unpinnable
 * by design" discipline: measured, named, kept.
 */
