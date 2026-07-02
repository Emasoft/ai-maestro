/**
 * Tests for ChangeMetadata — agent-scoped AIO for the `metadata` field
 * (TRDD-ef0c6c0a item 9 migration). Locks the gate sequence:
 *
 *   G00 auth → G01 shape → G02 size → G03 depth → G04 resolve → EXE → PG01
 *
 * 'clear' mode skips G02/G03 because the payload is generated from
 * existing keys, not from the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRegistry } = vi.hoisted(() => ({
  mockRegistry: {
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    loadAgents: vi.fn().mockReturnValue([]),
  },
}))

vi.mock('@/lib/agent-registry', () => mockRegistry)

const SYS_AUTH = { isSystemOwner: true } as const

beforeEach(() => {
  mockRegistry.getAgent.mockReset()
  mockRegistry.updateAgent.mockReset()
  mockRegistry.getAgent.mockReturnValue({
    id: 'a-1',
    name: 'agent-1',
    metadata: { existing: 'value', other: 42 },
  })
  mockRegistry.updateAgent.mockResolvedValue({
    id: 'a-1',
    name: 'agent-1',
    metadata: { merged: true },
  })
})

describe('ChangeMetadata — merge mode', () => {
  it('rejects calls without authContext', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    // @ts-expect-error — testing runtime guard
    const r = await ChangeMetadata('a-1', { foo: 1 }, undefined)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/authContext/i)
  })

  it('rejects non-object metadata (string)', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    // @ts-expect-error — testing runtime shape guard
    const r = await ChangeMetadata('a-1', 'not-an-object', SYS_AUTH)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/plain object/i)
    expect(mockRegistry.updateAgent).not.toHaveBeenCalled()
  })

  it('rejects array metadata', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('a-1', ['array'] as unknown as Record<string, unknown>, SYS_AUTH)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/plain object/i)
  })

  it('rejects metadata over 64 KB', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const big = { huge: 'x'.repeat(70_000) }
    const r = await ChangeMetadata('a-1', big, SYS_AUTH)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/64KB|maximum size/i)
    expect(mockRegistry.updateAgent).not.toHaveBeenCalled()
  })

  it('rejects metadata nested deeper than 5 levels', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const deep: Record<string, unknown> = { a: { b: { c: { d: { e: { f: 'too-deep' } } } } } }
    const r = await ChangeMetadata('a-1', deep, SYS_AUTH)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/depth/i)
  })

  it('returns 404-like error when agent not found', async () => {
    mockRegistry.getAgent.mockReturnValue(undefined)
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('missing', { foo: 1 }, SYS_AUTH)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found/i)
    expect(mockRegistry.updateAgent).not.toHaveBeenCalled()
  })

  it('happy path: passes metadata straight through to updateAgent', async () => {
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('a-1', { foo: 1, bar: 'two' }, SYS_AUTH)
    expect(r.success).toBe(true)
    expect(mockRegistry.updateAgent).toHaveBeenCalledWith('a-1', {
      metadata: { foo: 1, bar: 'two' },
    })
    expect(r.restartNeeded).toBe(false)
  })
})

describe('ChangeMetadata — clear mode', () => {
  it('builds an undefined-valued map from existing keys', async () => {
    mockRegistry.getAgent.mockReturnValue({
      id: 'a-1',
      name: 'agent-1',
      metadata: { keep: 'a', also: 'b', third: 'c' },
    })
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('a-1', {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(mockRegistry.updateAgent).toHaveBeenCalledTimes(1)
    const callArgs = mockRegistry.updateAgent.mock.calls[0]!
    expect(callArgs[0]).toBe('a-1')
    const sentMetadata = (callArgs[1] as { metadata: Record<string, undefined> }).metadata
    expect(Object.keys(sentMetadata).sort()).toEqual(['also', 'keep', 'third'])
    expect(sentMetadata.keep).toBeUndefined()
    expect(sentMetadata.also).toBeUndefined()
    expect(sentMetadata.third).toBeUndefined()
  })

  it('clear on agent with no metadata: sends empty object', async () => {
    mockRegistry.getAgent.mockReturnValue({ id: 'a-1', name: 'agent-1' })
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('a-1', {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(mockRegistry.updateAgent).toHaveBeenCalledWith('a-1', {
      metadata: {},
    })
  })

  it('clear mode skips size check (allows large existing metadata to be wiped)', async () => {
    // Even if the existing metadata was huge somehow, clearing it should always work
    // because the payload is just undefined-valued keys.
    const huge: Record<string, string> = {}
    for (let i = 0; i < 1000; i++) huge[`k${i}`] = 'x'.repeat(100)
    mockRegistry.getAgent.mockReturnValue({ id: 'a-1', name: 'agent-1', metadata: huge })
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata('a-1', {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(mockRegistry.updateAgent).toHaveBeenCalled()
  })
})
