/**
 * WebAuthn / Passkey Server-Side Module
 *
 * Handles credential registration and authentication using the WebAuthn
 * Level 3 protocol. Credentials are stored in ~/.aimaestro/webauthn-credentials.json
 * with 0o600 permissions (owner read/write only).
 *
 * Challenge lifecycle:
 *   1. Client requests options (GET) -> server generates challenge, stores in memory with 60s TTL
 *   2. Client performs navigator.credentials.create/get() -> sends response (POST)
 *   3. Server consumes challenge from memory (one-shot) and verifies the response
 *
 * RP configuration:
 *   - rpID / origin: DERIVED per-request from the Host header by
 *     resolveWebAuthnRp() against a strict allow-list (localhost always; one
 *     optional `*.ts.net` host via AIM_WEBAUTHN_TS_HOST). With no host threaded
 *     — and for every localhost request — it returns `localhost` /
 *     `http://localhost:23000`, so single-operator behaviour is byte-identical
 *     to the previous hardcode. TRDD-OC9ELGSO P2.
 *   - rpName: 'AI Maestro'
 *   - User: single system-owner (no multi-user)
 *
 * Supported algorithms: ES256 (-7), RS256 (-257)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types'
import { getStateDir } from '@/lib/ecosystem-constants'

// ============================================================================
// Constants
// ============================================================================

const CREDENTIALS_FILENAME = 'webauthn-credentials.json'
const RP_NAME = 'AI Maestro'
// TRDD-OC9ELGSO P2: rpId + origin are DERIVED per-request from the Host header
// by resolveWebAuthnRp() (below), against a strict allow-list. These two
// localhost defaults are exactly what that resolver returns for a localhost
// request (and when no host is threaded), so single-operator behaviour is
// byte-identical to the previous hardcode until a `*.ts.net` host is added to
// the allow-list via the AIM_WEBAUTHN_TS_HOST env var. Deriving instead of
// hardcoding is what lets a passkey work over Tailscale HTTPS without letting a
// forged Host header bind a credential to a foreign relying party.
const RP_ID_LOCALHOST = 'localhost'
const ORIGIN_LOCALHOST = 'http://localhost:23000'
const CHALLENGE_TTL_MS = 60_000 // 60 seconds
const USER_ID = 'system-owner'
const USER_DISPLAY_NAME = 'System Owner'

// ============================================================================
// Relying-Party resolution (TRDD-OC9ELGSO P2) — host-derived rpId + origin
// ============================================================================

export interface WebAuthnRp {
  /** WebAuthn relying-party ID — a bare hostname, never a scheme / port / IP. */
  rpId: string
  /** Expected origin (scheme + host + port); MUST equal the browser's origin. */
  origin: string
}

// Env var holding the ONE allowed `*.ts.net` host. EMPTY by default.
const TS_HOST_ENV = 'AIM_WEBAUTHN_TS_HOST'

/**
 * A syntactically valid Tailscale MagicDNS host: DNS labels ending in `.ts.net`,
 * with NO scheme, port, path, or userinfo. Used to validate the CONFIGURED host
 * so a malformed env var can never widen the allow-list beyond localhost.
 */
function isValidTsHost(host: string): boolean {
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+ts\.net$/.test(host)
}

/**
 * The single configured `*.ts.net` host, read from AIM_WEBAUTHN_TS_HOST. EMPTY
 * by default ⇒ only `localhost` resolves ⇒ behaviour identical to the historical
 * hardcode. A malformed value is IGNORED — it must never widen the allow-list,
 * and a bad env var must never break localhost login. FAIL CLOSED to localhost.
 */
export function getAllowedTsHost(): string | undefined {
  const raw = process.env[TS_HOST_ENV]?.trim().toLowerCase()
  if (!raw) return undefined
  return isValidTsHost(raw) ? raw : undefined
}

/**
 * Derive the WebAuthn relying-party {rpId, origin} from the request Host header
 * against a STRICT allow-list. FAIL CLOSED: a host not on the list THROWS.
 *
 *   - `localhost` (ALWAYS)  → { rpId: 'localhost', origin: 'http://localhost:<port>' }
 *       localhost is a WebAuthn "secure context" over plain HTTP.
 *   - the ONE configured `*.ts.net` host (when `allowedTsHost` is set) →
 *       { rpId: '<host>.ts.net', origin: 'https://<host>.ts.net:<port>' }
 *       a real registrable domain requires HTTPS (a secure context).
 *
 * REJECTED (throws `webauthn_host_not_allowed`):
 *   - a bare IP host (e.g. `100.99.233.43`) — an IP is NOT a valid WebAuthn RP_ID
 *     per spec, so it can never be an allowed relying party;
 *   - ANY host that is neither `localhost` nor THE configured `*.ts.net` name —
 *     the anti-RP-spoofing guard, so a forged Host cannot bind a credential to a
 *     foreign relying party.
 *
 * When `hostHeader` is absent the localhost default is returned unchanged, so a
 * caller that does not thread the host — and every localhost request — behaves
 * exactly as the previous hardcode did.
 */
