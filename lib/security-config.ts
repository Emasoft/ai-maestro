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
  }
  passwordPolicy: {
    minLength: number
    maxLength: number
  }
  sessionAuth: {
    sessionTtlDays: number
    sudoTokenTtlSeconds: number
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
  },
  passwordPolicy: {
    minLength: 8,
    maxLength: 256,
  },
  sessionAuth: {
    sessionTtlDays: 7,
    sudoTokenTtlSeconds: 60,
  },
}

let _cached: SecurityConfig | null = null
let _encryptionKey: Buffer | null = null

function deriveKey(password: string, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha512', password, salt, HKDF_INFO, KEY_LENGTH))
}

export function unlockSecurityConfig(password: string): boolean {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      _encryptionKey = deriveKey(password, crypto.randomBytes(SALT_LENGTH))
      _cached = structuredClone(DEFAULTS)
      return true
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const blob = JSON.parse(raw)
    const salt = Buffer.from(blob.salt, 'base64')
    const iv = Buffer.from(blob.iv, 'base64')
    const tag = Buffer.from(blob.tag, 'base64')
    const ciphertext = Buffer.from(blob.ciphertext, 'base64')

    const key = deriveKey(password, salt)
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const config = JSON.parse(decrypted.toString('utf-8'))

    _encryptionKey = key
    _cached = deepMerge(DEFAULTS, config)
    return true
  } catch {
    return false
  }
}

export function isUnlocked(): boolean {
  return _encryptionKey !== null
}

export function loadSecurityConfig(): SecurityConfig {
  if (_cached) return _cached
  return structuredClone(DEFAULTS)
}

export function saveSecurityConfig(config: SecurityConfig): void {
  if (!_encryptionKey) {
    throw new Error('Security config is locked — unlock with governance password first')
  }

  const salt = crypto.randomBytes(SALT_LENGTH)
  const key = Buffer.from(_encryptionKey)
  const iv = crypto.randomBytes(IV_LENGTH)
  const plaintext = JSON.stringify(config)

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const blob = {
    version: 1,
    algorithm: ALGORITHM,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }

  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${CONFIG_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(blob), { mode: 0o600 })
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
