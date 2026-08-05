/**
 * Agents Chat Service — TUI Menu Refusal Tests
 *
 * SCEN-014 P0-003 regression test:
 * When a Claude Code agent is in a TUI permission/menu state, the chat-to-
 * terminal bridge MUST refuse to send the chat message. Otherwise the
 * keystrokes are interpreted as menu navigation and the user's prompt is
 * silently lost (or worse — interpreted as a "1" / "y" answer).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'
import * as crypto from 'crypto'

const {
  mockRuntime,
  mockGetAgent,
  mockExistsSync,
  mockReadFileSync,
  mockStatePath,
} = vi.hoisted(() => {
  return {
    mockRuntime: {
      sessionExists: vi.fn().mockResolvedValue(true),
      sendKeys: vi.fn().mockResolvedValue(undefined),
      capturePane: vi.fn().mockResolvedValue(''),
    },
    mockGetAgent: vi.fn(),
    mockExistsSync: vi.fn(),
    mockReadFileSync: vi.fn(),
    mockStatePath: vi.fn().mockReturnValue('/tmp/aim-test-state/chat-state'),
  }
})

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => mockRuntime,
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: mockGetAgent,
}))

vi.mock('@/lib/ecosystem-constants', () => ({
  statePath: mockStatePath,
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
  }
})

const TEST_AGENT = {
  id: 'agent-uuid-1',
  name: 'tui-bot',
  workingDirectory: '/Users/test/agents/tui-bot',
  sessions: [{ status: 'online' as const }],
}

function hashCwd(cwd: string): string {
  return crypto.createHash('md5').update(cwd || '').digest('hex').substring(0, 16)
}

const STATE_FILE_PATH = path.join(
  '/tmp/aim-test-state/chat-state',
  `${hashCwd(TEST_AGENT.workingDirectory)}.json`
)

describe('sendChatMessage — TUI menu refusal (P0-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgent.mockReturnValue(TEST_AGENT)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockRuntime.sendKeys.mockResolvedValue(undefined)
    mockRuntime.capturePane.mockResolvedValue('shell prompt $ ')
    mockExistsSync.mockReturnValue(false)
  })

  it('refuses send when notificationType=permission_prompt', async () => {
    mockExistsSync.mockImplementation((p: string) => p === STATE_FILE_PATH)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      status: 'permission_request',
      notificationType: 'permission_prompt',
      message: 'Claude is asking for permission',
      updatedAt: new Date().toISOString(),
    }))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(409)
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/menu|permission|terminal/i)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('refuses send when status=permission_request even without notificationType', async () => {
    mockExistsSync.mockImplementation((p: string) => p === STATE_FILE_PATH)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      status: 'permission_request',
      message: 'Claude awaits approval',
      updatedAt: new Date().toISOString(),
    }))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(409)
    expect(result.error).toBeTruthy()
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('refuses send when tmux pane shows a permission menu (TUI signature detected)', async () => {
    mockExistsSync.mockReturnValue(false)
    mockRuntime.capturePane.mockResolvedValue([
      'Some output',
      '─────────────────────────',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No (Esc)',
      '─────────────────────────',
    ].join('\n'))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(409)
    expect(result.error).toBeTruthy()
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('allows send when notificationType=idle_prompt (safe state)', async () => {
    mockExistsSync.mockImplementation((p: string) => p === STATE_FILE_PATH)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      status: 'waiting_for_input',
      notificationType: 'idle_prompt',
      updatedAt: new Date().toISOString(),
    }))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledOnce()
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith(
      TEST_AGENT.name,
      'hello there',
      { literal: true, enter: true }
    )
  })

  it('allows send when no chat-state file exists and pane has no menu', async () => {
    mockExistsSync.mockReturnValue(false)
    mockRuntime.capturePane.mockResolvedValue('shell prompt $ ')

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledOnce()
  })

  it('allows send when capturePane fails (defensive — never block on capture errors)', async () => {
    mockExistsSync.mockReturnValue(false)
    mockRuntime.capturePane.mockRejectedValue(new Error('tmux not found'))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello there')

    expect(result.status).toBe(200)
    expect(mockRuntime.sendKeys).toHaveBeenCalledOnce()
  })

  it('preserves the existing 400 response when agent is not found', async () => {
    mockGetAgent.mockReturnValue(null)

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage('missing-id', 'hello')

    expect(result.status).toBe(404)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('preserves the existing 400 response when session is not online', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const result = await sendChatMessage(TEST_AGENT.id, 'hello')

    expect(result.status).toBe(400)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })
})

/**
 * The injected-prompt MARK on the chat surface (ai-maestro#117).
 *
 * Chat is the THIRD `sendKeys(…, {literal:true, enter:true})` in the product and the one
 * governance tooling actually drives, so an unmarked chat send forges human presence exactly as
 * the other two did. It is also the ONLY one that is caller-conditional, because the same
 * function serves the dashboard's chat box — a human typing, whose presence is real.
 *
 * That makes the SECOND test here the load-bearing one: marking unconditionally would be an easy
 * "simplification" that inverts the veto's direction and starts swallowing genuine keystrokes,
 * which is worse than the bug being fixed. This suite does NOT mock @/services/shared-state, so
 * these assert the real Map.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
 * A complementary pair: each mutation reds a DIFFERENT single test, so neither test is carrying
 * the other, and the conditional itself is pinned separately from the mark.
 *   s/injectedPrompts\.set\(sessionName, Date\.now\(\)\)/void 0/
 *   → 1 red / 10 green:
 *       MARKS the pane when an AGENT drove the send
 *   s/if \(opts\.markAsInjected\)/if (true)/
 *   → 1 red / 10 green:
 *       does NOT mark when the HUMAN dashboard drove the send
 */
