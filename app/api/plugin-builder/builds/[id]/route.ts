/**
 * Plugin Builder - Build Status API
 *
 * GET /api/plugin-builder/builds/:id - Check build status
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getBuildStatus } from '@/services/plugin-builder-service'
import { isValidUuid } from '@/lib/validation'
import { enforceAuth } from '@/lib/route-auth'

export async function GET(
  request: NextRequest,
  // TRDD-R268J32X: `Promise<…>` + `await` below, matching the repo majority (78 routes to 20) and
  // — load-bearing — letting the headless router DELEGATE to this handler instead of keeping an
  // unguarded hand-rolled twin. `delegateNextRoute` always passes `params: Promise.resolve(...)`,
  // so with the synchronous signature the delegated call read `id` off a Promise and every request
  // 400'd on "Invalid build ID". `await` on a non-promise is a no-op, so this is correct whichever
  // shape Next itself passes.
  { params }: { params: Promise<{ id: string }> }
) {
  // TRDD-R268J32X. This route had NO guard at all — the only unauthenticated one
  // in an otherwise-guarded subtree (`build` uses enforceAuth, `push` uses
  // enforceSystemOwner). It was protected solely by the entropy of the build id,
  // which `buildPlugin` mints as a randomUUID and returns only to the authenticated
  // POST caller — a capability URL, not an authorization decision. `lib/agent-auth`
  // states the project's own ruling that supersedes that pattern:
  //
  //     "SF-058 CLOSED: No auth headers AND no session cookie → rejected.
  //      There is no 'free' system-owner access anymore."
  //
  // enforceAuth (authentication only) is the right strength and matches the POST
  // sibling: build status is not a governance object, so there is no title to check.
  // Safe for the UI — components/plugin-builder/BuildAction.tsx polls this with a
  // plain same-origin fetch, and authenticateFromRequest resolves the `aim_session`
  // cookie to a system owner, which is how that component's POST already passes.
  // enforceAuth's write-block is a no-op on GET, so this adds authentication only.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { id } = await params

  // Reject malformed build IDs before hitting the service layer
  if (!id || !isValidUuid(id)) {
    return NextResponse.json(
      { error: 'Invalid build ID' },
      { status: 400 }
    )
  }

  try {
    const result = await getBuildStatus(id)

    if (result.error) {
      // Guard against service returning an invalid or missing HTTP status code
      const statusCode =
        typeof result.status === 'number' && result.status >= 100 && result.status < 600
          ? result.status
          : 500
      return NextResponse.json(
        { error: result.error },
        { status: statusCode }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Error getting build status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
