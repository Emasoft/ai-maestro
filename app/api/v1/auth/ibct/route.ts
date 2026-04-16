import { NextResponse } from 'next/server'
import { verifyProofWithPublicKeyHex } from '@/lib/aid-token'
import { loadKeyPair } from '@/lib/amp-keys'
import { loadTeams } from '@/lib/team-registry'
import { getAgent, getAgentByName } from '@/lib/agent-registry'
import { createCompactIbct, governanceScopeForTitle } from '@/lib/ibct'

const SERVER_URL = `http://localhost:${process.env.PORT || 23000}`

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (body.grant_type !== 'urn:aip:ibct') {
      return NextResponse.json(
        { error: 'unsupported_grant_type', message: 'Only urn:aip:ibct is supported' },
        { status: 400 }
      )
    }

    if (!body.agent_identity || !body.proof) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'agent_identity and proof are required' },
        { status: 400 }
      )
    }

    let identity: { address?: string; public_key?: string }
    try {
      identity = typeof body.agent_identity === 'string'
        ? JSON.parse(Buffer.from(body.agent_identity, 'base64').toString('utf-8'))
        : body.agent_identity
    } catch {
      return NextResponse.json(
        { error: 'invalid_identity', message: 'Could not decode agent_identity' },
        { status: 400 }
      )
    }

    if (!identity.public_key) {
      return NextResponse.json(
        { error: 'invalid_identity', message: 'public_key is required in identity' },
        { status: 400 }
      )
    }

    const verified = verifyProofWithPublicKeyHex(body.proof, identity.public_key, SERVER_URL)
    if (!verified) {
      return NextResponse.json(
        { error: 'invalid_proof', message: 'Proof of possession failed' },
        { status: 401 }
      )
    }

    const agentName = identity.address?.split('@')[0]
    if (!agentName) {
      return NextResponse.json(
        { error: 'invalid_identity', message: 'address is required' },
        { status: 400 }
      )
    }

    const keys = loadKeyPair(agentName)
    if (!keys) {
      return NextResponse.json(
        { error: 'unknown_agent', message: `No keys found for agent "${agentName}"` },
        { status: 404 }
      )
    }

    const agent = getAgent(agentName) ?? getAgentByName(agentName)
    const title = agent?.governanceTitle ?? 'autonomous'

    const teams = loadTeams()
    const agentTeam = agent ? teams.find(t => t.agentIds.includes(agent.id)) : null
    const scope = governanceScopeForTitle(title)

    const ibct = await createCompactIbct(
      `aip:key:ed25519:${agentName}`,
      scope,
      3,
      3600,
      agentTeam ? `team:${agentTeam.name}` : undefined,
    )

    return NextResponse.json({
      token_type: 'aip+jwt',
      access_token: ibct.token,
      expires_in: 3600,
      scope: ibct.claims.scope,
      issuer: ibct.claims.iss,
      subject: ibct.claims.sub,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: 'server_error', message: msg },
      { status: 500 }
    )
  }
}
