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
 *   - rpID: 'localhost' (WebAuthn Level 3 supports localhost without SSL)
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
// LIB2-MIN-04: RP_ID and ORIGIN are hardcoded to `localhost`. WebAuthn
// REQUIRES that the relying-party ID match the page's effective domain
// at registration AND authentication time. This means passkeys ONLY
// work when the user accesses the dashboard via `http://localhost:23000`.
// Tailscale-routed access (e.g. `http://100.99.233.43:23000` or a
// `*.ts.net` MagicDNS hostname) cannot use passkeys with this config —
// the browser will reject the credential because the RP_ID doesn't match
// the URL's hostname.
//
// To enable passkeys over Tailscale, this would need to derive RP_ID
// from `request.headers.host` (with a strict allow-list of permissible
// hostnames to prevent RP-spoofing attacks). The allow-list MUST include
// localhost and the user's Tailscale hostnames; arbitrary host headers
// MUST be rejected. Given Tailscale traffic is end-to-end encrypted
// inside the VPN, the practical risk of NOT supporting passkeys over
// Tailscale is low — operators can use the governance password as a
// fallback. Document the limitation; do not silently widen the allow-
// list without security review.
const RP_ID = 'localhost'
const ORIGIN = 'http://localhost:23000'
const CHALLENGE_TTL_MS = 60_000 // 60 seconds
const USER_ID = 'system-owner'
const USER_DISPLAY_NAME = 'System Owner'

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
export async function generateWebAuthnRegistrationOptions() {
  const existingCreds = loadCredentials()

  const excludeCredentials = existingCreds.map(c => ({
    id: c.credentialID,
    transports: c.transports as AuthenticatorTransportFuture[],
  }))

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
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
) {
  // If no explicit challenge provided, consume from store
  const challenge = expectedChallenge ?? consumeChallenge(USER_ID)
  if (!challenge) {
    throw new Error('webauthn_challenge_expired: no pending challenge found or challenge expired')
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
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
export async function generateWebAuthnAuthenticationOptions() {
  const existingCreds = loadCredentials()

  const allowCredentials = existingCreds.map(c => ({
    id: c.credentialID,
    transports: c.transports as AuthenticatorTransportFuture[],
  }))

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
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

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
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
