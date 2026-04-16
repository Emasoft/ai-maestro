import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'

const CONFIG_PATH = path.join(getStateDir(), 'security-config.enc')
const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
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
    return JSON.parse(decrypted.toString('utf-8'))
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
  return _cachedPassword !== null
}

export function loadSecurityConfig(): SecurityConfig {
  if (_cached) return _cached
  return structuredClone(DEFAULTS)
}

export function saveSecurityConfig(config: SecurityConfig): void {
  if (!_cachedPassword) {
    throw new Error('Security config is locked — unlock with governance password first')
  }

  const encrypted = encryptConfig(config, _cachedPassword)
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

export function getSecurityDefaults(): SecurityConfig {
  return structuredClone(DEFAULTS)
}

function deepMerge<T>(defaults: T, overrides: Partial<Record<string, unknown>>): T {
  const result = { ...defaults } as Record<string, unknown>
  for (const key of Object.keys(result)) {
    const def = result[key]
    const ovr = overrides[key]
    if (def && typeof def === 'object' && !Array.isArray(def) && ovr && typeof ovr === 'object' && !Array.isArray(ovr)) {
      result[key] = deepMerge(def, ovr as Partial<Record<string, unknown>>)
    } else if (ovr !== undefined) {
      result[key] = ovr
    }
  }
  return result as T
}
