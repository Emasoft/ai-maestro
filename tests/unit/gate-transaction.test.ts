/**
 * R51 — an all-in-one function is a TRANSACTION.
 *
 * The property under test is the one the previous contract got wrong: it is NOT enough to notice a
 * partial state and report it. A gate failure must UNDO everything already done, in reverse order,
 * and the caller must be told no changes were made — and that sentence must be TRUE when it is said.
 *
 * 0-IMPACT: the "system" is a plain array of effects. No registry, no filesystem, no server.
 */
import { describe, it, expect } from 'vitest'
import {
  runGateSequence,
  findUncompensatedGates,
  type Gate,
} from '@/lib/gate-transaction'

/** A toy world: gates push effects, compensations pop them. Empty at the end == "no trace left". */
interface World {
  effects: string[]
  log: string[]
}

const w = (): World => ({ effects: [], log: [] })

function mutating(id: string, effect: string, opts: { failRun?: boolean; failUndo?: boolean } = {}): Gate<World> {
  return {
    id,
    what: `apply ${effect}`,
    run: async (ctx) => {
      if (opts.failRun) throw new Error(`${id} exploded`)
      ctx.effects.push(effect)
      ctx.log.push(`run:${id}`)
    },
    undo: async (ctx) => {
      if (opts.failUndo) throw new Error(`${id} undo exploded`)
      const i = ctx.effects.lastIndexOf(effect)
      if (i >= 0) ctx.effects.splice(i, 1)
      ctx.log.push(`undo:${id}`)
    },
  }
}

const readOnly = (id: string, opts: { fail?: boolean } = {}): Gate<World> => ({
  id,
  what: 'check',
  readOnly: true,
  run: async (ctx) => {
    if (opts.fail) throw new Error(`${id} refused`)
    ctx.log.push(`run:${id}`)
  },
})

describe('R51 — the happy path', () => {
  it('runs every gate in order and reports success', async () => {
    const ctx = w()
    const r = await runGateSequence([readOnly('G01'), mutating('G02', 'a'), mutating('G03', 'b')], ctx)
    expect(r.ok).toBe(true)
    expect(ctx.effects).toEqual(['a', 'b'])
    expect(ctx.log).toEqual(['run:G01', 'run:G02', 'run:G03'])
  })
})

describe('R51.1/R51.2 — one failed gate reverts everything, backwards', () => {
  it('leaves NO TRACE of the gates that had already run', async () => {
    const ctx = w()
    const r = await runGateSequence(
      [mutating('G01', 'a'), mutating('G02', 'b'), mutating('G03', 'c', { failRun: true })],
      ctx,
    )
    expect(r.ok).toBe(false)
    // The whole point: the system is byte-for-byte what it was before the call.
    expect(ctx.effects).toEqual([])
  })

  it('undoes in REVERSE order — last executed, first reverted', async () => {
    // Order matters: an earlier gate's undo can depend on state a later gate changed, so unwinding
    // forwards can corrupt what it is trying to restore.
    const ctx = w()
    await runGateSequence(
      [mutating('G01', 'a'), mutating('G02', 'b'), mutating('G03', 'c'), mutating('G04', 'd', { failRun: true })],
      ctx,
    )
    expect(ctx.log).toEqual(['run:G01', 'run:G02', 'run:G03', 'undo:G03', 'undo:G02', 'undo:G01'])
  })

  it('does not run any gate after the failure', async () => {
    const ctx = w()
    await runGateSequence(
      [mutating('G01', 'a'), mutating('G02', 'b', { failRun: true }), mutating('G03', 'never')],
      ctx,
    )
    expect(ctx.log).not.toContain('run:G03')
    expect(ctx.effects).toEqual([])
  })

  it('a read-only gate failing still reverts the mutating gates before it', async () => {
    const ctx = w()
    const r = await runGateSequence([mutating('G01', 'a'), readOnly('G02', { fail: true })], ctx)
    expect(r.ok).toBe(false)
    expect(ctx.effects).toEqual([])
  })
})

describe('R51.3 — the caller is told, in the exact words', () => {
  it('names the gate NUMBER and states that no changes were made', async () => {
    const ctx = w()
    const r = await runGateSequence([mutating('G01', 'a'), mutating('G05b', 'b', { failRun: true })], ctx)
    if (r.ok) throw new Error('expected failure')
    expect(r.failedGateNumber).toBe(2)
    expect(r.failedGateId).toBe('G05b')
    expect(r.message).toContain('THE COMMAND FAILED TO ACCOMPLISH THE REQUESTED OPERATION BECAUSE GATE NUMBER 2')
    expect(r.message).toContain('SO NO CHANGES WERE MADE TO THE SYSTEM')
    expect(r.rolledBack).toBe(true)
  })
})

