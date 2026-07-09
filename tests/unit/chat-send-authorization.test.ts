/**
 * SECURITY REGRESSION (CRITICAL) — POST /api/agents/[id]/chat is a terminal
 * injection surface and must carry the `send-command` action.
 *
 * The route ends in `runtime.sendKeys(sessionName, message, { literal: true,
 * enter: true })` — arbitrary text plus Enter into a live agent's tmux pane. It
 * called `enforceAuth` alone, which AUTHENTICATES and stops; it does not even
 * hand the route the caller's identity. So any principal with any valid agent
 * token could type into any other agent's terminal, while the route that is
 * openly named for this (`PATCH /api/agents/[id]/session`) is gated by the
 * `send-command` matrix AND classified strict.
 *
 * The capability is defined by what the code does, not by what the endpoint is
 * called. "chat" was the unguarded twin of "send command".
 *
 * Every `expect(403)` below returned 200 against the old handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

type AuthResult = {
  agentId?: string
  governanceTitle?: string
  teamId?: string | null
  userId?: string
  userTitle?: string
  error?: string
  status?: number
}

const { mockAuth, mockChat } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockChat: {
    sendChatMessage: vi.fn(() => Promise.resolve({ data: { success: true } })),
    getConversationMessages: vi.fn(() => Promise.resolve({ data: [] })),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/services/agents-chat-service', () => mockChat)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// route-auth is no longer imported by this route (GET is covered by middleware.ts)
// '@/lib/authorization' is NOT mocked — the real matrix decides.

import { POST } from '@/app/api/agents/[id]/chat/route'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const TARGET = 'agent-target-1'

function as(auth: AuthResult) {
  mockAuth.authenticateFromRequest.mockReturnValue(auth)
}

async function chat(targetAgentId: string, message = 'echo hi') {
  const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${targetAgentId}/chat`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  } as never)
  return POST(req, { params: { id: targetAgentId } as never })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockChat.sendChatMessage.mockResolvedValue({ data: { success: true } })
})

describe('an agent may not type into another agent\'s terminal via /chat', () => {
  it('a MEMBER sending chat to a peer is refused, and nothing is typed (was 200)', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await chat(TARGET)
    expect(res.status).toBe(403)
    expect(mockChat.sendChatMessage).not.toHaveBeenCalled()
  })

  it('a MEMBER sending chat to the MANAGER is refused', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await chat(MANAGER)
    expect(res.status).toBe(403)
    expect(mockChat.sendChatMessage).not.toHaveBeenCalled()
  })

  it('an agent with NO governance title is refused (fail closed)', async () => {
    // 18 of 20 agents on this host carry governanceTitle: null. They must not
    // inherit a capability by virtue of having no title.
    as({ agentId: MEMBER, governanceTitle: undefined, teamId: null })
    const res = await chat(TARGET)
    expect(res.status).toBe(403)
  })

  it('a MANAGER may chat any agent', async () => {
    as({ agentId: MANAGER, governanceTitle: 'manager', teamId: null })
    const res = await chat(TARGET)
    expect(res.status).toBe(200)
    expect(mockChat.sendChatMessage).toHaveBeenCalledWith(TARGET, 'echo hi')
  })

  it('an agent may chat ITSELF — self-drive, it can already type in its own pane', async () => {
    as({ agentId: MEMBER, governanceTitle: 'member', teamId: null })
    const res = await chat(MEMBER)
    expect(res.status).toBe(200)
    expect(mockChat.sendChatMessage).toHaveBeenCalledWith(MEMBER, 'echo hi')
  })

  it('the system owner (dashboard chat box) is unaffected', async () => {
    as({})
    const res = await chat(TARGET)
    expect(res.status).toBe(200)
  })

  it('a non-owner USER principal is refused', async () => {
    as({ userId: 'u-1', userTitle: 'user' })
    const res = await chat(TARGET)
    expect(res.status).toBe(403)
  })

  it('an errored auth result is refused before anything is sent', async () => {
    as({ error: 'token_invalid', status: 401 })
    const res = await chat(TARGET)
    expect(res.status).toBe(401)
    expect(mockChat.sendChatMessage).not.toHaveBeenCalled()
  })
})

describe('static invariants', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'app', 'api', 'agents', '[id]', 'chat', 'route.ts'),
    'utf-8',
  )
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the POST handler authorizes with send-command', () => {
    expect(code).toMatch(/authorize\([^)]*'send-command'/)
  })

  it('authorization runs BEFORE the message is dispatched', () => {
    // Assert PRESENCE first. Without this, deleting the guard makes indexOf
    // return -1, which is trivially less than anything — the test would pass on
    // the very code it exists to reject. Caught by falsifying this suite.
    expect(code).toContain('authorize(')
    expect(code).toContain('sendChatMessage(')
    expect(code.indexOf('authorize(')).toBeLessThan(code.indexOf('sendChatMessage('))
  })

  it('sendChatMessage still ends in a literal sendKeys — the reason this route is send-command', () => {
    const svc = fs.readFileSync(
      path.join(process.cwd(), 'services', 'agents-chat-service.ts'),
      'utf-8',
    )
    expect(svc).toMatch(/sendKeys\([^)]*literal:\s*true[^)]*enter:\s*true/s)
  })
})