describe('sendChatMessage — the injected-prompt mark (#117)', () => {
  // This is a SIBLING describe, so the block above's beforeEach does NOT run for it — its full
  // setup has to be repeated here. Omitting it inherited the previous test's
  // `sessionExists=false` and every case 400'd before ever reaching the marking line.
  beforeEach(async () => {
    const { injectedPrompts } = await import('@/services/shared-state')
    injectedPrompts.clear()
    vi.clearAllMocks()
    mockGetAgent.mockReturnValue(TEST_AGENT)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockRuntime.sendKeys.mockResolvedValue(undefined)
    mockRuntime.capturePane.mockResolvedValue('shell prompt $ ')
    mockExistsSync.mockReturnValue(false)
  })

  it('MARKS the pane when an AGENT drove the send', async () => {
    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const { injectedPrompts } = await import('@/services/shared-state')

    const result = await sendChatMessage(TEST_AGENT.id, 'hello there', { markAsInjected: true })

    expect(result.status).toBe(200)
    expect(injectedPrompts.get(TEST_AGENT.name)).toBeDefined()
  })

  // THE DIRECTION GUARD. The dashboard chat box is a HUMAN typing; its presence must still be
  // recorded, so this path must leave no mark. Both spellings are asserted — the explicit false
  // and the omitted option — because the route passes Boolean(auth.agentId), which is `false`,
  // while any other caller that simply forgets the option gets `undefined`.
  it('does NOT mark when the HUMAN dashboard drove the send', async () => {
    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const { injectedPrompts } = await import('@/services/shared-state')

    const explicit = await sendChatMessage(TEST_AGENT.id, 'hello there', { markAsInjected: false })
    expect(explicit.status).toBe(200)
    expect(injectedPrompts.has(TEST_AGENT.name)).toBe(false)

    const omitted = await sendChatMessage(TEST_AGENT.id, 'hello again')
    expect(omitted.status).toBe(200)
    expect(injectedPrompts.has(TEST_AGENT.name)).toBe(false)
  })

  // Twin of the 409 cases in sessions-service / agents-core-service: a send that is REFUSED
  // injects nothing, so it must leave no mark — otherwise the next genuine keystroke is vetoed
  // as the echo of a prompt that was never delivered. Chat refuses on a TUI permission menu.
  it('does NOT mark a send REFUSED by the TUI-menu guard, even when the agent asked to mark', async () => {
    mockExistsSync.mockImplementation((p: string) => p === STATE_FILE_PATH)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      status: 'waiting_for_input',
      notificationType: 'permission_prompt',
      updatedAt: new Date().toISOString(),
    }))

    const { sendChatMessage } = await import('@/services/agents-chat-service')
    const { injectedPrompts } = await import('@/services/shared-state')

    const result = await sendChatMessage(TEST_AGENT.id, 'hello there', { markAsInjected: true })

    expect(result.status).toBe(409)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
    expect(injectedPrompts.has(TEST_AGENT.name)).toBe(false)
  })
})
