/**
 * TRDD-217AYEOT — the pillar CLIs detect their own environment.
 *
 * One `trddgrep` serves every project. In a plain repo it offers the whole
 * corpus-local 3-pillar surface; standing in an ai-maestro agent's workdir it
 * additionally offers the server-backed governance verbs. This file pins the
 * detector, and three of its cases are the ones a "simpler" detector gets wrong:
 *
 *   · it MUST NOT WRITE while detecting (the `loadAgents()` trap — see the zero-writes
 *     test, whose neuter run reproduces the bug rather than describing it);
 *   · `~/agents/role-plugins/` is a plugin-SOURCE container, not an agent — which is
 *     precisely what `checkAuthorizedAgentWorkdir` would call authorized;
 *   · ONE stale registry row (`workingDirectory: "/"`, documented in CLAUDE.md) must not
 *     turn every directory on the machine into an agent workdir.
 *
 * 0-IMPACT: every case runs against an INJECTED $HOME under the OS temp dir. The first
 * assertion of the zero-writes test is that the injection took effect — without it that
 * test passes vacuously while touching the developer's real ~/.aimaestro.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { statePath } from '@/lib/ecosystem-constants'
import { resolvePillarEnvironment } from '@/lib/pillar/environment'

let home: string
let realHome: string | undefined

beforeEach(() => {
  realHome = process.env.HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-pillar-env-'))
  process.env.HOME = home
})

afterEach(() => {
  process.env.HOME = realHome
  fs.rmSync(home, { recursive: true, force: true })
})

/** Seed a registry with the given rows, creating the dirs the real layout has. */
function seedRegistry(rows: unknown[]): void {
  const dir = path.join(home, '.aimaestro', 'agents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(rows), 'utf-8')
}

/** A real directory under the fake home, so `isUnder` compares resolved paths. */
function mkdir(...segments: string[]): string {
  const p = path.join(home, ...segments)
  fs.mkdirSync(p, { recursive: true })
  return p
}

describe('resolvePillarEnvironment — standalone', () => {
  it('is standalone on a host with no ai-maestro registry, and names the file it looked for', () => {
    const env = resolvePillarEnvironment(mkdir('Code', 'some-project'))
    expect(env.mode).toBe('standalone')
    expect(env.reason).toContain('registry.json')
  })

  it('creates nothing under the state dir it resolves', () => {
    // POSITIVE CONTROL, and it must come first: if $HOME injection silently stopped
    // working, the assertion below would pass while the detector touched the real
    // ~/.aimaestro. Proving the fake home is in effect is what makes it mean anything.
    // It works here because environment.ts calls statePath() at CALL time.
    expect(statePath()).toBe(path.join(home, '.aimaestro'))

    resolvePillarEnvironment(mkdir('Code', 'some-project'))
    expect(fs.existsSync(path.join(home, '.aimaestro'))).toBe(false)
  })

  // WHAT THIS FILE CANNOT PIN, stated so nobody mistakes the test above for the guard.
  //
  // The real hazard is using `loadAgents()` as the detector: it calls ensureAgentsDir()
  // BEFORE its own existsSync guard, and carries a claudeArgs→programArgs migration that
  // SAVES the registry. But `lib/agent-registry.ts` fixes AIMAESTRO_DIR at MODULE LOAD
  // (`const AIMAESTRO_DIR = getStateDir()`), so an IN-PROCESS $HOME swap never reaches
  // it — the neuter run proved this: swapping in loadAgents() left the assertion above
  // GREEN while the write went to the developer's REAL ~/.aimaestro instead. An
  // in-process test cannot observe it, and one that claims to is worse than none.
  //
  // Measured instead in a SUBPROCESS, where the whole module graph loads under the fake
  // home (TRDD-217AYEOT, 2026-07-30): the naive detector created `.aimaestro/` AND
  // `.aimaestro/agents/`; resolvePillarEnvironment created nothing. The shipped guard for
  // that property is the end-to-end `trddgrep env` test — a CLI-level run is the only
  // place the property is real, which is what the card's acceptance box asks for.

  it('is standalone in a directory no agent has registered, even under ~/agents', () => {
    const alice = mkdir('agents', 'alice')
    seedRegistry([{ name: 'alice', workingDirectory: alice }])
    // ~/agents/role-plugins is a plugin SOURCE container (CLAUDE.md R20.29), not an
    // agent. `checkAuthorizedAgentWorkdir` says ok:true for anything under ~/agents/
    // without reading the registry — right for authorization, wrong for identification.
    const env = resolvePillarEnvironment(mkdir('agents', 'role-plugins'))
    expect(env.mode).toBe('standalone')
  })

  it('ignores a soft-deleted agent — a tombstone is not a live workdir', () => {
    const gone = mkdir('agents', 'gone')
    seedRegistry([{ name: 'gone', workingDirectory: gone, deletedAt: '2026-07-01T00:00:00+0200' }])
    expect(resolvePillarEnvironment(gone).mode).toBe('standalone')
  })

  it('survives a corrupt registry as a plain project instead of throwing', () => {
    const dir = path.join(home, '.aimaestro', 'agents')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'registry.json'), '{ not json', 'utf-8')
    const env = resolvePillarEnvironment(mkdir('Code', 'p'))
    expect(env.mode).toBe('standalone')
    expect(env.reason).toMatch(/unreadable|not an array/)
  })

  it('a registry that is a JSON object, not an array, is not an agent environment', () => {
    const dir = path.join(home, '.aimaestro', 'agents')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'registry.json'), '{"agents":[]}', 'utf-8')
    expect(resolvePillarEnvironment(mkdir('Code', 'p')).mode).toBe('standalone')
  })
})

