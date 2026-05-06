import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'

const CONFIG_PATH = path.join(getStateDir(), 'security-config.enc')
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
// LIB2-MIN-02: IV_LENGTH is 16 bytes (NIST SP 800-38D recommends 12 bytes
// / 96 bits for AES-GCM). Node accepts 16-byte IVs, and our IV is randomly
// generated per encrypt so collision probability is negligible at any
// realistic scale. The length is fixed at 16 because every existing
// encrypted security-config.enc on disk has a 16-byte IV prefix — changing
// to 12 would require a migration that re-encrypts the config under the
// new IV size. If a future security review wants the standard 12-byte IV,
// add a version field to the encrypted blob and migrate; do NOT just flip
// this constant or every existing deployment will fail to decrypt.
const IV_LENGTH = 16
const SALT_LENGTH = 32
const HKDF_INFO = 'aimaestro-security-config-v1'

export interface SecurityConfig {
  keyRotation: {
    intervalDays: number
    overlapDays: number
  }
  argon2: {
    memoryCost: number
    timeCost: number
    parallelism: number
  }
  ibct: {
    defaultTtlSeconds: number
    maxDelegationDepth: number
  }
  ledger: {
    readOnlyOnTamper: boolean
    verifyOnStartup: boolean
    maxEntriesPerFile: number
    compactAfterEntries: number
  }
  passwordPolicy: {
    minLength: number
    maxLength: number
  }
  sessionAuth: {
    sessionTtlDays: number
    sudoTokenTtlSeconds: number
  }
  rateLimiting: {
    ibctTokenRequestsPerMinute: number
    loginAttemptsPerMinute: number
    apiRequestsPerMinute: number
  }
  agentCreation: {
    minIntervalSeconds: number
    maxAgentsPerHost: number
  }
  killSwitch: {
    maxConsecutiveAuthFailures: number
    lockoutDurationMinutes: number
  }
}

const DEFAULTS: SecurityConfig = {
  keyRotation: {
    intervalDays: 30,
    overlapDays: 7,
  },
  argon2: {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  },
  ibct: {
    defaultTtlSeconds: 3600,
    maxDelegationDepth: 3,
  },
  ledger: {
    readOnlyOnTamper: true,
    verifyOnStartup: true,
    maxEntriesPerFile: 10000,
    compactAfterEntries: 5000,
  },
  passwordPolicy: {
    minLength: 8,
    maxLength: 256,
  },
  sessionAuth: {
    sessionTtlDays: 7,
    sudoTokenTtlSeconds: 60,
  },
  rateLimiting: {
    ibctTokenRequestsPerMinute: 30,
    loginAttemptsPerMinute: 5,
    apiRequestsPerMinute: 300,
  },
  agentCreation: {
    minIntervalSeconds: 10,
    maxAgentsPerHost: 50,
  },
  killSwitch: {
    maxConsecutiveAuthFailures: 20,
    lockoutDurationMinutes: 30,
  },
}

let _cached: SecurityConfig | null = null
let _cachedPassword: string | null = null

function deriveKey(password: string, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha512', password, salt, HKDF_INFO, KEY_LENGTH))
}

function encryptConfig(config: SecurityConfig, password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(password, salt)
  const plaintext = JSON.stringify(config)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({
    version: 1,
    algorithm: ALGORITHM,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  })
}

/**
 * Validate that a decrypted config has sane values. An attacker who
 * compromises the encrypted file (or provides a crafted config via the
 * PATCH /api/settings/security endpoint) should not be able to set
 * killSwitch.maxConsecutiveAuthFailures to 999999999 or disable
 * readOnlyOnTamper. This function enforces hard lower/upper bounds
 * that the PATCH endpoint's Zod schema also checks — but defense-in-depth
 * means we validate on load as well.
 */
function clampConfig(config: Record<string, unknown>): void {
  const clamp = (obj: Record<string, unknown>, key: string, min: number, max: number) => {
    if (typeof obj[key] === 'number') obj[key] = Math.max(min, Math.min(max, obj[key] as number))
  }
  const ks = config.killSwitch as Record<string, unknown> | undefined
  if (ks) {
    clamp(ks, 'maxConsecutiveAuthFailures', 3, 100)
    clamp(ks, 'lockoutDurationMinutes', 1, 1440)
  }
  const ac = config.agentCreation as Record<string, unknown> | undefined
  if (ac) {
    clamp(ac, 'minIntervalSeconds', 1, 3600)
    clamp(ac, 'maxAgentsPerHost', 1, 500)
  }
  const rl = config.rateLimiting as Record<string, unknown> | undefined
  if (rl) {
    clamp(rl, 'loginAttemptsPerMinute', 1, 60)
    clamp(rl, 'ibctTokenRequestsPerMinute', 1, 300)
    clamp(rl, 'apiRequestsPerMinute', 10, 10000)
  }
  const pp = config.passwordPolicy as Record<string, unknown> | undefined
  if (pp) {
    clamp(pp, 'minLength', 4, 128)
    clamp(pp, 'maxLength', 8, 1024)
  }
}

