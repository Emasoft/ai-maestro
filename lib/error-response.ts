/**
 * Shared error response helper.
 *
 * Centralizes the "log full error server-side, return generic 500 to client"
 * pattern that round 1 / round 2 audits flagged across ~30 routes. Returning
 * `error.message` to clients can leak filesystem paths, internal hostnames,
 * environment values, library internals, and stack traces.
 *
 * USAGE:
 *   try {
 *     ...
 *   } catch (error) {
 *     return internalError(error, 'route-name-or-context')
 *   }
 *
 * The full error is logged with the context tag so the operator can grep
 * server logs for `[<context>]` to find the original error. The client
 * always receives a generic 500 with the context as a non-sensitive code.
 */

import { NextResponse } from 'next/server'

/**
 * Log the full error server-side and return a generic 500 response to the
 * client. The `code` parameter is a short, non-sensitive route identifier
 * (e.g. 'agents-create', 'webhooks-list') that lets the operator correlate
 * client error reports with server logs without leaking internals.
 */
export function internalError(error: unknown, code: string): NextResponse {
  // Log the full error with the context so operators can correlate
  // client-reported failures back to server-side stacks. Console output is
  // intentional — not piped to the client.
  // eslint-disable-next-line no-console
  console.error(`[${code}]`, error)
  return NextResponse.json(
    { error: 'internal_error', code },
    { status: 500 }
  )
}
