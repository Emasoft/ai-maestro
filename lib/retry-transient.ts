// A small generic "retry on thrown error with exponential backoff" helper. Extracted as a
// pure, testable unit (TRDD-JAU1ES1C) so boot-restore can survive a transient boot race
// (tmux/pm2 not yet ready when the server relaunches the fleet) without permanently dropping
// an agent.
//
// It retries ONLY a THROWN error. A function that RETURNS a value — including a
// `{ error }` result object — is never retried: the caller decides what a returned value
// means. This is deliberate for boot-restore, where a governance-gate refusal comes back as a
// returned `{ error }` (a correct, terminal skip) while an unexpected exception (transient IO,
// tmux-not-ready) is thrown (worth retrying).

export interface RetryOptions {
  /** total attempts including the first (must be >= 1). */
  attempts: number
  /** delay before the FIRST retry; each subsequent retry multiplies by `factor`. */
  baseDelayMs: number
  /** backoff multiplier (default 2 → base, 2×base, 4×base, …). */
  factor?: number
  /** called before each backoff wait, for logging. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
}

/** Backoff delay for a 1-indexed attempt. Pure so the schedule is testable without timers. */
export function backoffDelayMs(attempt: number, baseDelayMs: number, factor = 2): number {
  return baseDelayMs * Math.pow(factor, attempt - 1)
}

/**
 * Run `fn`, retrying on a thrown error up to `attempts` times with exponential backoff.
 * Returns `fn`'s value on the first success; rethrows the LAST error if every attempt throws.
 */
export async function retryTransient<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, baseDelayMs, factor = 2, onRetry } = opts
  if (attempts < 1) throw new Error('retryTransient: attempts must be >= 1')

  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < attempts) {
        const delay = backoffDelayMs(attempt, baseDelayMs, factor)
        onRetry?.(attempt, err, delay)
        await new Promise<void>(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastErr
}