describe('resolvePillarEnvironment — agent', () => {
  it('recognises an agent standing in its own registered workdir', () => {
    const alice = mkdir('agents', 'alice')
    seedRegistry([{ name: 'alice', workingDirectory: alice }])
    const env = resolvePillarEnvironment(alice)
    expect(env.mode).toBe('agent')
    if (env.mode !== 'agent') return
    expect(env.agentName).toBe('alice')
    expect(env.workdir).toBe(alice)
  })

  it('recognises a SUBDIRECTORY of the workdir — an agent works inside its own tree', () => {
    const alice = mkdir('agents', 'alice')
    seedRegistry([{ name: 'alice', workingDirectory: alice }])
    const env = resolvePillarEnvironment(mkdir('agents', 'alice', 'src', 'deep'))
    expect(env.mode).toBe('agent')
    if (env.mode !== 'agent') return
    expect(env.agentName).toBe('alice')
  })

  it('recognises an ADOPTED external workdir outside ~/agents (a MAINTAINER on a project)', () => {
    const repo = mkdir('Code', 'some-plugin')
    seedRegistry([{ name: 'apollo', workingDirectory: repo }])
    const env = resolvePillarEnvironment(repo)
    expect(env.mode).toBe('agent')
    if (env.mode !== 'agent') return
    expect(env.agentName).toBe('apollo')
  })

  it('picks the MOST SPECIFIC registration when workdirs nest', () => {
    const outer = mkdir('Code', 'monorepo')
    const inner = mkdir('Code', 'monorepo', 'packages', 'api')
    seedRegistry([
      { name: 'outer-agent', workingDirectory: outer },
      { name: 'inner-agent', workingDirectory: inner },
    ])
    const env = resolvePillarEnvironment(inner)
    expect(env.mode).toBe('agent')
    if (env.mode !== 'agent') return
    // Registry order must not decide this — the deeper registration is the agent
    // actually standing here. The outer row is listed first on purpose.
    expect(env.agentName).toBe('inner-agent')
  })

  it('ONE stale `workingDirectory: "/"` row does not make the whole filesystem an agent workdir', () => {
    // CLAUDE.md records exactly this drift: a legacy `default` agent registered at "/".
    // isUnder(anything, "/") is true, so without the pathological-row filter this single
    // row reports `agent` mode in every directory on the machine.
    seedRegistry([{ name: 'default', workingDirectory: '/' }])
    expect(resolvePillarEnvironment(mkdir('Code', 'unrelated')).mode).toBe('standalone')
    expect(resolvePillarEnvironment(os.tmpdir()).mode).toBe('standalone')
  })

  it('a row registered at $HOME itself is drift too, not an agent workdir', () => {
    seedRegistry([{ name: 'sloppy', workingDirectory: home }])
    expect(resolvePillarEnvironment(mkdir('Code', 'x')).mode).toBe('standalone')
  })
})
