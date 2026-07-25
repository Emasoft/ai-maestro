// The all-or-nothing gate runner — R51 (TRDD-DQ6XN2VP).
//
// An all-in-one function NEVER leaves the system in an invalid state. Not "reports that it did" —
// NEVER LEAVES ONE. If any gate fails, every gate already executed is undone in reverse order until
// the system is back to exactly the state it was in when the function was called, and the caller is
// told the operation made no changes.
//
// This supersedes the earlier "detect and report the residue" contract: reporting an invalid state
// is not an alternative to preventing one. The excuse that justified it — "a delete cannot be undone"
// — was false: DeleteAgent writes its cemetery archive BEFORE touching anything, so the restore
// substrate exists. "Unrevertable" is almost always a MISSING SNAPSHOT, not a property of the
// operation (R51.4).
//
// The one thing this runner will not do is LIE. If a compensation itself fails the system really is
// invalid, and it says so, naming every gate it could not revert (R51.5). That is not an escape
// hatch from the guarantee; it is the refusal to claim "no changes were made" when changes remain.

/** A gate that changes nothing needs no compensation; one that changes something MUST have one. */
export interface Gate<Ctx> {
  /** Stable label used in the failure message, e.g. 'G05b'. */
  id: string
  /** One line describing what it does, for the ops log. */
  what: string
  /**
   * True when the gate cannot change any state (validation, authorization, a read).
   * A gate that mutates and declares no `undo` is REJECTED before the sequence runs — the check is
   * cheap and it is the only thing that stops "I'll add the undo later" from becoming permanent.
   */
  readOnly?: boolean
  run: (ctx: Ctx) => Promise<void>
  /** Reverses `run` exactly. Required unless readOnly. */
  undo?: (ctx: Ctx) => Promise<void>
}

export interface GateSuccess {
  ok: true
  ops: string[]
}

export interface GateFailure {
  ok: false
  /** 1-based position of the gate that failed, as quoted in the message. */
  failedGateNumber: number
  failedGateId: string
  error: string
  /** True when every executed gate was successfully reverted. */
  rolledBack: boolean
  /** Gates whose compensation FAILED — non-empty means the system is invalid (R51.5). */
  unrevertable: { id: string; error: string }[]
  /** The exact message to return to the caller. */
  message: string
  ops: string[]
}

export type GateResult = GateSuccess | GateFailure

/** R51.3 — the exact wording, so every pipeline says the same thing. */
export function noChangesMessage(gateNumber: number, gateId: string, cause: string): string {
  return (
    `THE COMMAND FAILED TO ACCOMPLISH THE REQUESTED OPERATION BECAUSE GATE NUMBER ${gateNumber} ` +
    `(${gateId}) FAILED, SO NO CHANGES WERE MADE TO THE SYSTEM. Cause: ${cause}`
  )
}

/**
 * R51.5 — when a compensation fails we may NOT claim the system is unchanged, because that claim
 * would be false. Name what survived so a human can finish the job by hand.
 */
export function invalidStateMessage(
  gateNumber: number,
  gateId: string,
  cause: string,
  unrevertable: { id: string; error: string }[],
): string {
  return (
    `CRITICAL — THE COMMAND FAILED AT GATE NUMBER ${gateNumber} (${gateId}) AND THE ROLLBACK DID NOT ` +
    `COMPLETE, SO THE SYSTEM IS IN AN INVALID STATE. Cause: ${cause}. Could not revert: ` +
    unrevertable.map((u) => `${u.id} (${u.error})`).join('; ') +
    `. Manual repair is required — do NOT retry the command until this is resolved.`
  )
}

/** A mutating gate with no `undo` cannot satisfy R51, so the sequence refuses to start. */
export function findUncompensatedGates<Ctx>(gates: Gate<Ctx>[]): string[] {
  return gates.filter((g) => !g.readOnly && typeof g.undo !== 'function').map((g) => g.id)
}

