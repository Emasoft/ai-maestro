/**
 * Tests for the R21.4 adapter calling-context sentinel.
 *
 * The guard exists to catch external callers that bypass ChangePlugin and
 * call the plugin adapter directly — those bypass auth, validation, ledger
 * emission, and settings-lock serialization.
 */

import { describe, it, expect } from 'vitest'
import {
  inAdapterContext,
  assertAdapterContext,
  currentAdapterCaller,
} from '@/lib/client-plugin-adapters/adapter-context'

describe('adapter-context — assertAdapterContext', () => {
  it('throws when called outside any context', () => {
    expect(() => assertAdapterContext('claudeAdapter.install')).toThrow(/R21\.4 violation/)
  })

  it('does not throw when called inside inAdapterContext', async () => {
    let threw = false
    await inAdapterContext('ChangePlugin', async () => {
      try {
        assertAdapterContext('claudeAdapter.install')
      } catch {
        threw = true
      }
    })
    expect(threw).toBe(false)
  })

  it('error message includes the adapter function name for diagnostics', () => {
    try {
      assertAdapterContext('claudeAdapter.uninstall')
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (err) {
      expect((err as Error).message).toContain('claudeAdapter.uninstall')
    }
  })

  it('context is visible across awaits inside the callback', async () => {
    await inAdapterContext('ChangePlugin', async () => {
      await new Promise((r) => setImmediate(r))
      // Context should still be active after the microtask boundary
      expect(currentAdapterCaller()).toBe('ChangePlugin')
      expect(() => assertAdapterContext('test')).not.toThrow()
    })
  })

  it('nested context overrides the outer caller', async () => {
    await inAdapterContext('ChangePlugin', async () => {
      expect(currentAdapterCaller()).toBe('ChangePlugin')
      await inAdapterContext('ChangeClient', async () => {
        expect(currentAdapterCaller()).toBe('ChangeClient')
      })
      // After nested return, outer context resumes
      expect(currentAdapterCaller()).toBe('ChangePlugin')
    })
  })

  it('context does NOT leak to sibling stacks', async () => {
    const a = inAdapterContext('A', async () => {
      await new Promise((r) => setTimeout(r, 5))
      return currentAdapterCaller()
    })
    const b = inAdapterContext('B', async () => {
      await new Promise((r) => setTimeout(r, 1))
      return currentAdapterCaller()
    })
    const [aResult, bResult] = await Promise.all([a, b])
    expect(aResult).toBe('A')
    expect(bResult).toBe('B')
    expect(currentAdapterCaller()).toBeNull()
  })
})

describe('adapter-context — inAdapterContext input validation', () => {
  it('rejects empty caller string', () => {
    expect(() => inAdapterContext('', async () => 1)).toThrow(/non-empty string/)
  })

  it('rejects non-string caller', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => inAdapterContext(undefined, async () => 1)).toThrow(/non-empty string/)
  })

  it('returns the callback result', async () => {
    const result = await inAdapterContext('ChangePlugin', async () => 42)
    expect(result).toBe(42)
  })
})
