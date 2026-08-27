/**
 * TRDD-Q6JM2RU3 — `tests/scenarios/scripts/assert-clean-governance.sh`.
 *
 * A UI scenario that assigns the MANAGER title cannot run while another agent holds the per-host
 * singleton: `services/element-management-service.ts` Gate 7 (~:2699) rejects the retitle, and it
 * does so MID-RUN, at the first fleet-building step, where a forked runner may no longer have the
 * budget to recover and still clean up after itself. The audit moves that discovery to setup.
 *
 * WHY THE `scen<NNN>*` CASE IS A FAILURE AND NOT A PASS. The card proposed allowlisting an
 * incumbent whose name starts with this scenario's own prefix, on the theory that a leftover from
 * an interrupted run of the same scenario is harmless. It is not: Gate 7 compares **ids** and is
 * blind to names, so a leftover `scen030-manager` has a different id than the agent SCEN-030 will
 * create and blocks it exactly as a foreign holder would — after setup printed OK. That is the
 * failure the audit exists to remove, so the deviation is pinned here rather than left to prose.
 *
 * WHY $HOME REDIRECTION. The script reads `~/.aimaestro/governance.json` and `.../registry.json`.
 * Bash resolves `${HOME}` from the environment, so a seeded fake HOME drives every branch without
 * touching the developer's real state — and the containment is provable: a run that ignored the
 * fake HOME would read the real governance.json, whose managerId is neither of the seeded ids, so
 * the id-matching assertions below could not pass.
 *
 * NEUTER RUNS (2026-08-27 — OBSERVED, each mutation reverted after). Deleting the `scen"${NNN}"*`
 * arm outright proves nothing (the leftover would fall through to the generic FAIL and stay a
 * FAIL), so that arm was instead made `exit 0` — which IS the card's original allowlist:
 *   1. allowlist restored → 1 red: 'refuses a leftover from an interrupted run of THIS scenario'.
 *   2. corrupt-file branch made lenient (`|| incumbent_id=""` in place of the SETUP_FAIL)
 *      → 1 red: 'fails closed when governance.json cannot be parsed'.
 *   3. `grep -qE` skip branch removed (`if false`, i.e. audit every scenario)
 *      → 4 reds: the SKIP case plus all three live-corpus 'leaves the gate off for SCEN-0xx'.
 * Run 3 was predicted to redden one test and reddened four; the prediction was wrong and the
 * observation is what is recorded. Removing a whole BRANCH gives one cause four symptoms, which
 * says nothing about whether the four are four pins, so a fourth run probed the PREDICATE instead:
 *   4. verb requirement dropped (`MANAGER_VERB='\bMANAGER\b'`, so a bare mention arms the gate)
 *      → 2 reds: the fixture SKIP and 'leaves the gate off for SCEN-020'. SCEN-019 and SCEN-027
 *      stayed GREEN.
 * So the corpus cases are not one assertion wearing three names — but the same run shows SCEN-019
 * and SCEN-027 are WEAK pins: neither file contains the word MANAGER at all, so they survive any
 * predicate that requires it. SCEN-020 is the load-bearing one, because it names MANAGER in a bare
 * prose list of every title and so is the only real file that discriminates on the VERB. Keep
 * SCEN-020 in this list even if the other two are ever dropped.
 * Runs 1 and 2 each reddened exactly one test, so neither is carried by another assertion.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const AUDIT = path.join(REPO, 'tests', 'scenarios', 'scripts', 'assert-clean-governance.sh')

const INCUMBENT_ID = '11111111-1111-4111-8111-111111111111'
/** An id present in governance.json but in NO registry row — the stale-id shape a broken delete leaves. */
const ORPHAN_ID = '22222222-2222-4222-8222-222222222222'

let home: string
/** A scenario that assigns the MANAGER title, and one that never mentions it. */
let creating: string
let inert: string

function seedHome(governance: string | null, agentName: string | null) {
  fs.rmSync(path.join(home, '.aimaestro'), { recursive: true, force: true })
  fs.mkdirSync(path.join(home, '.aimaestro', 'agents'), { recursive: true })
  if (governance !== null) {
    fs.writeFileSync(path.join(home, '.aimaestro', 'governance.json'), governance)
  }
  const rows =
    agentName === null
      ? []
      : [{ id: INCUMBENT_ID, name: agentName, governanceTitle: 'manager', workingDirectory: `${home}/agents/${agentName}` }]
  fs.writeFileSync(path.join(home, '.aimaestro', 'agents', 'registry.json'), JSON.stringify(rows))
}

function audit(nnn: string, scenFile: string) {
  const r = spawnSync('bash', [AUDIT, nnn, scenFile], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home },
  })
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-audit-'))
  creating = path.join(home, 'creating.scen.md')
  inert = path.join(home, 'inert.scen.md')
  fs.writeFileSync(creating, '# fixture\n- **Action:** open the dialog and assign the MANAGER title\n')
  // Names MANAGER with no create/assign verb on the line — copied from the shape SCEN-020 really
  // has (a bare prose list of every title), which must NOT arm the gate. Written as `Titles:
  // MANAGER, …` on first attempt, this test failed: the predicate armed, correctly, because
  // `[Tt]itle` then preceded MANAGER on the same line. The fixture was wrong, not the predicate —
  // the live-corpus case for SCEN-020 passed throughout. Keep the verb off this line.
  fs.writeFileSync(inert, '# fixture\n  MANAGER, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER.\n')
})

