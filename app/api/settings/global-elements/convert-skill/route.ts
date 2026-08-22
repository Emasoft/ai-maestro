/**
 * POST /api/settings/global-elements/convert-skill
 *
 * Convert elements between AI coding clients.
 * Accepts source path/URL, target client, optional element filter.
 *
 * Body: { source: string, targetClient: string, elements?: string[], dryRun?: boolean }
 *
 * GET /api/settings/global-elements/convert-skill?sourceClient=claude-code&targetClient=codex
 *
 * Returns conversion capabilities (supported elements + warnings).
 */

import { NextRequest, NextResponse } from 'next/server'
import { convertElements, getConversionCapabilities } from '@/services/cross-client-conversion-service'
import { PROVIDER_IDS } from '@/lib/converter/registry'
import type { ProviderId, ElementType } from '@/lib/converter/types'
import { enforceAuth, enforceSystemOwner } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // TRDD-R268J32X — RAISED from enforceAuth to enforceSystemOwner. This is the widest-reaching
  // route found while draining the authentication-only ledger, and `enforceAuth`'s own docstring
  // ("any authenticated caller can call this") was plainly the wrong policy for it.
  //
  // WHAT ANY AUTHENTICATED AGENT COULD DO, traced end to end:
  //   • `source` is documented as "path, URL, or scope path". `convertElements`
  //     (`services/cross-client-conversion-service.ts:26`) parses it, and on a GitHub URL calls
  //     `downloadGitHubRepo(...)` — so the SERVER fetches a repo the CALLER names.
  //   • `scope: 'user'` reaches `lib/converter/convert.ts:209-212`, which returns
  //     `process.env.HOME` as the write root; `:171` then writes the converted files under it.
  //   • `force` overwrites, and `projectDir` is caller-supplied for the project scope.
  // Converted skills/agents/instructions are PROMPT CONTENT that Claude Code loads, so the
  // composition is remote-content → the owner's home directory → loaded as instructions.
  //
  // WHY enforceSystemOwner AND NOT an authorize() action: every other mutating route under
  // `app/api/settings/**` is already enforceSystemOwner or requireSudoToken — including the
  // sibling in THIS directory, `global-elements/install-skill`. Installing a skill globally
  // required the owner while CONVERTING one into the same place did not. That is the
  // TRDD-DQVPODKW shape (siblings hold the strong guard; the one that reaches furthest got the
  // weak one), and matching the subtree needs no new governance vocabulary — `authorize()` has no
  // verb for this and adding one would be a governance change, not a fix.
  //
  // Safe for the UI, verified empirically rather than assumed: `components/settings/ConvertButton.tsx`
  // calls this with a plain same-origin fetch, and `components/settings/GlobalElementsSection.tsx`
  // — the same settings UI — already calls `settings/global-plugins` (enforceSystemOwner) and
  // `settings/marketplaces` (enforceSystemOwner + requireSudoToken) successfully. A cookie session
  // resolves to the system owner (`lib/agent-auth`: "Valid session cookie (aim_session) → system
  // owner (web UI)").
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { source, targetClient, elements, dryRun, scope, projectDir, force } = body

  if (!source || typeof source !== 'string') {
    return NextResponse.json({ error: 'source is required (path, URL, or scope path)' }, { status: 400 })
  }
  if (!targetClient || !PROVIDER_IDS.includes(targetClient as ProviderId)) {
    return NextResponse.json({ error: `targetClient must be one of: ${PROVIDER_IDS.join(', ')}` }, { status: 400 })
  }

  try {
    const result = await convertElements({
      source,
      targetClient: targetClient as ProviderId,
      elements: elements as ElementType[] | undefined,
      scope: scope === 'project' ? 'project' : 'user',
      projectDir: typeof projectDir === 'string' ? projectDir : undefined,
      dryRun: Boolean(dryRun),
      force: Boolean(force),
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Conversion failed' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // TRDD-R268J32X: this had no guard at all. Only enforceAuth (not enforceSystemOwner) because it
  // returns STATIC capability metadata — which element types convert between two known providers —
  // with no user data, no paths and nothing to enumerate. The POST above is the owner-gated half.
  // Still authenticated, because `lib/agent-auth` records the ruling: "SF-058 CLOSED: No auth
  // headers AND no session cookie → rejected. There is no 'free' system-owner access anymore."
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { searchParams } = new URL(request.url)
  const sourceClient = searchParams.get('sourceClient')
  const targetClient = searchParams.get('targetClient')

  if (!sourceClient || !targetClient) {
    return NextResponse.json({ error: 'sourceClient and targetClient required' }, { status: 400 })
  }
  if (!PROVIDER_IDS.includes(sourceClient as ProviderId) || !PROVIDER_IDS.includes(targetClient as ProviderId)) {
    return NextResponse.json({ error: `Clients must be one of: ${PROVIDER_IDS.join(', ')}` }, { status: 400 })
  }

  const caps = await getConversionCapabilities(sourceClient as ProviderId, targetClient as ProviderId)
  return NextResponse.json({ sourceClient, targetClient, ...caps })
}
