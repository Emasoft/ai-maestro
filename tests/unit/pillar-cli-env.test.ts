/**
 * TRDD-217AYEOT — `trddgrep env` in a REAL subprocess: it detects, and it writes NOTHING.
 *
 * Why a subprocess and not `vi.mock`. `lib/agent-registry.ts` computes its state path at
 * MODULE LOAD, so an in-process `$HOME` injection arrives too late — the sibling
 * `pillar-environment.test.ts` has a case whose name says exactly that, because its first
 * version asserted against a fake path while the code under test had already resolved the
 * developer's real one. A spawn is the only altitude where `$HOME` is set BEFORE the
 * constant is computed (`os.homedir()` honours it on POSIX).
 *
 * The zero-writes claim is the one this file exists for, and a zero-writes assertion is
 * vacuous unless the subprocess provably READ the injected home — otherwise "created
 * nothing under the fake home" is satisfied by a process that never looked at it. So the
 * agent-detection case below is the positive control: it can only pass if the seeded
 * registry inside the fake home was actually read.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const REAL_STATE = path.join(os.homedir(), '.aimaestro')

let fakeHome: string
let projectDir: string

/** Every entry under the developer's REAL state dir — the 0-IMPACT witness. */
function realStateListing(): string[] {
  if (!fs.existsSync(REAL_STATE)) return []
  return fs.readdirSync(REAL_STATE).sort()
}

// The SAME two-part recipe `scripts/pillar-cli` uses, and for the same measured reason: a
// bare `--import tsx` resolves against the CWD, so from a foreign project it dies with
// "Cannot find package 'tsx'", and tsx discovers tsconfig.json from the CWD too, so without
// TSX_TSCONFIG_PATH the `@/lib/...` aliases go unresolved. This test spawns from a tmpdir,
// which is exactly that foreign CWD — its first version used the bare specifier and both
// cases failed with exit 1 in 300 ms, i.e. before reaching any assertion's subject.
const TSX_LOADER = path.join(REPO, 'node_modules', 'tsx', 'dist', 'loader.mjs')

function runEnv(cwd: string, home: string): { code: number | null; out: string; err: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', `file://${TSX_LOADER}`, path.join(REPO, 'scripts', 'trddgrep.mjs'), 'env'],
    {
      cwd,
      // A FULL env replacement would drop PATH; we override only HOME (and the XDG sibling,
      // so nothing falls back to the real one) plus the tsconfig pin.
      env: {
        ...process.env,
        HOME: home,
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
        TSX_TSCONFIG_PATH: path.join(REPO, 'tsconfig.json'),
      },
      encoding: 'utf-8',
      timeout: 120_000,
    },
  )
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-pillar-env-home-'))
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-pillar-env-proj-'))
})

afterEach(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
  fs.rmSync(projectDir, { recursive: true, force: true })
})

describe('trddgrep env (subprocess)', () => {
  it('reports standalone with no registry, and creates NOTHING under the fake home', () => {
    const before = realStateListing()

    const { code, out, err } = runEnv(projectDir, fakeHome)

    expect(err).not.toMatch(/could not run/)
    expect(code).toBe(0)
    expect(out).toContain('mode=standalone')
    // The reason must NAME the registry it looked for. "standalone" with an opaque reason
    // cannot be told apart from "the registry was unreadable", which is the whole point of
    // having a reason field at all.
    expect(out).toMatch(/registry/i)

    // Nothing materialized in the fake home — an observer must not create what it measures.
    expect(fs.existsSync(path.join(fakeHome, '.aimaestro'))).toBe(false)
    // …and nothing landed in the developer's real one either. Counted, not reasoned about:
    // an earlier probe in this card's history DID write ~/.aimaestro/agents from a naive
    // `loadAgents()` call, and only a before/after listing caught it.
    expect(realStateListing()).toEqual(before)
  })

  it('POSITIVE CONTROL — detects the agent whose registry row names this cwd', () => {
    // Proves the subprocess really reads the injected HOME. Without this, the assertion
    // above ("created nothing under the fake home") would also pass for a process that
    // resolved the real home and never touched the fake one.
    const agentsDir = path.join(fakeHome, '.aimaestro', 'agents')
    fs.mkdirSync(agentsDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentsDir, 'registry.json'),
      JSON.stringify([
        { id: 'a1', name: 'pillar-probe-bot', workingDirectory: projectDir },
        // A deleted row must not win, and a pathological `/` workdir must never match
        // (a real legacy `default` agent in this repo's registry carries exactly that).
        { id: 'a2', name: 'tombstoned', workingDirectory: projectDir, deletedAt: '2026-01-01T00:00:00+0000' },
        { id: 'a3', name: 'root-workdir', workingDirectory: '/' },
      ]),
    )

    const { code, out } = runEnv(projectDir, fakeHome)

    expect(code).toBe(0)
    expect(out).toContain('mode=agent')
    expect(out).toContain('agent=pillar-probe-bot')
    expect(out).not.toContain('tombstoned')
    expect(out).not.toContain('root-workdir')
  })
})
