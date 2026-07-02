/**
 * AID Token Exchange Endpoint
 *
 * POST /api/v1/auth/token
 *
 * Accepts an Ed25519 proof-of-possession and issues a short-lived
 * governance token (aim_tk_*) with embedded agentId + title + teamId.
 *
 * This is the bridge between AID (cryptographic identity) and AI Maestro
 * governance. Scripts call this via aid-maestro-token.sh.
 */

import { NextResponse } from 'next/server'
import {
  verifyNonceProofWithPublicKeyHex,
  issueGovernanceToken
} from '@/lib/aid-token'
import { consumeNonce } from '@/lib/aid-nonce'
import { loadKeyPair } from '@/lib/amp-keys'
import { loadTeams } from '@/lib/team-registry'

export async function POST(request: Request) {
  try {
    // API2-MAJ-05: rate limit must be keyed by sender identity AND keep a
    // generous global cap so a single attacker can't lock out every agent.
    // We compute the per-identity key after decoding the agent identity
    // (further below) — an outer global cap guards against pre-decode flood.
    const { checkAndRecordAttempt, resetRateLimit } = await import('@/lib/rate-limit')
    const globalCheck = checkAndRecordAttempt('aid-token-exchange:global', 200)
    if (!globalCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many token exchange attempts. Try again later.' },
        { status: 429 }
      )
    }

    const body = await request.json()

    // 1. Validate grant_type
    if (body.grant_type !== 'urn:aid:agent-identity') {
      return NextResponse.json(
        { error: 'unsupported_grant_type', message: 'Only urn:aid:agent-identity is supported' },
        { status: 400 }
      )
    }

    // 2. Validate required fields
    if (!body.agent_identity || !body.proof) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'agent_identity and proof are required' },
        { status: 400 }
      )
    }

    // 3. Decode Agent Identity document
    let identity: {
      aid_version?: string
      address?: string
      alias?: string
      public_key?: string
      key_algorithm?: string
      fingerprint?: string
    }
    try {
      const identityJson = Buffer.from(body.agent_identity, 'base64url').toString('utf-8')
      identity = JSON.parse(identityJson)
    } catch {
      return NextResponse.json(
        { error: 'invalid_identity', message: 'Failed to decode agent_identity (expected base64url JSON)' },
        { status: 400 }
      )
    }

    if (!identity.fingerprint && !identity.alias) {
      return NextResponse.json(
        { error: 'invalid_identity', message: 'Agent identity must contain fingerprint or alias' },
        { status: 400 }
      )
    }

    // API2-MAJ-05: per-identity rate limit (30/min). A single attacker
    // brute-forcing one fingerprint cannot starve other agents of token
    // exchange, and resetRateLimit on success affects only this identity.
    const identityKey = `aid-token-exchange:${identity.fingerprint || identity.alias || 'unknown'}`
    const identityCheck = checkAndRecordAttempt(identityKey, 30)
    if (!identityCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many token exchange attempts for this identity. Try again later.' },
        { status: 429 }
      )
    }

    // 4. Look up agent by fingerprint (primary) or by name (fallback)
    const { loadAgents, getAgentByName } = await import('@/lib/agent-registry')
    let agent: { id: string; name: string; governanceTitle?: string | null; metadata?: Record<string, unknown> } | null = null

    // Try fingerprint first (most reliable — cryptographic identity)
    if (identity.fingerprint) {
      const allAgents = loadAgents()
      agent = allAgents.find(a => {
        const ampMeta = a.metadata?.amp as Record<string, unknown> | undefined
        return ampMeta?.fingerprint === identity.fingerprint
      }) || null
    }

    // Fallback to name match
    if (!agent && identity.alias) {
      agent = getAgentByName(identity.alias) as typeof agent
    }

    if (!agent) {
      return NextResponse.json(
        { error: 'agent_not_found', message: `No registered agent matches fingerprint or alias` },
        { status: 404 }
      )
    }

    // 5. Load the agent's stored public key for verification
    const keyPair = loadKeyPair(agent.id)
    if (!keyPair) {
      return NextResponse.json(
        { error: 'no_keypair', message: 'Agent has no Ed25519 keypair registered' },
        { status: 401 }
      )
    }

    // 6. Verify NONCE-bound proof-of-possession (TRDD-15ff13ae).
    // The server URL is what the agent signed — use localhost only.
    // SECURITY: Never trust x-forwarded-host for proof verification.
    // An attacker could set x-forwarded-host to a domain they control,
    // then replay a proof signed for that domain.
    const serverUrl = `http://localhost:${process.env.PORT || 23000}`

    // Authenticate FIRST (Ed25519 over the server nonce), then consume the
    // nonce — authenticate-before-consume, so a caller who cannot produce a
    // valid proof can never burn a nonce.
    const proofResult = verifyNonceProofWithPublicKeyHex(body.proof, keyPair.publicHex, serverUrl)
    if (!proofResult.valid || !proofResult.nonce) {
      console.warn(`[AID Token] Proof verification failed for agent ${agent.name}: ${proofResult.error}`)
      return NextResponse.json(
        { error: 'invalid_proof', message: proofResult.error || 'Ed25519 signature verification failed' },
        { status: 401 }
      )
    }

    // 6b. Consume the server-issued nonce — SINGLE-USE + subject-bound.
    // This is the anti-replay gate: the nonce was issued by
    // POST /api/v1/auth/challenge, bound to the CLAIMED fingerprint, with a
    // short TTL. consumeNonce() atomically deletes it, so a replay of this
    // exact proof (same nonce) is rejected here ('unknown'), and the presented
    // fingerprint must match the nonce's binding (authz-hole pattern 5:
    // one-shot token bound to operation+subject; the operation is bound by the
    // "aid-token-exchange" signing-input prefix the verifier enforces).
    // We bind on the CLAIMED fingerprint (identity.fingerprint) — the same
    // value the client sent to the challenge endpoint — NOT on the resolved
    // agent id, so no agent-existence is leaked at challenge time. The
    // registered-key Ed25519 verify above is what proves the claim.
    const consumed = consumeNonce(proofResult.nonce, identity.fingerprint || '')
    if (!consumed.ok) {
      console.warn(`[AID Token] Nonce rejected for agent ${agent.name}: ${consumed.reason}`)
      return NextResponse.json(
        { error: 'invalid_nonce', message: `Challenge nonce ${consumed.reason} — request a fresh challenge` },
        { status: 401 }
      )
    }

    // 7. Resolve governance context
    // R34: `let` (not const) so the R34.1/R33 block below can override it with
    // the ledger-reconstructed title when recovery is used (the ledger BEATS the
    // registry on divergence — "ultimate source of truth").
    let governanceTitle = (agent.governanceTitle as string) || 'autonomous'

    // Find the team this agent belongs to
    let teamId: string | null = null
    const teams = loadTeams()
    for (const team of teams) {
      if (
        team.agentIds.includes(agent.id) ||
        team.chiefOfStaffId === agent.id ||
        team.orchestratorId === agent.id
      ) {
        teamId = team.id
        break
      }
    }

    // 7b. R34.1 ledger gate + R33 recovery fallback (decision D5, staged).
    // When ledger.enforceAidAssociation is OFF (default) this block is SKIPPED
    // entirely — the token is minted exactly as before (zero regression). When
    // ON: an AID whose fingerprint has no signed-ledger association to THIS agent
    // is refused (R34.1); if the live token store was lost but the ledger still
    // proves the binding, we reconstruct {title,team} from the ledger (R33) and
    // mint with those AUTHORITATIVE values.
    {
      const { loadSecurityConfig } = await import('@/lib/security-config')
      if (loadSecurityConfig().ledger.enforceAidAssociation) {
        const fp = (agent.metadata?.amp as Record<string, unknown> | undefined)?.fingerprint as string | undefined
        const { isAidAssociated, reconstructAgentAuthState } = await import('@/lib/aid-ledger-authority')
        const assoc = fp ? isAidAssociated(fp) : { ok: false as const }
        if (!assoc.ok || assoc.agentId !== agent.id || assoc.revoked) {
          // Not backed by a current association → try the R33 recovery path.
          const recovered = fp ? reconstructAgentAuthState(fp) : null
          if (!recovered || recovered.agentId !== agent.id) {
            return NextResponse.json(
              {
                error: 'aid_no_ledger_history',
                message: 'AID has no signed-ledger association on this host; refused (R34.1).',
              },
              { status: 403 }
            )
          }
          // R34: the ledger is the ultimate source of truth — its reconstructed
          // title/team override the (possibly tampered/stale) registry values.
          governanceTitle = recovered.governanceTitle
          teamId = recovered.teamId
        }
      }
    }

    // API2-MIN-05: this route currently uses manual `if (!body.foo)` field
    // checks instead of a Zod schema. Manual validation works but is more
    // brittle than a `.strict()` schema — adding a new field would have
    // to be remembered at every check site. A future refactor should
    // migrate the body to a `z.object({...}).strict()` schema (mirroring
    // the rest of the v1 routes); the validation gates below would then
    // be replaced by a single `parsed.success` check at the entry point.
    // Tracked as round-2 minor; not blocking.
    //
    // Validate scope is a string if provided; reject non-string values to prevent injection
    const rawScope = body.scope
    if (rawScope !== undefined && typeof rawScope !== 'string') {
      return NextResponse.json(
        { error: 'invalid_request', message: 'scope must be a string' },
        { status: 400 }
      )
    }
    const scope = (typeof rawScope === 'string' && rawScope) ? rawScope : 'governance'

    // 8. Issue token (async — persists to file under lock)
    const tokenResult = await issueGovernanceToken(
      agent.id,
      agent.name,
      governanceTitle,
      teamId,
      scope
    )

    // Reset only the per-identity bucket on success. The global bucket
    // intentionally is NOT reset so a successful exchange doesn't grant
    // the laundering window the audit flagged (API2-MAJ-05).
    resetRateLimit(identityKey)
    console.log(`[AID Token] Issued aim_tk_ token for agent "${agent.name}" (title=${governanceTitle}, team=${teamId || 'none'})`)

    const response = NextResponse.json(tokenResult)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[AID Token] Token exchange error: ${msg}`)
    return NextResponse.json(
      { error: 'server_error', message: 'Internal server error during token exchange' },
      { status: 500 }
    )
  }
}
