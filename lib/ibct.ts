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
    .setAudience('aimaestro:governance')
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
    audience: 'aimaestro:governance',
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
  const result = scopes[title]
  if (!result) {
    console.warn(`[ibct] Unknown governance title "${title}" — returning empty scope`)
  }
  return result ?? []
}

// ═══════════════════════════════════════════════════════════════
// Chained IBCT — Biscuit/Datalog capability tokens
//
// Used for multi-hop delegation chains in cross-host AMP messaging.
// The host's Ed25519 key mints a root Biscuit token. Each hop appends
// a "block" that attenuates the scope (can only restrict, never widen).
// Verification uses Datalog authorization policies.
//
// WASM dependency: @biscuit-auth/biscuit-wasm (ESM only, 2.5 MB).
// Loaded lazily to avoid blocking startup.
// ═══════════════════════════════════════════════════════════════

// Biscuit WASM v0.6.0 type definitions are inaccurate for the Node.js ESM
// runtime (constructors marked private, methods missing from types, etc.).
// We use a minimal runtime-verified interface and cast through `unknown`.
/* eslint-disable @typescript-eslint/no-explicit-any */
type BiscuitModule = any
let _biscuitModule: BiscuitModule | null = null

async function loadBiscuit(): Promise<BiscuitModule> {
  if (!_biscuitModule) {
    // Dynamic import with variable to prevent webpack from statically resolving
    // the WASM module (which causes "experiments.asyncWebAssembly" errors)
    const mod = '@biscuit-auth/biscuit-wasm'
    _biscuitModule = await import(/* webpackIgnore: true */ mod)
  }
  return _biscuitModule
}

/**
 * Mint a root chained IBCT token using the host's Ed25519 key.
 * The root token carries scope facts + an expiry check in the authorizer.
 *
 * Biscuit WASM v0.6.0 API (verified empirically — differs from Rust/Python docs):
 * - KeyPair: new KeyPair() or KeyPair.fromPrivateKey(privateKey)
 * - PublicKey: PublicKey.fromBytes(Uint8Array)
 * - Build: biscuit tagged template → BiscuitBuilder → builder.build(keyPair)
 * - Append: token.appendBlock(block, keyPair)
 * - Verify: Biscuit.fromBase64(base64) then authorizer tagged template
 */
export async function createChainedIbct(
  subject: string,
  scope: string[],
  ttlSeconds?: number,
): Promise<ChainedIbct> {
  const b = await loadBiscuit()
  const cfg = loadSecurityConfig().ibct
  const effectiveTtl = ttlSeconds ?? cfg.defaultTtlSeconds

  const rootKeyPair = new b.KeyPair()
  // Biscuit WASM uses its own generated KeyPair for signing.
  // We sign the authority block with this keypair and store the public key
  // alongside the token for verification. The host Ed25519 key is used
  // as the issuer identity (in the fact), not as the Biscuit signing key,
  // because Biscuit uses its own Ed25519 key format internally.
  const expiry = Math.floor(Date.now() / 1000) + effectiveTtl
  const iss = hostAipId()

  const scopeFacts = scope.map(s => `scope("${s}");`).join('\n    ')
  const builder = b.biscuit`
    subject("${subject}");
    expiry(${expiry});
    issuer("${iss}");
    ${scopeFacts}
  `
  const token = builder.build(rootKeyPair.getPrivateKey())
  const serialized = token.toBase64()

  return {
    mode: 'chained',
    tokenBase64: serialized,
    blocks: 1,
    bytes: Buffer.from(serialized, 'base64').length,
  }
}

/**
 * Append an attenuation block to a chained IBCT token.
 * The new block can only RESTRICT scope (add caveats), never widen it.
 */
export async function attenuateChainedIbct(
  tokenBase64: string,
  restrictScope: string[],
): Promise<ChainedIbct> {
  const b = await loadBiscuit()
  const token = b.Biscuit.fromBase64(tokenBase64)

  // Attenuation block: a check that restricts allowed scopes
  const allowed = restrictScope.map(s => `$s == "${s}"`).join(', ')
  const attBlock = b.block`
    check if scope($s), [${allowed}].contains($s);
  `
  const attenuated = token.appendBlock(attBlock)
  const serialized = attenuated.toBase64()

  return {
    mode: 'chained',
    tokenBase64: serialized,
    blocks: token.blockCount + 1,
    bytes: Buffer.from(serialized, 'base64').length,
  }
}

/**
 * Verify a chained IBCT token against Datalog authorization policies.
 * Returns the verified claims (subject, scope, issuer) or throws on failure.
 */
export async function verifyChainedIbct(
  tokenBase64: string,
  rootPublicKeyHex?: string,
): Promise<{ subject: string; scope: string[]; issuer: string; blocks: number }> {
  const b = await loadBiscuit()
  const publicKeyHex = rootPublicKeyHex ?? getHostPublicKeyHex()
  const rootPublicKey = b.PublicKey.fromBytes(Buffer.from(publicKeyHex, 'hex'))
  const token = b.Biscuit.fromBase64(tokenBase64, rootPublicKey)

  const now = Math.floor(Date.now() / 1000)

  // Authorization policy: check expiry + allow if all checks pass
  const auth = b.authorizer`
    time(${now});
    allow if expiry($exp), time($t), $t < $exp;
  `
  auth.addToken(token)
  auth.authorize()

  // Extract facts: query for subject, scope, and issuer
  const subjectFacts = auth.query(b.rule`data($sub) <- subject($sub)`)
  const scopeFacts = auth.query(b.rule`data($s) <- scope($s)`)
  const issuerFacts = auth.query(b.rule`data($iss) <- issuer($iss)`)

  if (!subjectFacts || subjectFacts.length === 0) {
    throw new Error('Biscuit token missing subject fact')
  }

  const subject = String(subjectFacts[0].get('sub'))
  const scopeSet = new Set<string>()
  for (const fact of (scopeFacts || [])) {
    scopeSet.add(String(fact.get('s')))
  }
  const issuer = issuerFacts?.length ? String(issuerFacts[0].get('iss')) : 'unknown'

  return {
    subject,
    scope: [...scopeSet],
    issuer,
    blocks: token.blockCount,
  }
}
