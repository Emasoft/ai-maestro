/**
 * getAgentProbe (TRDD-LT5N2JA4) — the aggregating read behind GET /api/agents/[id]/probe.
 *
 * Real chat-state fixture files (written to a temp dir), not a mocked `fs` module — chatStateFileFor
 * is mocked to point AT those real files, so the JSON parsing under test is the real code path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const AGENT = {
  id: 'a1',
  name: 'alice',
  workingDirectory: '/tmp/alice-wd',
  session: { status: 'online', programRunning: true },
} as unknown as import('@/types/agent').Agent

vi.mock('@/services/agents-core-service', () => ({
  getAgentById: vi.fn(),
}))
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({ capturePane: vi.fn(async () => 'testbot idle pane\n❯ \n') }),
}))
vi.mock('@/services/sessions-service', () => ({
  readPendingPrompt: vi.fn(() => null),
}))
vi.mock('@/lib/chat-state-path', () => ({
  chatStateFileFor: vi.fn(),
}))

import { getAgentById } from '@/services/agents-core-service'
import { chatStateFileFor } from '@/lib/chat-state-path'
import { getAgentProbe } from '@/services/block-state-service'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'))
  vi.mocked(getAgentById).mockReturnValue({ data: { agent: AGENT }, status: 200 })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

function writeChatState(fields: Record<string, unknown>): string {
  const p = path.join(tmpDir, 'state.json')
  fs.writeFileSync(p, JSON.stringify(fields))
  return p
}

describe('getAgentProbe — per-source degradation', () => {
  it('aggregates every feed as ok when all are available', async () => {
    vi.mocked(chatStateFileFor).mockReturnValue(
      writeChatState({ status: 'active', notificationType: null, updatedAt: new Date().toISOString() }),
    )
    const result = await getAgentProbe('a1')
    expect(result.data).toBeTruthy()
    expect(result.data!.sources.registry).toBe('ok')
    expect(result.data!.sources.pane).toBe('ok')
    expect(result.data!.sources.hook).toBe('ok')
    expect(result.data!.block).not.toBeNull()
    expect(result.data!.hook).not.toBeNull()
  })

  it('reports hook unavailable when the chat-state file is missing, without losing other fields', async () => {
    vi.mocked(chatStateFileFor).mockReturnValue(path.join(tmpDir, 'does-not-exist.json'))
    const result = await getAgentProbe('a1')
    expect(result.data!.sources.hook).toBe('unavailable: no chat-state file')
    expect(result.data!.hook).toBeNull()
    // the degradation of ONE source must not silently drop the others
    expect(result.data!.sources.registry).toBe('ok')
    expect(result.data!.sources.pane).toBe('ok')
    expect(result.data!.block).not.toBeNull()
  })

  it('usage is ALWAYS unavailable — no proven agentlenspro join key (card omit rule)', async () => {
    vi.mocked(chatStateFileFor).mockReturnValue(
      writeChatState({ status: 'active', updatedAt: new Date().toISOString() }),
    )
    const result = await getAgentProbe('a1')
    expect(result.data!.usage).toBeNull()
    expect(result.data!.sources.usage).toBe('unavailable: no proven join key (see TRDD-LT5N2JA4)')
  })

  it('reports stale: for a chat-state file older than 1h', async () => {
    const oldTs = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    vi.mocked(chatStateFileFor).mockReturnValue(
      writeChatState({ status: 'waiting_for_input', notificationType: 'idle_prompt', updatedAt: oldTs }),
    )
    const result = await getAgentProbe('a1')
    expect(result.data!.sources.hook).toMatch(/^stale:/)
    // still surfaced, just flagged — never silently dropped
    expect(result.data!.hook).not.toBeNull()
  })
})

describe('GET /api/agents/[id]/probe — route-level auth refusal', () => {
  it('propagates a 403 from the sudo/authorization guard verbatim (not re-testing authorize() internals)', async () => {
    vi.resetModules()
    const { NextResponse, NextRequest } = await import('next/server')
    vi.doMock('@/lib/sudo-guard', () => ({
      requireSudoToken: () =>
        NextResponse.json({ error: 'Not authorized to probe this agent' }, { status: 403 }),
    }))
    const { GET } = await import('@/app/api/agents/[id]/probe/route')
    const req = new NextRequest('http://localhost:23000/api/agents/a1/probe')
    const res = await GET(req, { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) })
    expect(res.status).toBe(403)
  })
})
