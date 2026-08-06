import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendKeys = vi.fn(async (..._a: unknown[]) => {})
// Typed with its arguments: one test dispatches on the session name, and a zero-arg fake would
// make that override untypeable while still passing at runtime.
const capturePane = vi.fn(async (_name?: unknown, _lines?: unknown): Promise<string> => '')

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({ sendKeys: (...a: unknown[]) => sendKeys(...(a as [])), capturePane: (...a: unknown[]) => capturePane(...(a as [])) }),
}))
vi.mock('@/services/block-state-service', () => ({ readPaneVerdict: vi.fn() }))

import {
  sendFallbackStep,
  collectFallbackCandidates,
  fallbackSessionName,
} from '@/lib/oauth-rotator/model-fallback-deps'

const FRANK_PANE = 'work\n  🤖 Fable 5 v2.1.223 ·xhigh 🧠 | 📁 frank | 📊 488k/1.0m'

beforeEach(() => {
  sendKeys.mockReset()
  sendKeys.mockImplementation(async () => {})
  capturePane.mockReset()
  capturePane.mockImplementation(async () => FRANK_PANE)
})

describe('fallbackSessionName', () => {
  it('uses computeSessionName, the same field the WRITE path addresses', () => {
    expect(fallbackSessionName({ id: 'a1', name: 'frank' })).toBe('frank')
  })

  it('returns null for a nameless agent rather than inventing a pane', () => {
    expect(fallbackSessionName({ id: 'a1' })).toBeNull()
  })
})

describe('sendFallbackStep — the keystrokes', () => {
  it('sends ESC as a tmux KEY NAME, not as literal text', async () => {
    // `-l` would type the characters E-s-c-a-p-e into the prompt instead of pressing the key.
    const r = await sendFallbackStep('frank', { agentId: 'a1', step: 'esc' })
    expect(r.ok).toBe(true)
    expect(sendKeys).toHaveBeenCalledWith('frank', 'Escape')
  })

  it('resolves the curated key to its command text HERE, and submits it', async () => {
    const r = await sendFallbackStep('frank', { agentId: 'a1', step: 'command', commandKey: 'model-opus' })
    expect(r.ok).toBe(true)
    // literal:true types the text; enter:true submits it. Without enter the command would sit
    // unsent in the prompt and the confirming ENTER would submit it a beat later instead.
    expect(sendKeys).toHaveBeenCalledWith('frank', '/model opus', { literal: true, enter: true })
  })

  it('refuses an unknown key and sends NOTHING', async () => {
    const r = await sendFallbackStep('frank', { agentId: 'a1', step: 'command', commandKey: 'model-nope' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/unknown command key/)
    expect(sendKeys).not.toHaveBeenCalled()
  })

  it('sends the confirm as Enter', async () => {
    const r = await sendFallbackStep('frank', { agentId: 'a1', step: 'confirm' })
    expect(r.ok).toBe(true)
    expect(sendKeys).toHaveBeenCalledWith('frank', 'Enter')
  })

  it('reports a runtime failure instead of throwing', async () => {
    // A throw would escape past the actuator's "do not confirm a failed command" guard.
    sendKeys.mockImplementation(async () => {
      throw new Error('no server running')
    })
    const r = await sendFallbackStep('frank', { agentId: 'a1', step: 'esc' })
    expect(r).toMatchObject({ ok: false })
    expect(r.detail).toMatch(/no server running/)
  })
})

describe('collectFallbackCandidates', () => {
  it('reports the model each pane actually says it is running', async () => {
    const out = await collectFallbackCandidates([{ id: 'a1', name: 'frank' }])
    expect(out.candidates).toEqual([{ agentId: 'a1', name: 'frank', model: 'Fable 5' }])
    expect(out.unreadable).toEqual([])
  })

  it('OMITS an agent whose pane cannot be captured — never defaults its model', async () => {
    // A guessed model either switches an agent that did not need it or skips one that did.
    capturePane.mockImplementation(async () => {
      throw new Error('no such session')
    })
    const out = await collectFallbackCandidates([{ id: 'a1', name: 'frank' }])
    expect(out.candidates).toEqual([])
    expect(out.unreadable).toEqual(['a1'])
  })

  it('OMITS an agent whose pane has no statusline', async () => {
    capturePane.mockImplementation(async () => 'just some output\nno statusline')
    const out = await collectFallbackCandidates([{ id: 'a1', name: 'frank' }])
    expect(out.candidates).toEqual([])
    expect(out.unreadable).toEqual(['a1'])
  })

  it('OMITS a nameless agent without attempting a capture', async () => {
    const out = await collectFallbackCandidates([{ id: 'a1' }])
    expect(out.unreadable).toEqual(['a1'])
    expect(capturePane).not.toHaveBeenCalled()
  })

  it('keeps the readable ones when a sibling is unreadable', async () => {
    capturePane.mockImplementation(async (name: unknown) =>
      name === 'frank' ? FRANK_PANE : 'nothing here',
    )
    const out = await collectFallbackCandidates([
      { id: 'a1', name: 'frank' },
      { id: 'a2', name: 'ghost' },
    ])
    expect(out.candidates.map(c => c.agentId)).toEqual(['a1'])
    expect(out.unreadable).toEqual(['a2'])
  })
})
