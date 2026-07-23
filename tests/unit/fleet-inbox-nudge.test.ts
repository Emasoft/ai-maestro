// Unit tests for the fleet inbox-nudge tick (TRDD-7HRDAD0U). The tick is pure over injected deps,
// so no live fleet / tmux / filesystem is needed — every dependency is a fake.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  runInboxNudgeTick,
  buildNudgePrompt,
  type InboxNudgeDeps,
  type InboxNudgeState,
} from '@/lib/fleet-inbox-nudge'

type Agent = { id: string; name: string; workingDirectory: string | null }

function makeDeps(over: {
  agents?: Agent[]
  unread?: Record<string, number>
  inject?: InboxNudgeDeps['inject']
  hook?: Record<string, { status: string | null; notificationType: string | null }>
  blocked?: boolean
} = {}): { deps: InboxNudgeDeps; injectCalls: Array<{ agentId: string; prompt: string }> } {
  const agents = over.agents ?? [{ id: 'a1', name: 'worker', workingDirectory: '/wd/a1' }]
  const unread = over.unread ?? { a1: 1 }
  const injectCalls: Array<{ agentId: string; prompt: string }> = []
  const deps: InboxNudgeDeps = {
    listAgents: () => agents,
    countUnread: async (id) => unread[id] ?? 0,
    inject:
      over.inject ??
      (async (agentId, prompt) => {
        injectCalls.push({ agentId, prompt })
        return { ok: true, status: 200 }
      }),
    getHookNotification: (wd) => {
      if (!over.hook || wd === null) return null
      const a = agents.find((x) => x.workingDirectory === wd)
      return a ? over.hook[a.id] ?? null : null
    },
    actuationBlocked: () => ({ blocked: !!over.blocked, reason: over.blocked ? 'kill-switch' : null }),
  }
  return { deps, injectCalls }
}

describe('fleet-inbox-nudge — runInboxNudgeTick', () => {
  let store: Map<string, InboxNudgeState>
  const now = () => 1_000_000

  beforeEach(() => {
    store = new Map()
  })

  it('injects an inbox-check turn into an idle agent with unread mail, and sets the cooldown', async () => {
    const { deps, injectCalls } = makeDeps({ unread: { a1: 3 } })
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.nudged).toEqual([{ agentId: 'a1', name: 'worker', unread: 3 }])
    expect(injectCalls).toHaveLength(1)
    expect(injectCalls[0].prompt).toContain('3 unread inter-agent messages')
    expect(store.get('a1')?.lastNudgeMs).toBe(1_000_000)
  })

  it('skips an agent with zero unread — no inject', async () => {
    const { deps, injectCalls } = makeDeps({ unread: { a1: 0 } })
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.nudged).toEqual([])
    expect(injectCalls).toHaveLength(0)
    expect(store.has('a1')).toBe(false)
  })

  it('respects the cooldown — an agent nudged within the window is not re-nudged', async () => {
    store.set('a1', { lastNudgeMs: 999_000 }) // 1s ago, well within the 5-min cooldown
    const { deps, injectCalls } = makeDeps({ unread: { a1: 1 } })
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.nudged).toEqual([])
    expect(r.skipped).toEqual([{ agentId: 'a1', name: 'worker', reason: 'cooldown' }])
    expect(injectCalls).toHaveLength(0)
  })

  it('injects nothing when actuation is machine-wide BLOCKED (kill-switch / pause)', async () => {
    const { deps, injectCalls } = makeDeps({ unread: { a1: 1 }, blocked: true })
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.actuationBlocked).toBe(true)
    expect(r.nudged).toEqual([])
    expect(r.scanned).toBe(0) // returns before scanning any agent
    expect(injectCalls).toHaveLength(0)
  })

  it('skips an agent blocked on a permission prompt (the USER must act) — no inject', async () => {
    const { deps, injectCalls } = makeDeps({
      unread: { a1: 2 },
      hook: { a1: { status: 'waiting_for_input', notificationType: 'permission_prompt' } },
    })
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.nudged).toEqual([])
    expect(r.skipped[0].reason).toBe('blocked: permission_prompt')
    expect(injectCalls).toHaveLength(0)
  })

  it('does NOT set the cooldown when the inject 409s (not idle) — so it retries next tick', async () => {
    let call = 0
    const inject: InboxNudgeDeps['inject'] = async () => {
      call++
      return call === 1 ? { ok: false, status: 409 } : { ok: true, status: 200 }
    }
    const { deps } = makeDeps({ unread: { a1: 1 }, inject })

    const r1 = await runInboxNudgeTick(deps, store, now)
    expect(r1.nudged).toEqual([])
    expect(r1.skipped).toEqual([{ agentId: 'a1', name: 'worker', reason: 'not idle' }])
    expect(store.has('a1')).toBe(false) // no cooldown recorded

    const r2 = await runInboxNudgeTick(deps, store, now)
    expect(r2.nudged).toEqual([{ agentId: 'a1', name: 'worker', unread: 1 }])
    expect(store.get('a1')?.lastNudgeMs).toBe(1_000_000)
  })

  it('a countUnread failure on one agent is skipped and the pass continues to the next', async () => {
    const agents: Agent[] = [
      { id: 'bad', name: 'boom', workingDirectory: '/wd/bad' },
      { id: 'ok', name: 'healthy', workingDirectory: '/wd/ok' },
    ]
    const deps: InboxNudgeDeps = {
      listAgents: () => agents,
      countUnread: async (id) => {
        if (id === 'bad') throw new Error('inbox unreadable')
        return 1
      },
      inject: async () => ({ ok: true, status: 200 }),
      getHookNotification: () => null,
      actuationBlocked: () => ({ blocked: false, reason: null }),
    }
    const r = await runInboxNudgeTick(deps, store, now)
    expect(r.skipped.find((s) => s.agentId === 'bad')?.reason).toContain('countUnread error')
    expect(r.nudged).toEqual([{ agentId: 'ok', name: 'healthy', unread: 1 }])
  })
})

describe('fleet-inbox-nudge — buildNudgePrompt', () => {
  it('is a single line, singular vs plural, and names the agent-messaging skill', () => {
    expect(buildNudgePrompt(1)).toContain('1 unread inter-agent message')
    expect(buildNudgePrompt(1)).not.toContain('messages')
    expect(buildNudgePrompt(5)).toContain('5 unread inter-agent messages')
    expect(buildNudgePrompt(2)).toContain('amp-inbox.sh')
    expect(buildNudgePrompt(2).includes('\n')).toBe(false) // sent literally with Enter — must be one line
  })
})