export interface GateSequenceOptions<Ctx> {
  /**
   * R51.7 — the SUCCESS-path check. Returns the list of violated invariants; empty means valid.
   *
   * "Every gate ran" and "the system is valid" are different claims. A run where each gate
   * succeeded can still leave an agent holding a title with no compatible role-plugin, a workdir
   * missing its seeded rules, or a team slot pointing at a deleted agent. A violation here is
   * treated as a GATE FAILURE — same reverse compensation, same message — because returning success
   * on a contradicted system is exactly what the aim forbids.
   */
  invariants?: (ctx: Ctx) => Promise<string[]>
}

/**
 * Run gates in order. On the first failure, undo everything already executed in REVERSE order and
 * return a failure describing the abort. Never throws.
 */
export async function runGateSequence<Ctx>(
  gates: Gate<Ctx>[],
  ctx: Ctx,
  opts: GateSequenceOptions<Ctx> = {},
): Promise<GateResult> {
  const ops: string[] = []

  // Refuse to start rather than discover mid-flight that a gate cannot be undone — by then the
  // damage is done and the guarantee is already broken.
  const uncompensated = findUncompensatedGates(gates)
  if (uncompensated.length) {
    const cause = `mutating gate(s) without a compensation: ${uncompensated.join(', ')}`
    return {
      ok: false,
      failedGateNumber: 0,
      failedGateId: 'PRECHECK',
      error: cause,
      rolledBack: true, // nothing ran, so nothing to revert
      unrevertable: [],
      message: noChangesMessage(0, 'PRECHECK', cause),
      ops: [`PRECHECK: REFUSED — ${cause}`],
    }
  }

  const executed: Gate<Ctx>[] = []

  /** Undo everything already executed, then build the failure result. Shared by BOTH abort paths —
   *  a failing gate and a violated success-path invariant are the same event: the aim was not met. */
  const abort = async (gateNumber: number, gateId: string, cause: string): Promise<GateFailure> => {
    // Reverse order: the most recent change is the one whose undo is still valid; undoing an
    // earlier gate first could invalidate the state a later gate's undo depends on.
    const unrevertable: { id: string; error: string }[] = []
    for (let j = executed.length - 1; j >= 0; j--) {
      const done = executed[j]
      if (done.readOnly || !done.undo) continue
      try {
        await done.undo(ctx)
        ops.push(`${done.id}: reverted`)
      } catch (undoErr) {
        const ue = undoErr instanceof Error ? undoErr.message : String(undoErr)
        unrevertable.push({ id: done.id, error: ue })
        ops.push(`${done.id}: ROLLBACK FAILED — ${ue}`)
        // Keep going: a later-listed gate may still be revertible, and reverting more is strictly
        // better than stopping at the first compensation failure.
      }
    }
    return {
      ok: false,
      failedGateNumber: gateNumber,
      failedGateId: gateId,
      error: cause,
      rolledBack: unrevertable.length === 0,
      unrevertable,
      message: unrevertable.length
        ? invalidStateMessage(gateNumber, gateId, cause, unrevertable)
        : noChangesMessage(gateNumber, gateId, cause),
      ops,
    }
  }

  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i]
    try {
      await gate.run(ctx)
      executed.push(gate)
      ops.push(`${gate.id}: ${gate.what}`)
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      ops.push(`${gate.id}: FAILED — ${cause}`)
      return abort(i + 1, gate.id, cause)
    }
  }

  // R51.7 — every gate ran; that is NOT yet "the system is valid". Check the invariants before
  // claiming success, and treat a violation exactly like a gate failure.
  if (opts.invariants) {
    let violations: string[]
    try {
      violations = await opts.invariants(ctx)
    } catch (err) {
      // An invariant check that cannot run leaves validity UNKNOWN, and unknown is not valid.
      const cause = `invariant check failed to run: ${err instanceof Error ? err.message : String(err)}`
      ops.push(`INVARIANTS: FAILED — ${cause}`)
      return abort(gates.length + 1, 'INVARIANTS', cause)
    }
    if (violations.length) {
      const cause = `system invariants violated: ${violations.join('; ')}`
      ops.push(`INVARIANTS: FAILED — ${cause}`)
      return abort(gates.length + 1, 'INVARIANTS', cause)
    }
    ops.push(`INVARIANTS: verified (${gates.length} gate(s) ran, system valid)`)
  }

  return { ok: true, ops }
}