export function resolveWebAuthnRp(
  hostHeader?: string | null,
  allowedTsHost?: string,
): WebAuthnRp {
  const header = hostHeader?.trim()
  if (!header) {
    // No host to derive from ⇒ historical localhost default (byte-identical).
    return { rpId: RP_ID_LOCALHOST, origin: ORIGIN_LOCALHOST }
  }

  // Parse via URL so ports and IPv6 brackets are handled uniformly. An
  // unparseable Host is REJECTED (fail closed), never silently defaulted.
  let hostname: string
  let port: string
  try {
    const u = new URL(`http://${header}`)
    hostname = u.hostname.toLowerCase()
    port = u.port
  } catch {
    throw new Error(`webauthn_host_not_allowed: unparseable Host "${header}"`)
  }

  if (hostname === 'localhost') {
    // Keep plain HTTP — localhost is a secure context without TLS.
    return {
      rpId: RP_ID_LOCALHOST,
      origin: port ? `http://localhost:${port}` : 'http://localhost',
    }
  }

  const allowed = allowedTsHost?.trim().toLowerCase()
  if (allowed && isValidTsHost(allowed) && hostname === allowed) {
    // A real registrable domain over Tailscale HTTPS. rpId is the bare hostname.
    return {
      rpId: hostname,
      origin: port ? `https://${hostname}:${port}` : `https://${hostname}`,
    }
  }

  // Bare IP, unknown hostname, or a non-configured `*.ts.net` — all rejected.
  throw new Error(
    `webauthn_host_not_allowed: host "${hostname}" is not on the WebAuthn allow-list`,
  )
}

/** Resolve {rpId, origin} for a request using the env-configured allow-list. */
function resolveRp(hostHeader?: string | null): WebAuthnRp {
  return resolveWebAuthnRp(hostHeader, getAllowedTsHost())
}

// ============================================================================
// Types
// ============================================================================

export interface StoredCredential {
  credentialID: string
  credentialPublicKey: string // base64url-encoded
  counter: number
  transports: string[]
  createdAt: string // ISO 8601
  label: string
}

interface ChallengeRecord {
  challenge: string
  expiresAt: number
}

// ============================================================================
// In-Memory Challenge Store (same globalThis pattern as sudo-auth.ts)
// ============================================================================

interface WebAuthnGlobals {
  __aiMaestroWebAuthnChallenges?: Map<string, ChallengeRecord>
}

const g = globalThis as unknown as WebAuthnGlobals
const challenges: Map<string, ChallengeRecord> =
  g.__aiMaestroWebAuthnChallenges ?? new Map<string, ChallengeRecord>()
if (!g.__aiMaestroWebAuthnChallenges) g.__aiMaestroWebAuthnChallenges = challenges

function sweepChallenges(): void {
  const now = Date.now()
  for (const [key, rec] of challenges.entries()) {
    if (rec.expiresAt <= now) challenges.delete(key)
  }
}

// ============================================================================
// Challenge Operations
// ============================================================================

/**
 * Store a challenge for a user. Overwrites any existing challenge for that user.
 * Challenge expires after CHALLENGE_TTL_MS (60s).
 */
export function storeChallenge(userId: string, challenge: string): void {
  sweepChallenges()
  challenges.set(userId, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  })
}

/**
 * Consume a challenge for a user. Returns the challenge string if valid and
 * not expired, or null otherwise. One-shot: the challenge is deleted after
 * consumption.
 */
export function consumeChallenge(userId: string): string | null {
  sweepChallenges()
  const rec = challenges.get(userId)
  if (!rec) return null
  challenges.delete(userId)
  if (rec.expiresAt <= Date.now()) return null
  return rec.challenge
}

// ============================================================================
// Credential File Operations
// ============================================================================

/** Returns the absolute path to the credentials file. */
export function getCredentialFilePath(): string {
  return path.join(getStateDir(), CREDENTIALS_FILENAME)
}

/**
 * Load all stored WebAuthn credentials from disk.
 * Returns an empty array if the file does not exist.
 */
export function loadCredentials(): StoredCredential[] {
  const filePath = getCredentialFilePath()
  if (!fs.existsSync(filePath)) return []
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed as StoredCredential[]
}

/**
 * Save a new credential to disk. Uses atomic write (tmp + rename).
 * Throws if a credential with the same ID already exists.
 */
export function saveCredential(cred: StoredCredential): void {
  const existing = loadCredentials()
  if (existing.some(c => c.credentialID === cred.credentialID)) {
    throw new Error(`webauthn_duplicate: credential with ID "${cred.credentialID}" already exists`)
  }
  existing.push(cred)
  writeCredentials(existing)
}

