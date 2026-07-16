import { describe, it, expect, vi } from 'vitest'
import { retryTransient, backoffDelayMs } from '@/lib/retry-transient'

describe('backoffDelayMs', () => {
  it('grows exponentially from the base (default factor 2)', () => {
    expect(backoffDelayMs(1, 1000)).toBe(1000)
    expect(backoffDelayMs(2, 1000)).toBe(2000)
    expect(backoffDelayMs(3, 1000)).toBe(4000)
  })
  it('honors a custom factor', () => {
    expect(backoffDelayMs(1, 2000, 3)).toBe(2000)
    expect(backoffDelayMs(2, 2000, 3)).toBe(6000)
    expect(backoffDelayMs(3, 2000, 3)).toBe(18000)
  })
})

describe('retryTransient', () => {
  // baseDelayMs 0 → setTimeout(0), so the tests do not wait on real backoff.
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    await expect(retryTransient(fn, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries a thrown error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('tmux not ready'))
      .mockRejectedValueOnce(new Error('tmux not ready'))
      .mockResolvedValue('woken')
    const onRetry = vi.fn()
    await expect(retryTransient(fn, { attempts: 3, baseDelayMs: 0, onRetry })).resolves.toBe('woken')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('rethrows the LAST error after exhausting attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValue(new Error('last'))
    await expect(retryTransient(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('last')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a returned {error} value (only throws are transient)', async () => {
    // Governance-gate refusals come back as a RETURNED value — never retried.
    const fn = vi.fn().mockResolvedValue({ error: 'no MANAGER — refused' })
    const r = await retryTransient(fn, { attempts: 3, baseDelayMs: 0 })
    expect(r).toEqual({ error: 'no MANAGER — refused' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid attempts count', async () => {
    await expect(retryTransient(async () => 'x', { attempts: 0, baseDelayMs: 0 })).rejects.toThrow(
      'attempts must be >= 1',
    )
  })
})
