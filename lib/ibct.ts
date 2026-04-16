import * as jose from 'jose'
import crypto from 'crypto'
import { getOrCreateHostKeyPair, getHostPublicKeyHex } from '@/lib/host-keys'
import { loadSecurityConfig } from '@/lib/security-config'

export type IbctMode = 'compact' | 'chained'

export interface CompactClaims {
  iss: string
  sub: string
  scope: string[]
  max_depth: number
  context?: string
}

export interface CompactIbct {
  mode: 'compact'
  token: string
  claims: CompactClaims & { exp: number; iat: number }
}

export interface ChainedIbct {
  mode: 'chained'
  tokenBase64: string
  blocks: number
  bytes: number
}

function hostAipId(): string {
  const pubHex = getHostPublicKeyHex()
  const fingerprint = crypto.createHash('blake2b512')
    .update(pubHex)
    .digest()
    .subarray(0, 32)
    .toString('hex')
    .substring(0, 32)
  return `aip:key:ed25519:${fingerprint}`
}

function derToJosePrivateKey(privateKeyHex: string): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  })
}

function derToJosePublicKey(publicKeyHex: string): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.from(publicKeyHex, 'hex'),
    format: 'der',
    type: 'spki',
  })
}

export async function createCompactIbct(
  subject: string,
  scope: string[],
  maxDepth?: number,
  ttlSeconds?: number,
  context?: string,
): Promise<CompactIbct> {
  const cfg = loadSecurityConfig().ibct
  const effectiveTtl = ttlSeconds ?? cfg.defaultTtlSeconds
  const effectiveDepth = maxDepth ?? cfg.maxDelegationDepth
  const { privateKeyHex } = getOrCreateHostKeyPair()
  const privateKey = derToJosePrivateKey(privateKeyHex)
  const issuer = hostAipId()

  const payload: Record<string, unknown> = {
    scope,
    max_depth: effectiveDepth,
  }
  if (context) payload.context = context

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'aip+jwt' })
    .setIssuer(issuer)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${effectiveTtl}s`)
    .sign(privateKey)

  const decoded = jose.decodeJwt(token)

  return {
    mode: 'compact',
    token,
    claims: {
      iss: issuer,
      sub: subject,
      scope,
      max_depth: effectiveDepth,
      context,
      exp: decoded.exp as number,
      iat: decoded.iat as number,
    },
  }
}

export async function verifyCompactIbct(
  token: string,
  issuerPublicKeyHex?: string,
): Promise<CompactClaims & { exp: number; iat: number }> {
  const publicKeyHex = issuerPublicKeyHex ?? getHostPublicKeyHex()
  const publicKey = derToJosePublicKey(publicKeyHex)

  const { payload } = await jose.jwtVerify(token, publicKey, {
    typ: 'aip+jwt',
    algorithms: ['EdDSA'],
  })

  return {
    iss: payload.iss as string,
    sub: payload.sub as string,
    scope: payload.scope as string[],
    max_depth: payload.max_depth as number,
    context: payload.context as string | undefined,
    exp: payload.exp as number,
    iat: payload.iat as number,
  }
}

export function governanceScopeForTitle(title: string): string[] {
  const scopes: Record<string, string[]> = {
    manager: [
      'agent:create', 'agent:delete', 'agent:wake', 'agent:hibernate',
      'team:create', 'team:delete', 'team:manage',
      'title:change', 'title:assign',
      'message:broadcast', 'message:any',
      'plugin:install', 'plugin:uninstall',
      'governance:configure',
    ],
    'chief-of-staff': [
      'agent:wake', 'agent:hibernate',
      'team:manage',
      'message:team', 'message:any',
      'plugin:install', 'plugin:uninstall',
    ],
    orchestrator: [
      'agent:wake', 'agent:hibernate',
      'message:team',
      'task:assign', 'task:create',
    ],
    architect: [
      'message:cos', 'message:orchestrator',
    ],
    integrator: [
      'message:cos', 'message:orchestrator',
    ],
    member: [
      'message:cos', 'message:orchestrator',
    ],
    maintainer: [
      'repo:read', 'repo:write', 'repo:publish',
      'issue:triage', 'issue:fix',
      'message:manager', 'message:cos',
    ],
    autonomous: [
      'message:manager', 'message:cos', 'message:autonomous',
    ],
  }
  return scopes[title] ?? []
}
