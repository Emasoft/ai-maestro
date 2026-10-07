/**
 * TRDD-FM2ERCE6 — reconcileOrphanPanesOnBoot relaunches an orphan shell-only pane
 * through wakeAgent (the single launch path), bounded to one relaunch per agent.
 *
 * Doubles ONLY the boundaries: the tmux runtime, pane inspection and wakeAgent.
 * The registry is the real one, read from a temp HOME.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { TMP_HOME } = vi.hoisted(() => {
  const nodeOs = require('os') as typeof import('os')
  const nodeFs = require('fs') as typeof import('fs')
  const nodePath = require('path') as typeof import('path')
  return { TMP_HOME: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aim-reconcile-relaunch-')) }
})
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

const calls: string[] = []
const mockWake = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ data: { success: true }, status: 200 }))
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    sessionExists: async () => true,
    killSession: async (n: string) => { calls.push(`kill:${n}`) },
  }),
}))
vi.mock('@/services/agents-core-service', () => ({
  getPaneCommand: () => ({ paneCommand: 'zsh', programRunning: false, paneCurrentPath: '/' }),
  wakeAgent: (...a: unknown[]) => { calls.push('wake'); return mockWake(...a) },
}))

import { reconcileOrphanPanesOnBoot } from '@/services/session-reconcile-service'

const REGISTRY = path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json')
function seed(agents: unknown[]): void {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
  fs.writeFileSync(REGISTRY, JSON.stringify(agents))
}

beforeEach(() => {
  calls.length = 0
  mockWake.mockClear()
  mockWake.mockImplementation(async () => ({ data: { success: true }, status: 200 }))
  if (fs.existsSync(REGISTRY)) fs.rmSync(REGISTRY)
})

describe('reconcileOrphanPanesOnBoot relaunch (TRDD-FM2ERCE6)', () => {
  it('kills the dead shell then relaunches an active agent through wakeAgent exactly once', async () => {
    seed([{ id: 'id-a', name: 'agent-a', status: 'active' }])
    const res = await reconcileOrphanPanesOnBoot()
    expect(res).toEqual({ checked: 1, killed: 1, relaunched: 1 })
    expect(calls).toEqual(['kill:agent-a', 'wake']) // kill first: wakeAgent short-circuits on a live pane
    expect(mockWake).toHaveBeenCalledWith('id-a', { authContext: { isSystemOwner: true } })
  })

  it('does not relaunch an agent that is not active (hibernated / offline)', async () => {
    seed([{ id: 'id-h', name: 'agent-h', status: 'hibernated' }])
    const res = await reconcileOrphanPanesOnBoot()
    expect(res).toEqual({ checked: 1, killed: 1, relaunched: 0 })
    expect(mockWake).not.toHaveBeenCalled()
  })

  it('does not count a relaunch when wakeAgent refuses (quarantine / missing preconditions)', async () => {
    mockWake.mockImplementation(async () => ({ error: 'role_plugin_required', status: 409 }))
    seed([{ id: 'id-q', name: 'agent-q', status: 'active', roleMissing: true }])
    const res = await reconcileOrphanPanesOnBoot()
    expect(res).toEqual({ checked: 1, killed: 1, relaunched: 0 })
    expect(mockWake).toHaveBeenCalledTimes(1)
  })

  it('relaunches a second consecutive orphan of the same agent NOT at all (no crash-loop)', async () => {
    seed([{ id: 'id-l', name: 'agent-l', status: 'active' }])
    await reconcileOrphanPanesOnBoot()
    calls.length = 0
    mockWake.mockClear()
    const res = await reconcileOrphanPanesOnBoot()
    expect(res).toEqual({ checked: 1, killed: 1, relaunched: 0 })
    expect(mockWake).not.toHaveBeenCalled()
    expect(calls).toEqual(['kill:agent-l'])
  })
})