describe('R51.5 — a failed compensation must NOT claim "no changes"', () => {
  it('reports an INVALID STATE and names what could not be reverted', async () => {
    // The one case the guarantee cannot be met. Saying "no changes were made" here would be a false
    // statement about the system, and a false all-clear is worse than a loud failure.
    const ctx = w()
    const r = await runGateSequence(
      [mutating('G01', 'a', { failUndo: true }), mutating('G02', 'b', { failRun: true })],
      ctx,
    )
    if (r.ok) throw new Error('expected failure')
    expect(r.rolledBack).toBe(false)
    expect(r.unrevertable.map((u) => u.id)).toEqual(['G01'])
    expect(r.message).toContain('THE SYSTEM IS IN AN INVALID STATE')
    expect(r.message).toContain('G01')
    expect(r.message).not.toContain('NO CHANGES WERE MADE')
    // And the effect really did survive — the message is describing reality, not hedging.
    expect(ctx.effects).toEqual(['a'])
  })

  it('keeps reverting the others even after one compensation fails', async () => {
    // Reverting 2 of 3 is strictly better than stopping at the first failure.
    const ctx = w()
    const r = await runGateSequence(
      [mutating('G01', 'a'), mutating('G02', 'b', { failUndo: true }), mutating('G03', 'c'), mutating('G04', 'd', { failRun: true })],
      ctx,
    )
    if (r.ok) throw new Error('expected failure')
    expect(r.unrevertable.map((u) => u.id)).toEqual(['G02'])
    expect(ctx.effects).toEqual(['b']) // a and c were still reverted
  })
})

describe('R51.4 — a mutating gate with no compensation cannot run at all', () => {
  it('refuses to START the sequence, naming the offending gates', async () => {
    // Discovering this mid-flight is too late: by then the un-undoable change has happened and the
    // guarantee is already broken. The check is cheap, so it runs before anything executes.
    const ctx = w()
    const bad: Gate<World> = { id: 'G09', what: 'mutate with no undo', run: async () => {} }
    const r = await runGateSequence([mutating('G01', 'a'), bad], ctx)
    if (r.ok) throw new Error('expected refusal')
    expect(r.failedGateId).toBe('PRECHECK')
    expect(r.error).toContain('G09')
    expect(ctx.log).toEqual([]) // nothing ran
    expect(r.message).toContain('NO CHANGES WERE MADE TO THE SYSTEM')
  })

  it('findUncompensatedGates identifies exactly the mutating gates missing an undo', () => {
    const gates: Gate<World>[] = [
      readOnly('G01'),
      mutating('G02', 'a'),
      { id: 'G03', what: 'x', run: async () => {} },
      { id: 'G04', what: 'y', readOnly: true, run: async () => {} },
    ]
    expect(findUncompensatedGates(gates)).toEqual(['G03'])
  })
})

describe('R51.7 — success is not "every gate ran", it is "the system is valid"', () => {
  it('rolls back when the gates all succeeded but an invariant is violated', async () => {
    // The failure mode this closes: a run where nothing threw, yet the result contradicts itself —
    // a title with no compatible role-plugin, a workdir missing its rules, a team slot pointing at
    // a deleted agent. Returning success there is exactly what the aim forbids.
    const ctx = w()
    const r = await runGateSequence([mutating('G01', 'a'), mutating('G02', 'b')], ctx, {
      invariants: async () => ['agent holds title MANAGER with no compatible role-plugin'],
    })
    if (r.ok) throw new Error('expected failure')
    expect(ctx.effects).toEqual([]) // fully reverted, exactly like a gate failure
    expect(r.failedGateId).toBe('INVARIANTS')
    expect(r.failedGateNumber).toBe(3) // reported after the 2 real gates
    expect(r.message).toContain('NO CHANGES WERE MADE TO THE SYSTEM')
    expect(r.error).toContain('no compatible role-plugin')
  })

  it('an invariant check that THROWS is a failure — unknown validity is not validity', async () => {
    const ctx = w()
    const r = await runGateSequence([mutating('G01', 'a')], ctx, {
      invariants: async () => {
        throw new Error('registry unreadable')
      },
    })
    if (r.ok) throw new Error('expected failure')
    expect(ctx.effects).toEqual([])
    expect(r.error).toContain('registry unreadable')
  })

  it('passes when the invariants hold, and says so', async () => {
    const ctx = w()
    const r = await runGateSequence([mutating('G01', 'a')], ctx, { invariants: async () => [] })
    expect(r.ok).toBe(true)
    expect(ctx.effects).toEqual(['a'])
    expect(r.ops.some((o) => o.includes('INVARIANTS: verified'))).toBe(true)
  })
})
