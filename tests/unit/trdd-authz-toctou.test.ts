/**
 * TRDD-6D6SQNI6 — the authorization decision and the write it authorises are ONE
 * critical section on the target card.
 *
 * THE BUG. `authorizeTrddVerb` read the card to decide who may act; the store verb then
 * took the document lock and wrote. Between those two steps the card was unlocked, so a
 * peer changing `min-approval-requirement` or `assignee` — the two fields the decision
 * turns on, and precisely the ones a racing governance edit would be changing — let the
 * mutation land on an authorization computed against a state that no longer existed.
 *
 * WHAT MAKES THIS TESTABLE DETERMINISTICALLY. The race needs an interleaving, and
 * "start two requests and hope" is a lottery that passes with the fix removed (measured
 * on this repo before: a concurrency test that relies on natural scheduling passes under
 * the neuter that deletes the lock entirely, because whether the losing interleaving
 * OCCURS is the scheduler's choice). So the lock is HELD by the test itself, the
 * contender is observed to be blocked, the peer edit lands while it waits, and only then
 * is the lock released. Nothing is left to timing.
 *
 * THE CONTENDER MUST START IN A SIBLING ASYNC CONTEXT. `withJsonLock` is reentrant
 * through an `AsyncLocalStorage` held-set, so a contender started INSIDE the holder's
 * callback would inherit the held set, skip the lock, run immediately, and prove nothing.
 * Every contender below is created in the test body, never inside the holder.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { withAuthorizedTrdd } from '@/lib/trdd-authz'
import { withTrddLock } from '@/lib/trdd-store'
import { editTrdd } from '@/lib/trdd-store'
import type { AgentAuthResult } from '@/lib/agent-auth'

const ID = 'B6B6B6B6'
// A PAST instant. The store's field guard refuses a future `updated:` outright — measured,
// with the error "never type a timestamp, read the clock", which is exactly right and is
// what rejected the first version of this fixture.
const ISO = '2026-07-09T13:00:00.000Z'

/**
 * A CHIEF-OF-STAFF, and the tier flip that decides for or against it. COS may approve a
 * `chief-of-staff`-tier card and may NOT approve a `manager`-tier one — so raising the
 * tier is a decision that genuinely CHANGES, which is what the race needs. `assignee` and
 * `created-by` are deliberately absent from the fixture: present, they would send
 * `resolveActor` into the agent registry, and this file has no business mocking it.
 */
const COS: AgentAuthResult = {
  agentId: '22222222-2222-4222-8222-222222222222',
  governanceTitle: 'chief-of-staff',
}

/** The human owner — `authorize()` grants this before the matrix runs, no registry needed. */
const OWNER: AgentAuthResult = {}

const card = (tier: string): string =>
  [
    '---',
    `trdd-id: ${ID}`,
    'title: toctou fixture',
    'column: proposal',
    `min-approval-requirement: ${tier}`,
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    '---',
    '',
    `# TRDD-${ID} — toctou fixture`,
    '',
    'body',
    '',
  ].join('\n')

describe('TRDD authorization and its write are one critical section (TRDD-6D6SQNI6)', () => {
  let dir: string
  let cardPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-toctou-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(dir, z), { recursive: true })
    }
    cardPath = path.join(dir, 'proposals', `TRDD-20260101_000000+0100-${ID}-x.md`)
    fs.writeFileSync(cardPath, card('chief-of-staff'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('POSITIVE CONTROL: uncontended, the COS is allowed and the write runs', async () => {
    // Without this, "it refused" below is satisfied just as well by a change that refuses
    // EVERYTHING — which is the easiest way to make a security test pass for a bad reason.
    const write = vi.fn(async () => 'written')

    const outcome = await withAuthorizedTrdd(COS, dir, ID, 'approve', write)

    expect(outcome.denied).toBeNull()
    expect(outcome.value).toBe('written')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a peer that raises the tier while the verb waits for the lock makes it REFUSE', async () => {
    const write = vi.fn(async () => 'written')

    // Take the document lock and park inside it.
    let parked!: () => void
    let release!: () => void
    const isParked = new Promise<void>((r) => { parked = r })
    const holder = withTrddLock(dir, ID, async () => {
      parked()
      await new Promise<void>((r) => { release = r })
    })
    await isParked

    // SIBLING context — created here, not inside the holder's callback (see the header).
    const contender = withAuthorizedTrdd(COS, dir, ID, 'approve', write)

    // It must be waiting on the lock, not running. This assertion is also what proves the
    // contender did not inherit the holder's held-set: an inherited store cannot block.
    await new Promise((r) => setTimeout(r, 250))
    expect(write, 'the contender ran while the lock was held').not.toHaveBeenCalled()

    // The racing governance edit: this card now needs MANAGER approval.
    fs.writeFileSync(cardPath, card('manager'))

    release()
    await holder
    const outcome = await contender

    // Pre-fix, the decision was already made against `chief-of-staff` before the wait, so
    // the write landed on a card the COS no longer had authority over.
    expect(outcome.denied?.status).toBe(403)
    expect(write, 'the write ran on an authorization the card had already invalidated')
      .not.toHaveBeenCalled()
  })

  it('the store verb NESTS inside the widened section without deadlocking', async () => {
    // The risk the card names explicitly: taking the lock at the seam means the store
    // verb re-acquires it. That is safe only because `withJsonLock` is reentrant, and a
    // self-deadlock appears only under the nesting — i.e. exactly where nothing looks at
    // it. A real verb, not a spy, is the only thing that exercises the re-acquisition.
    const outcome = await withAuthorizedTrdd(OWNER, dir, ID, 'edit', () =>
      editTrdd(dir, ID, { priority: '1' }, ISO),
    )

    expect(outcome.denied).toBeNull()
    expect(outcome.value?.ok).toBe(true)
    expect(fs.readFileSync(cardPath, 'utf8')).toMatch(/^priority: 1$/m)
  }, 10_000)
})
