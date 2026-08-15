/**
 * TRDD-DSQUWKVI — the externalized-compaction command key must never become an AUTOMATIC action.
 *
 * THE HAZARD, and it is a cost hazard rather than a safety one, which is why nothing else here
 * would catch it. `/janitor-externalized-compaction` is a SKILL, not a script alias: injecting
 * it makes the target agent's MODEL read the skill and run the script, so it costs a full model
 * turn over whatever context that session is holding. On a COLD cache with a large context that
 * one turn IS the ~600k cache-creation write the whole feature exists to avoid — the agent would
 * pay exactly the cost it was being shrunk to prevent, and only then shrink.
 *
 * So the split is load-bearing, not stylistic:
 *   - INJECTING the key is for a WARM or already-small session — a human clicking a button.
 *   - The SUBPROCESS seam (`lib/external-compaction.ts`, `POST …/continuity/compact`) is for
 *     "this agent is cold and fat", because it spends ZERO model tokens.
 *
 * Raised by the janitor (who owns the skill) on 2026-08-15 and verified here against their
 * shipped `SKILL.md`, which instructs the MODEL ("Fire it", "Branch on the FIRST WORD of
 * stdout", "END YOUR TURN IMMEDIATELY") rather than being a direct script invocation.
 *
 * A comment cannot enforce this — the failure mode is a future continuity leg resolving the key
 * by name and firing it on a context-pressure signal, which reads like exactly the right thing
 * to do. This test is the enforcement.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { getAgentCommand } from '@/lib/agent-commands'

const repoRoot = path.resolve(__dirname, '..', '..')

/** The AUTOMATIC actuation surface: the modules that fire commands at agents with no human in
 *  the loop. If a new unattended actuator is added, ADD IT HERE — an unlisted file is not
 *  covered, and this list is what makes the guard's claim true rather than aspirational. */
const AUTOMATIC_ACTUATORS = [
  'lib/fleet-recovery-actuator.ts',
  'lib/fleet-continuity.ts',
  'lib/fleet-liveness-watchdog.ts',
  'lib/oauth-rotator/model-fallback.ts',
  'lib/oauth-rotator/model-fallback-actuator.ts',
  'lib/oauth-rotator/model-fallback-deps.ts',
  'lib/oauth-rotator/model-fallback-sweep.ts',
]

const KEY = 'janitor-externalized-compaction'

function sourceOf(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), 'utf8')
}

describe('externalized compaction is never fired automatically (TRDD-DSQUWKVI)', () => {
  it('the key exists — otherwise every assertion below passes vacuously', () => {
    // The failure this guards is real and silent: rename or drop the key and a test that only
    // says "nobody references it" becomes trivially true while the guard stops meaning anything.
    expect(getAgentCommand(KEY)).toBeDefined()
  })

  it('POSITIVE CONTROL — the scan set is non-empty and the scan CAN see a command key', () => {
    const sources = AUTOMATIC_ACTUATORS.map(sourceOf)
    expect(sources).toHaveLength(AUTOMATIC_ACTUATORS.length)
    expect(sources.every((s) => s.length > 0)).toBe(true)
    // `model-opus` IS fired automatically (that is the model-fallback lane's whole job), so
    // finding it proves the scan reaches real code and would find our key if it were there.
    // Without this, a broken path or a typo'd needle would report "clean" forever.
    expect(sources.some((s) => s.includes('model-opus'))).toBe(true)
  })

  it('no automatic actuator resolves the externalized-compaction key', () => {
    const offenders = AUTOMATIC_ACTUATORS.filter((rel) => sourceOf(rel).includes(KEY))
    expect(
      offenders,
      `These fire commands with no human in the loop and must not inject '${KEY}':\n  ${offenders.join('\n  ')}\n` +
        'Injecting a SKILL costs the target a full model turn — on a cold, fat session that turn ' +
        'is the very cache-creation write the shrink exists to avoid. For unattended shrinking ' +
        'use the ZERO-token subprocess seam: runExternalCompaction() in lib/external-compaction.ts.',
    ).toEqual([])
  })

  it('the entry itself documents the attended-only constraint, so a reader meets it first', () => {
    const src = sourceOf('lib/agent-commands.ts')
    // Keyed on the CONSTRAINT's vocabulary rather than an exact sentence, so honest rewording
    // does not redden the test while deleting the warning outright does.
    expect(src).toMatch(/model turn/i)
    expect(src).toMatch(/lib\/external-compaction/)
  })
})