/**
 * Delete a credential by its ID.
 * Returns true if the credential was found and deleted, false otherwise.
 */
export function deleteCredential(credentialID: string): boolean {
  const existing = loadCredentials()
  const filtered = existing.filter(c => c.credentialID !== credentialID)
  if (filtered.length === existing.length) return false
  writeCredentials(filtered)
  return true
}

/**
 * Update the counter for a credential after successful authentication.
 * Throws if the credential is not found.
 */
export function updateCredentialCounter(credentialID: string, newCounter: number): void {
  const existing = loadCredentials()
  const idx = existing.findIndex(c => c.credentialID === credentialID)
  if (idx === -1) {
    throw new Error(`webauthn_not_found: credential "${credentialID}" not found`)
  }
  existing[idx].counter = newCounter
  writeCredentials(existing)
}

/** Atomic write: write to tmp file, then rename. Sets 0o600 permissions. */
function writeCredentials(creds: StoredCredential[]): void {
  const filePath = getCredentialFilePath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  // Ensure final file also has correct permissions (rename preserves tmp perms,
  // but be explicit for defense in depth)
  fs.chmodSync(filePath, 0o600)
}

// ============================================================================
// Registration
// ============================================================================

/**
 * Generate WebAuthn registration options for the system owner.
 * Excludes already-registered credentials to prevent duplicate registration.
 */
export async function generateWebAuthnRegistrationOptions(hostHeader?: string | null) {
  const existingCreds = loadCredentials()
  const { rpId } = resolveRp(hostHeader)

  const excludeCredentials = existingCreds.map(c => ({
    id: c.credentialID,
    transports: c.transports as AuthenticatorTransportFuture[],
  }))

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: USER_ID,
    userDisplayName: USER_DISPLAY_NAME,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257], // ES256, RS256
  })

  // Store the challenge for later verification
  storeChallenge(USER_ID, options.challenge)

  return options
}

/**
 * Verify a registration response from the browser.
 * Returns the verified credential data on success, throws on failure.
 */
export async function verifyWebAuthnRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge?: string,
  hostHeader?: string | null,
) {
  // If no explicit challenge provided, consume from store
  const challenge = expectedChallenge ?? consumeChallenge(USER_ID)
  if (!challenge) {
    throw new Error('webauthn_challenge_expired: no pending challenge found or challenge expired')
  }

  const { rpId, origin } = resolveRp(hostHeader)

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: false,
  })

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('webauthn_verification_failed: registration response verification failed')
  }

  return verification.registrationInfo
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Generate WebAuthn authentication options.
 * Includes all registered credentials as allowCredentials.
 */
export async function generateWebAuthnAuthenticationOptions(hostHeader?: string | null) {
  const existingCreds = loadCredentials()
  const { rpId } = resolveRp(hostHeader)

  const allowCredentials = existingCreds.map(c => ({
    id: c.credentialID,
    transports: c.transports as AuthenticatorTransportFuture[],
  }))

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials,
    userVerification: 'preferred',
  })

  // Store the challenge for later verification
  storeChallenge(USER_ID, options.challenge)

  return options
}

/**
 * Verify an authentication response from the browser.
 * Returns the updated credential info on success, throws on failure.
 */
export async function verifyWebAuthnAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge?: string,
  hostHeader?: string | null,
) {
  const challenge = expectedChallenge ?? consumeChallenge(USER_ID)
  if (!challenge) {
    throw new Error('webauthn_challenge_expired: no pending challenge found or challenge expired')
  }

  // Find the credential being used
  const existingCreds = loadCredentials()
  const matchingCred = existingCreds.find(c => c.credentialID === response.id)
  if (!matchingCred) {
    throw new Error('webauthn_unknown_credential: credential not found in store')
  }

  // Decode the stored public key from base64url back to Uint8Array
  const publicKeyBytes = Buffer.from(matchingCred.credentialPublicKey, 'base64url')

  const credential = {
    id: matchingCred.credentialID,
    publicKey: new Uint8Array(publicKeyBytes.buffer, publicKeyBytes.byteOffset, publicKeyBytes.byteLength),
    counter: matchingCred.counter,
    transports: matchingCred.transports as AuthenticatorTransportFuture[],
  }

  const { rpId, origin } = resolveRp(hostHeader)

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    credential,
    requireUserVerification: false,
  })

  if (!verification.verified) {
    throw new Error('webauthn_verification_failed: authentication response verification failed')
  }

  // Update the counter
  updateCredentialCounter(matchingCred.credentialID, verification.authenticationInfo.newCounter)

  return verification.authenticationInfo
}

/**
 * Check if any passkeys are registered for the system owner.
 */
export function hasRegisteredCredentials(): boolean {
  return loadCredentials().length > 0
}
