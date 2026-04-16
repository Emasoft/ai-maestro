import fs from 'fs'
import path from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'

const CONFIG_PATH = path.join(getStateDir(), 'security-config.json')

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

export function loadSecurityConfig(): SecurityConfig {
  if (_cached) return _cached
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    const merged = deepMerge(DEFAULTS, parsed)
    _cached = merged
    return merged
  } catch {
    const defaults = structuredClone(DEFAULTS)
    _cached = defaults
    return defaults
  }
}

export function saveSecurityConfig(config: SecurityConfig): void {
  const dir = path.dirname(CONFIG_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = `${CONFIG_PATH}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_PATH)
  _cached = config
}

export function resetSecurityConfigCache(): void {
  _cached = null
}

export function getSecurityDefaults(): SecurityConfig {
  return { ...DEFAULTS }
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
