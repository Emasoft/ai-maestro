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