afterAll(() => {
  if (home) fs.rmSync(home, { recursive: true, force: true })
})

describe('assert-clean-governance.sh — the MANAGER-singleton setup precondition', () => {
  it('clears a MANAGER-creating scenario when the singleton is free', () => {
    seedHome(JSON.stringify({ version: 1, managerId: null }), null)
    const r = audit('030', creating)
    expect(r.status, r.err).toBe(0)
    expect(r.out).toMatch(/GOVERNANCE_AUDIT_OK/)
  })

  it('clears a MANAGER-creating scenario on a pristine host with no governance.json', () => {
    seedHome(null, null)
    const r = audit('030', creating)
    expect(r.status, r.err).toBe(0)
    expect(r.out).toMatch(/GOVERNANCE_AUDIT_OK/)
  })

  it('refuses a MANAGER-creating scenario while a foreign agent holds the singleton', () => {
    seedHome(JSON.stringify({ version: 1, managerId: INCUMBENT_ID }), 'jack-bot')
    const r = audit('030', creating)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/SETUP_FAIL pre-existing-MANAGER jack-bot/)
    expect(r.err).toContain(INCUMBENT_ID)
    // The message must hand the operator the remediation tool, not just the verdict.
    expect(r.err).toMatch(/list-governance-litter\.sh/)
  })

  it('refuses a leftover from an interrupted run of THIS scenario (Gate 7 is id-based, so it still blocks)', () => {
    seedHome(JSON.stringify({ version: 1, managerId: INCUMBENT_ID }), 'scen030-manager')
    const r = audit('030', creating)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/SETUP_FAIL pre-existing-MANAGER scen030-manager/)
    expect(r.err).toMatch(/interrupted SCEN-030 run/)
  })

  it('refuses a managerId that no registry agent carries, rather than reading it as "no manager"', () => {
    seedHome(JSON.stringify({ version: 1, managerId: ORPHAN_ID }), 'someone-else')
    const r = audit('030', creating)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/pre-existing-MANAGER <unregistered id>/)
    expect(r.err).toContain(ORPHAN_ID)
  })

  it('fails closed when governance.json cannot be parsed', () => {
    seedHome('{ this is not json', null)
    const r = audit('030', creating)
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/cannot parse .*governance\.json/)
  })

  it('skips a scenario that never assigns the MANAGER title, but still names the incumbent', () => {
    seedHome(JSON.stringify({ version: 1, managerId: INCUMBENT_ID }), 'jack-bot')
    const r = audit('027', inert)
    expect(r.status, r.err).toBe(0)
    expect(r.out).toMatch(/GOVERNANCE_AUDIT_SKIP/)
    // The evidence belt: if a future scenario phrases manager-creation unmatchably, the run log
    // still records that the singleton was taken when setup waved it through.
    expect(r.out).toContain('jack-bot')
  })
})

/**
 * The predicate against the REAL corpus. Named files on each side rather than a count, so adding a
 * scenario cannot redden this, while a predicate that stops discriminating does. SCEN-005 and
 * SCEN-024 are the two that defeat a `data_produced:` grep ("3 test agents" / "scen024-mgr-01");
 * SCEN-022 is the one that defeats a `subsystems: governance` gate.
 */
describe('assert-clean-governance.sh — predicate discrimination on the live scenario corpus', () => {
  const SCEN_DIR = path.join(REPO, 'tests', 'scenarios')

  function scenPath(prefix: string) {
    const hit = fs.readdirSync(SCEN_DIR).find((f) => f.startsWith(prefix) && f.endsWith('.scen.md'))
    expect(hit, `no scenario file starting with ${prefix}`).toBeTruthy()
    return path.join(SCEN_DIR, hit as string)
  }

  beforeAll(() => {
    // Singleton free, so an armed gate reports OK and an unarmed one reports SKIP — the two are
    // distinguishable without any incumbent in play.
    seedHome(JSON.stringify({ version: 1, managerId: null }), null)
  })

  it.each(['SCEN-005', 'SCEN-022', 'SCEN-024', 'SCEN-030'])('arms the gate for %s', (prefix) => {
    const r = audit(prefix.slice(-3), scenPath(prefix))
    expect(r.status, r.err).toBe(0)
    expect(r.out, `${prefix} should be gated`).toMatch(/GOVERNANCE_AUDIT_OK/)
  })

  it.each(['SCEN-019', 'SCEN-020', 'SCEN-027'])('leaves the gate off for %s', (prefix) => {
    const r = audit(prefix.slice(-3), scenPath(prefix))
    expect(r.status, r.err).toBe(0)
    expect(r.out, `${prefix} should not be gated`).toMatch(/GOVERNANCE_AUDIT_SKIP/)
  })
})
