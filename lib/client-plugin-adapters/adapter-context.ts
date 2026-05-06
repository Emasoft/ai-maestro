/**
 * Adapter Calling Context (R21.4 + R21.21 enforcement)
 *
 * Per R21 (AIO Composition), client-plugin adapters are PRIMITIVES below
 * the AIO line — they MUST only be invoked from inside ChangePlugin (or
 * an explicitly-named internal call site like ChangeClient's plugin
 * re-emission loop). External callers that bypass the AIO and call the
 * adapter directly skip auth gates, validation, ledger emission, and
 * settings-lock serialization.
 *
 * This module ships a small AsyncLocalStorage-based sentinel. The flow:
 *
 *   inAdapterContext('ChangePlugin', async () => { adapter.install(...) })
 *
 * Inside the adapter functions:
 *
 *   assertAdapterContext('claudeAdapter.install')
 *
 * If a caller invokes the adapter without first entering the context,
 * the assert throws and the request fails fast. The error message names
 * the adapter function so the offending stack frame is easy to find.
 *
 * Tests and other internal callers that need to bypass the sentinel
 * MUST call `inAdapterContext('TEST:<reason>', fn)` so the bypass is
 * audit-visible — there is no silent way through.
 */

import { AsyncLocalStorage } from 'async_hooks'

interface AdapterCallContext {
  /** Caller name for audit. Must start with one of:
   *  - 'ChangePlugin' (the canonical AIO)
   *  - 'ChangeClient' (R18 plugin re-emission)
   *  - 'TEST:<reason>' (test bypass — visible in logs)
   *  - 'Bootstrap:<reason>' (server startup migrations)
   */
  caller: string
}

const als = new AsyncLocalStorage<AdapterCallContext>()

/**
 * Enter an adapter-calling context. Adapter functions invoked inside the
 * callback will see the sentinel and proceed normally. Any nested adapter
 * call that escapes (e.g. via a bare promise without await) loses the
 * context — that's intentional, the contract is "the call must be on the
 * stack of an inAdapterContext frame".
 */
export function inAdapterContext<T>(caller: string, fn: () => Promise<T>): Promise<T> {
  if (!caller || typeof caller !== 'string') {
    throw new Error('inAdapterContext: caller must be a non-empty string')
  }
  return als.run({ caller }, fn)
}

/**
 * Throw if the current async stack is not inside an inAdapterContext frame.
 * Adapter functions call this as their first statement.
 *
 * The error includes the adapter function name so the offending caller is
 * easy to locate. The message is intentionally descriptive — this is a
 * design-time invariant, not a user-facing error.
 */
export function assertAdapterContext(adapterFn: string): void {
  const ctx = als.getStore()
  if (!ctx) {
    throw new Error(
      `R21.4 violation: ${adapterFn} called outside inAdapterContext(). ` +
      `Plugin adapters are below the AIO line — they must only be invoked ` +
      `from inside ChangePlugin (or another explicitly named AIO that wraps ` +
      `the call with inAdapterContext('<name>', ...)). If you are writing a ` +
      `test or one-off bootstrap call, wrap your invocation with ` +
      `inAdapterContext('TEST:<reason>', ...) to make the bypass auditable.`
    )
  }
}

/** For diagnostics / logging. Returns the current caller name or null. */
export function currentAdapterCaller(): string | null {
  return als.getStore()?.caller ?? null
}