function decryptConfig(blob: string, password: string): SecurityConfig | null {
  try {
    const parsed = JSON.parse(blob)
    const salt = Buffer.from(parsed.salt, 'base64')
    const iv = Buffer.from(parsed.iv, 'base64')
    const tag = Buffer.from(parsed.tag, 'base64')
    const ciphertext = Buffer.from(parsed.ciphertext, 'base64')
    const key = deriveKey(password, salt)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const config = JSON.parse(decrypted.toString('utf-8'))
    // Clamp values to sane ranges — defense against tampered encrypted files
    if (config && typeof config === 'object') clampConfig(config)
    return config
  } catch {
    return null
  }
}

export function unlockSecurityConfig(password: string): boolean {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      _cachedPassword = password
      _cached = structuredClone(DEFAULTS)
      return true
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const config = decryptConfig(raw, password)
    if (!config) return false

    _cachedPassword = password
    _cached = deepMerge(DEFAULTS, config as unknown as Partial<Record<string, unknown>>)
    return true
  } catch {
    return false
  }
}

export function reEncryptWithNewPassword(newPassword: string): void {
  const config = loadSecurityConfig()
  _cachedPassword = newPassword
  saveSecurityConfig(config)
}

export function isUnlocked(): boolean {
  // Config is considered unlocked if:
  // 1. We have a cached password (explicit unlock via login), OR
  // 2. No encrypted config file exists (first-run, using defaults — nothing to unlock)
  if (_cachedPassword !== null) return true
  try { return !fs.existsSync(CONFIG_PATH) } catch { return false }
}

export function loadSecurityConfig(): SecurityConfig {
  if (_cached) return _cached
  return structuredClone(DEFAULTS)
}

export function saveSecurityConfig(config: SecurityConfig, password?: string): void {
  const effectivePassword: string | null = password || _cachedPassword
  if (!effectivePassword) {
    throw new Error('Security config is locked — unlock with governance password first')
  }
  const pwd: string = effectivePassword
  // Cache the password if provided externally (e.g., from sudo flow)
  if (password && !_cachedPassword) _cachedPassword = password

  const encrypted = encryptConfig(config, pwd)
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${CONFIG_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, encrypted, { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_PATH)
  _cached = config
}

export function resetSecurityConfigCache(): void {
  _cached = null
}

export function lockSecurityConfig(): void {
  _cachedPassword = null
  _cached = null
}

export function getSecurityDefaults(): SecurityConfig {
  return structuredClone(DEFAULTS)
}

// LIB2-MIN-03: cap recursion depth at 10. The encrypted security-config
// PATCH endpoint feeds a user-controlled JSON object into this function;
// without a depth cap, a deeply nested overrides blob (decryptable
// because the caller knows the password) would cause stack overflow. The
// silent try/catch upstream would then swallow the error and fall back
// to defaults — a recoverable failure mode but harder to diagnose. The
// REAL config is at most 4 levels deep (e.g. `agentAuth.idleAccessTokens.maxAge`),
// so 10 levels is generous AND well below the recursion-limit ceiling.
const DEEP_MERGE_MAX_DEPTH = 10

function deepMerge<T>(defaults: T, overrides: Partial<Record<string, unknown>>, depth = 0): T {
  if (depth > DEEP_MERGE_MAX_DEPTH) {
    // Refuse to recurse further. Return defaults at this level — the caller
    // sees a partially merged structure, but the program does not crash.
    console.warn(`[security-config] deepMerge depth cap reached (${DEEP_MERGE_MAX_DEPTH}); ignoring deeper overrides`)
    return defaults
  }
  const result = { ...defaults } as Record<string, unknown>
  for (const key of Object.keys(result)) {
    const def = result[key]
    const ovr = overrides[key]
    if (def && typeof def === 'object' && !Array.isArray(def) && ovr && typeof ovr === 'object' && !Array.isArray(ovr)) {
      result[key] = deepMerge(def, ovr as Partial<Record<string, unknown>>, depth + 1)
    } else if (ovr !== undefined) {
      result[key] = ovr
    }
  }
  return result as T
}
